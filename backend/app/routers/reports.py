"""/reports — report types per role, background generation (Processing → Completed / Failed), history,
downloads (PDF, XLSX, CSV) and email."""
from __future__ import annotations

import json
import logging
import re
import smtplib
from email.message import EmailMessage

from fastapi import APIRouter, BackgroundTasks, Depends
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.orm import Session

from .. import models as m
from .. import repository as repo
from ..config import get_settings
from ..core.deps import Principal, current_principal, require_action
from ..core.errors import fail, invalid, not_found
from ..core.ids import next_id
from ..core.timeutil import format_datetime, parse_iso, utcnow
from ..database import get_db, session_factory
from ..domain import constants as c
from ..domain.exporters import build_report_file, file_name
from ..domain.filters import Filters, parse_filters
from ..domain.reports import build_report_rows, report_metadata
from ..schemas import EmailQueuedOut, EmailReportRequest, ReportOut, ReportRequest, ReportTypeOut

router = APIRouter(prefix="/reports", tags=["Reports & Exports"])
log = logging.getLogger("demandiq.reports")
EMAIL = re.compile(r"^\S+@\S+\.\S+$")


def _fmt_time(zone: str):
    def fmt(value):
        return format_datetime(parse_iso(value), zone) if value else ""

    return fmt


def report_rows(db: Session, name: str, f: Filters) -> list[dict]:
    data: dict = {"inventory": repo.load_inventory(db)}
    if name in ("Sales Summary", "Sales by Region", "Product Performance Report"):
        data["sales"] = repo.load_sales(db, f)
    if "Forecast" in name:
        data["forecasts"] = repo.load_forecasts(db)
    if "Reorder" in name:
        data["reorders"] = repo.load_reorders(db)
    if "User Activity" in name:
        data["activity"] = [repo.activity_json(a) for a in db.execute(select(m.ActivityLog).order_by(m.ActivityLog.created_at.desc(), m.ActivityLog.event_id.desc())).scalars()]
    if "System Error" in name:
        data["errors"] = [repo.error_json(e) for e in db.execute(select(m.ErrorLog).order_by(m.ErrorLog.created_at.desc(), m.ErrorLog.error_id.desc())).scalars()]
    if "Data Quality" in name:
        data["datasets"] = repo.load_datasets(db)
    return build_report_rows(name, f, data, _fmt_time(get_settings().app_timezone))



def render(db: Session, report: m.Report) -> tuple[bytes, str, str]:
    filters = json.loads(report.filters) if report.filters else {}
    f = parse_filters(filters, repo.sales_bounds(db))

    report_type = db.execute(
        select(m.RoleReportType)
        .where(
            m.RoleReportType.report_type_id == report.report_type_id
        )
        .limit(1)
    ).scalar_one_or_none()

    if report_type is None:
        raise ValueError("Report type not found.")

    user = db.get(m.User, report.user_id)
    user_name = user.full_name if user else "Unknown User"
    role_id = user.role_id if user else 0

    rows = report_rows(db, report_type.report_name, f)

    zone = get_settings().app_timezone
    metadata = report_metadata(f, user_name, role_id)

    return build_report_file(
        report.file_format,
        rows,
        report_type.report_name,
        metadata,
        format_datetime(utcnow(), zone),
    )


def stored_path(report: m.Report):
    directory = get_settings().reports_dir
    directory.mkdir(parents=True, exist_ok=True)
    return directory / f"{report.report_id}.{report.file_format.lower()}"


