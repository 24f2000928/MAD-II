from datetime import datetime, date

from werkzeug.security import generate_password_hash, check_password_hash
from extensions import db

ROLES = ("admin", "examiner", "student")
EXAM_TYPES = ("Viva", "Practical", "Project Demo", "Assessment")
EXAM_STATUSES = ("Draft", "Slot Creation", "Booking Open", "Closed", "Completed")
SLOT_STATUSES = ("Available", "Full", "Cancelled", "Completed")
BOOKING_STATUSES = ("Booked", "Cancelled", "Completed", "Absent")

def iso(v):
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.isoformat(timespec="seconds")
    if isinstance(v, date):
        return v.isoformat()
    return v.strfttime("%H:%M")

class User(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False, index= True)
    password_hash = db.Column(db.String(128), nullable=False)
    name = db.Column(db.String(100), nullable=False)
    phone = db.Column(db.String(20))
    role = db.Column(db.String(20), nullable=False, index=True)
    active = db.Column(db.Boolean, default=True, nullable=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    student_profile = db.relationship("StudentProfile", uselist=False, backref="user", cascade="all, delete-orphan")
    examiner_profile = db.relationship("ExaminerProfile", uselist=False, backref="user", cascade="all, delete-orphan")

    def set_password(self, pw):
        self.password_hash = generate_password_hash(pw)

    def check_password(self, pw):
        return check_password_hash(self.password_hash, pw)

    def to_dict(self):
        d = {
            "id": self.id, "email": self.email, "name": self.name, "phone": self.phone,
            "role": self.role, "active": self.active, "created_at": iso(self.created_at),
        }
        if self.student_profile:
            d.update(self.student_profile.to_dict())
        if self.examiner_profile:
            d.update(self.examiner_profile.to_dict())
        return d

class StudentProfile(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), unique=True, nullable=False)
    roll_no = db.Column(db.String(30), unique=True)
    program = db.Column(db.String(100))
    year = db.Column(db.Integer)

    def to_dict(self):
        return {"roll_no": self.roll_no, "program": self.program, "year": self.year}

class ExaminerProfile(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), unique=True, nullable=False)
    department = db.Column(db.String(100))
    designation = db.Column(db.String(100))
    status = db.Column(db.String(20), default="Active")  # Active / On Leave / Inactive

    def to_dict(self):
        return {"department": self.department, "designation": self.designation, "examiner_status": self.status}

class ExaminerProfile(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), unique=True, nullable=False)
    department = db.Column(db.String(100))
    designation = db.Column(db.String(100))
    status = db.Column(db.String(20), default="Active")  # Active / On Leave / Inactive

    def to_dict(self):
        return {"department": self.department, "designation": self.designation, "examiner_status": self.status}

