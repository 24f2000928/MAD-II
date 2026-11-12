from datetime import datetime

from flask import Blueprint, request, jsonify

from extensions import db
from models import Examination, Slot, Booking, Evaluation, EvaluationScore
from utils import (ApiError, role_required, require, parse_date, parse_time, parse_number, today,
                   overlaps, invalidate_exam, invalidate_slots, notify, compute_total)

bp = Blueprint("examiner", __name__, url_prefix="/api/examiner")
examiner_only = role_required("examiner")


def _assigned_exam(user, exam_id):
    exam = db.get_or_404(Examination, exam_id)
    if user not in exam.examiners:
        raise ApiError("You are not assigned to this examination", 403)
    return exam


def _own_slot(user, slot_id):
    slot = db.get_or_404(Slot, slot_id)
    if slot.examiner_id != user.id:
        raise ApiError("This slot belongs to another examiner", 403)
    return slot


def _own_booking(user, booking_id):
    booking = db.get_or_404(Booking, booking_id)
    if booking.slot.examiner_id != user.id:
        raise ApiError("You can only evaluate students booked into your slots", 403)
    return booking


@bp.get("/dashboard")
@examiner_only
def dashboard(user):
    exams = user.assigned_exams.all()
    slots = Slot.query.filter_by(examiner_id=user.id)
    bookings = Booking.query.join(Slot).filter(Slot.examiner_id == user.id, Booking.status != "Cancelled")
    pending = bookings.filter(Booking.status == "Booked").all()
    upcoming = (slots.filter(Slot.date >= today(), Slot.status.in_(("Available", "Full")))
                .order_by(Slot.date, Slot.start_time).limit(5).all())
    return jsonify({
        "assigned_exams": [e.to_dict() for e in exams],
        "slot_count": slots.count(),
        "booked_students": bookings.count(),
        "pending_evaluations": len(pending),
        "pending": [b.to_dict() for b in pending if b.slot.date <= today()][:10],
        "upcoming_slots": [s.to_dict() for s in upcoming],
    })


# ------------------------------------------------------------------ slots
@bp.get("/exams/<int:eid>/slots")
@examiner_only
def my_slots(user, eid):
    exam = _assigned_exam(user, eid)
    slots = Slot.query.filter_by(exam_id=eid, examiner_id=user.id).order_by(Slot.date, Slot.start_time).all()
    return jsonify({"exam": exam.to_dict(detail=True), "slots": [s.to_dict() for s in slots],
                    "can_create": exam.slot_creation_allowed()})


def _validate_slot(user, exam, data, slot=None):
    require(data, "date", "start_time", "end_time")
    d = parse_date(data["date"], "date")
    st, et = parse_time(data["start_time"], "start_time"), parse_time(data["end_time"], "end_time")
    if d < today():
        raise ApiError("Slot date cannot be in the past")
    if et <= st:
        raise ApiError("End time must be after start time")
    cap = parse_number(data.get("capacity", 1), "capacity", int, 1, 200)
    # no overlapping slots for the same examiner on the same day (across all exams)
    q = Slot.query.filter(Slot.examiner_id == user.id, Slot.date == d, Slot.status != "Cancelled")
    if slot:
        q = q.filter(Slot.id != slot.id)
    for other in q:
        if overlaps(st, et, other.start_time, other.end_time):
            raise ApiError(f"Overlaps with your slot {other.start_time:%H:%M}-{other.end_time:%H:%M} "
                           f"for '{other.exam.name}'")
    link = (data.get("meeting_link") or "").strip() or None
    if link and not link.startswith(("http://", "https://")):
        raise ApiError("Meeting link must start with http:// or https://")
    return d, st, et, cap, link


@bp.post("/exams/<int:eid>/slots")
@examiner_only
def create_slot(user, eid):
    exam = _assigned_exam(user, eid)
    if not exam.slot_creation_allowed():
        raise ApiError("Slot creation is not open for this examination right now")
    d, st, et, cap, link = _validate_slot(user, exam, request.get_json() or {})
    slot = Slot(exam_id=eid, examiner_id=user.id, date=d, start_time=st, end_time=et,
                capacity=cap, available_seats=cap, meeting_link=link)
    db.session.add(slot)
    db.session.commit()
    invalidate_slots(eid)
    return jsonify(slot.to_dict()), 201


def _editable(slot):
    if slot.exam.status not in ("Draft", "Slot Creation"):
        raise ApiError("Slots can only be changed before student booking begins")
    if slot.bookings.filter(Booking.status != "Cancelled").count():
        raise ApiError("This slot already has bookings")


@bp.put("/slots/<int:sid>")
@examiner_only
def update_slot(user, sid):
    slot = _own_slot(user, sid)
    _editable(slot)
    d, st, et, cap, link = _validate_slot(user, slot.exam, request.get_json() or {}, slot)
    slot.date, slot.start_time, slot.end_time, slot.meeting_link = d, st, et, link
    slot.capacity = slot.available_seats = cap
    slot.refresh_status()
    db.session.commit()
    invalidate_slots(slot.exam_id)
    return jsonify(slot.to_dict())


@bp.delete("/slots/<int:sid>")
@examiner_only
def delete_slot(user, sid):
    slot = _own_slot(user, sid)
    _editable(slot)
    eid = slot.exam_id
    db.session.delete(slot)
    db.session.commit()
    invalidate_slots(eid)
    return jsonify({"message": "Slot removed"})


