from collections import Counter
from datetime import datetime, timedelta

from flask import Blueprint, request, jsonify
from sqlalchemy import or_, func

from extensions import db
from models import (User, ExaminerProfile, Course, Examination, RubricCriterion, Slot, Booking,
                    Evaluation, RescheduleLog, EXAM_TYPES)
from utils import (ApiError, role_required, require, parse_date, parse_time, parse_number,
                   validate_email, validate_password, invalidate_exam, invalidate_slots, notify, queue_task)

bp = Blueprint("admin", __name__, url_prefix="/api/admin")
admin_only = role_required("admin")


# ------------------------------------------------------------- dashboard
@bp.get("/stats")
@admin_only
def stats(user):
    return jsonify({
        "courses": Course.query.count(),
        "exams": Examination.query.count(),
        "students": User.query.filter_by(role="student").count(),
        "examiners": User.query.filter_by(role="examiner").count(),
        "slots": Slot.query.count(),
        "bookings": Booking.query.count(),
        "active_bookings": Booking.query.filter_by(status="Booked").count(),
        "pending_evaluations": Booking.query.filter_by(status="Booked").join(Slot)
                                            .filter(Slot.date <= datetime.now().date()).count(),
        "exam_status": dict(db.session.query(Examination.status, func.count()).group_by(Examination.status).all()),
    })


@bp.get("/reports")
@admin_only
def reports(user):
    """Data for the ChartJS analytics on the admin reports page."""
    popular = (db.session.query(Examination.name, func.count(Booking.id))
               .join(Booking, Booking.exam_id == Examination.id)
               .filter(Booking.status != "Cancelled")
               .group_by(Examination.id).order_by(func.count(Booking.id).desc()).limit(8).all())
    workload = (db.session.query(User.name, func.count(Booking.id))
                .join(Slot, Slot.examiner_id == User.id)
                .join(Booking, Booking.slot_id == Slot.id)
                .filter(Booking.status != "Cancelled")
                .group_by(User.id).order_by(func.count(Booking.id).desc()).all())
    since = datetime.utcnow() - timedelta(days=29)
    trend = Counter(b.booked_at.date().isoformat()
                    for b in Booking.query.filter(Booking.booked_at >= since).all())
    days = [(since + timedelta(days=i)).date().isoformat() for i in range(30)]
    status = dict(db.session.query(Booking.status, func.count()).group_by(Booking.status).all())
    avg = (db.session.query(Examination.name, func.avg(Evaluation.total_marks), Examination.max_marks)
           .join(Evaluation, Evaluation.exam_id == Examination.id)
           .filter(Evaluation.status == "Submitted").group_by(Examination.id).all())
    return jsonify({
        "popular_exams": {"labels": [p[0] for p in popular], "data": [p[1] for p in popular]},
        "examiner_workload": {"labels": [w[0] for w in workload], "data": [w[1] for w in workload]},
        "booking_trend": {"labels": days, "data": [trend.get(d, 0) for d in days]},
        "booking_status": status,
        "average_scores": [{"exam": a[0], "average": round(a[1] or 0, 2), "max": a[2]} for a in avg],
    })


@bp.post("/reports/monthly")
@admin_only
def trigger_monthly_report(user):
    """Manually trigger the monthly report job (it also runs on the 1st via Celery beat)."""
    from tasks import monthly_report
    task = queue_task(monthly_report)
    return jsonify({"message": "Monthly report job queued", "task_id": task.id}), 202


@bp.post("/reminders/run")
@admin_only
def trigger_reminders(user):
    from tasks import daily_reminders
    task = queue_task(daily_reminders)
    return jsonify({"message": "Reminder job queued", "task_id": task.id}), 202


# ---------------------------------------------------------------- courses
def _course_from(data, course=None):
    require(data, "code", "name")
    code = data["code"].strip().upper()
    clash = Course.query.filter(Course.code == code)
    if course:
        clash = clash.filter(Course.id != course.id)
    if clash.first():
        raise ApiError("A course with this code already exists", 409)
    course = course or Course()
    course.code = code
    course.name = data["name"].strip()
    course.description = data.get("description")
    course.credits = parse_number(data.get("credits", 4), "credits", int, 0, 20)
    if data.get("status") in ("Active", "Archived"):
        course.status = data["status"]
    return course


