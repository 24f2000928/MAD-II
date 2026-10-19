import os
from datetime import timedelta

BASE_DIR = os.path.abspath(os.path.dirname(__file__))

class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "emp-dev-secret-key-change-me-in-production-0001")
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "emp-jwt-secret-key-change-me-in-production-0001")
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=12)

    SQLALCHEMY_DATABASE_URI = "sqlite:///" + os.path.join(BASE_DIR, "instance", "emp.sqlite3")
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379")
    CACHE_TYPE = "RedisCache"
    CACHE_REDIS_URL = REDIS_URL + "/0"
    CACHE_DEFAULT_TIMEOUT = 300  
    CELERY_BROKER_URL = REDIS_URL + "/1"
    CELERY_RESULT_BACKEND = REDIS_URL + "/2"

    ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@emp.com")
    ADMIN_PASSWORD = os.environ.get("ADMIN_PASSWORD", "admin123")
    ADMIN_NAME = "Administrator"

    SMTP_HOST = os.environ.get("SMTP_HOST", "localhost")
    SMTP_PORT = int(os.environ.get("SMTP_PORT", 1025))
    SMTP_USER = os.environ.get("SMTP_USER", "")
    SMTP_PASSWORD = os.environ.get("SMTP_PASSWORD", "")
    MAIL_SENDER = os.environ.get("MAIL_SENDER", "noreply@emp.com")

    GCHAT_WEBHOOK_URL = os.environ.get("GCHAT_WEBHOOK_URL", "")

    REMINDER_HOUR = int(os.environ.get("REMINDER_HOUR", 8))
    REMINDER_MINUTE = int(os.environ.get("REMINDER_MINUTE", 0))
    REMINDER_DAYS_AHEAD = 1

    EXPORT_DIR = os.path.join(BASE_DIR, "instance", "exports")