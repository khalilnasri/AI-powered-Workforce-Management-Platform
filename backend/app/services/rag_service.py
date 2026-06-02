"""
RAG-Pipeline für Reception-PDFs.

Ablauf:
1. PDF wird Seite für Seite gelesen.
2. Jede Seite wird in überlappende Text-Chunks aufgeteilt.
3. Die Chunks werden per Keyword-Suche bewertet.
4. Die besten Chunks werden als Kontext an OpenRouter (LLM) gesendet.
5. Das LLM formuliert die Antwort — aber NUR auf Basis des Kontexts.
"""

from __future__ import annotations

import logging
from pathlib import Path

logger = logging.getLogger(__name__)

# ── Pfad zum Ordner mit den PDF-Dateien ──────────────────────────────────────
KNOWLEDGE_DIR = Path(__file__).parent.parent / "knowledge" / "reception"

# ── Welches Hotel → welche PDF-Datei ─────────────────────────────────────────
# Schlüssel: Teile des Standortnamens (kleingeschrieben), Wert: Dateiname
LOCATION_TO_PDF: dict[str, str] = {
    "mercure oldenburger allee": "mercure_oldenburger_allee_reception_sop.pdf",
    "mercure city":              "mercure_city_reception_sop.pdf",
    "dary":                      "dary_hotel_reception_sop.pdf",
}

# ── Stoppwörter (werden bei der Suche ignoriert) ──────────────────────────────
_STOP_WORDS = {
    # Deutsch
    "der", "die", "das", "ein", "eine", "und", "oder", "aber", "in", "an",
    "auf", "mit", "von", "für", "zu", "ist", "sind", "war", "wird", "wie",
    "was", "wer", "ich", "du", "er", "sie", "es", "wir", "ihr", "dem",
    "den", "des", "bei", "im", "am", "zum", "zur", "nach", "aus", "auch",
    "nicht", "noch", "sich", "beim", "bis", "wenn", "dann", "alle", "bitte",
    # Englisch
    "the", "a", "an", "and", "or", "but", "in", "on", "at", "to", "for",
    "of", "with", "is", "are", "was", "be", "by", "from", "as", "this",
    "that", "it", "not", "no", "can", "will", "do", "if", "so",
}


# ── 1. Text in Chunks aufteilen ───────────────────────────────────────────────

def split_text_into_chunks(
    text: str,
    chunk_size: int = 1000,
    overlap: int = 150,
) -> list[str]:
    """
    Teilt einen langen Text in überlappende Abschnitte (Chunks).

    Beispiel (chunk_size=10, overlap=3):
        "ABCDEFGHIJKLMNO"
        → ["ABCDEFGHIJ", "HIJKLMNOP", ...]

    overlap sorgt dafür, dass Informationen an Chunk-Grenzen
    nicht verloren gehen.
    """
    chunks: list[str] = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end].strip()
        if chunk:
            chunks.append(chunk)
        if end >= len(text):
            break
        start += chunk_size - overlap
    return chunks


# ── 2. PDF laden + in Chunks umwandeln ───────────────────────────────────────

def _load_pdf_chunks(pdf_path: Path) -> list[dict]:
    """
    Liest eine PDF-Datei und gibt alle Chunks mit Metadaten zurück.

    Jeder Chunk ist ein Dict:
        {
            "text":     str,   # Textinhalt
            "page":     int,   # Seitennummer
            "document": str,   # Dateiname (z. B. "mercure_city_reception_sop.pdf")
        }
    """
    from app.services.pdf_reader import read_pdf_text

    chunks: list[dict] = []
    pages = read_pdf_text(str(pdf_path))

    for page_info in pages:
        page_num  = page_info["page"]
        page_text = page_info["text"]
        if not page_text:
            continue
        for chunk_text in split_text_into_chunks(page_text):
            chunks.append({
                "text":     chunk_text,
                "page":     page_num,
                "document": pdf_path.name,
            })

    return chunks


