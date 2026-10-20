"""Errors in the contract's shape: {"detail": {"code", "message", ...extra}} (docs/API_CONTRACT.md, section 3)."""
from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException


class ApiError(Exception):
    def __init__(self, status: int, code: str, message: str, **extra: Any):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message
        self.extra = extra

    def body(self) -> dict:
        return {"detail": {"code": self.code, "message": self.message, **self.extra}}


def fail(status: int, code: str, message: str, **extra: Any):
    raise ApiError(status, code, message, **extra)


def invalid(fields: dict[str, Any]) -> None:
    """422 validation_error with the field messages that are set (falsy values are ignored)."""
    errors = {name: message for name, message in fields.items() if message}
    if errors:
        first = next(iter(errors.values()))
        raise ApiError(422, "validation_error", first, fields=errors)


def not_found(message: str):
    raise ApiError(404, "not_found", message)


STATUS_CODES = {404: "not_found", 405: "method_not_allowed", 401: "not_authenticated", 403: "forbidden", 413: "file_too_large"}


def install(app: FastAPI) -> None:
    @app.exception_handler(ApiError)
    async def _api_error(_request: Request, error: ApiError):
        return JSONResponse(status_code=error.status, content=error.body())

    @app.exception_handler(RequestValidationError)
    async def _validation(_request: Request, error: RequestValidationError):
        fields: dict[str, str] = {}
        for item in error.errors():
            loc = [str(part) for part in item.get("loc", []) if part not in ("body", "query", "path")]
            name = ".".join(loc) or "request"
            fields.setdefault(name, str(item.get("msg", "Invalid value.")).removeprefix("Value error, "))
        if any(item.get("type") == "json_invalid" for item in error.errors()):
            return JSONResponse(status_code=400, content={"detail": {"code": "invalid_json", "message": "The request body is not valid JSON."}})
        first_name, first_message = next(iter(fields.items()), ("request", "Some of the values are not valid."))
        return JSONResponse(
            status_code=422,
            content={"detail": {"code": "validation_error", "message": f"{first_name}: {first_message}", "fields": fields}},
        )

    @app.exception_handler(StarletteHTTPException)
    async def _http(request: Request, error: StarletteHTTPException):
        if isinstance(error.detail, dict):
            return JSONResponse(status_code=error.status_code, content={"detail": error.detail})
        code = STATUS_CODES.get(error.status_code, "error")
        message = f"{request.method} {request.url.path} is not part of the API." if error.status_code in (404, 405) else str(error.detail)
        return JSONResponse(status_code=error.status_code, content={"detail": {"code": code, "message": message}}, headers=getattr(error, "headers", None))

    @app.exception_handler(Exception)
    async def _unexpected(_request: Request, error: Exception):
        import logging

        logging.getLogger("demandiq").exception("Unexpected error", exc_info=error)
        return JSONResponse(status_code=500, content={"detail": {"code": "server_error", "message": "The server had a problem. Try again in a moment."}})
