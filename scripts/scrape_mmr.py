"""
scrape_mmr.py — Download and extract the NYC Mayor's Management Report

Module 07: Document Scraping

This script:
1. Downloads the MMR PDF from the official NYC source (with caching)
2. Extracts text as markdown using pymupdf4llm
3. Saves extracted markdown to disk
4. Writes metadata to the raw_documents table in Postgres

Usage:
    python scrape_mmr.py

Requirements:
    pip install pymupdf4llm requests psycopg2-binary python-dotenv

Environment variables (.env):
    NEON_DATABASE_URL=postgresql://user:pass@host/dbname
"""

import os
import json
from pathlib import Path
from datetime import date, datetime

import requests
import psycopg2
import pymupdf4llm
from dotenv import load_dotenv

load_dotenv()

# ─── Configuration ────────────────────────────────────────────────────────────

MMR_URL = "https://www.nyc.gov/assets/operations/downloads/pdf/pmmr2026/2026_pmmr.pdf"
MMR_TITLE = "NYC Preliminary Mayor's Management Report FY2026"
MMR_DOC_DATE = date(2026, 3, 1)  # PMMR is published in March

# Local paths for cached artifacts
DATA_DIR = Path("data/raw")
PDF_DIR = DATA_DIR / "pdfs"
TEXT_DIR = DATA_DIR / "text"
PDF_PATH = PDF_DIR / "pmmr_2026.pdf"
TEXT_PATH = TEXT_DIR / "pmmr_2026.md"

# NYC.gov (Akamai) returns 403 without a browser-like User-Agent.
REQUEST_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    ),
}


# ─── Download ─────────────────────────────────────────────────────────────────

def download_with_caching(url: str, dest_path: Path) -> Path:
    """
    Download a file to dest_path, but skip if it already exists.

    This is the core responsible-scraping pattern: check before fetching.
    Running this script twice should never hit the server a second time.

    TODO: Implement the download logic
    - If dest_path.exists(), print a cache hit message and return early
    - Otherwise, use requests.get() with stream=True and a timeout
    - Call response.raise_for_status() to catch HTTP errors loudly
    - Write the file in 8192-byte chunks using response.iter_content()
    - Create parent directories if they don't exist (dest_path.parent.mkdir)
    - Print the file size in MB after saving
    """
    if dest_path.exists():
        print(f"Cache hit: {dest_path}")
        return dest_path
    with requests.get(url, stream=True, timeout=60, headers=REQUEST_HEADERS) as response:
        response.raise_for_status()
        dest_path.parent.mkdir(parents=True, exist_ok=True)
        with open(dest_path, "wb") as f:
            for chunk in response.iter_content(chunk_size=8192):
                f.write(chunk)
    print(f"Downloaded {dest_path.name} ({dest_path.stat().st_size / 1024 / 1024:.2f} MB)")
    return dest_path


# ─── Extraction ───────────────────────────────────────────────────────────────

def extract_to_markdown(pdf_path: Path, text_path: Path) -> list[dict]:
    """
    Extract PDF text to markdown using pymupdf4llm.

    Returns the list of page dicts (from page_chunks=True) so the caller
    has per-page metadata available. Also writes the full markdown to text_path.

    TODO: Implement the extraction logic
    - Call pymupdf4llm.to_markdown() with page_chunks=True, write_images=False
    - Join all page texts into a single markdown string
    - Create text_path.parent if it doesn't exist
    - Write the joined markdown to text_path
    - Print the page count and output file size
    - Return the list of page dicts

    Note: This takes 15-30 seconds on the full MMR. During development,
    add pages=list(range(10)) to limit to 10 pages for faster iteration.
    Remove before committing.
    """
    pages = pymupdf4llm.to_markdown(
        str(pdf_path),
        page_chunks=True,
        write_images=False,
    )
    markdown = "\n\n".join(page["text"] for page in pages)
    text_path.parent.mkdir(parents=True, exist_ok=True)
    text_path.write_text(markdown, encoding="utf-8")
    size_mb = text_path.stat().st_size / 1024 / 1024
    print(f"Extracted {len(pages)} pages ({size_mb:.2f} MB) → {text_path}")
    return pages


# ─── Postgres Storage ─────────────────────────────────────────────────────────

def store_metadata(
    conn,
    url: str,
    title: str,
    doc_type: str,
    doc_date: date,
    file_path: Path,
    text_path: Path,
    page_count: int,
    metadata: dict,
) -> int:
    """
    Insert a row into raw_documents. Returns the new row's id.

    Use ON CONFLICT (url) DO NOTHING for idempotency — running the script
    twice should not create duplicate rows.

    TODO: Implement the insert
    - Use the url column as the conflict target (it has a UNIQUE constraint)
    - file_path and text_path should be absolute paths (use .resolve())
    - metadata should be a JSON object with the following keys:
      - url: the source URL
      - title: the document title
      - doc_type: the document type
      - doc_date: the document date
      - file_path: the absolute path to the cached PDF
      - text_path: the absolute path to the extracted markdown
      - page_count: the number of pages extracted
      - extracted_at: the timestamp of the extraction
      - metadata: the document metadata
    - After insert, fetch and return the id (use RETURNING id, or query by url)
    - Print confirmation with the row id
    """
    abs_pdf = str(file_path.resolve())
    abs_text = str(text_path.resolve())
    extracted_at = datetime.now()
    metadata_payload: dict = {}

    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO nl2sql.raw_documents
                (url, title, doc_type, doc_date, file_path, raw_text_path, page_count, extracted_at, metadata)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
            ON CONFLICT (url) DO NOTHING
            RETURNING id
            """,
            (
                url,
                title,
                doc_type,
                doc_date,
                abs_pdf,
                abs_text,
                page_count,
                extracted_at,
                json.dumps(metadata_payload),
            ),
        )
        row = cur.fetchone()
        if row is None:
            cur.execute(
                "SELECT id FROM nl2sql.raw_documents WHERE url = %s",
                (url,),
            )
            row = cur.fetchone()
        if row is None:
            raise RuntimeError(f"Failed to insert or fetch raw_documents row for {url}")
        row_id = row[0]
    conn.commit()
    print(f"Stored raw_documents row id: {row_id}")
    return row_id


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    database_url = os.environ.get("NEON_DATABASE_URL")
    if not database_url:
        raise EnvironmentError("DATABASE_URL not set — check your .env file")

    # Step 1: Download (cached)
    print("=== Step 1: Download ===")
    download_with_caching(MMR_URL, PDF_PATH)

    # Step 2: Extract
    print("\n=== Step 2: Extract ===")
    pages = extract_to_markdown(PDF_PATH, TEXT_PATH)

    # Step 3: Store metadata
    print("\n=== Step 3: Store metadata ===")
    conn = psycopg2.connect(database_url)
    try:
        row_id = store_metadata(
            conn=conn,
            url=MMR_URL,
            title=MMR_TITLE,
            doc_type="mmr",
            doc_date=MMR_DOC_DATE,
            file_path=PDF_PATH,
            text_path=TEXT_PATH,
            page_count=len(pages),
            metadata={},
        )
        print(f"raw_documents row id: {row_id}")
    finally:
        conn.close()

    print("\n=== Done ===")
    print(f"PDF:      {PDF_PATH}")
    print(f"Markdown: {TEXT_PATH}")
    print(f"Postgres: raw_documents id={row_id}")
    print("\nReady for Module 08: Chunking + Embedding Pipeline")


if __name__ == "__main__":
    main()
