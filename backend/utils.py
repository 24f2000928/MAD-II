import re
from datetime import datetime, date, time
from functools import wraps

from flask import jsonify
from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity

from extensions import db, cache
from models import User, Examination, Slot

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

class ApiError(Exception):
    def __init__(self,message, status=400):
        super().__init__(message)
        self.message = message
        self.status = status

def error(message, status=400):
    return jsonify({"error": message}), status

#----auth-----
def current_user():
    uid = get_jwt_identity()
    return db.session.get(User, int(uid)) if uid else None

def role_required(*roles):
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            user = current_user()
            if not user or not user.active:
                return error("Account not found or deactivated", 401)
            if roles and user.role not in roles:
                return error("You do not have permission to access this resource", 403)
            return fn(*args, **kwargs)
        return wrapper
    return decorator

#----validation-----
def require(data, *fields):
    missing = [f for f in fields if data.get(f) in (None, "")]
    if missing:
        raise ApiError("Missing required field(s): " + ", ".join(missing))

def parse_date(v, field="date", required=False):
    if v in (None, ""):
        if required:
            raise ApiError(f"{field} is required")
        return None
    try:
        return datetime.strptime(v, "%Y-%m-%d").date()
    except (TypeError, ValueError):
        raise ApiError(f"{field} must be in YYYY-MM-DD format")

def parse_time(v, field="time"):
    try:
        return datetime.strptime(v, "%H:%M").time()
    except (TypeError, ValueError):
        raise ApiError(f"{field} must be in HH:MM format")

def parse_number(v, field, cast=float, minimum=None, maximum=None):
    try:
        n = cast(v)
    except (TypeError, ValueError):
        raise ApiError(f"{field} must be a number")
    if minimum is not None and n < minimum:
        raise ApiError(f"{field} must be at least {minimum}")
    if maximum is not None and n > maximum:
        raise ApiError(f"{field} must be at most {maximum}")
    return n

def validate_email(email):
    if not email or not EMAIL_RE.match(email):
        raise ApiError("Please provide a valid email address")
    return email.strip().lower()

def validate_password(pw):
    if not pw or len(pw) < 6:
        raise ApiError("Password must be at least 6 characters long")
    return pw


#----Caching-----
EXAM_TTL = 300
SLOTS_TTL = 60

def _safe_get(key):
    try:
        return cache.get(key)
    except Exception:
        return None

def _safe_set(key,value,timeout):
    try:
        cache.set(key,value,timeout=timeout)
    except Exception:
        pass

def _safe_delete(*keys):
    try:
        cache.delete_many(*keys)
    except Exception:
        pass

def cached_exam_list():
    key="exams:all"
    data = _safe_get(key)
    if data is None:
        data = [e.to_dict() for e in Examination.query.order_by(Examination.created_at.desc()).all()]
        _safe_set(key,data,EXAM_TTL)
    return data

def cached_exam(exam_id):
    key =f"exam:{exam_id}"
    data = _safe_get(key)
    if data is None:
        exam = db.session.get(Examination, exam_id)
        if not exam:
            return None
        data = exam.to_dict()
        _safe_set(key,data,EXAM_TTL)   
    return data

def cached_rubric(exam_id):
    exam = cached_exam(exam_id)
    return exam["rubric"] if exam else []

def cached_exam_slots(exam_id):
    key = f"exam:{exam_id}:slots"
    data = _safe_get(key)
    if data is None:
        slots = (Slot.query.filter_by(exam_id=exam_id)
                 .order_by(Slot.date, Slot.start_time).all())
        data = [s.to_dict() for s in slots]
        _safe_set(key,data,SLOTS_TTL)
    return data

def invalidate_exam(exam_id=None):
    keys = ["exams:all"]
    if exam_id:
        keys += [f"exam:{exam_id}", f"exam:{exam_id}:slots"]
    _safe_delete(*keys)

def invalidate_slots(slot_id):
    _safe_delete(f"exam:{slot_id}:slots")

def queue_task(task, *args):
    from config import Config
    try:
        import redis
        redis.Redis.from_url(Config.CELERY_BROKER_URL, socket_connect_timeout=1).ping()
        return task.delay(*args)
    except Exception:
        raise ApiError("Background worker is unavailable. Make sure Redis and Celery are running .", 503)

def notify(user_id, message, link=None):
    from models import Notification
    db.session.add(Notification(user_id=user_id, message=message, link=link))

def compute_total(exam, scores):
    weight_sum = sum(c.weightage or 0 for c, _ in scores)
    if weight_sum <= 0:
        return round(sum(m for _, m in scores), 2)
    weighted = sum((m / c.max_marks) * (c.weightage or 0) for c, m in scores if c.max_marks)
    return round(weighted / weight_sum * exam.max_marks, 2)

def overlaps(a_start: time, a_end: time, b_start: time, b_end: time):
    return a_start < b_end and b_start < a_end

def today():
    return date.today()