@bp.get("/courses")
@admin_only
def list_courses(user):
    q = request.args.get("q", "").strip()
    query = Course.query
    if q:
        query = query.filter(or_(Course.code.ilike(f"%{q}%"), Course.name.ilike(f"%{q}%")))
    return jsonify([c.to_dict() for c in query.order_by(Course.code).all()])


@bp.post("/courses")
@admin_only
def create_course(user):
    course = _course_from(request.get_json() or {})
    db.session.add(course)
    db.session.commit()
    return jsonify(course.to_dict()), 201


@bp.put("/courses/<int:cid>")
@admin_only
def update_course(user, cid):
    course = db.get_or_404(Course, cid)
    _course_from(request.get_json() or {}, course)
    db.session.commit()
    invalidate_exam()
    for e in course.exams:
        invalidate_exam(e.id)
    return jsonify(course.to_dict())


@bp.delete("/courses/<int:cid>")
@admin_only
def delete_course(user, cid):
    course = db.get_or_404(Course, cid)
    if course.exams.count():
        # keep history intact: courses with examinations are archived instead of deleted
        course.status = "Archived"
        db.session.commit()
        return jsonify({"message": "Course has examinations, so it was archived instead of deleted"})
    db.session.delete(course)
    db.session.commit()
    return jsonify({"message": "Course deleted"})


# ------------------------------------------------------------ examinations
def _exam_from(data, exam=None):
    require(data, "course_id", "name", "exam_type", "duration", "max_marks")
    if not db.session.get(Course, int(data["course_id"])):
        raise ApiError("Course not found")
    if data["exam_type"] not in EXAM_TYPES:
        raise ApiError("Examination type must be one of: " + ", ".join(EXAM_TYPES))
    exam = exam or Examination()
    exam.course_id = int(data["course_id"])
    exam.name = data["name"].strip()
    exam.exam_type = data["exam_type"]
    exam.duration = parse_number(data["duration"], "duration", int, 5, 600)
    exam.max_marks = parse_number(data["max_marks"], "max_marks", float, 1, 1000)
    exam.instructions = data.get("instructions")
    exam.slot_creation_start = parse_date(data.get("slot_creation_start"), "slot_creation_start")
    exam.slot_creation_end = parse_date(data.get("slot_creation_end"), "slot_creation_end")
    exam.booking_start = parse_date(data.get("booking_start"), "booking_start")
    exam.booking_end = parse_date(data.get("booking_end"), "booking_end")
    for a, b, label in ((exam.slot_creation_start, exam.slot_creation_end, "Slot creation"),
                        (exam.booking_start, exam.booking_end, "Slot booking")):
        if a and b and a > b:
            raise ApiError(f"{label} start date must be before its end date")
    if exam.slot_creation_end and exam.booking_start and exam.booking_start < exam.slot_creation_end:
        raise ApiError("Booking should start after slot creation ends")
    return exam


def _set_examiners(exam, ids):
    examiners = User.query.filter(User.id.in_(ids or []), User.role == "examiner").all()
    exam.examiners = examiners


@bp.get("/exams")
@admin_only
def list_exams(user):
    q = request.args.get("q", "").strip()
    query = Examination.query.join(Course)
    if q:
        query = query.filter(or_(Examination.name.ilike(f"%{q}%"), Course.code.ilike(f"%{q}%"),
                                 Course.name.ilike(f"%{q}%")))
    for field, col in (("status", Examination.status), ("type", Examination.exam_type),
                       ("course_id", Examination.course_id)):
        if request.args.get(field):
            query = query.filter(col == request.args[field])
    out = []
    for e in query.order_by(Examination.created_at.desc()).all():
        d = e.to_dict()
        d["slot_count"] = e.slots.count()
        d["booking_count"] = Booking.query.filter(Booking.exam_id == e.id, Booking.status != "Cancelled").count()
        d["rubric_count"] = len(e.rubric)
        out.append(d)
    return jsonify(out)


@bp.post("/exams")
@admin_only
def create_exam(user):
    data = request.get_json() or {}
    exam = _exam_from(data)
    _set_examiners(exam, data.get("examiner_ids"))
    db.session.add(exam)
    db.session.commit()
    invalidate_exam(exam.id)
    return jsonify(exam.to_dict(detail=True)), 201


