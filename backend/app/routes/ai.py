"""
AI-Endpunkt: Fragen an Reception-Dokumente stellen.

POST /ai/ask
    1. Mitarbeiter-Standort auflösen (assigned_location_id → Location.name)
    2. Keyword-Suche im passenden Hotel-PDF
    3. Kontext an OpenRouter senden (LLM formuliert die Antwort)
    4. Antwort + Quellen zurückgeben

Sicherheit:
    - Nur eingeloggte Mitarbeiter/Admins dürfen fragen.
    - Die KI antwortet NUR auf Basis der gefundenen PDF-Chunks.
    - Werden keine passenden Chunks gefunden → klare "keine Info"-Meldung.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth.deps import get_current_employee
from app.config.database import get_db
from app.models.employee import Employee
from app.models.employee_work_location import EmployeeWorkLocation
from app.models.location import WorkplaceLocation
from app.services.openrouter_client import _MODEL, is_configured
from app.services.rag_service import ask_reception_question

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])


# ── Request / Response Schemas ────────────────────────────────────────────────

class AskRequest(BaseModel):
    question: str = Field(
        ...,
        min_length=1,
        max_length=500,
        description="Frage auf Deutsch oder Englisch",
    )


class Source(BaseModel):
    document: str   # Dateiname der PDF (z. B. "mercure_city_reception_sop.pdf")
    page: int       # Seitennummer


class AskResponse(BaseModel):
    answer: str
    sources: list[Source]


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/ask", response_model=AskResponse)
def ask_question(
    body: AskRequest,
    db: Session = Depends(get_db),
    current_employee: Employee = Depends(get_current_employee),
):
    """
    Stellt eine Frage an die Reception-Dokumente des Hotels.

    - Nur eingeloggte Mitarbeiter dürfen fragen (JWT-Token nötig).
    - Das System sucht im PDF, das zum Standort des Mitarbeiters passt.
    - Ist kein Standort zugewiesen, werden alle PDFs durchsucht.
    - Die KI antwortet ausschließlich auf Basis der gefundenen PDF-Texte.
    """
    # ── Standortname des Mitarbeiters auflösen ───────────────────────────────
    location_name: str | None = None
    loc_id = db.scalar(
        select(EmployeeWorkLocation.location_id)
        .where(EmployeeWorkLocation.employee_id == current_employee.id)
        .order_by(EmployeeWorkLocation.location_id)
        .limit(1)
    )
    if loc_id is None and current_employee.assigned_location_id:
        loc_id = current_employee.assigned_location_id
    if loc_id:
        location = db.get(WorkplaceLocation, loc_id)
        if location:
            location_name = location.name

    # ── Logging ──────────────────────────────────────────────────────────────
    logger.info(
        "[AI] Frage von '%s' (Standort: %s) | Modell: %s | Konfiguriert: %s",
        current_employee.name,
        location_name or "kein Standort",
        _MODEL,
        is_configured(),
    )
    logger.info("[AI] Frage: %s", body.question)

    # ── RAG-Pipeline ausführen ───────────────────────────────────────────────
    answer, chunks = ask_reception_question(
        question=body.question,
        employee_location_name=location_name,
    )

    # ── Quellen deduplizieren (gleiche Seite nur einmal) ─────────────────────
    seen_sources: set[tuple[str, int]] = set()
    sources: list[Source] = []
    for chunk in chunks:
        key = (chunk["document"], chunk["page"])
        if key not in seen_sources:
            seen_sources.add(key)
            sources.append(Source(document=chunk["document"], page=chunk["page"]))

    logger.info(
        "[AI] Antwort fertig | %d Quellen | %d Zeichen",
        len(sources),
        len(answer),
    )

    return AskResponse(answer=answer, sources=sources)