# ── 3. Standort → PDF-Datei auflösen ─────────────────────────────────────────

def _resolve_pdf_path(location_name: str | None) -> Path | None:
    """
    Gibt den Pfad zur PDF zurück, die zum Standort des Mitarbeiters passt.
    Gibt None zurück, wenn kein Treffer gefunden wird.

    Beispiel:
        "Mercure Oldenburger Allee" → .../mercure_oldenburger_allee_reception_sop.pdf
    """
    if not location_name:
        return None

    name_lower = location_name.lower().strip()

    for key, filename in LOCATION_TO_PDF.items():
        if key in name_lower:
            path = KNOWLEDGE_DIR / filename
            if path.exists():
                return path
    return None


# ── 4. Keyword-Score berechnen ────────────────────────────────────────────────

def _score_chunk(chunk_text: str, keywords: list[str]) -> float:
    """
    Bewertet einen Chunk: zählt, wie oft die Suchbegriffe vorkommen.
    Je öfter → desto relevanter.
    """
    text_lower = chunk_text.lower()
    score = 0.0
    for kw in keywords:
        score += text_lower.count(kw)
    return score


# ── 5. Hauptfunktion: Suche ───────────────────────────────────────────────────

def search_chunks(
    question: str,
    employee_location_name: str | None,
    top_n: int = 3,
) -> list[dict]:
    """
    Findet die relevantesten Textabschnitte aus dem passenden Hotel-PDF.

    Ablauf:
    1. Standortname → PDF auflösen
    2. Wenn kein Standort → alle PDFs durchsuchen (Fallback)
    3. Frage in Schlüsselwörter aufteilen
    4. Chunks nach Keyword-Treffer bewerten und sortieren
    5. Top-N Treffer zurückgeben

    Rückgabe: Liste von Chunks mit Feldern:
        text, page, document, score
    """
    # Welche PDF(s) durchsuchen?
    pdf_path = _resolve_pdf_path(employee_location_name)

    if pdf_path:
        pdf_paths = [pdf_path]
    else:
        # Kein Standort zugewiesen → alle vorhandenen PDFs durchsuchen
        pdf_paths = [
            KNOWLEDGE_DIR / filename
            for filename in LOCATION_TO_PDF.values()
            if (KNOWLEDGE_DIR / filename).exists()
        ]

    if not pdf_paths:
        return []

    # Frage in Schlüsselwörter aufteilen (Stoppwörter entfernen)
    words = question.lower().split()
    keywords = [
        word.strip("?!.,;:")
        for word in words
        if word.strip("?!.,;:") not in _STOP_WORDS and len(word.strip("?!.,;:")) > 2
    ]

    if not keywords:
        return []

    # Alle Chunks laden + bewerten
    scored: list[dict] = []
    for path in pdf_paths:
        try:
            chunks = _load_pdf_chunks(path)
        except Exception:
            continue  # PDF nicht lesbar → überspringen

        for chunk in chunks:
            score = _score_chunk(chunk["text"], keywords)
            if score > 0:
                scored.append({**chunk, "score": score})

    if not scored:
        return []

    # Nach Score absteigend sortieren
    scored.sort(key=lambda x: x["score"], reverse=True)

    # Doppelte Chunks herausfiltern (gleicher Textanfang)
    seen: set[str] = set()
    results: list[dict] = []
    for item in scored:
        fingerprint = item["text"][:80]
        if fingerprint not in seen:
            seen.add(fingerprint)
            results.append(item)
        if len(results) >= top_n:
            break

    return results


# ── 6. Rohe Antwort aus Chunks (Fallback ohne LLM) ───────────────────────────

_NO_INFO = (
    "Ich habe dazu keine passende Information in den hinterlegten "
    "Reception-Dokumenten gefunden. Bitte frage deinen Manager."
)

# Mindest-Score damit ein Chunk als "relevant" gilt
_MIN_SCORE = 1.0


