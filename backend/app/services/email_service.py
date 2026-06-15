"""Best-effort outbound email for notification delivery (Phase 9).

A thin SMTP sender plus the small HTML/text templates the notification channels
use. Two rules govern everything here:

* **Optional.** Email is a no-op until ``SMTP_HOST`` is configured (see
  :pyattr:`Settings.email_configured`). The app runs fully without it — all
  notifications still land in the bell/inbox.
* **Never blocks or breaks the caller.** :func:`send_email` swallows and logs any
  failure and returns a bool, so a flaky mail server can never roll back or delay
  the action that produced the notification. The notification channels call it on
  the post-commit path, well after the user's change is durably saved.

Templates are deliberately minimal inline-styled HTML (email clients ignore most
CSS) with a plain-text alternative, and every message carries an absolute
deep-link back into the app (see :mod:`app.services.notification_links`).
"""

from __future__ import annotations

import html
import logging
import smtplib
from email.message import EmailMessage
from typing import List, Optional

from ..config import settings

logger = logging.getLogger(__name__)


def _from_address() -> Optional[str]:
    return settings.smtp_from or settings.smtp_username


def send_email(*, to: str, subject: str, html_body: str, text_body: str) -> bool:
    """Send one email. Returns True on success, False (logged) otherwise.

    Silently returns False when email is not configured, so callers can fire
    unconditionally. Never raises.
    """
    if not settings.email_configured:
        return False
    sender = _from_address()
    if not sender or not to:
        return False
    try:
        msg = EmailMessage()
        msg["Subject"] = subject[:200]
        msg["From"] = sender
        msg["To"] = to
        msg.set_content(text_body)
        msg.add_alternative(html_body, subtype="html")

        with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=10) as smtp:
            if settings.smtp_use_tls:
                smtp.starttls()
            if settings.smtp_username and settings.smtp_password:
                smtp.login(settings.smtp_username, settings.smtp_password)
            smtp.send_message(msg)
        return True
    except Exception:
        logger.exception("Failed to send email to %s", to)
        return False


# --- Templates -------------------------------------------------------------- #

_WRAP = (
    '<div style="font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;'
    'max-width:560px;margin:0 auto;color:#0f172a;">{body}</div>'
)


def _button(url: str, label: str) -> str:
    return (
        f'<a href="{html.escape(url)}" '
        'style="display:inline-block;background:#4f46e5;color:#ffffff;'
        'text-decoration:none;padding:10px 18px;border-radius:8px;'
        f'font-weight:600;font-size:14px;">{html.escape(label)}</a>'
    )


def render_notification_email(*, title: str, message: str, link: str) -> tuple[str, str]:
    """HTML + plain-text bodies for a single notification email."""
    safe_title = html.escape(title or "Notification")
    safe_message = html.escape(message or "")
    body = (
        f'<h2 style="font-size:18px;margin:0 0 12px;">{safe_title}</h2>'
        f'<p style="font-size:14px;line-height:1.5;color:#334155;margin:0 0 20px;">{safe_message}</p>'
        f"{_button(link, 'Open in app')}"
        '<p style="font-size:12px;color:#94a3b8;margin-top:24px;">'
        "You receive this because of your notification preferences. "
        "Manage them in Settings.</p>"
    )
    html_body = _WRAP.format(body=body)
    text_body = f"{title}\n\n{message}\n\nOpen: {link}"
    return html_body, text_body


def render_digest_email(*, heading: str, items: List[dict], inbox_url: str) -> tuple[str, str]:
    """HTML + plain-text bodies for the weekly digest.

    ``items`` are ``{"title", "message", "link"}`` dicts, one per unread
    notification being summarised.
    """
    safe_heading = html.escape(heading)
    rows = []
    text_lines = [heading, ""]
    for it in items:
        t = html.escape(it.get("title") or "")
        m = html.escape(it.get("message") or "")
        link = html.escape(it.get("link") or inbox_url)
        rows.append(
            '<li style="margin:0 0 14px;list-style:none;border-left:3px solid #e2e8f0;'
            'padding-left:12px;">'
            f'<a href="{link}" style="font-size:14px;font-weight:600;color:#4f46e5;'
            f'text-decoration:none;">{t}</a>'
            f'<div style="font-size:13px;color:#475569;margin-top:2px;">{m}</div>'
            "</li>"
        )
        text_lines.append(f"- {it.get('title')}: {it.get('message')} ({it.get('link')})")
    body = (
        f'<h2 style="font-size:18px;margin:0 0 16px;">{safe_heading}</h2>'
        f'<ul style="padding:0;margin:0 0 20px;">{"".join(rows)}</ul>'
        f"{_button(inbox_url, 'Open your inbox')}"
    )
    html_body = _WRAP.format(body=body)
    text_lines += ["", f"Open your inbox: {inbox_url}"]
    return html_body, "\n".join(text_lines)
