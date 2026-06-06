"""
scrape_cb_minutes.py — Episode 9: Community Board Minutes Scraper

Extends the ingestion pipeline to handle NYC Community Board minutes.
Supports HTML pages and PDF links; normalizes to the unified document schema.

Usage:
    python scrape_cb_minutes.py

Prerequisites:
    pip install beautifulsoup4 requests pymupdf4llm psycopg2-binary

Environment variables:
    DATABASE_URL — Neon Postgres connection string
"""

import hashlib
import json
import os
import re
import tempfile
import time
from datetime import datetime, timezone
from urllib.parse import urljoin, urlparse

import psycopg2
import requests
from bs4 import BeautifulSoup
from dotenv import load_dotenv

load_dotenv()

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BOARD_URLS = {
    "CB1 Manhattan": "https://manhattancb1.cityofnewyork.us/meetings/full-board-meeting-and-agenda/full-board-meeting-minutes/",
    # CB4 Brooklyn is in Airtable — requires API key or manual export for now
    # "CB4 Brooklyn": "https://airtable.com/appqbqZrn4avTJC9M/shrOQqdMutwMd3Vja/tbl78IQkeFXTRGHs1/viw6xeCeCgloRVvSJ/recl5xEiZEaf2pcvS/fldd8QaVUNZl9F6ER/attump0pBORoq4O61",
    "CB14 Brooklyn": "https://cb14brooklyn.com/june-2026-meetings/",
}

REQUEST_HEADERS = {"User-Agent": "NYC-Corpus-Builder/1.0 (research use)"}
REQUEST_DELAY_SECONDS = 1.0   # be a good citizen; don't hammer the city servers
MAX_MINUTES_PER_BOARD = 10    # cap so the first run doesn't take forever

# ---------------------------------------------------------------------------
# Step 1: URL Discovery
# ---------------------------------------------------------------------------

def discover_minutes_urls(board_index_url: str, max_pages: int = MAX_MINUTES_PER_BOARD) -> list[str]:
    """
    Fetch the community board's index page and return URLs that look like
    meeting minutes pages or PDF links.

    TODO: Implement this function.
    - Fetch board_index_url with a rate-limiting delay
    - Parse the HTML with BeautifulSoup
    - Find all <a> tags whose link text or href suggests meeting minutes
      (keywords: "minutes", "board meeting"; or href ending in ".pdf")
    - Return a deduplicated list of absolute URLs, capped at max_pages

    Hint: Use urljoin(board_index_url, href) to build absolute URLs from
    relative ones. City government pages often use relative paths.
    """
    time.sleep(REQUEST_DELAY_SECONDS)
    try:
        response = requests.get(board_index_url, headers=REQUEST_HEADERS, timeout=15)
        response.raise_for_status()
    except Exception as e:
        print(f"    Error fetching {board_index_url}: {e}")
        return []

    soup = BeautifulSoup(response.text, "html.parser")
    urls = []

    for link in soup.find_all("a", href=True):
        href = link["href"]
        text = link.get_text(strip=True).lower()

        # More permissive: look for PDF links or any link with common keywords
        is_minutes_link = any(kw in text for kw in ["minutes", "board meeting", "meeting", "agendas"])
        is_pdf_link = href.lower().endswith(".pdf")

        if is_minutes_link or is_pdf_link:
            full_url = urljoin(board_index_url, href)
            urls.append(full_url)

    return list(dict.fromkeys(urls))[:max_pages]


# ---------------------------------------------------------------------------
# Step 2: HTML Text Extraction
# ---------------------------------------------------------------------------

def extract_html_minutes(url: str) -> str:
    """
    Fetch an HTML minutes page and return the main text content.

    TODO: Implement this function.
    - Fetch the URL with a User-Agent header and timeout
    - Parse with BeautifulSoup
    - Try multiple CSS selectors in priority order to find the content container
      (inspect the real pages to know which selectors to try)
    - Extract text with get_text(separator="\\n\\n", strip=True)
    - Return empty string if nothing useful is found

    The goal: extract the meeting minutes text, not the navigation/footer noise.
    """
    time.sleep(REQUEST_DELAY_SECONDS)
    response = requests.get(url, headers=REQUEST_HEADERS, timeout=15)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    for selector in [
        {"class": "entry-content"},
        {"class": "field-item"},
        {"id": "content"},
        "main",
        "article",
    ]:
        if isinstance(selector, dict):
            container = soup.find("div", selector)
        else:
            container = soup.find(selector)

        if container:
            text = container.get_text(separator="\n\n", strip=True)
            if len(text) > 200:
                return text

    return soup.get_text(separator="\n\n", strip=True)