def format_answer(chunks: list[dict]) -> str:
    """
    Fallback: Formatiert die Chunks direkt als lesbare Antwort (ohne LLM).
    Wird verwendet wenn kein OpenRouter-Key konfiguriert ist.
    """
    if not chunks:
        return _NO_INFO

    parts: list[str] = []
    for i, chunk in enumerate(chunks, start=1):
        text = chunk["text"][:600].strip()
        if len(chunk["text"]) > 600:
            text = text.rsplit(" ", 1)[0] + " …"
        parts.append(f"**{i}.** {text}")

    return "\n\n".join(parts)


# ── 7. Kontext aus Chunks bauen ───────────────────────────────────────────────

def build_context(chunks: list[dict]) -> str:
    """
    Baut den Kontext-String, der an das LLM übergeben wird.

    Jeder Chunk wird mit Quelle (Dateiname + Seite) beschriftet,
    damit das LLM die Quellenangabe in die Antwort aufnehmen kann.

    Beispiel:
        [Quelle 1: mercure_city_reception_sop.pdf, Seite 2]
        ... Text des Chunks ...

        ---

        [Quelle 2: mercure_city_reception_sop.pdf, Seite 3]
        ... Text des Chunks ...
    """
    parts = []
    for i, chunk in enumerate(chunks, start=1):
        label = f"[Quelle {i}: {chunk['document']}, Seite {chunk['page']}]"
        parts.append(f"{label}\n{chunk['text']}")
    return "\n\n---\n\n".join(parts)


# ── 8. Haupt-Einstiegspunkt: Frage beantworten ───────────────────────────────

def ask_reception_question(
    question: str,
    employee_location_name: str | None,
) -> tuple[str, list[dict]]:
    """
    Vollständige RAG-Pipeline:
    1. Passende PDF-Chunks per Keyword-Suche finden
    2. Kontext aus den Chunks bauen
    3. Antwort über OpenRouter (LLM) generieren
       → Fallback: rohen Chunk-Text zurückgeben

    Rückgabe:
        (answer_text, chunks)
        chunks enthält die verwendeten Quellen (document, page, score)
    """
    # ── Schritt 1: Relevante Chunks suchen ───────────────────────────────────
    chunks = search_chunks(
        question=question,
        employee_location_name=employee_location_name,
        top_n=4,
    )

    # Logging: welche Dokumente wurden gefunden?
    if chunks:
        logger.info(
            "[RAG] %d Chunks gefunden | Standort: %s | Beste Score: %.1f",
            len(chunks),
            employee_location_name or "kein Standort",
            chunks[0]["score"],
        )
        for i, c in enumerate(chunks, start=1):
            logger.info(
                "[RAG] Chunk %d → %s (Seite %d, Score %.1f): %.60s …",
                i, c["document"], c["page"], c["score"], c["text"],
            )
    else:
        logger.info(
            "[RAG] Keine Chunks gefunden | Standort: %s | Frage: %.80s",
            employee_location_name or "kein Standort",
            question,
        )

    # ── Schritt 2: Keine relevanten Chunks → direkte Antwort ─────────────────
    if not chunks or chunks[0]["score"] < _MIN_SCORE:
        return _NO_INFO, []

    # ── Schritt 3: Kontext bauen + LLM aufrufen ──────────────────────────────
    from app.services.openrouter_client import ask_openrouter, is_configured

    context = build_context(chunks)

    if is_configured():
        logger.info("[RAG] Sende Kontext an OpenRouter.")
        llm_answer = ask_openrouter(question=question, context=context)

        # Wenn LLM eine leere Antwort zurückgibt → Fallback
        if llm_answer:
            return llm_answer, chunks

    # ── Fallback: Kein Key oder LLM-Fehler → rohen Text zurückgeben ──────────
    logger.info("[RAG] Fallback: Roher Chunk-Text wird verwendet.")
    return format_answer(chunks), chunks
