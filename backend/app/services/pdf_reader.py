"""PDF-Text-Extraktion: liest eine PDF-Datei Seite für Seite."""

from __future__ import annotations


def read_pdf_text(file_path: str) -> list[dict]:
    """
    Liest eine PDF-Datei und gibt den Text jeder Seite zurück.

    Rückgabe: Liste von Dicts mit:
        - page  (int)  : Seitennummer, beginnend bei 1
        - text  (str)  : extrahierter Text der Seite
    """
    from pypdf import PdfReader

    reader = PdfReader(file_path)
    pages = []
    for i, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        pages.append({"page": i, "text": text.strip()})
    return pages
