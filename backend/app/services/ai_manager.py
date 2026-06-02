import logging
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import httpx
from fastapi import HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..crypto import decrypt_data, encrypt_data

logger = logging.getLogger(__name__)

AI_MANAGER_CONFIG_KEY = "ai_manager_config"
AI_MANAGER_USAGE_KEY = "ai_manager_usage"
SUPPORTED_AI_PROVIDERS = {"openai", "openrouter", "anthropic", "huggingface", "litellm"}
DEFAULT_MODELS = {
    "openai": "gpt-4o-mini",
    "openrouter": "openai/gpt-4o-mini",
    "anthropic": "claude-3-5-haiku-latest",
    "huggingface": "openai/gpt-oss-20b",
    "litellm": "gpt-4o-mini",
}
DEFAULT_BASE_URLS = {
    "openai": "https://api.openai.com/v1",
    "openrouter": "https://openrouter.ai/api/v1",
    "anthropic": "https://api.anthropic.com/v1",
    "huggingface": "https://router.huggingface.co/v1",
    "litellm": "http://localhost:4000/v1",
}
MAX_RECENT_USAGE_EVENTS = 50
DEFAULT_AI_REQUEST_TIMEOUT_SECONDS = 60
MAX_AI_REQUEST_TIMEOUT_SECONDS = 300
AI_LIMIT_WARNING_THRESHOLD = 80


