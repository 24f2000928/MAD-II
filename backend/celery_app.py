"""Celery application (Redis broker + result backend) with the beat schedule.

Run (from the backend folder):
    celery -A celery_app.celery worker -l info --pool=solo     # --pool=solo is needed on Windows
    celery -A celery_app.celery beat -l info
"""
import os

from celery import Celery, Task
from celery.schedules import crontab

from config import Config


class FlaskTask(Task):
    """Run every task inside the Flask application context so models/db work."""
    def __call__(self, *args, **kwargs):
        from app import app
        with app.app_context():
            return self.run(*args, **kwargs)


celery = Celery("emp", broker=Config.CELERY_BROKER_URL, backend=Config.CELERY_RESULT_BACKEND,
                task_cls=FlaskTask, include=["tasks"])
celery.conf.update(
    timezone=os.environ.get("CELERY_TIMEZONE", "Asia/Kolkata"),
    result_expires=3600,
    broker_connection_retry_on_startup=True,
    # fail fast in the web request if Redis is down instead of hanging
    task_publish_retry=False,
    broker_connection_timeout=3,
    beat_schedule={
        "daily-exam-reminder": {
            "task": "tasks.daily_reminders",
            "schedule": crontab(hour=Config.REMINDER_HOUR, minute=Config.REMINDER_MINUTE),
        },
        "monthly-exam-report": {
            "task": "tasks.monthly_report",
            "schedule": crontab(day_of_month=1, hour=7, minute=0),
        },
    },
)
