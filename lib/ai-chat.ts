"use client"

/**
 * ai-chat.ts — "Ask Your Canvas" RAG engine
 *
 * Implements retrieval-augmented generation (RAG) over the user's canvas notes.
 * Instead of querying a vector database, the entire note set is passed directly
 * as context to the LLM (the canvas is typically small enough for this to work
 * well without embedding-based retrieval).
 *
 * Flow:
 *   1. buildContext() serialises all blocks into a numbered list
 *   2. askCanvas() wraps that context in a system prompt and streams the response
 *   3. parseCitedIndices() extracts [N] citation markers from the AI's reply
 *   4. The UI maps those indices back to block IDs for highlighting
 */

import { loadAIConfig } from "@/lib/ai-settings"
import { getAIProviderParams } from "@/lib/ai-client"
import type { TextBlock } from "@/components/tile-card"
import { CONTENT_TYPE_CONFIG } from "@/lib/content-types"

// ── System prompt ─────────────────────────────────────────────────────────────
// Instructs the model to stay grounded in the provided notes and to cite them
// using [N] notation so the UI can highlight the relevant cards.

const SYSTEM_PROMPT = `You are a research assistant embedded in a spatial thinking tool called Synapse.
The user has assembled a canvas of notes. Each note has a number, a content type, an AI-assigned category, and the note text.

Answer the user's question by reasoning directly from these notes.

Rules:
- Cite notes inline using their number in square brackets, e.g. [1], [3].
- Keep your answer concise: 2-4 sentences unless the question genuinely requires more depth.
- Use only information present in the notes. If the notes lack enough information to answer, say so clearly and briefly.
- Use markdown: **bold** for key terms. Avoid bullet lists unless the question explicitly calls for a list.
- Answer in the same language as the question.
- Never invent facts not present in the notes.`

// ── Context builder ───────────────────────────────────────────────────────────

/**
 * Serialises all canvas blocks into a numbered reference list.
 * Format: "[N] TypeLabel [Category]: text..."
 *
 * Each note is truncated at 300 chars to keep the prompt within token limits
 * while preserving enough content for the model to reason from. The index
 * is 1-based so citations read naturally as [1], [2] etc.
 */
function buildContext(blocks: TextBlock[]): string {
  if (blocks.length === 0) return "(No notes on the canvas yet.)"
  return blocks
    .map((b, i) => {
      const typeLabel = CONTENT_TYPE_CONFIG[b.contentType]?.label ?? b.contentType
      const category  = b.category ? ` [${b.category}]` : ""
      return `[${i + 1}] ${typeLabel}${category}: ${b.text.slice(0, 300)}${b.text.length > 300 ? "..." : ""}`
    })
    .join("\n")
}

// ── Citation parser ───────────────────────────────────────────────────────────

/**
 * Extracts 0-based block indices from the AI response.
 *
 * The model cites notes as [1], [2], [3] (1-based). This function finds all
 * such markers using a global regex, converts them to 0-based indices, and
 * deduplicates via a Set. The calling component maps these indices to block
 * IDs for the highlight-on-click citation pills.
 */
export function parseCitedIndices(text: string): number[] {
  const matches = text.matchAll(/\[(\d+)\]/g)
  const indices = new Set<number>()
  for (const m of matches) {
    const n = parseInt(m[1], 10)
    if (n >= 1) indices.add(n - 1) // convert 1-based citation to 0-based index
  }
  return Array.from(indices)
}

// ── Streaming RAG function ────────────────────────────────────────────────────

/**
 * Streams an AI answer grounded in the user's canvas notes.
 *
 * Uses an async generator so the caller can `for await` over text chunks
 * and update the UI incrementally — each yielded string is a delta from the
 * OpenRouter SSE stream. The AbortSignal lets the user stop mid-stream.
 *
 * The context is re-built on every call so new or edited notes are always
 * included without any caching concerns.
 *
 * @param question - the user's natural-language question
 * @param blocks   - current canvas notes (all of them)
 * @param signal   - optional AbortSignal to cancel the stream
 */
export async function* askCanvas(
  question: string,
  blocks: TextBlock[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const config = loadAIConfig()
  if (!config) throw new Error("No API key configured. Open Settings and add your OpenRouter key.")

  const context = buildContext(blocks)

  // Combine context and question in the user message so the system prompt
  // stays clean and cacheable across multiple turns in the same session.
  const userMessage = `## Canvas notes\n\n${context}\n\n## Question\n\n${question}`

  const params = getAIProviderParams(config)

  const response = await fetch(params.url, {
    method: "POST",
    headers: params.headers,
    body: JSON.stringify({
      model: config.modelId,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userMessage },
      ],
      stream: true,       // enables server-sent events (SSE) response
      temperature: 0.3,   // low temperature for factual, grounded answers
      max_tokens: 2000,
    }),
    signal,
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`AI API error ${response.status}: ${err}`)
  }

  // Read the SSE stream line by line. Each line is either:
  //   "data: {...}" — a JSON chunk with a delta
  //   "data: [DONE]" — signals the end of the stream
  //   ""            — keep-alive blank line, skip it
  const reader  = response.body!.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // decode() with stream:true handles multi-byte characters split across chunks
      const chunk = decoder.decode(value, { stream: true })
      const lines = chunk.split("\n")

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const data = line.slice(6).trim()
        if (data === "[DONE]") return

        try {
          const json  = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) yield delta  // yield each text chunk to the caller
        } catch {
          // malformed SSE line — skip and continue reading
        }
      }
    }
  } finally {
    // Always release the reader lock so the connection can be cleaned up,
    // even if the generator is aborted mid-stream.
    reader.releaseLock()
  }
}