@bp.put("/exams/<int:eid>")
@admin_only
def update_exam(user, eid):
    exam = db.get_or_404(Examination, eid)
    data = request.get_json() or {}
    _exam_from(data, exam)
    if "examiner_ids" in data:
        _set_examiners(exam, data["examiner_ids"])
    db.session.commit()
    invalidate_exam(exam.id)
    return jsonify(exam.to_dict(detail=True))


@bp.delete("/exams/<int:eid>")
@admin_only
def delete_exam(user, eid):
    exam = db.get_or_404(Examination, eid)
    if Booking.query.filter_by(exam_id=eid).count():
        raise ApiError("This examination has bookings and cannot be deleted. Close it instead.")
    db.session.delete(exam)
    db.session.commit()
    invalidate_exam(eid)
    return jsonify({"message": "Examination deleted"})


STATUS_ACTIONS = {
    "open_slot_creation": ("Slot Creation", ("Draft", "Booking Open")),
    "close_slot_creation": ("Draft", ("Slot Creation",)),
    "open_booking": ("Booking Open", ("Draft", "Slot Creation", "Closed")),
    "close_booking": ("Closed", ("Booking Open",)),
    "complete": ("Completed", ("Closed", "Booking Open")),
    "reopen": ("Closed", ("Completed",)),
}


@bp.post("/exams/<int:eid>/status")
@admin_only
def change_exam_status(user, eid):
    """Open / close examiner slot creation and student slot booking."""
    exam = db.get_or_404(Examination, eid)
    action = (request.get_json() or {}).get("action")
    if action not in STATUS_ACTIONS:
        raise ApiError("Unknown action")
    target, allowed_from = STATUS_ACTIONS[action]
    if exam.status not in allowed_from:
        raise ApiError(f"Cannot {action.replace('_', ' ')} while examination is '{exam.status}'")
    if target == "Booking Open" and not exam.slots.filter(Slot.status != "Cancelled").count():
        raise ApiError("No slots have been created yet for this examination")
    exam.status = target
    if target == "Slot Creation":
        for ex in exam.examiners:
            notify(ex.id, f"Slot creation is open for '{exam.name}'. Please add your available slots.",
                   f"/examiner/exams/{exam.id}")
    db.session.commit()
    invalidate_exam(exam.id)
    return jsonify(exam.to_dict(detail=True))


@bp.post("/exams/<int:eid>/publish")
@admin_only
def publish_results(user, eid):
    exam = db.get_or_404(Examination, eid)
    publish = (request.get_json() or {}).get("publish", True)
    if publish:
        pending = Booking.query.filter_by(exam_id=eid, status="Booked").count()
        if pending and not (request.get_json() or {}).get("force"):
            raise ApiError(f"{pending} booking(s) are still pending evaluation. Publish anyway with force.", 409)
        exam.results_published = True
        exam.published_at = datetime.utcnow()
        evaluated = Evaluation.query.filter_by(exam_id=eid, status="Submitted").all()
        for ev in evaluated:
            notify(ev.student_id, f"Results for '{exam.name}' have been published.", "/student/results")
    else:
        exam.results_published = False
    db.session.commit()
    invalidate_exam(eid)
    if publish:
        try:
            from tasks import send_result_emails
            queue_task(send_result_emails, eid)
        except ApiError:
            pass  # results are published (and notified in-app) even if the broker is down
    return jsonify(exam.to_dict(detail=True))


# ---------------------------------------------------------------- rubrics
def _criterion_from(data, crit):
    require(data, "name", "max_marks")
    crit.name = data["name"].strip()
    crit.max_marks = parse_number(data["max_marks"], "max_marks", float, 0.5, 1000)
    crit.weightage = parse_number(data.get("weightage", 0) or 0, "weightage", float, 0, 100)
    crit.description = data.get("description")
    return crit


def _check_weightage(exam, extra_crit=None):
    total = sum(c.weightage or 0 for c in exam.rubric if c is not extra_crit) + (extra_crit.weightage if extra_crit else 0)
    if total > 100.0001:
        raise ApiError(f"Total weightage would be {total:g}%, which exceeds 100%")


