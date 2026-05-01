"use client"

/**
 * file-extract.ts — PDF / DOCX / TXT text extraction and chunking
 *
 * Extracts raw text from uploaded study-material files, then splits it into
 * note-sized chunks that can be added to the Synapse canvas.
 *
 * Supported formats:
 *   .pdf  — Mozilla PDF.js (pdfjs-dist), loaded via CDN worker
 *   .docx — Mammoth.js, runs entirely in the browser
 *   .txt  — native FileReader, no extra library needed
 *
 * Chunking strategy (designed for academic material):
 *   1. Normalise line endings and whitespace.
 *   2. Split at paragraph breaks (2+ consecutive newlines).
 *   3. Drop chunks shorter than MIN_CHUNK_LEN — these are usually headers,
 *      page numbers, figure captions, or navigation artifacts.
 *   4. Chunks longer than MAX_CHUNK_LEN are split at the nearest sentence
 *      boundary so each note fits comfortably in a tile card.
 */

// ── Constants ──────────────────────────────────────────────────────────────────

/** Minimum characters a chunk must have to be kept (filters junk lines). */
const MIN_CHUNK_LEN = 60

/** Maximum characters per chunk before it is split at a sentence boundary. */
const MAX_CHUNK_LEN = 420

// ── Text chunking ─────────────────────────────────────────────────────────────

/**
 * Splits a large block of text into note-sized chunks.
 *
 * @param text - raw extracted text (may contain many newlines and whitespace)
 * @returns array of clean, trimmed chunks ready to become canvas notes
 */
export function chunkText(text: string): string[] {
  // Step 1: normalise line endings, collapse 3+ blank lines to 2
  const normalised = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")

  // Step 2: split at paragraph breaks
  const paragraphs = normalised.split(/\n\s*\n/)

  const chunks: string[] = []

  for (const para of paragraphs) {
    // Collapse internal whitespace and trim
    const cleaned = para.replace(/[ \t]+/g, " ").trim()
    if (cleaned.length < MIN_CHUNK_LEN) continue  // skip headers/captions/footers

    if (cleaned.length <= MAX_CHUNK_LEN) {
      // Short enough to be one chunk
      chunks.push(cleaned)
    } else {
      // Step 3: split long paragraphs at sentence boundaries
      // Regex: split after . ! ? followed by a space and uppercase letter
      const sentences = cleaned.split(/(?<=[.!?])\s+(?=[A-Z"'])/)
      let current = ""
      for (const sentence of sentences) {
        if (!current) {
          current = sentence
        } else if ((current + " " + sentence).length <= MAX_CHUNK_LEN) {
          current += " " + sentence
        } else {
          if (current.length >= MIN_CHUNK_LEN) chunks.push(current.trim())
          current = sentence
        }
      }
      if (current.trim().length >= MIN_CHUNK_LEN) chunks.push(current.trim())
    }
  }

  return chunks
}

// ── PDF extraction ─────────────────────────────────────────────────────────────

/**
 * Extracts all text from a PDF file using Mozilla PDF.js.
 *
 * PDF.js is dynamically imported so it is never bundled into the initial JS
 * payload. The worker is loaded from unpkg CDN at the exact installed version
 * to avoid version mismatch errors.
 *
 * Text items from each page are joined with a newline so paragraph structure
 * is preserved across the raw output.
 */
async function extractFromPDF(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist")

  // Point the worker at the CDN — must match the installed package version
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const pageTexts: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i)
    const content = await page.getTextContent()
    // Each item is either TextItem (has .str) or TextMarkedContent (no .str)
    const pageText = content.items
      .map((item: any) => ("str" in item ? item.str : ""))
      .join(" ")
    pageTexts.push(pageText)
  }

  return pageTexts.join("\n\n")
}

// ── DOCX extraction ────────────────────────────────────────────────────────────

/**
 * Extracts plain text from a .docx file using Mammoth.js.
 *
 * Mammoth's extractRawText() discards all formatting (bold, tables, lists)
 * and returns just the paragraph text, which is exactly what we want for notes.
 * It runs entirely in the browser — no server round-trip.
 */
async function extractFromDOCX(file: File): Promise<string> {
  const mammoth    = await import("mammoth")
  const arrayBuffer = await file.arrayBuffer()
  const result      = await mammoth.extractRawText({ arrayBuffer })
  return result.value
}

// ── TXT extraction ─────────────────────────────────────────────────────────────

/** Reads a plain text file using the built-in FileReader API. */
function extractFromTXT(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload  = e => resolve(e.target?.result as string ?? "")
    reader.onerror = () => reject(new Error("Could not read text file"))
    reader.readAsText(file)
  })
}

// ── Public API ────────────────────────────────────────────────────────────────

/** File types the import panel will accept. */
export const ACCEPTED_TYPES = ".pdf,.docx,.txt"

/**
 * Extracts text from a file and returns it as note-sized chunks.
 *
 * Dispatches to the correct extractor based on file extension, then runs the
 * shared chunkText() splitter on the raw output.
 *
 * @param file - a File object from a file picker or drag-drop event
 * @returns array of text chunks ready to be added as canvas notes
 * @throws if the file type is unsupported or extraction fails
 */
export async function extractAndChunk(file: File): Promise<string[]> {
  const name = file.name.toLowerCase()
  let raw: string

  if (name.endsWith(".pdf")) {
    raw = await extractFromPDF(file)
  } else if (name.endsWith(".docx")) {
    raw = await extractFromDOCX(file)
  } else if (name.endsWith(".txt")) {
    raw = await extractFromTXT(file)
  } else {
    throw new Error(
      `Unsupported file type. Please upload a .pdf, .docx, or .txt file.`
    )
  }

  const chunks = chunkText(raw)
  if (chunks.length === 0) {
    throw new Error(
      "No readable text found in this file. Make sure it is not a scanned image PDF."
    )
  }

  return chunks
}
