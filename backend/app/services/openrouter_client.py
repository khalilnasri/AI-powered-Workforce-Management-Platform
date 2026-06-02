"""
OpenRouter API Client.

Sendet eine Frage + PDF-Kontext an ein LLM über die OpenRouter API.
Die KI darf NUR auf Basis des übergebenen Kontexts antworten (kein Halluzinieren).

Konfiguration über .env:
    OPENROUTER_API_KEY   = sk-or-...          (Pflicht)
    OPENROUTER_MODEL     = openai/gpt-4o-mini (Standard)
    OPENROUTER_BASE_URL  = https://openrouter.ai/api/v1 (optional)
"""

from __future__ import annotations

import logging
import os

import requests

logger = logging.getLogger(__name__)

# ── Konfiguration aus Umgebungsvariablen ──────────────────────────────────────

_API_KEY  = os.getenv("OPENROUTER_API_KEY", "")
_MODEL    = os.getenv("OPENROUTER_MODEL", "openai/gpt-4o-mini")
_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")

# ── System-Prompt: strenge Anweisung gegen Halluzinieren ─────────────────────

_SYSTEM_PROMPT = """\
Du bist ein interner Hotel-Reception-Assistent für das Time-Stemple-System.

WICHTIGE REGELN:
1. Antworte AUSSCHLIESSLICH mit Informationen aus dem bereitgestellten Kontext.
2. Erfinde KEINE Informationen. Wenn die Antwort nicht im Kontext steht, sage klar:
   "Ich habe dazu keine passende Information in den hinterlegten Reception-Dokumenten gefunden. Bitte frage deinen Manager."
3. Antworte immer auf Deutsch.
4. Sei präzise und praxisnah.

ANTWORTFORMAT (immer einhalten):
**Erklärung:** Kurze Zusammenfassung in 1-2 Sätzen.

**Schritt-für-Schritt:**
1. Erster Schritt
2. Zweiter Schritt
(nur wenn eine Anleitung sinnvoll ist)

**Wichtiger Hinweis:** (nur wenn relevant)

**Quelle:** [Dateiname, Seite X]\
"""

# Fallback-Antwort wenn keine passende Info gefunden wurde
NO_INFO_ANSWER = (
    "Ich habe dazu keine passende Information in den hinterlegten "
    "Reception-Dokumenten gefunden. Bitte frage deinen Manager."
)


def is_configured() -> bool:
    """Gibt True zurück wenn ein API-Key vorhanden ist."""
    return bool(_API_KEY) and not _API_KEY.startswith("sk-or-hier")


def ask_openrouter(question: str, context: str) -> str:
    """
    Sendet die Frage + PDF-Kontext an OpenRouter und gibt die Antwort zurück.

    Parameter:
        question  : Die Frage des Mitarbeiters
        context   : Der relevante Text aus den PDFs (vorher per Keyword-Suche gefunden)

    Rückgabe:
        Die Antwort der KI als String.
        Bei Fehler: klare Fehlermeldung (kein Server-Crash).
    """
    if not is_configured():
        logger.warning("[OpenRouter] Kein API-Key konfiguriert. Fallback auf Raw-Text.")
        return ""  # Leerer String → Aufrufer nutzt format_answer() als Fallback

    # ── User-Nachricht: Kontext + Frage ──────────────────────────────────────
    user_message = (
        f"KONTEXT AUS DEN HOTEL-DOKUMENTEN:\n"
        f"{'─' * 60}\n"
        f"{context}\n"
        f"{'─' * 60}\n\n"
        f"FRAGE DES MITARBEITERS:\n{question}"
    )

    payload = {
        "model": _MODEL,
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {"role": "user",   "content": user_message},
        ],
        "temperature": 0.2,   # niedrig = präzise, wenig Kreativität
        "max_tokens":  800,   # begrenzen um Kosten zu kontrollieren
    }

    headers = {
        "Authorization": f"Bearer {_API_KEY}",
        "Content-Type":  "application/json",
        "HTTP-Referer":  "https://time-stemple.local",   # für OpenRouter-Logs
        "X-Title":       "Time Stemple Hotel Assistant",
    }

    logger.info("[OpenRouter] Sende Anfrage | Modell: %s | Frage: %.80s", _MODEL, question)

    try:
        response = requests.post(
            url=f"{_BASE_URL}/chat/completions",
            json=payload,
            headers=headers,
            timeout=30,  # 30 Sekunden max warten
        )
        response.raise_for_status()  # wirft Exception bei 4xx/5xx

        data = response.json()

        # Antwort extrahieren
        answer = (
            data.get("choices", [{}])[0]
            .get("message", {})
            .get("content", "")
            .strip()
        )

        if not answer:
            logger.warning("[OpenRouter] Leere Antwort erhalten.")
            return NO_INFO_ANSWER

        logger.info("[OpenRouter] Antwort erhalten (%d Zeichen).", len(answer))
        return answer

    except requests.exceptions.Timeout:
        logger.error("[OpenRouter] Timeout nach 30 Sekunden.")
        return "Die KI-Anfrage hat zu lange gedauert. Bitte versuche es erneut."

    except requests.exceptions.ConnectionError:
        logger.error("[OpenRouter] Verbindungsfehler zur OpenRouter API.")
        return "Keine Verbindung zur KI-API möglich. Bitte prüfe die Internetverbindung."

    except requests.exceptions.HTTPError as exc:
        status_code = exc.response.status_code if exc.response else "?"
        logger.error("[OpenRouter] HTTP-Fehler %s: %s", status_code, exc)
        if status_code == 401:
            return "Ungültiger API-Key. Bitte prüfe OPENROUTER_API_KEY in der .env-Datei."
        if status_code == 429:
            return "API-Limit erreicht. Bitte versuche es später erneut."
        return f"KI-Dienst nicht verfügbar (HTTP {status_code}). Bitte versuche es später."

    except Exception as exc:
        logger.error("[OpenRouter] Unerwarteter Fehler: %s", exc, exc_info=True)
        return "Unerwarteter Fehler beim KI-Aufruf. Bitte versuche es erneut."