def _rubric_locked(exam):
    if Evaluation.query.filter_by(exam_id=exam.id).count():
        raise ApiError("Rubric cannot change after evaluations have started")


@bp.get("/exams/<int:eid>/rubric")
@admin_only
def get_rubric(user, eid):
    exam = db.get_or_404(Examination, eid)
    return jsonify([c.to_dict() for c in exam.rubric])


@bp.post("/exams/<int:eid>/rubric")
@admin_only
def add_criterion(user, eid):
    exam = db.get_or_404(Examination, eid)
    _rubric_locked(exam)
    crit = _criterion_from(request.get_json() or {}, RubricCriterion(exam_id=eid))
    _check_weightage(exam, crit)
    db.session.add(crit)
    db.session.commit()
    invalidate_exam(eid)
    return jsonify(crit.to_dict()), 201


@bp.put("/rubric/<int:cid>")
@admin_only
def update_criterion(user, cid):
    crit = db.get_or_404(RubricCriterion, cid)
    _rubric_locked(crit.exam)
    _criterion_from(request.get_json() or {}, crit)
    _check_weightage(crit.exam, crit)
    db.session.commit()
    invalidate_exam(crit.exam_id)
    return jsonify(crit.to_dict())


@bp.delete("/rubric/<int:cid>")
@admin_only
def delete_criterion(user, cid):
    crit = db.get_or_404(RubricCriterion, cid)
    _rubric_locked(crit.exam)
    eid = crit.exam_id
    db.session.delete(crit)
    db.session.commit()
    invalidate_exam(eid)
    return jsonify({"message": "Criterion removed"})


# -------------------------------------------------------------- examiners
@bp.get("/examiners")
@admin_only
def list_examiners(user):
    q = request.args.get("q", "").strip()
    query = User.query.filter_by(role="examiner").outerjoin(ExaminerProfile)
    if q:
        query = query.filter(or_(User.name.ilike(f"%{q}%"), User.email.ilike(f"%{q}%"),
                                 ExaminerProfile.department.ilike(f"%{q}%")))
    out = []
    for u in query.order_by(User.name).all():
        d = u.to_dict()
        d["assigned_exams"] = [{"id": e.id, "name": e.name} for e in u.assigned_exams]
        d["slot_count"] = Slot.query.filter_by(examiner_id=u.id).count()
        out.append(d)
    return jsonify(out)


@bp.post("/examiners")
@admin_only
def create_examiner(user):
    data = request.get_json() or {}
    require(data, "name", "email", "password")
    email = validate_email(data["email"])
    validate_password(data["password"])
    if User.query.filter_by(email=email).first():
        raise ApiError("An account with this email already exists", 409)
    ex = User(email=email, name=data["name"].strip(), phone=data.get("phone"), role="examiner")
    ex.set_password(data["password"])
    ex.examiner_profile = ExaminerProfile(department=data.get("department"), designation=data.get("designation"))
    db.session.add(ex)
    db.session.commit()
    return jsonify(ex.to_dict()), 201


@bp.put("/examiners/<int:uid>")
@admin_only
def update_examiner(user, uid):
    ex = User.query.filter_by(id=uid, role="examiner").first_or_404()
    data = request.get_json() or {}
    if data.get("name"):
        ex.name = data["name"].strip()
    if "phone" in data:
        ex.phone = data["phone"]
    if data.get("email"):
        email = validate_email(data["email"])
        if User.query.filter(User.email == email, User.id != uid).first():
            raise ApiError("Email already in use", 409)
        ex.email = email
    if data.get("password"):
        ex.set_password(validate_password(data["password"]))
    if "active" in data:
        ex.active = bool(data["active"])
    prof = ex.examiner_profile or ExaminerProfile(user_id=ex.id)
    for f in ("department", "designation"):
        if f in data:
            setattr(prof, f, data[f])
    if data.get("examiner_status") in ("Active", "On Leave", "Inactive"):
        prof.status = data["examiner_status"]
    ex.examiner_profile = prof
    db.session.commit()
    invalidate_exam()
    return jsonify(ex.to_dict())


