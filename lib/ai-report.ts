"use client"

/**
 * ai-report.ts — AI Research Report Generator
 *
 * Generates a structured prose research report from all canvas notes, streamed
 * live so the user sees the output appear word-by-word in the panel.
 *
 * Flow:
 *   1. buildReportContext() groups all blocks by their AI-assigned category
 *      (falling back to content-type label for unenriched notes), then
 *      serialises each group with type, confidence, and annotation snippets.
 *   2. generateReport() sends that context to OpenRouter with a system prompt
 *      that specifies the exact report structure (Executive Summary, per-topic
 *      sections, Open Questions, Key Insights, Conclusion).
 *   3. The SSE stream is yielded chunk-by-chunk so the caller can update the
 *      UI with each delta — same streaming pattern used in ai-chat.ts.
 */

import { loadAIConfig } from "@/lib/ai-settings"
import type { TextBlock } from "@/components/tile-card"
import { CONTENT_TYPE_CONFIG } from "@/lib/content-types"

// ── System prompt ─────────────────────────────────────────────────────────────
// The model is told to follow a fixed heading structure so the markdown output
// is predictable and can be rendered cleanly by the report panel.

const SYSTEM_PROMPT = `You are a research report writer embedded in a spatial thinking tool called Synapse.
The user has assembled a canvas of notes. Generate a concise, well-structured research report synthesising those notes into coherent prose.

## Structure (use exactly these headings)
1. ## Executive Summary — 2-3 sentences capturing the core argument or theme
2. ## [Topic] — one ## section per distinct topic/category in the notes; synthesise the notes into flowing prose (do not just list them)
3. ## Open Questions — bullets for any notes classified as questions
4. ## Key Insights — 3-5 cross-cutting observations that emerge from the whole canvas
5. ## Conclusion — 2-3 sentences tying everything together

## Rules
- Write in a clear, academic-but-readable style.
- Use markdown: **bold** for key terms, > blockquotes for direct quotes from the notes.
- Do not invent facts not present in the notes. If the canvas lacks information, note the gap.
- Keep length proportional to note count: roughly 80 words per 5 notes, minimum 150 words.
- Omit sections that have no relevant notes (e.g. skip Open Questions if there are none).
- Answer in the same language as the majority of the notes.`

// ── Context builder ───────────────────────────────────────────────────────────

/**
 * Groups canvas notes by their AI-assigned category and serialises them into
 * a structured context block for the report prompt.
 *
 * Grouping strategy:
 *   - Use b.category if the note has been enriched; otherwise fall back to
 *     the content-type label (e.g. "Claim", "Idea") so unenriched notes are
 *     still included rather than silently dropped.
 *
 * Each note in the output includes:
 *   - Content type and AI confidence percentage (if available)
 *   - Note text truncated at 250 chars to keep token usage in check
 *   - AI annotation snippet (first 150 chars) when present
 *
 * @returns A multi-section string with one ### heading per category group.
 */
function buildReportContext(projectName: string, blocks: TextBlock[]): string {
  if (blocks.length === 0) return "(No notes on the canvas.)"

  // Group blocks by category; fall back to content-type label for unenriched notes
  const grouped = new Map<string, TextBlock[]>()
  for (const b of blocks) {
    const key = b.category?.trim() || CONTENT_TYPE_CONFIG[b.contentType]?.label || "General"
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(b)
  }

  // Serialise each group as a ### section with one bullet per note
  const sections: string[] = []
  for (const [group, items] of grouped) {
    const notes = items.map((b, i) => {
      const typeLabel = CONTENT_TYPE_CONFIG[b.contentType]?.label ?? b.contentType
      const conf      = b.confidence != null ? ` (confidence: ${b.confidence}%)` : ""
      const annot     = b.annotation ? `\n   Annotation: ${b.annotation.slice(0, 150)}` : ""
      return `  - [${typeLabel}]${conf}: ${b.text.slice(0, 250)}${b.text.length > 250 ? "..." : ""}${annot}`
    }).join("\n")
    sections.push(`### ${group}\n${notes}`)
  }

  return `Project: ${projectName}\n\n${sections.join("\n\n")}`
}

// ── Streaming report generator ────────────────────────────────────────────────

/**
 * Streams an AI-generated research report from the user's canvas notes.
 *
 * Uses the same async generator / SSE streaming pattern as askCanvas() in
 * ai-chat.ts: each yielded string is a text delta from the OpenRouter stream,
 * so the caller can `for await` and append chunks to a React state string.
 *
 * Temperature 0.4: slightly higher than the chat RAG (0.3) to allow more
 * fluid prose while still staying grounded in the source notes.
 * Max tokens 1800: generous budget for a full multi-section report.
 *
 * @param projectName - used as a header in the context so the model knows
 *                      which canvas it's writing about
 * @param blocks      - all canvas notes (will be grouped by category)
 * @param signal      - optional AbortSignal so the Stop button works
 */
export async function* generateReport(
  projectName: string,
  blocks: TextBlock[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const config = loadAIConfig()
  if (!config) throw new Error("No API key configured. Open Settings and add your OpenRouter key.")

  const context   = buildReportContext(projectName, blocks)
  const userMsg   = `Generate a research report for the following canvas.\n\n${context}`

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
      "HTTP-Referer": "[YOUR_DEPLOYED_URL]",
      "X-Title": "Synapse",
    },
    body: JSON.stringify({
      model: config.modelId,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userMsg },
      ],
      stream: true,        // server-sent events for live streaming to the UI
      temperature: 0.4,    // slightly creative for prose, still grounded
      max_tokens: 1800,    // enough for a full multi-section report
    }),
    signal,
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenRouter error ${response.status}: ${err}`)
  }

  // Parse the SSE stream line by line — same logic as ai-chat.ts
  const reader  = response.body!.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      // stream: true in TextDecoder ensures multi-byte chars split across chunks
      // are reassembled correctly rather than producing replacement characters.
      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue  // skip blank / non-data lines
        const data = line.slice(6).trim()
        if (data === "[DONE]") return             // stream finished sentinel

        try {
          const json  = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) yield delta                  // emit each text chunk to the caller
        } catch { /* malformed SSE line — skip and continue */ }
      }
    }
  } finally {
    // Always release the reader lock so the HTTP connection can be cleaned up,
    // even when the generator is aborted mid-stream via AbortSignal.
    reader.releaseLock()
  }
}
