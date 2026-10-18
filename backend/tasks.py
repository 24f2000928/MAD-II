import csv
import os
from collections import Counter
from datetime import date, datetime, timedelta

from jinja2 import Environment, FileSystemLoader, select_autoescape

from celery_app import celery
from config import Config, BASE_DIR
from extensions import db
from mailer import send_email, send_gchat
from models import User, Examination, Slot, Booking, Evaluation, Notification

jinja = Environment(loader=FileSystemLoader(os.path.join(BASE_DIR, "mail_templates")),
                    autoescape=select_autoescape(["html"]))

#----A. Daily Examination Reminder-----
@celery.task(name="tasks.daily_reminders")
def daily_reminders():
    start = date.today()
    end = start + timedelta(days=Config.REMINDER_DAYS_AHEAD)
    bookings = (Booking.query.join(Slot)
                .filter(Booking.status == "Booked", Slot.date >= start, Slot.date <= end)
                .order_by(Slot.date, Slot.start_time).all())
    tpl = jinja.get_template("reminder.html")
    chat_lines = []
    for b in bookings:
        s, e = b.slot, b.exam
        html = tpl.render(student=b.student, exam=e, slot=s, examiner=s.examiner)
        send_email(b.student.email, f"Reminder: {e.name} on {s.date: %d %b %Y}", html)
        db.session.add(Notification(user_id=b.student_id,
                                    message=f"Reminder: '{e.name}' on {s.date} at {s.start_time:%H:%M}."))
        chat_lines.append(f"• *{e.name}* ({e.course.code}) — {b.student.name}: {s.date:%d %b} "
                          f"{s.start_time:%H:%M}-{s.end_time:%H:%M}, examiner {s.examiner.name}"
                          + (f"\n   Instructions: {e.instructions}" if e.instructions else ""))
    db.session.commit()
    if chat_lines:
        send_gchat("📅 *Upcoming examinations*\n" + "\n".join(chat_lines))
    return {"reminders_sent": len(bookings)}

#----B. Monthly Examination Report-----
def build_monthly_stats(first, last):
    in_month = Slot.date.between(first, last)
    exams_conducted = (db.session.query(Examination).join(Slot)
                        .filter(in_month).distinct().count())
    evaluations = (Evaluation.query.filter(Evaluation.status == "Submitted",
                                           Evaluation.evaluated_at >= datetime.combine(first, datetime.min.time()),
                                           Evaluation.evaluated_at < datetime.combine(last + timedelta(days=1),
                                                                                      datetime.min.time()))).all()
    month_bookings = Booking.query.join(Slot).filter(in_month).all()
    completed = [b for b in month_bookings if b.status == "Completed"]
    pending = [b for b in month_bookings if b.status == "Booked"]
    absent = [b for b in month_bookings if b.status == "Absent"]
    cancelled = [b for b in month_bookings if b.status == "Cancelled"]
    active = Counter(ev.examiner for ev in evaluations).most_common(5)

    per_exam = {}
    for b in month_bookings:
        if b.status == "Cancelled":
            continue
        row = per_exam.setdefault(b.exam_id, {"name": b.exam.name, "course": b.exam.course.code,
                                              "type": b.exam.exam_type, "booked": 0, "evaluated": 0,
                                              "marks": [], "max": b.exam.max_marks})
        row["booked"] += 1
        if b.evaluation and b.evaluation.status == "Submitted":
            row["evaluated"] += 1
            row["marks"].append(b.evaluation.total_marks)
    for row in per_exam.values():
        row["avg"] = round(sum(row["marks"]) / len(row["marks"]), 2) if row["marks"] else "-"

    return {
        "month": first.strftime("%B %Y"), "generated": datetime.now().strftime("%d %b %Y %H:%M"),
        "exams_conducted": exams_conducted, "students_evaluated": len({ev.student_id for ev in evaluations}),
        "evaluations": len(evaluations), "completed_bookings": len(completed),
        "pending_evaluations": len(pending), "absent": len(absent), "cancelled": len(cancelled),
        "total_bookings": len(month_bookings), "active_examiners": active,
        "per_exam": list(per_exam.values()),
    }

@celery.task(name="tasks.monthly_report")
def monthly_report(year=None, month=None):
    if year and month:
        first = date(year, month, 1)
    else:
        first = (date.today().replace(day=1) - timedelta(days=1)).replace(day=1)
    last = (first.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
    stats = build_monthly_stats(first, last)
    html = jinja.get_template("monthly_report.html").render(**stats)

    os.makedirs(Config.EXPORT_DIR, exist_ok=True)
    path = os.path.join(Config.EXPORT_DIR, f"monthly_report_{first:%Y_%m}.html")
    with open(path, "w", encoding="utf-8") as f:
        f.write(html)
    admin = User.query.filter_by(role="admin").first()
    sent = send_email(admin.email, f"EMP Monthly Examination Report - {stats['month']}", html)
    db.session.add(Notification(user_id=admin.id, message=f"Monthly report for {stats['month']} generated"
                                                          f"{' and emailed' if sent else ''}."))
    db.session.commit()
    return {"month": stats["month"], "emailed": sent, "file": os.path.basename(path)}

#---C. User-triggered CSV export-----
@celery.task(name="tasks.export_history_csv")
def export_history_csv(student_id):
    student = db.session.get(User, student_id)
    bookings = Booking.query.filter_by(student_id=student_id).order_by(Booking.booked_at).all()
    os.makedirs(Config.EXPORT_DIR, exist_ok=True)
    filename = f"history_{student_id}_{datetime.now():%Y%m%d_%H%M%S}.csv"
    roll = student.student_profile.roll_no if student.student_profile else ""
    with open(os.path.join(Config.EXPORT_DIR, filename), "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["Student ID", "Roll No", "Examination Name", "Course", "Examination Date", "Time",
                    "Examiner", "Marks Obtained", "Maximum Marks", "Booking Status"])
        for b in bookings:
            ev = b.evaluation
            show = b.exam.results_published and ev and ev.status == "Submitted"
            w.writerow([student_id, roll, b.exam.name, f"{b.exam.course.code} - {b.exam.course.name}",
                        b.slot.date.isoformat(), f"{b.slot.start_time:%H:%M}-{b.slot.end_time:%H:%M}",
                        b.slot.examiner.name, ev.total_marks if show else "Not published",
                        b.exam.max_marks, b.status])
    db.session.add(Notification(user_id=student_id, message="Your examination history CSV is ready to download.",
                                link=f"/api/student/exports/{filename}"))
    db.session.commit()
    send_email(student.email, "Your examination history export is ready",
               f"<p>Hi {student.name},</p><p>Your examination history export (<b>{len(bookings)}</b> "
               f"records) is ready. Download it from your dashboard.</p>")
    return {"user_id": student_id, "file": filename, "rows": len(bookings)}

#----D. Result Publication Emails----
@celery.task(name="tasks.send_result_emails")
def send_result_emails(exam_id):
    exam = db.session.get(Examination, exam_id)
    evals = Evaluation.query.filter_by(exam_id=exam_id, status="Submitted").all()
    tpl = jinja.get_template("result.html")
    for ev in evals:
        send_email(ev.booking.student.email, f"Result published: {exam.name}",
                   tpl.render(student=ev.booking.student, exam=exam, ev=ev))
    return {"emails": len(evals)}
    