@bp.delete("/examiners/<int:uid>")
@admin_only
def remove_examiner(user, uid):
    ex = User.query.filter_by(id=uid, role="examiner").first_or_404()
    if Slot.query.filter_by(examiner_id=uid).count():
        ex.active = False
        if ex.examiner_profile:
            ex.examiner_profile.status = "Inactive"
        db.session.commit()
        return jsonify({"message": "Examiner has slot history, so the account was deactivated"})
    db.session.delete(ex)
    db.session.commit()
    invalidate_exam()
    return jsonify({"message": "Examiner removed"})


# --------------------------------------------------------------- students
@bp.get("/students")
@admin_only
def list_students(user):
    from models import StudentProfile
    q = request.args.get("q", "").strip()
    query = User.query.filter_by(role="student").outerjoin(StudentProfile)
    if q:
        query = query.filter(or_(User.name.ilike(f"%{q}%"), User.email.ilike(f"%{q}%"),
                                 StudentProfile.roll_no.ilike(f"%{q}%")))
    out = []
    for u in query.order_by(User.name).all():
        d = u.to_dict()
        d["booking_count"] = Booking.query.filter_by(student_id=u.id).count()
        out.append(d)
    return jsonify(out)


@bp.get("/students/<int:uid>")
@admin_only
def student_detail(user, uid):
    st = User.query.filter_by(id=uid, role="student").first_or_404()
    bookings = Booking.query.filter_by(student_id=uid).order_by(Booking.booked_at.desc()).all()
    return jsonify({"student": st.to_dict(), "bookings": [b.to_dict(include_eval=True) for b in bookings]})


@bp.put("/students/<int:uid>")
@admin_only
def update_student(user, uid):
    st = User.query.filter_by(id=uid, role="student").first_or_404()
    data = request.get_json() or {}
    if "active" in data:
        st.active = bool(data["active"])
    if data.get("name"):
        st.name = data["name"].strip()
    db.session.commit()
    return jsonify(st.to_dict())


# ------------------------------------------------------------------ slots
@bp.get("/slots")
@admin_only
def list_slots(user):
    query = Slot.query.join(Examination).join(User, Slot.examiner_id == User.id)
    for field, col in (("exam_id", Slot.exam_id), ("examiner_id", Slot.examiner_id), ("status", Slot.status)):
        if request.args.get(field):
            query = query.filter(col == request.args[field])
    if request.args.get("date"):
        query = query.filter(Slot.date == parse_date(request.args["date"]))
    q = request.args.get("q", "").strip()
    if q:
        query = query.filter(or_(Examination.name.ilike(f"%{q}%"), User.name.ilike(f"%{q}%")))
    return jsonify([s.to_dict() for s in query.order_by(Slot.date, Slot.start_time).all()])


@bp.put("/slots/<int:sid>")
@admin_only
def admin_update_slot(user, sid):
    """Reschedule a whole slot and/or change its assigned examiner (exceptional situations)."""
    slot = db.get_or_404(Slot, sid)
    data = request.get_json() or {}
    changes = []
    if data.get("date"):
        slot.date = parse_date(data["date"])
        changes.append("date")
    if data.get("start_time"):
        slot.start_time = parse_time(data["start_time"], "start_time")
        changes.append("time")
    if data.get("end_time"):
        slot.end_time = parse_time(data["end_time"], "end_time")
    if slot.end_time <= slot.start_time:
        raise ApiError("End time must be after start time")
    if data.get("examiner_id") and int(data["examiner_id"]) != slot.examiner_id:
        ex = User.query.filter_by(id=int(data["examiner_id"]), role="examiner", active=True).first()
        if not ex:
            raise ApiError("Examiner not found")
        if ex not in slot.exam.examiners:
            slot.exam.examiners.append(ex)
        slot.examiner_id = ex.id
        changes.append("examiner")
    if "meeting_link" in data:
        slot.meeting_link = data["meeting_link"]
    if data.get("status") in ("Available", "Cancelled", "Completed"):
        slot.status = data["status"]
        slot.refresh_status()
    if changes:
        for b in slot.bookings.filter_by(status="Booked"):
            notify(b.student_id, f"Your slot for '{slot.exam.name}' was updated by the admin "
                                 f"({', '.join(changes)} changed).", "/student/bookings")
    db.session.commit()
    invalidate_exam(slot.exam_id)
    return jsonify(slot.to_dict())