def generate_in_background(report_id: str, session_id: str | None) -> None:
    """The background job: Processing → Completed (file stored) or Failed (nothing matched)."""
    with session_factory()() as db:
        report = db.get(m.Report, report_id)
        if report is None:
            return
        user = report.owner
        try:
            content, _, _ = render(db, report)
            stored_path(report).write_bytes(content)
            report.status = "Completed"
            report.completed_at = utcnow()
            repo.log_event(db, f"{report.report_type} exported", "Reports & Exports", "Completed", report.format, user=user, session_id=session_id, role_id=report.role_id)
        except ValueError as error:
            report.status = "Failed"
            report.completed_at = utcnow()
            report.error = str(error)[:400]
            repo.log_event(db, f"{report.report_type} export failed", "Reports & Exports", "Failed", f"{report.format} · {report.error}", user=user, session_id=session_id, role_id=report.role_id)
            repo.log_error(db, "Reports & Exports", "Export failure", "Warning", f"{report.report_type}: {report.error}")
        except Exception as error:  # noqa: BLE001
            log.exception("Report %s failed", report_id)
            report.status = "Failed"
            report.completed_at = utcnow()
            report.error = "The report could not be generated."
            repo.log_error(db, "Reports & Exports", "Export failure", "Error", f"{report.report_type}: {error}")
        db.commit()


def _check_request(db: Session, principal: Principal, body: ReportRequest) -> Filters:
    require_action(principal, "Generate reports")
    names = [r[0] for r in c.REPORT_TYPES]
    invalid({"name": body.name not in names and "Choose a report type.", "format": body.format not in c.REPORT_FORMATS and "Use PDF, XLSX or CSV."})
    allowed = [t["name"] for t in repo.report_types_for(db, principal.role_id)]
    if body.name not in allowed:
        fail(403, "report_not_allowed", f"The {c.role_name(principal.role_id)} role can't generate the {body.name}.")
    return parse_filters(body.filters if isinstance(body.filters, dict) else {}, repo.sales_bounds(db))


def _find(db: Session, principal: Principal, report_id: str) -> m.Report:
    report = db.get(m.Report, report_id)
    if report is None or (principal.role_id != c.ADMIN and report.user_id != principal.user.user_id):
        not_found("That report doesn't exist.")
    return report