@bp.post("/slots/<int:sid>/meeting-link")
@examiner_only
def set_meeting_link(user, sid):
    """Meeting links may be added/changed at any time (does not affect bookings)."""
    slot = _own_slot(user, sid)
    link = ((request.get_json() or {}).get("meeting_link") or "").strip() or None
    if link and not link.startswith(("http://", "https://")):
        raise ApiError("Meeting link must start with http:// or https://")
    slot.meeting_link = link
    db.session.commit()
    invalidate_slots(slot.exam_id)
    return jsonify(slot.to_dict())


@bp.post("/slots/<int:sid>/complete")
@examiner_only
def complete_slot(user, sid):
    slot = _own_slot(user, sid)
    pending = slot.bookings.filter_by(status="Booked").count()
    if pending:
        raise ApiError(f"{pending} student(s) in this slot are not evaluated yet (mark absent or evaluate)")
    slot.status = "Completed"
    db.session.commit()
    invalidate_slots(slot.exam_id)
    return jsonify(slot.to_dict())


@bp.get("/slots/<int:sid>/bookings")
@examiner_only
def slot_bookings(user, sid):
    slot = _own_slot(user, sid)
    items = slot.bookings.filter(Booking.status != "Cancelled").all()
    return jsonify({"slot": slot.to_dict(), "bookings": [b.to_dict(include_eval=True) for b in items]})


# --------------------------------------------------------------- bookings
@bp.get("/bookings")
@examiner_only
def my_bookings(user):
    q = Booking.query.join(Slot).filter(Slot.examiner_id == user.id, Booking.status != "Cancelled")
    if request.args.get("exam_id"):
        q = q.filter(Booking.exam_id == int(request.args["exam_id"]))
    if request.args.get("status"):
        q = q.filter(Booking.status == request.args["status"])
    return jsonify([b.to_dict(include_eval=True) for b in q.order_by(Slot.date, Slot.start_time).all()])


@bp.get("/bookings/<int:bid>/evaluation")
@examiner_only
def get_evaluation(user, bid):
    booking = _own_booking(user, bid)
    return jsonify({"booking": booking.to_dict(include_eval=True),
                    "exam": booking.exam.to_dict(detail=True)})


@bp.post("/bookings/<int:bid>/evaluation")
@examiner_only
def submit_evaluation(user, bid):
    """Score a student against the predefined rubric. `submit=false` saves a draft."""
    booking = _own_booking(user, bid)
    exam = booking.exam
    data = request.get_json() or {}
    if booking.status not in ("Booked", "Completed"):
        raise ApiError("This booking cannot be evaluated")
    if exam.results_published:
        raise ApiError("Results are already published; evaluation is locked")
    if booking.slot.date > today():
        raise ApiError("You can evaluate only after the examination date")
    criteria = {c.id: c for c in exam.rubric}
    if not criteria:
        raise ApiError("No rubric has been defined for this examination yet")

    given = {int(s["criterion_id"]): s for s in data.get("scores", []) if s.get("criterion_id") is not None}
    submit = bool(data.get("submit"))
    if submit and set(given) != set(criteria):
        raise ApiError("Please score every rubric criterion before submitting")

    ev = booking.evaluation or Evaluation(booking_id=bid, student_id=booking.student_id,
                                          examiner_id=user.id, exam_id=exam.id)
    ev.examiner_id = user.id
    ev.scores = []
    pairs = []
    for cid, s in given.items():
        crit = criteria.get(cid)
        if not crit:
            raise ApiError(f"Criterion {cid} does not belong to this examination")
        marks = parse_number(s.get("marks"), f"marks for '{crit.name}'", float, 0, crit.max_marks)
        ev.scores.append(EvaluationScore(criterion_id=cid, marks=marks, comment=(s.get("comment") or "")[:300]))
        pairs.append((crit, marks))
    ev.total_marks = compute_total(exam, pairs)
    ev.remarks = data.get("remarks")
    ev.evaluated_at = datetime.utcnow()
    ev.status = "Submitted" if submit else "Draft"
    if submit:
        booking.status = "Completed"
    db.session.add(ev)
    db.session.commit()
    return jsonify(booking.to_dict(include_eval=True))


@bp.post("/bookings/<int:bid>/absent")
@examiner_only
def mark_absent(user, bid):
    booking = _own_booking(user, bid)
    if booking.status != "Booked":
        raise ApiError("Only booked students can be marked absent")
    if booking.slot.date > today():
        raise ApiError("You can mark attendance only on/after the examination date")
    booking.status = "Absent"
    notify(booking.student_id, f"You were marked absent for '{booking.exam.name}'.")
    db.session.commit()
    return jsonify(booking.to_dict(include_eval=True))


@bp.post("/exams/<int:eid>/complete")
@examiner_only
def complete_exam(user, eid):
    """Examiner marks their part of an exam done; when every slot of the exam is
    finished and booking is closed, the examination itself becomes Completed."""
    exam = _assigned_exam(user, eid)
    mine = Slot.query.filter(Slot.exam_id == eid, Slot.examiner_id == user.id,
                             Slot.status.in_(("Available", "Full"))).all()
    for s in mine:
        if s.bookings.filter_by(status="Booked").count():
            raise ApiError(f"Slot on {s.date} {s.start_time:%H:%M} still has pending evaluations")
        s.status = "Completed"
    remaining = Slot.query.filter(Slot.exam_id == eid, Slot.status.in_(("Available", "Full"))).count()
    if not remaining and exam.status in ("Closed", "Booking Open"):
        exam.status = "Completed"
    db.session.commit()
    invalidate_exam(eid)
    return jsonify(exam.to_dict())