# ---------------------------------------------------------------------------
# Step 3: PDF Fallback Extraction
# ---------------------------------------------------------------------------

def extract_pdf_minutes(pdf_url: str) -> str:
    """
    Download a PDF from pdf_url and extract text using pymupdf4llm.

    TODO: Implement this function.
    - Download the PDF bytes with requests
    - Write to a temp file
    - Call pymupdf4llm.to_markdown(tmp_path) to extract text
    - Clean up the temp file (use try/finally)
    - Return the extracted markdown string

    This is the same pattern from Episode 7 — you've done this before.
    """
    import pymupdf4llm

    time.sleep(REQUEST_DELAY_SECONDS)
    response = requests.get(pdf_url, headers=REQUEST_HEADERS, timeout=30)
    response.raise_for_status()

    with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as f:
        f.write(response.content)
        tmp_path = f.name

    try:
        markdown = pymupdf4llm.to_markdown(tmp_path)
        return markdown
    finally:
        os.unlink(tmp_path)


# ---------------------------------------------------------------------------
# Step 4: Normalization
# ---------------------------------------------------------------------------

def normalize_to_document_schema(
    raw_text: str,
    source_url: str,
    board_name: str,
    published_date: datetime | None,
) -> dict:
    """
    Normalize extracted text + metadata into the unified document schema.

    TODO: Implement this function.
    Returns a dict with these keys:
        content       (str)           — the raw extracted text
        source_type   (str)           — always 'community_board' for this scraper
        source_url    (str)           — the URL the content was fetched from
        title         (str)           — descriptive title (e.g., "CB4 Brooklyn Minutes - March 2024")
        published_date (datetime|None) — the meeting date, if known
        board_name    (str)           — e.g., "CB4 Brooklyn"

    For the title: if published_date is available, format as
    "{board_name} Minutes - {published_date.strftime('%B %Y')}"
    Otherwise fall back to "{board_name} Minutes".

    Hint: The published_date can often be parsed from the URL using a regex
    like r'(\\d{4})[-/](\\d{2})' to find year-month patterns. Try that before
    returning None.
    """
    if published_date is None:
        match = re.search(r'(\d{4})[-/](\d{2})', source_url)
        if match:
            try:
                year, month = int(match.group(1)), int(match.group(2))
                published_date = datetime(year, month, 1, tzinfo=timezone.utc)
            except ValueError:
                pass

    if published_date:
        title = f"{board_name} Minutes - {published_date.strftime('%B %Y')}"
    else:
        title = f"{board_name} Minutes"

    return {
        "content": raw_text,
        "source_type": "community_board",
        "source_url": source_url,
        "title": title,
        "published_date": published_date,
        "board_name": board_name,
    }


# ---------------------------------------------------------------------------
# Step 5: Recency Weight
# ---------------------------------------------------------------------------

def compute_recency_weight(published_date: datetime | None) -> float:
    """
    Compute a recency weight in [0, 1] based on days since publication.

    Formula: 1.0 / (1.0 + days_since_published / 365.0)
    - Returns 1.0 if published_date is None (don't penalize undated documents)
    - A document published today returns 1.0
    - A document published ~1 year ago returns ~0.5
    - A document published ~10 years ago returns ~0.09

    TODO: Implement this function.
    Hint: Use datetime.now(timezone.utc) for the current time.
    Make sure both datetimes are timezone-aware before subtracting.
    """
    if published_date is None:
        return 1.0

    now = datetime.now(timezone.utc)
    if published_date.tzinfo is None:
        published_date = published_date.replace(tzinfo=timezone.utc)

    days_since = max(0, (now - published_date).days)
    return 1.0 / (1.0 + days_since / 365.0)


# ---------------------------------------------------------------------------
# Step 6: Chunking + Embedding (reuse from Episode 8)
# ---------------------------------------------------------------------------

def chunk_text(text: str, chunk_size: int = 512, overlap: int = 50) -> list[str]:
    """
    Token-aware chunking using tiktoken (same as Episode 8).
    Splits into fixed-size chunks with overlap.
    """
    import tiktoken
    enc = tiktoken.get_encoding("cl100k_base")
    tokens = enc.encode(text)
    chunks = [enc.decode(tokens[i:i + chunk_size]) for i in range(0, len(tokens), chunk_size - overlap)]
    return chunks