@router.get("/types", response_model=list[ReportTypeOut], summary="The report types the signed-in user's role may generate")
def types(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return repo.report_types_for(db, principal.role_id)


@router.get("", response_model=list[ReportOut], summary="Report history: your reports (the Admin: everyone's), newest first")
def list_reports(principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    query = select(m.Report).order_by(m.Report.generated_at.desc(), m.Report.report_id.desc())
    if principal.role_id != c.ADMIN:
        query = query.where(m.Report.user_id == principal.user.user_id)
    return [repo.report_json(db, r) for r in db.execute(query).scalars()]




@router.post("", status_code=202, response_model=ReportOut, summary="Generate a report in the background (poll GET /reports/{id})")
def create(
    body: ReportRequest,
    background: BackgroundTasks,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    _check_request(db, principal, body)

    report_type = db.execute(
        select(m.RoleReportType).where(
            m.RoleReportType.role_id == principal.role_id,
            m.RoleReportType.report_name == body.name,
        )
    ).scalar_one_or_none()

    if report_type is None:
        fail(400, "invalid_report_type", "The selected report type was not found.")

    report = m.Report(
        report_id=next_id(db, "RPT"),
        report_type_id=report_type.report_type_id,
        user_id=principal.user.user_id,
        file_format=body.format,
        generated_at=utcnow(),
        status="Processing",
        filters=json.dumps(body.filters) if body.filters else None,
    )

    db.add(report)
    db.commit()
    db.refresh(report)

    background.add_task(
        generate_in_background,
        report.report_id,
        principal.session.session_id,
    )

    return repo.report_json(db, report)



@router.post("/email", status_code=202, response_model=EmailQueuedOut, summary="Generate a report and email it")
def email(body: EmailReportRequest, background: BackgroundTasks, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    recipients = body.recipients
    require_action(principal, "Generate reports")
    names = [r[0] for r in c.REPORT_TYPES]
    invalid(
        {
            "name": body.name not in names and "Choose a report type.",
            "format": body.format not in c.REPORT_FORMATS and "Use PDF, XLSX or CSV.",
            "recipients": "Enter between 1 and 20 email addresses." if not isinstance(recipients, list) or not recipients or len(recipients) > 20
            else (any(not EMAIL.match(str(a)) for a in recipients) and "One of the email addresses is not valid."),
            "subject": len(str(body.subject or "")) > 200 and "Keep the subject under 200 characters.",
        }
    )
    f = _check_request(db, principal, body)
    mail_id = next_id(db, "MAIL")
    message = str(body.message or "")
    repo.log_event(db, "Report emailed", "Reports & Exports", "Pending", f"{body.name} · {body.format} → {', '.join(recipients)}{' (with a message)' if message else ''}", user=principal.user, session_id=principal.session.session_id)
    db.commit()
    background.add_task(send_report_email, body.name, body.format, f.as_json(), [str(a) for a in recipients], str(body.subject or ""), message, principal.user.full_name, principal.role_id)
    return {"id": mail_id, "status": "Queued", "recipients": recipients, "name": body.name, "format": body.format}


def send_report_email(name: str, fmt: str, filters: dict, recipients: list[str], subject: str, message: str, user_name: str, role_id: int) -> None:
    settings = get_settings()
    with session_factory()() as db:
        f = parse_filters(filters, repo.sales_bounds(db))
        rows = report_rows(db, name, f)
        if not rows:
            repo.log_error(db, "Reports & Exports", "Email failure", "Warning", f"{name}: There is no matching data to export.")
            db.commit()
            return
        content, attachment, content_type = build_report_file(fmt, rows, name, report_metadata(f, user_name, role_id), format_datetime(utcnow(), settings.app_timezone))
        if not settings.smtp_host:
            log.warning("SMTP_HOST is not set: %s (%s) for %s was generated but not emailed.", name, fmt, ", ".join(recipients))
            return
        mail = EmailMessage()
        mail["From"] = settings.smtp_from
        mail["To"] = ", ".join(recipients)
        mail["Subject"] = subject or f"DemandIQ {name}"
        mail.set_content(message or f"Please find the {name} attached.")
        maintype, subtype = content_type.split(";")[0].split("/")
        mail.add_attachment(content, maintype=maintype, subtype=subtype, filename=attachment)
        try:
            with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=30) as smtp:
                if settings.smtp_starttls:
                    smtp.starttls()
                if settings.smtp_user:
                    smtp.login(settings.smtp_user, settings.smtp_password or "")
                smtp.send_message(mail)
        except (OSError, smtplib.SMTPException) as error:
            repo.log_error(db, "Reports & Exports", "Email failure", "Error", f"{name} → {', '.join(recipients)}: {error}")
            db.commit()


@router.get("/{report_id}", response_model=ReportOut, summary="A report and its status")
def get_report(report_id: str, principal: Principal = Depends(current_principal), db: Session = Depends(get_db)):
    return repo.report_json(db, _find(db, principal, report_id))



@router.get(
    "/{report_id}/file",
    summary="Download the report file (PDF, XLSX or CSV)",
    response_class=Response,
    responses={
        200: {
            "content": {
                "application/pdf": {},
                "text/csv": {},
                "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": {},
            }
        }
    },
)
def download(
    report_id: str,
    principal: Principal = Depends(current_principal),
    db: Session = Depends(get_db),
):
    report = _find(db, principal, report_id)

    if report.status == "Processing":
        fail(409, "report_processing", "The report is still being generated.")

    if report.status == "Failed":
        fail(409, "report_failed", "The report generation failed.")

    path = stored_path(report)
    from ..domain.exporters import CONTENT_TYPES

    if path.is_file():
        content = path.read_bytes()
    else:
        # Rebuild a missing file using the saved report filters.
        try:
            content, _, _ = render(db, report)
        except ValueError:
            fail(409, "report_failed", "There is no matching data to export.")

        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(content)

    # Resolve the report name from its report_type_id.
    report_type = db.execute(
        select(m.RoleReportType)
        .where(m.RoleReportType.report_type_id == report.report_type_id)
        .limit(1)
    ).scalar_one_or_none()

    report_name = (
        report_type.report_name if report_type else "Report"
    )

    file_format = report.file_format.upper()
    name = file_name(report_name, file_format)

    return Response(
        content=content,
        media_type=CONTENT_TYPES[file_format],
        headers={
            "Content-Disposition": f'attachment; filename="{name}"'
        },
    )
