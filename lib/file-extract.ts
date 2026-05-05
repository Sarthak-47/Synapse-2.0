"use client"

/**
 * file-extract.ts — Study material text extraction and chunking
 *
 * Extracts raw text from uploaded files and splits it into note-sized chunks
 * that can be added to the Synapse canvas.
 *
 * Supported formats:
 *   .pdf        — Mozilla PDF.js (pdfjs-dist), CDN worker, fully in-browser
 *   .pptx       — JSZip (PPTX is a ZIP of XML slides), extracts <a:t> nodes
 *   .docx       — Mammoth.js, runs entirely in the browser
 *   .txt        — native FileReader, no library needed
 *   .jpg/.jpeg  — OpenRouter vision API (GPT-4o), returns transcribed text
 *   .png        — same vision API path
 *   .webp       — same vision API path
 *
 * Chunking strategy (tuned for academic material):
 *   1. Normalise line endings; collapse excess blank lines.
 *   2. Split at paragraph breaks (2+ newlines).
 *   3. Drop chunks under MIN_CHUNK_LEN — usually headers, page numbers,
 *      figure captions, or slide navigation artifacts.
 *   4. Chunks over MAX_CHUNK_LEN are split at sentence boundaries so each
 *      note fits comfortably inside a tile card.
 */

import { loadAIConfig } from "@/lib/ai-settings"
import { getAIProviderParams } from "@/lib/ai-client"
import { compressDocument } from "@/lib/ai-compress"

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_CHUNK_LEN = 60
const MAX_CHUNK_LEN = 420

// ── Text chunking ─────────────────────────────────────────────────────────────

/**
 * Splits a large block of text into note-sized chunks.
 * Used by every extractor after raw text has been obtained.
 */
export function chunkText(text: string): string[] {
  const normalised = text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")

  const paragraphs = normalised.split(/\n\s*\n/)
  const chunks: string[] = []

  for (const para of paragraphs) {
    const cleaned = para.replace(/[ \t]+/g, " ").trim()
    if (cleaned.length < MIN_CHUNK_LEN) continue

    if (cleaned.length <= MAX_CHUNK_LEN) {
      chunks.push(cleaned)
    } else {
      // Split at sentence boundaries: ". " / "! " / "? " followed by uppercase
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

// ── PDF extraction ────────────────────────────────────────────────────────────

/**
 * Extracts all text from a PDF using Mozilla PDF.js.
 * Dynamically imported so it is never in the initial bundle.
 * Worker is loaded from unpkg CDN at the exact installed version.
 */
async function extractFromPDF(file: File): Promise<string> {
  const pdfjsLib = await import("pdfjs-dist")
  pdfjsLib.GlobalWorkerOptions.workerSrc =
    `https://unpkg.com/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`

  const arrayBuffer = await file.arrayBuffer()
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise

  const pageTexts: string[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page    = await pdf.getPage(i)
    const content = await page.getTextContent()
    const pageText = content.items
      .map((item: any) => ("str" in item ? item.str : ""))
      .join(" ")
    pageTexts.push(pageText)
  }

  return pageTexts.join("\n\n")
}

// ── PPTX extraction ───────────────────────────────────────────────────────────

/**
 * Extracts text from a PowerPoint (.pptx) file using JSZip.
 *
 * PPTX files are ZIP archives containing XML slide files at:
 *   ppt/slides/slide1.xml, slide2.xml, …
 *
 * Each slide's text lives in <a:t> (DrawingML text) elements. We extract
 * all of them in order, join per-slide text with spaces, and join slides
 * with double newlines so the chunker sees paragraph-level breaks.
 */
async function extractFromPPTX(file: File): Promise<string> {
  const JSZip       = (await import("jszip")).default
  const arrayBuffer = await file.arrayBuffer()
  const zip         = await JSZip.loadAsync(arrayBuffer)

  // Collect slide files in numeric order (slide1, slide2, …)
  const slideFiles = Object.keys(zip.files)
    .filter(name => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => {
      const numA = parseInt(a.match(/\d+/)![0])
      const numB = parseInt(b.match(/\d+/)![0])
      return numA - numB
    })

  if (slideFiles.length === 0) {
    throw new Error("No slides found in this PPTX file.")
  }

  const slideTexts: string[] = []
  for (const slideName of slideFiles) {
    const xml = await zip.files[slideName].async("text")
    // <a:t> tags hold the visible text in DrawingML (Office Open XML)
    const matches = [...xml.matchAll(/<a:t[^>]*>([\s\S]*?)<\/a:t>/g)]
    const text    = matches
      .map(m => m[1].replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim())
      .filter(t => t.length > 0)
      .join(" ")
    if (text.length > 0) slideTexts.push(text)
  }

  return slideTexts.join("\n\n")
}

// ── DOCX extraction ───────────────────────────────────────────────────────────

/**
 * Extracts plain text from a .docx file using Mammoth.js.
 * extractRawText() discards all formatting and returns clean paragraphs.
 */
async function extractFromDOCX(file: File): Promise<string> {
  const mammoth     = await import("mammoth")
  const arrayBuffer = await file.arrayBuffer()
  const result      = await mammoth.extractRawText({ arrayBuffer })
  return result.value
}

// ── TXT extraction ────────────────────────────────────────────────────────────

function extractFromTXT(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader   = new FileReader()
    reader.onload  = e => resolve(e.target?.result as string ?? "")
    reader.onerror = () => reject(new Error("Could not read text file."))
    reader.readAsText(file)
  })
}

// ── Image OCR via vision API ──────────────────────────────────────────────────

/**
 * Safely encodes an ArrayBuffer to base64 without hitting the JS call-stack
 * limit that `btoa(String.fromCharCode(...bytes))` hits on large images.
 */
function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes     = new Uint8Array(buffer)
  const chunkSize = 8192
  let binary      = ""
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize))
  }
  return btoa(binary)
}

