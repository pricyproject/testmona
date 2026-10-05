import ipaddress
from contextvars import ContextVar, Token
from typing import Optional

from starlette.requests import Request


_client_ip: ContextVar[Optional[str]] = ContextVar("client_ip", default=None)
_user_agent: ContextVar[Optional[str]] = ContextVar("user_agent", default=None)


def _clean_header_value(value: Optional[str], max_length: int) -> Optional[str]:
    if not value:
        return None
    cleaned = value.strip()
    if not cleaned:
        return None
    return cleaned[:max_length]


def get_peer_ip(request: Request) -> Optional[str]:
    """The socket peer address, i.e. the only value a client cannot forge.

    Forwarded headers are attacker-controlled unless the deployment terminates
    TLS at a known proxy, so anything used as a security key (rate-limit
    buckets) must start here.
    """
    if request.client and request.client.host:
        return _clean_header_value(request.client.host, 45)
    return None


def _peer_is_trusted_proxy(request: Request, trusted: str) -> bool:
    """True when the socket peer is in the configured proxy allowlist."""
    if not trusted:
        return False
    peer = get_peer_ip(request)
    if not peer:
        return False
    try:
        peer_address = ipaddress.ip_address(peer)
    except ValueError:
        return False
    for entry in trusted.split(","):
        candidate = entry.strip()
        if not candidate:
            continue
        try:
            if "/" in candidate:
                if peer_address in ipaddress.ip_network(candidate, strict=False):
                    return True
            elif peer_address == ipaddress.ip_address(candidate):
                return True
        except ValueError:
            continue
    return False


def get_request_client_ip(request: Request, trusted_proxy_ips: str = "") -> Optional[str]:
    # Forwarded headers are only honoured when the socket peer is a proxy we
    # were told to trust; otherwise any client could impersonate another IP.
    if _peer_is_trusted_proxy(request, trusted_proxy_ips):
        forwarded_for = request.headers.get("x-forwarded-for")
        if forwarded_for:
            first_forwarded_ip = forwarded_for.split(",", 1)[0]
            cleaned_ip = _clean_header_value(first_forwarded_ip, 45)
            if cleaned_ip:
                return cleaned_ip

        for header_name in ("x-real-ip", "cf-connecting-ip"):
            cleaned_ip = _clean_header_value(request.headers.get(header_name), 45)
            if cleaned_ip:
                return cleaned_ip

    return get_peer_ip(request)


def get_rate_limit_key(request: Request, trusted_proxy_ips: str = "") -> str:
    """Bucket key for rate limiting.

    Prefers the forwarded client IP when the peer is a trusted proxy, but always
    falls back to the unforgeable socket peer so a spoofed header can never mint
    a fresh bucket.
    """
    return get_request_client_ip(request, trusted_proxy_ips) or get_peer_ip(request) or "unknown"


def get_request_user_agent(request: Request) -> Optional[str]:
    return _clean_header_value(request.headers.get("user-agent"), 500)


def set_request_metadata(client_ip: Optional[str], user_agent: Optional[str]) -> tuple[Token[Optional[str]], Token[Optional[str]]]:
    ip_token = _client_ip.set(_clean_header_value(client_ip, 45))
    user_agent_token = _user_agent.set(_clean_header_value(user_agent, 500))
    return ip_token, user_agent_token


def reset_request_metadata(tokens: tuple[Token[Optional[str]], Token[Optional[str]]]) -> None:
    ip_token, user_agent_token = tokens
    _client_ip.reset(ip_token)
    _user_agent.reset(user_agent_token)


def current_client_ip() -> Optional[str]:
    return _client_ip.get()


def current_user_agent() -> Optional[str]:
    return _user_agent.get()