class Course(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    code = db.Column(db.String(20), unique=True, nullable=False)
    name = db.Column(db.String(150), nullable=False)
    description = db.Column(db.Text)
    credits = db.Column(db.Integer, default=4)
    status = db.Column(db.String(20), default="Active")  # Active / Archived
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    exams = db.relationship("Examination", backref="course", lazy="dynamic")

    def to_dict(self):
        return {
            "id": self.id, "code": self.code, "name": self.name, "description": self.description,
            "credits": self.credits, "status": self.status, "exam_count": self.exams.count(),
        }

exam_examiners = db.Table(
    "exam_examiner",
    db.Column("exam_id", db.Integer, db.ForeignKey("examination.id"), primary_key=True),
    db.Column("examiner_id", db.Integer, db.ForeignKey("user.id"), primary_key=True),
)

class Examination(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    course_id = db.Column(db.Integer, db.ForeignKey("course.id"), nullable=False)
    name = db.Column(db.String(150), nullable=False)
    exam_type = db.Column(db.String(30), nullable=False)
    duration = db.Column(db.Integer, nullable=False)  # minutes
    max_marks = db.Column(db.Float, nullable=False)
    instructions = db.Column(db.Text)
    slot_creation_start = db.Column(db.Date)
    slot_creation_end = db.Column(db.Date)
    booking_start = db.Column(db.Date)
    booking_end = db.Column(db.Date)
    status = db.Column(db.String(20), default="Draft", nullable=False)
    results_published = db.Column(db.Boolean, default=False)
    published_at = db.Column(db.DateTime)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    examiners = db.relationship("User", secondary=exam_examiners, backref=db.backref("assigned_exams", lazy="dynamic"))
    rubric = db.relationship("RubricCriterion", backref="exam", cascade="all, delete-orphan", order_by="RubricCriterion.id")
    slots = db.relationship("Slot", backref="exam", lazy="dynamic", cascade="all, delete-orphan")

    def to_dict(self, detail=False):
        d = {
            "id": self.id, "course_id": self.course_id,
            "course_code": self.course.code, "course_name": self.course.name,
            "name": self.name, "exam_type": self.exam_type, "duration": self.duration,
            "max_marks": self.max_marks, "instructions": self.instructions,
            "slot_creation_start": iso(self.slot_creation_start), "slot_creation_end": iso(self.slot_creation_end),
            "booking_start": iso(self.booking_start), "booking_end": iso(self.booking_end),
            "status": self.status, "results_published": self.results_published,
            "examiner_ids": [e.id for e in self.examiners],
            "examiners": [{"id": e.id, "name": e.name} for e in self.examiners],
        }
        if detail:
            d["rubric"] = [r.to_dict() for r in self.rubric]
        return d

    def slot_creation_allowed(self, today=None):
        today = today or date.today()
        return (self.status == "Slot Creation"
                and (self.slot_creation_start is None or self.slot_creation_start <= today)
                and (self.slot_creation_end is None or today <= self.slot_creation_end))

    def booking_allowed(self, today=None):
        today = today or date.today()
        return (self.status == "Booking Open"
                and (self.booking_start is None or self.booking_start <= today)
                and (self.booking_end is None or today <= self.booking_end))

class RubricCriterion(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    exam_id = db.Column(db.Integer, db.ForeignKey("examination.id"), nullable=False)
    name = db.Column(db.String(120), nullable=False)
    max_marks = db.Column(db.Float, nullable=False)
    weightage = db.Column(db.Float, nullable=False, default=0)  # percentage
    description = db.Column(db.Text)

    def to_dict(self):
        return {"id": self.id, "exam_id": self.exam_id, "name": self.name, "max_marks": self.max_marks,
                "weightage": self.weightage, "description": self.description}

class Slot(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    exam_id = db.Column(db.Integer, db.ForeignKey("examination.id"), nullable=False, index=True)
    examiner_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    date = db.Column(db.Date, nullable=False)
    start_time = db.Column(db.Time, nullable=False)
    end_time = db.Column(db.Time, nullable=False)
    capacity = db.Column(db.Integer, nullable=False, default=1)
    available_seats = db.Column(db.Integer, nullable=False, default=1)
    status = db.Column(db.String(20), default="Available", nullable=False)
    meeting_link = db.Column(db.String(300))
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    examiner = db.relationship("User")
    bookings = db.relationship("Booking", backref="slot", lazy="dynamic")

    def refresh_status(self):
        if self.status in ("Cancelled", "Completed"):
            return
        self.status = "Full" if self.available_seats <= 0 else "Available"

    def to_dict(self):
        return {
            "id": self.id, "exam_id": self.exam_id, "exam_name": self.exam.name,
            "examiner_id": self.examiner_id, "examiner_name": self.examiner.name,
            "date": iso(self.date), "start_time": iso(self.start_time), "end_time": iso(self.end_time),
            "capacity": self.capacity, "available_seats": self.available_seats, "status": self.status,
            "meeting_link": self.meeting_link,
            "booked_count": self.bookings.filter(Booking.status != "Cancelled").count(),
        }

class Booking(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    student_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    slot_id = db.Column(db.Integer, db.ForeignKey("slot.id"), nullable=False, index=True)
    exam_id = db.Column(db.Integer, db.ForeignKey("examination.id"), nullable=False, index=True)
    booked_at = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(20), default="Booked", nullable=False)
    cancelled_at = db.Column(db.DateTime)

    student = db.relationship("User")
    exam = db.relationship("Examination")
    evaluation = db.relationship("Evaluation", uselist=False, backref="booking")

    # A student may hold only one active (non-cancelled) booking per examination.
    __table_args__ = (
        db.Index("uq_active_booking", "student_id", "exam_id", unique=True,
                 sqlite_where=db.text("status != 'Cancelled'")),
    )

    def to_dict(self, include_eval=False):
        s = self.slot
        d = {
            "id": self.id, "student_id": self.student_id, "student_name": self.student.name,
            "student_email": self.student.email,
            "roll_no": self.student.student_profile.roll_no if self.student.student_profile else None,
            "slot_id": self.slot_id, "exam_id": self.exam_id, "exam_name": self.exam.name,
            "exam_type": self.exam.exam_type, "max_marks": self.exam.max_marks, "course_code": self.exam.course.code,
            "course_name": self.exam.course.name, "exam_status": self.exam.status,
            "examiner_id": s.examiner_id, "examiner_name": s.examiner.name,
            "date": iso(s.date), "start_time": iso(s.start_time), "end_time": iso(s.end_time),
            "meeting_link": s.meeting_link, "booked_at": iso(self.booked_at), "status": self.status,
            "results_published": self.exam.results_published,
            "evaluated": bool(self.evaluation and self.evaluation.status == "Submitted"),
        }
        if include_eval:
            d["evaluation"] = self.evaluation.to_dict() if self.evaluation else None
        return d

class Evaluation(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    booking_id = db.Column(db.Integer, db.ForeignKey("booking.id"), unique=True, nullable=False)
    student_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    examiner_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False)
    exam_id = db.Column(db.Integer, db.ForeignKey("examination.id"), nullable=False)
    total_marks = db.Column(db.Float, default=0)
    remarks = db.Column(db.Text)
    evaluated_at = db.Column(db.DateTime, default=datetime.utcnow)
    status = db.Column(db.String(20), default="Draft")  # Draft / Submitted

    scores = db.relationship("EvaluationScore", backref="evaluation", cascade="all, delete-orphan")
    examiner = db.relationship("User", foreign_keys=[examiner_id])

    def to_dict(self):
        return {
            "id": self.id, "booking_id": self.booking_id, "student_id": self.student_id,
            "examiner_id": self.examiner_id, "examiner_name": self.examiner.name, "exam_id": self.exam_id,
            "total_marks": round(self.total_marks or 0, 2), "remarks": self.remarks,
            "evaluated_at": iso(self.evaluated_at), "status": self.status,
            "scores": [s.to_dict() for s in self.scores],
        }

class EvaluationScore(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    evaluation_id = db.Column(db.Integer, db.ForeignKey("evaluation.id"), nullable=False)
    criterion_id = db.Column(db.Integer, db.ForeignKey("rubric_criterion.id"), nullable=False)
    marks = db.Column(db.Float, nullable=False, default=0)
    comment = db.Column(db.String(300))

    criterion = db.relationship("RubricCriterion")

    def to_dict(self):
        return {"criterion_id": self.criterion_id, "criterion_name": self.criterion.name,
                "max_marks": self.criterion.max_marks, "weightage": self.criterion.weightage,
                "marks": self.marks, "comment": self.comment}

class RescheduleLog(db.Model):
    """History of admin reschedules / examiner reassignments."""
    id = db.Column(db.Integer, primary_key=True)
    booking_id = db.Column(db.Integer, db.ForeignKey("booking.id"), nullable=False)
    old_slot_id = db.Column(db.Integer, db.ForeignKey("slot.id"))
    new_slot_id = db.Column(db.Integer, db.ForeignKey("slot.id"))
    reason = db.Column(db.String(300))
    changed_by = db.Column(db.Integer, db.ForeignKey("user.id"))
    changed_at = db.Column(db.DateTime, default=datetime.utcnow)

class Notification(db.Model):
    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey("user.id"), nullable=False, index=True)
    message = db.Column(db.String(500), nullable=False)
    link = db.Column(db.String(300))
    read = db.Column(db.Boolean, default=False)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    def to_dict(self):
        return {"id": self.id, "message": self.message, "link": self.link, "read": self.read,
                "created_at": iso(self.created_at)}