def embed_texts(texts: list[str]) -> list[list[float]]:
    """
    Embed texts using OpenAI text-embedding-3-small (same as Episode 8).
    Batches requests for efficiency.
    """
    from openai import OpenAI
    client = OpenAI(api_key=os.environ.get("OPENAI_API_KEY"))
    all_embeddings = []
    batch_size = 100
    for i in range(0, len(texts), batch_size):
        batch = texts[i:i + batch_size]
        response = client.embeddings.create(input=batch, model="text-embedding-3-small")
        all_embeddings.extend([data.embedding for data in response.data])
    return all_embeddings


# ---------------------------------------------------------------------------
# Step 7: Ingestion
# ---------------------------------------------------------------------------

def compute_content_hash(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def ingest_document(conn, document: dict) -> int:
    """
    Chunk, embed, and insert a normalized document into the chunks table.
    Skips chunks that already exist (ON CONFLICT on content_hash).
    Returns the number of new chunks inserted.
    """
    chunks = chunk_text(document["content"])
    if not chunks:
        return 0

    embeddings = embed_texts(chunks)
    recency_weight = compute_recency_weight(document.get("published_date"))
    inserted = 0

    with conn.cursor() as cur:
        for chunk_text_content, embedding in zip(chunks, embeddings):
            content_hash = compute_content_hash(chunk_text_content)
            metadata = {
                "source_type": document["source_type"],
                "source_url": document["source_url"],
                "title": document["title"],
                "board_name": document.get("board_name"),
            }

            cur.execute("""
                INSERT INTO nl2sql.chunks (
                    content, content_hash, embedding,
                    source_type, board_name, recency_weight,
                    metadata, chunk_index
                ) VALUES (
                    %s, %s, %s::nl2sql.vector,
                    %s, %s, %s,
                    %s::jsonb, 0
                )
                ON CONFLICT (content_hash) DO NOTHING
            """, (
                chunk_text_content,
                content_hash,
                f"[{','.join(str(x) for x in embedding)}]",
                document["source_type"],
                document.get("board_name"),
                recency_weight,
                json.dumps(metadata),
            ))
            if cur.rowcount > 0:
                inserted += 1

    conn.commit()
    return inserted


# ---------------------------------------------------------------------------
# Step 8: Orchestration — scrape all boards
# ---------------------------------------------------------------------------

def scrape_board_minutes(board_name: str, board_index_url: str, conn) -> dict:
    """
    Discover and ingest minutes for a single community board.
    Returns a summary dict with counts.

    TODO: Wire together the functions above:
    1. Call discover_minutes_urls() to get the list of URLs
    2. For each URL:
       a. If it ends in '.pdf', call extract_pdf_minutes()
       b. Otherwise call extract_html_minutes()
    3. Skip if the extracted text is too short (< 100 chars) — likely a navigation page
    4. Call normalize_to_document_schema() on the extracted text
    5. Call ingest_document() to chunk, embed, and store
    6. Sleep REQUEST_DELAY_SECONDS between requests
    7. Return {"board": board_name, "urls_found": N, "chunks_inserted": M}
    """
    urls = discover_minutes_urls(board_index_url)
    total_chunks = 0

    for url in urls:
        try:
            if url.lower().endswith(".pdf"):
                text = extract_pdf_minutes(url)
            else:
                text = extract_html_minutes(url)

            if len(text) < 100:
                print(f"    Skipped {url} (too short)")
                continue

            doc = normalize_to_document_schema(text, url, board_name, None)
            chunks_inserted = ingest_document(conn, doc)
            total_chunks += chunks_inserted
            print(f"    {url}: {chunks_inserted} chunks")
        except Exception as e:
            print(f"    Error on {url}: {e}")

    return {
        "board": board_name,
        "urls_found": len(urls),
        "chunks_inserted": total_chunks,
    }


def main():
    database_url = os.environ.get("NEON_DATABASE_URL") or os.environ.get("DATABASE_URL")
    if not database_url:
        raise EnvironmentError("NEON_DATABASE_URL or DATABASE_URL environment variable not set")

    conn = psycopg2.connect(database_url)
    with conn.cursor() as cur:
        cur.execute("SET search_path TO nl2sql")
    conn.commit()

    print(f"Connected to database. Scraping {len(BOARD_URLS)} community boards...\n")

    total_chunks = 0
    for board_name, board_url in BOARD_URLS.items():
        print(f"Scraping {board_name}...")
        result = scrape_board_minutes(board_name, board_url, conn)
        print(f"  URLs found: {result['urls_found']}")
        print(f"  Chunks inserted: {result['chunks_inserted']}")
        total_chunks += result["chunks_inserted"]

    conn.close()
    print(f"\nDone. Total chunks inserted: {total_chunks}")


if __name__ == "__main__":
    main()
