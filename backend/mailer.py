import json
import logging
import smtplib
import urllib.request
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from config import Config

log = logging.getLogger(__name__)

def send_email(to, subject, html, attachments=None):
    msg = MIMEMultipart()
    msg['From'] = Config.MAIL_SENDER
    msg['To'] = to
    msg['Subject'] = subject
    msg.attach(MIMEText(html, 'html'))
    for name, data,subtype in attachments or []:
        part = MIMEApplication(data, _subtype = subtype)
        part.add_header('Content-Disposition', 'attachment', filename=name)
        msg.attach(part)
    try:
        with smtplib.SMTP(Config.SMTP_HOST, Config.SMTP_PORT, timeout=10) as s:
            if Config.SMTP_USER:
                s.starttls()
                s.login(Config.SMTP_USER, Config.SMTP_PASSWORD)
            s.send_message(msg)
        return True
    except Exception as e:
        log.warning("Email to %s failed: %s", to, e)
        return False

def g_chat(text, webhook=None):
    url = webhook or Config.G_CHAT_WEBHOOK_URL
    if not url:
        return False
    req = urllib.request.Request(url, data=json.dumps({"text": text}).encode(),
                                 headers={"Content-Type": "application/json; charset=UTF-8"})
    try:
        urllib.request.urlopen(req, timeout=10)
        return True
    except Exception as e:
        log.warning("Google Chat webhook failed: %s", e)
        return False