/**
 * Extracts text from an image using OpenRouter's vision API (GPT-4o).
 *
 * Why vision API instead of Tesseract.js:
 *   - Handles handwritten notes, diagrams, tables, screenshots, slides
 *   - No 10 MB Tesseract worker download
 *   - Reuses the API key the user already has configured
 *
 * The model is instructed to transcribe all visible text verbatim without
 * commentary so the output goes cleanly into the chunker.
 */
async function extractFromImage(file: File): Promise<string> {
  const config = loadAIConfig()
  if (!config) {
    throw new Error(
      "No API key configured. Add your OpenRouter key in Settings first."
    )
  }

  const arrayBuffer = await file.arrayBuffer()
  const base64      = arrayBufferToBase64(arrayBuffer)
  const mimeType    = file.type || "image/jpeg"

  const params = getAIProviderParams(config)

  const response = await fetch(params.url, {
    method: "POST",
    headers: params.headers,
    body: JSON.stringify({
      // GPT-4o has reliable vision; if Google API is selected, we must use the active Gemini model
      model: config.provider === "google" ? config.modelId : "openai/gpt-4o",
      messages: [{
        role: "user",
        content: [
          {
            type: "image_url",
            image_url: { url: `data:${mimeType};base64,${base64}` },
          },
          {
            type: "text",
            text:
              "Extract every piece of text visible in this image exactly as it appears. " +
              "If it is a slide or diagram, transcribe all labels, headings, and bullet points. " +
              "If it is handwritten, do your best to transcribe accurately. " +
              "Return only the extracted text — no commentary, no markdown fences.",
          },
        ],
      }],
      max_tokens: 1000,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Vision API error ${response.status}: ${err}`)
  }

  const data = await response.json()
  const text = data.choices?.[0]?.message?.content ?? ""
  if (!text.trim()) throw new Error("No text could be extracted from this image.")
  return text
}

// ── Public API ────────────────────────────────────────────────────────────────

/** All file extensions the import panel accepts. */
export const ACCEPTED_TYPES = ".pdf,.pptx,.docx,.txt,.jpg,.jpeg,.png,.webp"

/** Returns true if the file is an image (uses vision API rather than local extraction). */
export function isImageFile(file: File): boolean {
  const name = file.name.toLowerCase()
  return [".jpg", ".jpeg", ".png", ".webp"].some(ext => name.endsWith(ext))
}

/**
 * Extracts text from any supported file and returns note-sized chunks.
 *
 * Images go through the vision API and skip the chunker if the result is
 * short enough to be a single note. All other formats run locally.
 *
 * @param file - File from a picker or drag-drop event
 * @param useAI - Whether to use AI Lossless Compression (defaults to true)
 * @returns array of text chunks ready to become canvas notes
 */
export async function extractAndChunk(file: File, useAI: boolean = true): Promise<string[]> {
  const name = file.name.toLowerCase()
  let raw: string

  if (name.endsWith(".pdf")) {
    raw = await extractFromPDF(file)
  } else if (name.endsWith(".pptx")) {
    raw = await extractFromPPTX(file)
  } else if (name.endsWith(".docx")) {
    raw = await extractFromDOCX(file)
  } else if (name.endsWith(".txt")) {
    raw = await extractFromTXT(file)
  } else if (isImageFile(file)) {
    raw = await extractFromImage(file)
  } else {
    throw new Error(
      "Unsupported file type. Please upload a PDF, PPTX, DOCX, TXT, or image file."
    )
  }

  // If useAI is true and the user didn't upload an image (which already uses Vision API),
  // we pass the raw text through the lossless compression pipeline.
  let chunks: string[]
  if (useAI && !isImageFile(file)) {
    chunks = await compressDocument(raw)
  } else {
    // Fallback to dumb local chunking (or image parsing, which comes pre-condensed)
    chunks = chunkText(raw)
  }

  if (chunks.length === 0) {
    // If chunker filtered everything (e.g. very short image text), keep raw as one note
    const fallback = raw.trim()
    if (fallback.length > 0) return [fallback]
    throw new Error(
      "No readable text found. For PDFs, make sure the file is not a scanned image."
    )
  }

  return chunks
}