class AIProviderConfigPayload(BaseModel):
    provider: str = Field(..., description="Supported values: openai, openrouter, anthropic, huggingface, litellm")
    enabled: bool = False
    api_key: Optional[str] = Field(default=None, max_length=4000)
    model: Optional[str] = Field(default=None, max_length=160)
    base_url: Optional[str] = Field(default=None, max_length=500)
    request_timeout_seconds: int = Field(default=DEFAULT_AI_REQUEST_TIMEOUT_SECONDS, ge=5, le=MAX_AI_REQUEST_TIMEOUT_SECONDS)
    monthly_token_limit: Optional[int] = Field(default=None, ge=1, le=1_000_000_000)

    @field_validator("provider")
    @classmethod
    def validate_provider(cls, value: str) -> str:
        normalized = (value or "").strip().lower()
        if normalized not in SUPPORTED_AI_PROVIDERS:
            raise ValueError("Unsupported AI provider")
        return normalized

    @field_validator("model", "base_url", "api_key")
    @classmethod
    def normalize_optional_text(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        stripped = value.strip()
        return stripped or None


SOURCE_TYPES = ("requirements", "defects", "test_plans", "test_cases")
ROUTING_TASKS = ("qa", "generation", "assistant")


class RequirementChatSettingsPayload(BaseModel):
    enabled: bool = True
    max_context_requirements: int = Field(default=40, ge=1, le=200)
    history_turns: int = Field(default=6, ge=0, le=20)
    source_types: List[str] = Field(default_factory=lambda: ["requirements"])

    @field_validator("source_types")
    @classmethod
    def validate_source_types(cls, value: List[str]) -> List[str]:
        cleaned = [v for v in (value or []) if v in SOURCE_TYPES]
        return cleaned or ["requirements"]


class TestCaseGenerationSettingsPayload(BaseModel):
    default_count: int = Field(default=5, ge=1, le=20)
    max_tokens: int = Field(default=3000, ge=256, le=4000)


class RoutingTargetPayload(BaseModel):
    provider: Optional[str] = None
    model: Optional[str] = Field(default=None, max_length=160)

    @field_validator("provider")
    @classmethod
    def validate_provider(cls, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        normalized = value.strip().lower()
        if normalized not in SUPPORTED_AI_PROVIDERS:
            raise ValueError("Unsupported routing provider")
        return normalized

    @field_validator("model")
    @classmethod
    def normalize_model(cls, value: Optional[str]) -> Optional[str]:
        return (value or "").strip() or None


class RoutingSettingsPayload(BaseModel):
    qa: RoutingTargetPayload = Field(default_factory=RoutingTargetPayload)
    generation: RoutingTargetPayload = Field(default_factory=RoutingTargetPayload)
    assistant: RoutingTargetPayload = Field(default_factory=RoutingTargetPayload)


class FallbackSettingsPayload(BaseModel):
    enabled: bool = False
    order: List[str] = Field(default_factory=list)

    @field_validator("order")
    @classmethod
    def validate_order(cls, value: List[str]) -> List[str]:
        seen: List[str] = []
        for item in value or []:
            normalized = str(item or "").strip().lower()
            if normalized in SUPPORTED_AI_PROVIDERS and normalized not in seen:
                seen.append(normalized)
        return seen


class AIManagerSettingsPayload(BaseModel):
    active_provider: str = Field(..., description="Supported values: openai, openrouter, anthropic, huggingface, litellm")
    per_project_monthly_token_limit: Optional[int] = Field(default=None, ge=1, le=1_000_000_000)
    requirement_chat: Optional[RequirementChatSettingsPayload] = None
    system_prompt: Optional[str] = Field(default=None, max_length=2000)
    compact_payload_default: Optional[bool] = None
    test_case_generation: Optional[TestCaseGenerationSettingsPayload] = None
    routing: Optional[RoutingSettingsPayload] = None
    fallback: Optional[FallbackSettingsPayload] = None
    providers: List[AIProviderConfigPayload] = Field(default_factory=list)

    @field_validator("active_provider")
    @classmethod
    def validate_active_provider(cls, value: str) -> str:
        normalized = (value or "").strip().lower()
        if normalized not in SUPPORTED_AI_PROVIDERS:
            raise ValueError("Unsupported active AI provider")
        return normalized


class AITestRequest(BaseModel):
    provider: Optional[str] = Field(
        default=None,
        description="Supported values: openai, openrouter, anthropic, huggingface, litellm",
    )
    prompt: str = Field(default="Reply with exactly: TestMona AI is ready.", min_length=1, max_length=1000)

    @field_validator("provider")
    @classmethod
    def validate_optional_provider(cls, value: Optional[str]) -> Optional[str]:
        if value is None:
            return None
        normalized = value.strip().lower()
        if normalized not in SUPPORTED_AI_PROVIDERS:
            raise ValueError("Unsupported AI provider")
        return normalized


class AICompletionRequest(BaseModel):
    prompt: str = Field(..., min_length=1, max_length=12000)
    provider: Optional[str] = None
    max_tokens: int = Field(default=500, ge=1, le=4000)
    temperature: float = Field(default=0.2, ge=0, le=2)
    timeout_seconds: Optional[int] = Field(default=None, ge=5, le=MAX_AI_REQUEST_TIMEOUT_SECONDS)


class AICompletionResult(BaseModel):
    provider: str
    model: str
    content: str
    prompt_tokens: int = 0
    completion_tokens: int = 0
    total_tokens: int = 0


DEFAULT_REQUIREMENT_CHAT = {
    "enabled": True,
    "max_context_requirements": 40,
    "history_turns": 6,
    "source_types": ["requirements"],
}
DEFAULT_TEST_CASE_GENERATION = {
    "default_count": 5,
    "max_tokens": 3000,
}
DEFAULT_ROUTING = {task: {"provider": None, "model": None} for task in ROUTING_TASKS}
DEFAULT_FALLBACK = {"enabled": False, "order": []}


def default_ai_config() -> Dict[str, Any]:
    return {
        "active_provider": "openai",
        "per_project_monthly_token_limit": None,
        "requirement_chat": dict(DEFAULT_REQUIREMENT_CHAT),
        "system_prompt": "",
        "compact_payload_default": True,
        "test_case_generation": dict(DEFAULT_TEST_CASE_GENERATION),
        "routing": {task: dict(target) for task, target in DEFAULT_ROUTING.items()},
        "fallback": dict(DEFAULT_FALLBACK),
        "providers": {
            provider: {
                "provider": provider,
                "enabled": False,
                "api_key": None,
                "model": DEFAULT_MODELS[provider],
                "base_url": DEFAULT_BASE_URLS[provider],
                "request_timeout_seconds": DEFAULT_AI_REQUEST_TIMEOUT_SECONDS,
                "monthly_token_limit": None,
            }
            for provider in sorted(SUPPORTED_AI_PROVIDERS)
        },
    }


def _empty_usage() -> Dict[str, Any]:
    current_month = datetime.now(timezone.utc).strftime("%Y-%m")
    return {
        "current_month": current_month,
        "totals": {
            "requests": 0,
            "failures": 0,
            "prompt_tokens": 0,
            "completion_tokens": 0,
            "total_tokens": 0,
        },
        "providers": {
            provider: {
                "requests": 0,
                "failures": 0,
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0,
            }
            for provider in sorted(SUPPORTED_AI_PROVIDERS)
        },
        "monthly": {
            current_month: {
                "providers": {
                    provider: {
                        "requests": 0,
                        "failures": 0,
                        "prompt_tokens": 0,
                        "completion_tokens": 0,
                        "total_tokens": 0,
                    }
                    for provider in sorted(SUPPORTED_AI_PROVIDERS)
                },
                "projects": {},
                "users": {},
            }
        },
        "recent_events": [],
    }


def _safe_json_loads(value: Optional[str], fallback: Dict[str, Any]) -> Dict[str, Any]:
    if not value:
        return fallback
    try:
        import json

        loaded = json.loads(value)
        return loaded if isinstance(loaded, dict) else fallback
    except Exception:
        return fallback


def _coerce_positive_int(value: Any) -> Optional[int]:
    try:
        normalized = int(value)
    except (TypeError, ValueError):
        return None
    return normalized if normalized > 0 else None


def _persist_setting(db: Session, key: str, value: Dict[str, Any], description: str) -> None:
    import json

    payload = json.dumps(value, separators=(",", ":"), sort_keys=True)
    existing = crud.get_system_setting(db, key)
    if existing:
        crud.update_system_setting(db, key, schemas.SystemSettingsUpdate(value=payload, description=description))
    else:
        crud.create_system_setting(db, schemas.SystemSettingsCreate(key=key, value=payload, description=description))


def _load_ai_config(db: Session) -> Dict[str, Any]:
    setting = crud.get_system_setting(db, AI_MANAGER_CONFIG_KEY)
    config = default_ai_config()
    stored = _safe_json_loads(setting.value if setting else None, {})
    if stored:
        active_provider = str(stored.get("active_provider") or "").strip().lower()
        if active_provider in SUPPORTED_AI_PROVIDERS:
            config["active_provider"] = active_provider
        config["per_project_monthly_token_limit"] = stored.get("per_project_monthly_token_limit")
        stored_chat = stored.get("requirement_chat")
        if isinstance(stored_chat, dict):
            config["requirement_chat"].update(
                {k: v for k, v in stored_chat.items() if k in DEFAULT_REQUIREMENT_CHAT}
            )
        if isinstance(stored.get("system_prompt"), str):
            config["system_prompt"] = stored["system_prompt"]
        if "compact_payload_default" in stored:
            config["compact_payload_default"] = bool(stored.get("compact_payload_default"))
        if isinstance(stored.get("test_case_generation"), dict):
            config["test_case_generation"].update(
                {k: v for k, v in stored["test_case_generation"].items() if k in DEFAULT_TEST_CASE_GENERATION}
            )
        if isinstance(stored.get("routing"), dict):
            for task in ROUTING_TASKS:
                target = stored["routing"].get(task)
                if isinstance(target, dict):
                    config["routing"][task] = {
                        "provider": target.get("provider"),
                        "model": target.get("model"),
                    }
        if isinstance(stored.get("fallback"), dict):
            config["fallback"] = {
                "enabled": bool(stored["fallback"].get("enabled")),
                "order": list(stored["fallback"].get("order") or []),
            }
        for provider, provider_config in (stored.get("providers") or {}).items():
            normalized_provider = str(provider or "").strip().lower()
            if normalized_provider in config["providers"] and isinstance(provider_config, dict):
                config["providers"][normalized_provider].update(provider_config)
                config["providers"][normalized_provider]["provider"] = normalized_provider
    return config


def _mask_key(encrypted_key: Optional[str]) -> Optional[str]:
    if not encrypted_key:
        return None
    try:
        plain = decrypt_data(encrypted_key)
    except ValueError:
        return "configured"
    if len(plain) <= 8:
        return "configured"
    return f"{plain[:4]}...{plain[-4:]}"


def _provider_requires_api_key(provider: str) -> bool:
    return provider != "litellm"


def _public_provider_config(provider_config: Dict[str, Any]) -> Dict[str, Any]:
    public_config = {key: value for key, value in provider_config.items() if key != "api_key"}
    public_config["token_configured"] = bool(provider_config.get("api_key"))
    public_config["api_key_masked"] = _mask_key(provider_config.get("api_key"))
    public_config["api_key_required"] = _provider_requires_api_key(str(provider_config.get("provider") or ""))
    return public_config


def _normalize_requirement_chat(raw: Any) -> Dict[str, Any]:
    chat = dict(DEFAULT_REQUIREMENT_CHAT)
    if not isinstance(raw, dict):
        return chat

    def _int(key: str, lo: int, hi: int) -> int:
        try:
            value = int(raw[key]) if raw.get(key) is not None else chat[key]
        except (TypeError, ValueError):
            value = chat[key]
        return min(hi, max(lo, value))

    chat["enabled"] = bool(raw.get("enabled", chat["enabled"]))
    chat["max_context_requirements"] = _int("max_context_requirements", 1, 200)
    chat["history_turns"] = _int("history_turns", 0, 20)
    raw_sources = raw.get("source_types")
    if isinstance(raw_sources, list):
        cleaned = [s for s in raw_sources if s in SOURCE_TYPES]
        chat["source_types"] = cleaned or ["requirements"]
    else:
        chat["source_types"] = list(DEFAULT_REQUIREMENT_CHAT["source_types"])
    return chat


def _normalize_test_case_generation(raw: Any) -> Dict[str, Any]:
    cfg = dict(DEFAULT_TEST_CASE_GENERATION)
    if isinstance(raw, dict):
        def _int(key: str, lo: int, hi: int) -> int:
            try:
                value = int(raw[key]) if raw.get(key) is not None else cfg[key]
            except (TypeError, ValueError):
                value = cfg[key]
            return min(hi, max(lo, value))
        cfg["default_count"] = _int("default_count", 1, 20)
        cfg["max_tokens"] = _int("max_tokens", 256, 4000)
    return cfg


def _normalize_routing(raw: Any) -> Dict[str, Any]:
    routing = {task: {"provider": None, "model": None} for task in ROUTING_TASKS}
    if isinstance(raw, dict):
        for task in ROUTING_TASKS:
            target = raw.get(task)
            if isinstance(target, dict):
                provider = str(target.get("provider") or "").strip().lower()
                model = str(target.get("model") or "").strip()
                routing[task] = {
                    "provider": provider if provider in SUPPORTED_AI_PROVIDERS else None,
                    "model": model or None,
                }
    return routing


def _normalize_fallback(raw: Any) -> Dict[str, Any]:
    fb = {"enabled": False, "order": []}
    if isinstance(raw, dict):
        fb["enabled"] = bool(raw.get("enabled"))
        order: List[str] = []
        for item in raw.get("order") or []:
            normalized = str(item or "").strip().lower()
            if normalized in SUPPORTED_AI_PROVIDERS and normalized not in order:
                order.append(normalized)
        fb["order"] = order
    return fb


def get_requirement_chat_settings(db: Session) -> Dict[str, Any]:
    return _normalize_requirement_chat(_load_ai_config(db).get("requirement_chat"))


def get_test_case_generation_settings(db: Session) -> Dict[str, Any]:
    return _normalize_test_case_generation(_load_ai_config(db).get("test_case_generation"))


def get_compact_payload_default(db: Session) -> bool:
    return bool(_load_ai_config(db).get("compact_payload_default", True))


def get_ai_manager_settings(db: Session) -> Dict[str, Any]:
    config = _load_ai_config(db)
    return {
        "active_provider": config["active_provider"],
        "per_project_monthly_token_limit": config.get("per_project_monthly_token_limit"),
        "requirement_chat": _normalize_requirement_chat(config.get("requirement_chat")),
        "system_prompt": str(config.get("system_prompt") or ""),
        "compact_payload_default": bool(config.get("compact_payload_default", True)),
        "test_case_generation": _normalize_test_case_generation(config.get("test_case_generation")),
        "routing": _normalize_routing(config.get("routing")),
        "fallback": _normalize_fallback(config.get("fallback")),
        "providers": [_public_provider_config(config["providers"][provider]) for provider in sorted(config["providers"])],
    }


def get_ai_manager_status(db: Session) -> Dict[str, Any]:
    settings = get_ai_manager_settings(db)
    active_provider = settings["active_provider"]
    provider = next((item for item in settings["providers"] if item["provider"] == active_provider), None)
    token_required = bool(provider and provider.get("api_key_required", True))
    available = bool(provider and provider.get("enabled") and (provider.get("token_configured") or not token_required))
    reason = None
    if not provider:
        reason = "active_provider_not_configured"
    elif not provider.get("enabled"):
        reason = "active_provider_disabled"
    elif token_required and not provider.get("token_configured"):
        reason = "token_missing"
    safe_provider = None
    if provider:
        safe_provider = {key: value for key, value in provider.items() if key != "api_key_masked"}
    chat = _normalize_requirement_chat(settings.get("requirement_chat"))
    return {
        "active_provider": active_provider,
        "available": available,
        "reason": reason,
        "provider": safe_provider,
        "requirement_chat_enabled": chat["enabled"],
        "requirement_chat_source_types": chat["source_types"],
        "compact_payload_default": bool(settings.get("compact_payload_default", True)),
        "test_case_default_count": _normalize_test_case_generation(
            settings.get("test_case_generation")
        )["default_count"],
    }


def update_ai_manager_settings(db: Session, payload: AIManagerSettingsPayload) -> Dict[str, Any]:
    config = _load_ai_config(db)

    config["active_provider"] = payload.active_provider
    config["per_project_monthly_token_limit"] = payload.per_project_monthly_token_limit
    if payload.requirement_chat is not None:
        config["requirement_chat"] = _normalize_requirement_chat(payload.requirement_chat.model_dump())
    if payload.system_prompt is not None:
        config["system_prompt"] = payload.system_prompt.strip()
    if payload.compact_payload_default is not None:
        config["compact_payload_default"] = bool(payload.compact_payload_default)
    if payload.test_case_generation is not None:
        config["test_case_generation"] = _normalize_test_case_generation(payload.test_case_generation.model_dump())
    if payload.routing is not None:
        config["routing"] = _normalize_routing(payload.routing.model_dump())
    if payload.fallback is not None:
        config["fallback"] = _normalize_fallback(payload.fallback.model_dump())
    for provider_payload in payload.providers:
        provider_config = config["providers"][provider_payload.provider]
        provider_config.update(
            {
                "enabled": provider_payload.enabled,
                "model": provider_payload.model or DEFAULT_MODELS[provider_payload.provider],
                "base_url": provider_payload.base_url or DEFAULT_BASE_URLS[provider_payload.provider],
                "request_timeout_seconds": provider_payload.request_timeout_seconds,
                "monthly_token_limit": provider_payload.monthly_token_limit,
            }
        )
        if provider_payload.api_key:
            provider_config["api_key"] = encrypt_data(provider_payload.api_key)

    _persist_setting(db, AI_MANAGER_CONFIG_KEY, config, "AI provider configuration and encrypted API tokens")
    return get_ai_manager_settings(db)


def _usage_limit_entry(used_tokens: int, limit: Optional[int]) -> Dict[str, Any]:
    normalized_used = max(0, int(used_tokens or 0))
    normalized_limit = _coerce_positive_int(limit)
    percent_used = round((normalized_used / normalized_limit) * 100, 2) if normalized_limit else 0
    status = "unlimited"
    if normalized_limit:
        if normalized_used >= normalized_limit:
            status = "exceeded"
        elif percent_used >= AI_LIMIT_WARNING_THRESHOLD:
            status = "warning"
        else:
            status = "ok"
    return {
        "used_tokens": normalized_used,
        "limit": normalized_limit,
        "remaining_tokens": max(normalized_limit - normalized_used, 0) if normalized_limit else None,
        "percent_used": percent_used,
        "status": status,
    }


def _build_usage_limits(db: Session, usage: Dict[str, Any]) -> Dict[str, Any]:
    config = _load_ai_config(db)
    current_month = _ensure_monthly_usage(usage)
    monthly_bucket = usage["monthly"][current_month]
    provider_usage = monthly_bucket.get("providers") or {}
    provider_limits = {}
    for provider in sorted(SUPPORTED_AI_PROVIDERS):
        monthly_provider_usage = provider_usage.get(provider) if isinstance(provider_usage.get(provider), dict) else {}
        provider_limits[provider] = {
            **_usage_limit_entry(
                int(monthly_provider_usage.get("total_tokens") or 0),
                config["providers"].get(provider, {}).get("monthly_token_limit"),
            ),
            "requests": int(monthly_provider_usage.get("requests") or 0),
            "failures": int(monthly_provider_usage.get("failures") or 0),
        }

    project_limit = _coerce_positive_int(config.get("per_project_monthly_token_limit"))
    project_entries = []
    projects = monthly_bucket.get("projects") if isinstance(monthly_bucket.get("projects"), dict) else {}
    for project_id, project_usage in projects.items():
        if not isinstance(project_usage, dict):
            continue
        project_entries.append({
            "project_id": str(project_id),
            **_usage_limit_entry(int(project_usage.get("total_tokens") or 0), project_limit),
            "requests": int(project_usage.get("requests") or 0),
            "failures": int(project_usage.get("failures") or 0),
        })
    project_entries.sort(key=lambda item: item["used_tokens"], reverse=True)

    operations = monthly_bucket.get("operations") if isinstance(monthly_bucket.get("operations"), dict) else {}
    by_operation = [
        {
            "operation": str(op),
            "requests": int(stats.get("requests") or 0),
            "failures": int(stats.get("failures") or 0),
            "total_tokens": int(stats.get("total_tokens") or 0),
            "prompt_tokens": int(stats.get("prompt_tokens") or 0),
            "completion_tokens": int(stats.get("completion_tokens") or 0),
        }
        for op, stats in operations.items()
        if isinstance(stats, dict)
    ]
    by_operation.sort(key=lambda item: item["total_tokens"], reverse=True)

    return {
        "current_month": current_month,
        "active_provider": config["active_provider"],
        "providers": provider_limits,
        "active_provider_limit": provider_limits.get(config["active_provider"]),
        "by_operation": by_operation,
        "project_monthly_limit": {
            "limit": project_limit,
            "total_projects": len(project_entries),
            "projects_over_limit": sum(1 for item in project_entries if item["status"] == "exceeded"),
            "projects_near_limit": sum(1 for item in project_entries if item["status"] == "warning"),
            "top_projects": project_entries[:10],
        },
    }


def _persist_usage(db: Session, usage: Dict[str, Any], description: str) -> None:
    persisted_usage = {key: value for key, value in usage.items() if key != "limits"}
    _persist_setting(db, AI_MANAGER_USAGE_KEY, persisted_usage, description)


def get_ai_usage(db: Session, include_limits: bool = True) -> Dict[str, Any]:
    setting = crud.get_system_setting(db, AI_MANAGER_USAGE_KEY)
    usage = _empty_usage()
    stored = _safe_json_loads(setting.value if setting else None, {})
    if stored:
        usage["current_month"] = stored.get("current_month") or usage["current_month"]
        if isinstance(stored.get("totals"), dict):
            usage["totals"].update(stored.get("totals") or {})
        for provider, provider_usage in (stored.get("providers") or {}).items():
            if provider in usage["providers"] and isinstance(provider_usage, dict):
                usage["providers"][provider].update(provider_usage)
        if isinstance(stored.get("monthly"), dict):
            usage["monthly"].update(stored.get("monthly") or {})
        recent_events = stored.get("recent_events")
        usage["recent_events"] = recent_events[:MAX_RECENT_USAGE_EVENTS] if isinstance(recent_events, list) else []
    _ensure_monthly_usage(usage)
    if include_limits:
        usage["limits"] = _build_usage_limits(db, usage)
    return usage


def reset_ai_usage(db: Session) -> Dict[str, Any]:
    usage = _empty_usage()
    _ensure_monthly_usage(usage)
    _persist_usage(db, usage, "AI token usage reset")
    logger.info("AI usage statistics reset")
    return get_ai_usage(db)


def clear_ai_recent_events(db: Session) -> Dict[str, Any]:
    usage = get_ai_usage(db, include_limits=False)
    usage["recent_events"] = []
    _persist_usage(db, usage, "AI recent activity cleared")
    logger.info("AI recent activity cleared")
    return get_ai_usage(db)


def _ensure_monthly_usage(usage: Dict[str, Any]) -> str:
    current_month = datetime.now(timezone.utc).strftime("%Y-%m")
    usage["current_month"] = current_month
    if not isinstance(usage.get("monthly"), dict):
        usage["monthly"] = {}
    monthly = usage["monthly"]
    current_bucket = monthly.get(current_month)
    if not isinstance(current_bucket, dict):
        current_bucket = {}
        monthly[current_month] = current_bucket
    if "providers" not in current_bucket:
        legacy_provider_values = {
            provider: current_bucket.pop(provider)
            for provider in list(current_bucket.keys())
            if provider in SUPPORTED_AI_PROVIDERS and isinstance(current_bucket.get(provider), dict)
        }
        current_bucket["providers"] = legacy_provider_values
    if not isinstance(current_bucket.get("providers"), dict):
        current_bucket["providers"] = {}
    if not isinstance(current_bucket.get("projects"), dict):
        current_bucket["projects"] = {}
    if not isinstance(current_bucket.get("users"), dict):
        current_bucket["users"] = {}
    if not isinstance(current_bucket.get("operations"), dict):
        current_bucket["operations"] = {}
    for provider in SUPPORTED_AI_PROVIDERS:
        if not isinstance(current_bucket["providers"].get(provider), dict):
            current_bucket["providers"][provider] = {}
        current_bucket["providers"][provider].update({
            "requests": int(current_bucket["providers"][provider].get("requests") or 0),
            "failures": int(current_bucket["providers"][provider].get("failures") or 0),
            "prompt_tokens": int(current_bucket["providers"][provider].get("prompt_tokens") or 0),
            "completion_tokens": int(current_bucket["providers"][provider].get("completion_tokens") or 0),
            "total_tokens": int(current_bucket["providers"][provider].get("total_tokens") or 0),
        })
    return current_month


def _record_usage(
    db: Session,
    provider: str,
    model: str,
    operation: str,
    prompt_tokens: int,
    completion_tokens: int,
    success: bool,
    error: Optional[str] = None,
    project_id: Optional[int] = None,
    user_id: Optional[int] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
) -> None:
    usage = get_ai_usage(db, include_limits=False)
    current_month = _ensure_monthly_usage(usage)
    total_tokens = max(0, prompt_tokens) + max(0, completion_tokens)
    bucket = usage["providers"].setdefault(provider, _empty_usage()["providers"][provider])
    monthly_bucket = usage["monthly"][current_month]
    month_provider_bucket = monthly_bucket["providers"][provider]
    project_bucket = monthly_bucket["projects"].setdefault(str(project_id), {
        "requests": 0,
        "failures": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
    }) if project_id is not None else None
    user_bucket = monthly_bucket["users"].setdefault(str(user_id), {
        "requests": 0,
        "failures": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
    }) if user_id is not None else None
    operation_bucket = monthly_bucket["operations"].setdefault(operation or "completion", {
        "requests": 0,
        "failures": 0,
        "prompt_tokens": 0,
        "completion_tokens": 0,
        "total_tokens": 0,
    })
    targets = [usage["totals"], bucket, month_provider_bucket, operation_bucket]
    if project_bucket is not None:
        targets.append(project_bucket)
    if user_bucket is not None:
        targets.append(user_bucket)
    for target in targets:
        target["requests"] = int(target.get("requests") or 0) + 1
        target["prompt_tokens"] = int(target.get("prompt_tokens") or 0) + max(0, prompt_tokens)
        target["completion_tokens"] = int(target.get("completion_tokens") or 0) + max(0, completion_tokens)
        target["total_tokens"] = int(target.get("total_tokens") or 0) + total_tokens
        if not success:
            target["failures"] = int(target.get("failures") or 0) + 1

    usage["recent_events"] = [
        {
            "provider": provider,
            "model": model,
            "operation": operation,
            "success": success,
            "prompt_tokens": max(0, prompt_tokens),
            "completion_tokens": max(0, completion_tokens),
            "total_tokens": total_tokens,
            "error": error,
            "project_id": project_id,
            "user_id": user_id,
            "entity_type": entity_type,
            "entity_id": entity_id,
            "created_at": datetime.now(timezone.utc).isoformat(),
        },
        *list(usage.get("recent_events") or []),
    ][:MAX_RECENT_USAGE_EVENTS]
    _persist_usage(db, usage, "AI token usage rollups and recent connection events")


def _get_private_config(db: Session, provider: Optional[str] = None, project_id: Optional[int] = None) -> Dict[str, Any]:
    config = _load_ai_config(db)

    selected_provider = provider or config["active_provider"]
    provider_config = config["providers"].get(selected_provider)
    if not provider_config:
        raise HTTPException(status_code=400, detail="Unsupported AI provider")
    if not provider_config.get("enabled"):
        raise HTTPException(status_code=400, detail="AI provider is not enabled")
    encrypted_key = provider_config.get("api_key")
    if not encrypted_key and _provider_requires_api_key(selected_provider):
        raise HTTPException(status_code=400, detail="AI API token is not configured")
    if encrypted_key:
        try:
            provider_config["api_key_plain"] = decrypt_data(encrypted_key)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail="AI API token cannot be decrypted") from exc
    else:
        provider_config["api_key_plain"] = ""
    monthly_limit = _coerce_positive_int(provider_config.get("monthly_token_limit"))
    if monthly_limit:
        usage = get_ai_usage(db, include_limits=False)
        current_month = _ensure_monthly_usage(usage)
        used_tokens = int(usage["monthly"][current_month]["providers"][selected_provider].get("total_tokens") or 0)
        if used_tokens >= monthly_limit:
            raise HTTPException(status_code=429, detail="AI provider monthly token limit reached")
    project_limit = _coerce_positive_int(config.get("per_project_monthly_token_limit"))
    if project_limit and project_id is not None:
        usage = get_ai_usage(db, include_limits=False)
        current_month = _ensure_monthly_usage(usage)
        monthly_bucket = usage["monthly"][current_month]
        project_usage = monthly_bucket.get("projects", {}).get(str(project_id), {})
        used_tokens = int(project_usage.get("total_tokens") or 0)
        if used_tokens >= project_limit:
            raise HTTPException(status_code=429, detail="Project monthly AI token limit reached")
    return provider_config


def _usage_from_openai_payload(data: Dict[str, Any]) -> tuple[int, int]:
    usage = data.get("usage") or {}
    return int(usage.get("prompt_tokens") or 0), int(usage.get("completion_tokens") or 0)


def _operation_task(operation: str) -> Optional[str]:
    """Map an operation string to a routing task group."""
    if operation == "requirement_project_qa":
        return "qa"
    if operation == "requirement_test_case_generation":
        return "generation"
    if operation.startswith("test_case_assistant"):
        return "assistant"
    return None


async def generate_ai_completion(
    db: Session,
    request: AICompletionRequest,
    operation: str = "completion",
    project_id: Optional[int] = None,
    user_id: Optional[int] = None,
    entity_type: Optional[str] = None,
    entity_id: Optional[int] = None,
) -> AICompletionResult:
    config = _load_ai_config(db)
    system_prompt = str(config.get("system_prompt") or "").strip()

    # Task-group routing: an operation can pin a provider/model override.
    route = _normalize_routing(config.get("routing")).get(_operation_task(operation)) or {}
    routed_provider = route.get("provider")
    routed_model = route.get("model")
    chosen_provider = request.provider or routed_provider or config["active_provider"]

    # Fallback chain (errors + token limits, per admin config). An explicit
    # request.provider (e.g. the connection test) pins that provider and never
    # falls back, so a failure surfaces instead of being masked by another.
    fallback = _normalize_fallback(config.get("fallback"))
    candidates = [chosen_provider]
    if fallback["enabled"] and not request.provider:
        for prov in fallback["order"]:
            if prov not in candidates:
                candidates.append(prov)

    async def _attempt(prov: str, model_override: Optional[str]) -> AICompletionResult:
        # Raises HTTPException on any failure (after recording usage for call
        # failures); pre-call config/limit errors propagate without a usage row.
        provider_config = _get_private_config(db, prov, project_id=project_id)
        provider = provider_config["provider"]
        model = model_override or provider_config.get("model") or DEFAULT_MODELS[provider]
        base_url = str(provider_config.get("base_url") or DEFAULT_BASE_URLS[provider]).rstrip("/")
        provider_timeout = int(provider_config.get("request_timeout_seconds") or DEFAULT_AI_REQUEST_TIMEOUT_SECONDS)
        timeout = min(
            MAX_AI_REQUEST_TIMEOUT_SECONDS,
            max(provider_timeout, request.timeout_seconds or provider_timeout),
        )
        api_key = provider_config["api_key_plain"]
        prompt_tokens = 0
        completion_tokens = 0
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout)) as client:
                if provider in {"openai", "openrouter", "huggingface", "litellm"}:
                    headers = {"Content-Type": "application/json"}
                    if api_key:
                        headers["Authorization"] = f"Bearer {api_key}"
                    messages = []
                    if system_prompt:
                        messages.append({"role": "system", "content": system_prompt})
                    messages.append({"role": "user", "content": request.prompt})
                    response = await client.post(
                        f"{base_url}/chat/completions",
                        headers=headers,
                        json={
                            "model": model,
                            "messages": messages,
                            "max_tokens": request.max_tokens,
                            "temperature": request.temperature,
                        },
                    )
                    response.raise_for_status()
                    data = response.json()
                    choices = data.get("choices") or []
                    content = (((choices[0] if choices else {}).get("message") or {}).get("content") or "").strip()
                    prompt_tokens, completion_tokens = _usage_from_openai_payload(data)
                elif provider == "anthropic":
                    body = {
                        "model": model,
                        "messages": [{"role": "user", "content": request.prompt}],
                        "max_tokens": request.max_tokens,
                        "temperature": request.temperature,
                    }
                    if system_prompt:
                        body["system"] = system_prompt
                    response = await client.post(
                        f"{base_url}/messages",
                        headers={
                            "x-api-key": api_key,
                            "anthropic-version": "2023-06-01",
                            "Content-Type": "application/json",
                        },
                        json=body,
                    )
                    response.raise_for_status()
                    data = response.json()
                    content_blocks = data.get("content") or []
                    content = "\n".join(
                        str(block.get("text") or "")
                        for block in content_blocks
                        if isinstance(block, dict) and block.get("type") == "text"
                    ).strip()
                    usage = data.get("usage") or {}
                    prompt_tokens = int(usage.get("input_tokens") or 0)
                    completion_tokens = int(usage.get("output_tokens") or 0)
                else:
                    raise HTTPException(status_code=400, detail="Unsupported AI provider")

            if not content:
                raise HTTPException(status_code=502, detail="AI provider returned an empty response")

            _record_usage(
                db, provider, model, operation, prompt_tokens, completion_tokens, True,
                project_id=project_id, user_id=user_id, entity_type=entity_type, entity_id=entity_id,
            )
            return AICompletionResult(
                provider=provider,
                model=model,
                content=content,
                prompt_tokens=prompt_tokens,
                completion_tokens=completion_tokens,
                total_tokens=prompt_tokens + completion_tokens,
            )
        except httpx.TimeoutException as exc:
            logger.warning("AI provider request timed out for %s after %s seconds", provider, timeout)
            _record_usage(
                db, provider, model, operation, 0, 0, False, f"timeout after {timeout} seconds",
                project_id=project_id, user_id=user_id, entity_type=entity_type, entity_id=entity_id,
            )
            raise HTTPException(
                status_code=504,
                detail=f"AI provider request timed out after {timeout} seconds. Try fewer test cases, a faster model, or increase the provider timeout in AI Manager.",
            ) from exc
        except httpx.HTTPStatusError as exc:
            detail = "AI provider request failed"
            try:
                provider_error = exc.response.json()
                detail = str(provider_error.get("error") or provider_error.get("message") or detail)
            except Exception:
                detail = exc.response.text[:300] or detail
            logger.warning("AI provider HTTP error for %s: %s", provider, detail)
            _record_usage(
                db, provider, model, operation, 0, 0, False, detail[:200],
                project_id=project_id, user_id=user_id, entity_type=entity_type, entity_id=entity_id,
            )
            raise HTTPException(status_code=502, detail="AI provider request failed. Check provider credentials, model, and quota.") from exc
        except HTTPException:
            raise
        except Exception as exc:
            logger.exception("Unexpected AI provider error for %s", provider)
            _record_usage(
                db, provider, model, operation, 0, 0, False, "unexpected_error",
                project_id=project_id, user_id=user_id, entity_type=entity_type, entity_id=entity_id,
            )
            raise HTTPException(status_code=500, detail="Unexpected AI provider error") from exc

    primary_exc: Optional[HTTPException] = None
    for prov in candidates:
        model_override = routed_model if prov == routed_provider else None
        try:
            return await _attempt(prov, model_override)
        except HTTPException as exc:
            # Keep the primary provider's error as the root cause to surface if
            # every candidate fails (more meaningful than a fallback's error).
            if primary_exc is None:
                primary_exc = exc
            if len(candidates) > 1:
                logger.warning("AI provider %s failed (%s); trying next candidate", prov, exc.detail)
            continue
    raise primary_exc or HTTPException(status_code=500, detail="Unexpected AI provider error")
