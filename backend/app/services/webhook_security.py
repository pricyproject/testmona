"""Validation helpers for outbound webhook targets."""

from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlparse

from ..config import settings

_LOCAL_HOSTNAMES = {"localhost", "localhost.localdomain"}


def _is_blocked_ip(address: str) -> bool:
    ip = ipaddress.ip_address(address)
    return any(
        (
            ip.is_private,
            ip.is_loopback,
            ip.is_link_local,
            ip.is_multicast,
            ip.is_reserved,
            ip.is_unspecified,
        )
    )


def _validate_host(hostname: str) -> None:
    lowered = hostname.rstrip(".").lower()
    if lowered in _LOCAL_HOSTNAMES or lowered.endswith(".localhost"):
        raise ValueError("Webhook URL cannot target local or private network hosts")

    try:
        if _is_blocked_ip(lowered):
            raise ValueError("Webhook URL cannot target local or private network hosts")
        return
    except ValueError as exc:
        if "Webhook URL" in str(exc):
            raise

    try:
        resolved = socket.getaddrinfo(lowered, None, type=socket.SOCK_STREAM)
    except socket.gaierror:
        return

    for result in resolved:
        address = result[4][0]
        if _is_blocked_ip(address):
            raise ValueError("Webhook URL cannot target local or private network hosts")


def normalize_webhook_url(value: str) -> str:
    stripped = value.strip()
    parsed = urlparse(stripped)
    if parsed.scheme.lower() not in {"http", "https"}:
        raise ValueError("Webhook URL must use http:// or https://")
    if not parsed.hostname:
        raise ValueError("Webhook URL must include a host")
    if parsed.username or parsed.password:
        raise ValueError("Webhook URL cannot include credentials")
    if parsed.fragment:
        raise ValueError("Webhook URL cannot include a fragment")
    try:
        parsed.port
    except ValueError as exc:
        raise ValueError("Webhook URL includes an invalid port") from exc
    if len(stripped) > 2048:
        raise ValueError("Webhook URL is too long")
    if not settings.webhook_allow_private_urls:
        _validate_host(parsed.hostname)
    return stripped
