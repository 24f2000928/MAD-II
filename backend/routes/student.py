import os
from datetime import datetime

from flask import Blueprint, request, jsonify, send_from_directory, current_app
from sqlalchemy.exc import IntegrityError

from extensions import db
from models import Examination, Slot, Booking
from utils import ApiError, role_required, require, today, overlaps, invalidate_slots, notify, cached_exam_list, queue_task
from routes.common import filter_exams

bp = Blueprint("student", __name__, url_prefix="/api/student")
student_only = role_required("student")


def _my_bookings(user):
    return Booking.query.filter_by(student_id=user.id).order_by(Booking.booked_at.desc()).all()


def _public_booking(b):
    """Hide marks/remarks until the admin publishes results."""
    d = b.to_dict(include_eval=True)
    if not b.exam.results_published or not b.evaluation or b.evaluation.status != "Submitted":
        d["evaluation"] = None
    return d


@bp.get("/dashboard")
@student_only
def dashboard(user):
    bookings = _my_bookings(user)
    booked_exam_ids = {b.exam_id for b in bookings if b.status != "Cancelled"}
    open_exams = [e for e in cached_exam_list() if e["status"] == "Booking Open"]
    upcoming = sorted([b for b in bookings if b.status == "Booked" and b.slot.date >= today()],
                      key=lambda b: (b.slot.date, b.slot.start_time))
    results = [b for b in bookings if b.exam.results_published and b.evaluation
               and b.evaluation.status == "Submitted"]
    open_slot_count = (Slot.query.join(Examination)
                       .filter(Examination.status == "Booking Open", Slot.status == "Available",
                               Slot.date >= today()).count())
    return jsonify({
        "available_exams": [dict(e, booked=e["id"] in booked_exam_ids) for e in open_exams],
        "available_slot_count": open_slot_count,
        "upcoming": [_public_booking(b) for b in upcoming],
        "booked_count": len([b for b in bookings if b.status == "Booked"]),
        "results": [_public_booking(b) for b in results][:5],
        "result_count": len(results),
    })


@bp.get("/exams")
@student_only
def browse_exams(user):
    exams = [e for e in cached_exam_list() if e["status"] != "Draft"]
    booked = {b.exam_id: b.status for b in Booking.query.filter(Booking.student_id == user.id,
                                                                Booking.status != "Cancelled")}
    return jsonify([dict(e, booked=e["id"] in booked) for e in filter_exams(exams, request.args)])


@bp.post("/bookings")
@student_only
def book_slot(user):
    data = request.get_json() or {}
    require(data, "slot_id")
    slot = db.session.get(Slot, int(data["slot_id"]))
    if not slot:
        raise ApiError("Slot not found", 404)
    exam = slot.exam
    if not exam.booking_allowed():
        raise ApiError("Booking is not open for this examination")
    if slot.status != "Available" or slot.available_seats <= 0:
        raise ApiError("This slot is no longer available")
    if slot.date < today():
        raise ApiError("This slot is in the past")
    if Booking.query.filter(Booking.student_id == user.id, Booking.exam_id == exam.id,
                            Booking.status != "Cancelled").first():
        raise ApiError("You have already booked a slot for this examination", 409)
    # avoid clashing with another exam booked at the same time
    for b in Booking.query.join(Slot).filter(Booking.student_id == user.id, Booking.status == "Booked",
                                             Slot.date == slot.date):
        if overlaps(slot.start_time, slot.end_time, b.slot.start_time, b.slot.end_time):
            raise ApiError(f"Clashes with your booking for '{b.exam.name}' at {b.slot.start_time:%H:%M}")

    # Atomic seat decrement: the WHERE clause guarantees we never go below zero,
    # even if two students click "Book" on the last seat at the same moment.
    updated = (Slot.query.filter(Slot.id == slot.id, Slot.available_seats > 0)
               .update({Slot.available_seats: Slot.available_seats - 1}, synchronize_session=False))
    if not updated:
        db.session.rollback()
        raise ApiError("Sorry, this slot just became full", 409)
    db.session.refresh(slot)
    slot.refresh_status()  # mark Full automatically when capacity is reached
    booking = Booking(student_id=user.id, slot_id=slot.id, exam_id=exam.id)
    db.session.add(booking)
    notify(user.id, f"Booked '{exam.name}' on {slot.date} at {slot.start_time:%H:%M}.", "/student/bookings")
    try:
        db.session.commit()
    except IntegrityError:  # unique partial index: one active booking per exam
        db.session.rollback()
        raise ApiError("You have already booked a slot for this examination", 409)
    invalidate_slots(exam.id)
    return jsonify(booking.to_dict()), 201


@bp.get("/bookings")
@student_only
def my_bookings(user):
    status = request.args.get("status")
    items = [b for b in _my_bookings(user) if not status or b.status == status]
    return jsonify([_public_booking(b) for b in items])


@bp.post("/bookings/<int:bid>/cancel")
@student_only
def cancel_booking(user, bid):
    booking = Booking.query.filter_by(id=bid, student_id=user.id).first_or_404()
    exam = booking.exam
    if booking.status != "Booked":
        raise ApiError("Only active bookings can be cancelled")
    if exam.booking_end and today() > exam.booking_end:
        raise ApiError("The booking deadline has passed; cancellation is no longer allowed")
    if exam.status != "Booking Open":
        raise ApiError("Booking is closed for this examination; cancellation is not allowed")
    booking.status = "Cancelled"
    booking.cancelled_at = datetime.utcnow()
    slot = booking.slot
    slot.available_seats += 1
    slot.refresh_status()
    notify(user.id, f"Cancelled your booking for '{exam.name}'.")
    db.session.commit()
    invalidate_slots(exam.id)
    return jsonify(booking.to_dict())


@bp.get("/results")
@student_only
def results(user):
    items = [b for b in _my_bookings(user)
             if b.exam.results_published and b.evaluation and b.evaluation.status == "Submitted"]
    return jsonify([_public_booking(b) for b in items])


# --------------------------------------------------- async CSV export (Celery)
@bp.post("/export")
@student_only
def export_history(user):
    from tasks import export_history_csv
    task = queue_task(export_history_csv, user.id)
    return jsonify({"task_id": task.id, "message": "Export started. You'll be notified when it is ready."}), 202


@bp.get("/export/<task_id>")
@student_only
def export_status(user, task_id):
    from celery_app import celery
    res = celery.AsyncResult(task_id)
    out = {"state": res.state}
    if res.successful():
        result = res.result or {}
        if result.get("user_id") != user.id:
            raise ApiError("Not your export", 403)
        out["file"] = result.get("file")
    return jsonify(out)


@bp.get("/exports/<path:filename>")
@student_only
def download_export(user, filename):
    if not filename.startswith(f"history_{user.id}_") or "/" in filename or "\\" in filename:
        raise ApiError("Not your export", 403)
    directory = current_app.config["EXPORT_DIR"]
    if not os.path.exists(os.path.join(directory, filename)):
        raise ApiError("File not found", 404)
    return send_from_directory(directory, filename, as_attachment=True, mimetype="text/csv")