# --------------------------------------------------------------- bookings
@bp.get("/bookings")
@admin_only
def list_bookings(user):
    from models import StudentProfile
    query = (Booking.query.join(Slot).join(Examination, Booking.exam_id == Examination.id)
             .join(User, Booking.student_id == User.id).outerjoin(StudentProfile))
    for field, col in (("exam_id", Booking.exam_id), ("status", Booking.status),
                       ("examiner_id", Slot.examiner_id), ("student_id", Booking.student_id)):
        if request.args.get(field):
            query = query.filter(col == request.args[field])
    q = request.args.get("q", "").strip()
    if q:
        query = query.filter(or_(User.name.ilike(f"%{q}%"), User.email.ilike(f"%{q}%"),
                                 StudentProfile.roll_no.ilike(f"%{q}%"), Examination.name.ilike(f"%{q}%")))
    return jsonify([b.to_dict(include_eval=True) for b in query.order_by(Booking.booked_at.desc()).all()])


@bp.post("/bookings/<int:bid>/reschedule")
@admin_only
def reschedule_booking(user, bid):
    """Move a booking to another slot of the same exam. Choosing a slot that belongs to
    a different examiner effectively reassigns the student to that examiner."""
    booking = db.get_or_404(Booking, bid)
    data = request.get_json() or {}
    require(data, "slot_id")
    if booking.status != "Booked":
        raise ApiError("Only active bookings can be rescheduled")
    if booking.evaluation and booking.evaluation.status == "Submitted":
        raise ApiError("This booking has already been evaluated")
    new_slot = db.get_or_404(Slot, int(data["slot_id"]))
    if new_slot.exam_id != booking.exam_id:
        raise ApiError("The new slot must belong to the same examination")
    if new_slot.id == booking.slot_id:
        raise ApiError("Booking is already in this slot")
    if new_slot.status in ("Cancelled", "Completed"):
        raise ApiError("Target slot is not open")
    if new_slot.available_seats <= 0:
        raise ApiError("Target slot is full")

    old = booking.slot
    old.available_seats += 1
    old.refresh_status()
    new_slot.available_seats -= 1
    new_slot.refresh_status()
    booking.slot_id = new_slot.id
    if booking.evaluation:  # drop any draft by the previous examiner
        db.session.delete(booking.evaluation)
    db.session.add(RescheduleLog(booking_id=bid, old_slot_id=old.id, new_slot_id=new_slot.id,
                                 reason=data.get("reason"), changed_by=user.id))
    notify(booking.student_id,
           f"Your '{booking.exam.name}' slot was moved to {new_slot.date} {new_slot.start_time:%H:%M} "
           f"with {new_slot.examiner.name}.", "/student/bookings")
    if old.examiner_id != new_slot.examiner_id:
        notify(new_slot.examiner_id, f"{booking.student.name} was assigned to your slot for '{booking.exam.name}'.")
    db.session.commit()
    invalidate_slots(booking.exam_id)
    return jsonify(booking.to_dict(include_eval=True))


@bp.get("/bookings/<int:bid>/history")
@admin_only
def booking_history(user, bid):
    logs = RescheduleLog.query.filter_by(booking_id=bid).order_by(RescheduleLog.changed_at.desc()).all()
    out = []
    for l in logs:
        o, n = db.session.get(Slot, l.old_slot_id), db.session.get(Slot, l.new_slot_id)
        out.append({"changed_at": l.changed_at.isoformat(timespec="seconds"), "reason": l.reason,
                    "from": f"{o.date} {o.start_time:%H:%M} ({o.examiner.name})" if o else None,
                    "to": f"{n.date} {n.start_time:%H:%M} ({n.examiner.name})" if n else None})
    return jsonify(out)


@bp.post("/bookings/<int:bid>/cancel")
@admin_only
def admin_cancel_booking(user, bid):
    booking = db.get_or_404(Booking, bid)
    if booking.status != "Booked":
        raise ApiError("Only active bookings can be cancelled")
    booking.status = "Cancelled"
    booking.cancelled_at = datetime.utcnow()
    booking.slot.available_seats += 1
    booking.slot.refresh_status()
    notify(booking.student_id, f"Your booking for '{booking.exam.name}' was cancelled by the admin.")
    db.session.commit()
    invalidate_slots(booking.exam_id)
    return jsonify(booking.to_dict())
