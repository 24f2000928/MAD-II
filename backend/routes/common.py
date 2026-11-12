from flask import Blueprint, request, jsonify

from extensions import db
from models import Course, Notification
from utils import (ApiError, role_required, cached_exam_list, cached_exam, cached_exam_slots)

bp = Blueprint("common", __name__, url_prefix="/api")


def filter_exams(exams, args):
    q = (args.get("q") or "").strip().lower()
    course_id = args.get("course_id", type=int)
    exam_type = args.get("type")
    status = args.get("status")
    out = []
    for e in exams:
        if q and q not in f"{e['name']} {e['course_code']} {e['course_name']} {e['exam_type']}".lower():
            continue
        if course_id and e["course_id"] != course_id:
            continue
        if exam_type and e["exam_type"] != exam_type:
            continue
        if status and e["status"] != status:
            continue
        out.append(e)
    return out


@bp.get("/exams")
@role_required()
def list_exams(user):
    """Search & filter examinations (served from the Redis cache)."""
    exams = cached_exam_list()
    if user.role == "student":
        exams = [e for e in exams if e["status"] != "Draft"]
    elif user.role == "examiner":
        exams = [e for e in exams if user.id in e["examiner_ids"]]
    return jsonify(filter_exams(exams, request.args))


@bp.get("/exams/<int:exam_id>")
@role_required()
def get_exam(user, exam_id):
    exam = cached_exam(exam_id)
    if not exam or (user.role == "student" and exam["status"] == "Draft"):
        raise ApiError("Examination not found", 404)
    return jsonify(exam)


@bp.get("/exams/<int:exam_id>/slots")
@role_required()
def exam_slots(user, exam_id):
    """Examination schedule (cached with a short expiry since seats change often)."""
    exam = cached_exam(exam_id)
    if not exam:
        raise ApiError("Examination not found", 404)
    slots = cached_exam_slots(exam_id)
    if user.role == "student":
        slots = [s for s in slots if s["status"] != "Cancelled"]
    return jsonify(slots)


@bp.get("/courses")
@role_required()
def list_courses(user):
    q = Course.query
    if user.role != "admin":
        q = q.filter_by(status="Active")
    return jsonify([c.to_dict() for c in q.order_by(Course.code).all()])


@bp.get("/notifications")
@role_required()
def notifications(user):
    items = (Notification.query.filter_by(user_id=user.id)
             .order_by(Notification.created_at.desc()).limit(30).all())
    return jsonify([n.to_dict() for n in items])


@bp.post("/notifications/read")
@role_required()
def mark_read(user):
    Notification.query.filter_by(user_id=user.id, read=False).update({"read": True})
    db.session.commit()
    return jsonify({"message": "ok"})
