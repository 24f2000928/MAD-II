"""
Optional demo data that creates courses, examiners, students and examinations in every lifecycle with dates relative to today so that demo always works.
Passwords: examiners-> examiner123, students-> student123
"""

from datetime import date, time, timedelta, datetime
from app import app
from extensions import db
from models import (User, StudentProfile, ExaminerProfile, Course, Examination, RubricCriterion,
                    Slot, Booking, Evaluation, EvaluationScore)
from utils import compute_total

T = date.today()

def user(email, name, role, pw, **profile):
    u = User.query.filter_by(email=email).first()
    if u:
        return u
    u = User(email=email, name=name, role=role, phone="98765" + str(abs(hash(email))% 100000).zfill(5))
    u.set_password(pw)
    if role == "student":
        u.student_profile = StudentProfile(**profile)
    else:
        u.examiner_profile = ExaminerProfile(**profile)
    db.session.add(u)
    return u

def run():
    if Course.query.first():
        print("Demo data already present - skipping.")
        return

    ex1 = user("anita@emp.com", "Dr. Anita Rao", "examiner", "examiner123", department="Computer Science", designation="Professor")
    ex2 = user("vikram@emp.com", "Prof. Vikram Shah", "examiner", "examiner123", department="Computer Science", designation="Assistant Professor")
    ex3 = user("meera@emp.com", "Dr. Meera Iyer", "examiner", "examiner123", department="Data Science", designation="Associate Professor")
    students = [user(f"student{i}@emp.com", n, "student", "student123", roll_no=f"23F100{i}", program="BS Data Science", year=2)
                for i, n in enumerate(["Aarav Kumar", "Diya Sharma", "Rohan Verma", "Isha Patel", "Kabir Singh", "Sara Khan"], 1)]

    c1 = Course(code="MAD2", name="Modern Application Development II", description="Vue, Flask APIs, Celery & Redis", credits=4)
    c2 = Course(code="DBMS", name="Database Management Systems", description="Relational modelling and SQL", credits=4)
    c3 = Course(code="MLP", name="Machine Learning Practice", description="Applied ML projects", credits=4)
    db.session.add_all([c1, c2, c3])
    db.session.flush()

    def exam(course, name, typ, status, maxm, sc, bk, examiners, published=False, instr=None):
        e = Examination(course_id=course.id, name=name, exam_type=typ, duration=20, max_marks=maxm, status=status,
                        slot_creation_start=T + timedelta(days=sc[0]), slot_creation_end=T + timedelta(days=sc[1]),
                        booking_start=T + timedelta(days=bk[0]), booking_end=T + timedelta(days=bk[1]),
                        results_published=published, instructions=instr or "Join 5 minutes early with your ID card.",
                        published_at=datetime.utcnow() if published else None)
        e.examiners = examiners
        db.session.add(e)
        db.session.flush()
        return e

    def rubric(e, items):
        for n, m, w, d in items:
            db.session.add(RubricCriterion(exam_id=e.id, name=n, max_marks=m, weightage=w, description=d))
        db.session.flush()

    viva_rubric = [("Concept clarity", 10, 40, "Understanding of core concepts"),
                   ("Code walkthrough", 10, 40, "Ability to explain own code"),
                   ("Communication", 5, 20, "Clarity and confidence")]

    e1 = exam(c2, "DBMS Viva", "Viva", "Completed", 100, (-30, -20), (-19, -12), [ex1, ex2], published=True)
    rubric(e1, viva_rubric)

    e2 = exam(c1, "MAD-II Project Viva", "Project Demo", "Closed", 100, (-15, -8), (-7, -2), [ex1, ex3],
              instr="Demo your project live. Keep the code and report ready.")
    rubric(e2, [("Functionality", 20, 50, "Core features working"), ("Code quality", 10, 25, "Structure & readability"),
                ("Viva answers", 10, 25, "Answers to examiner questions")])
    
    e3 = exam(c3, "MLP Practical", "Practical", "Booking Open", 50, (-6, -2), (-1, 5), [ex2, ex3])
    rubric(e3, [("Model building", 20, 60, "Pipeline & model"), ("Evaluation", 10, 40, "Metrics & analysis")])

    e4 = exam(c1, "MAD-II Mid-term Assessment", "Assessment", "Slot Creation", 40, (-1, 4), (5, 10), [ex1, ex2])
    rubric(e4, viva_rubric)
    
    exam(c2, "DBMS End-term Viva", "Viva", "Draft", 100, (10, 15), (16, 20), [ex1])

    def slot(e, ex, day, h, cap=3, status="Available"):
        s = Slot(exam_id=e.id, examiner_id=ex.id, date=T + timedelta(days=day), start_time=time(h, 0),
                 end_time=time(h + 1, 0), capacity=cap, available_seats=cap, status=status,
                 meeting_link="https://meet.google.com/abc-defg-hij")
        db.session.add(s)
        db.session.flush()
        return s

    def book(st, s):
        b = Booking(student_id=st.id, slot_id=s.id, exam_id=s.exam_id,
                    booked_at=datetime.utcnow() - timedelta(days=max(1, -(s.date - T).days + 3)))
        s.available_seats -= 1
        s.refresh_status()
        db.session.add(b)
        db.session.flush()
        return b

    def evaluate(b, ex, fracs, remarks):
        crits = b.exam.rubric
        ev = Evaluation(booking_id=b.id, student_id=b.student_id, examiner_id=ex.id, exam_id=b.exam_id,
                        remarks=remarks, status="Submitted", evaluated_at=datetime.combine(b.slot.date, time(18)))
        pairs = []
        for c, f in zip(crits, fracs):
            m = round(c.max_marks * f, 1)
            ev.scores.append(EvaluationScore(criterion_id=c.id, marks=m))
            pairs.append((c, m))
        ev.total_marks = compute_total(b.exam, pairs)
        b.status = "Completed"
        db.session.add(ev)

    s1, s2 = slot(e1, ex1, -10, 10, status="Completed"), slot(e1, ex2, -10, 14, status="Completed")
    for i, st in enumerate(students[:5]):
        b = book(st, s1 if i < 3 else s2)
        evaluate(b, b.slot.examiner, [0.9 - i * 0.1, 0.8, 0.7 + i * 0.05], ["Excellent", "Good grasp", "Well done", "Needs revision", "Fair"][i])
    
    s3, s4 = slot(e2, ex1, -1, 10), slot(e2, ex3, -1, 15)
    for i, st in enumerate(students):
        b = book(st, s3 if i % 2 == 0 else s4)
        if i < 2:
            evaluate(b, b.slot.examiner, [0.85, 0.9, 0.75], "Solid project")
    
    s5, s6, _ = slot(e3, ex2, 7, 9, cap=2), slot(e3, ex3, 7, 11, cap=3), slot(e3, ex2, 8, 14, cap=2)
    book(students[0], s5)
    book(students[1], s5)  
    book(students[2], s6)
    
    slot(e4, ex1, 7, 10)

    db.session.commit()
    print("Demo data created.")
    print("  admin@emp.com / admin123")
    print("  anita@emp.com, vikram@emp.com, meera@emp.com / examiner123")
    print("  student1..6@emp.com / student123")


if __name__ == "__main__":
    with app.app_context():
        run()