"use client"

import { loadAIConfig } from "@/lib/ai-settings"
import type { TextBlock } from "@/components/tile-card"
import { CONTENT_TYPE_CONFIG } from "@/lib/content-types"

// ── System prompt ─────────────────────────────────────────────────────────────

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

function buildReportContext(projectName: string, blocks: TextBlock[]): string {
  if (blocks.length === 0) return "(No notes on the canvas.)"

  // Group by category, then by contentType for ungrouped ones
  const grouped = new Map<string, TextBlock[]>()
  for (const b of blocks) {
    const key = b.category?.trim() || CONTENT_TYPE_CONFIG[b.contentType]?.label || "General"
    if (!grouped.has(key)) grouped.set(key, [])
    grouped.get(key)!.push(b)
  }

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

// ── Public API ────────────────────────────────────────────────────────────────

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
      "HTTP-Referer": "https://nodepad.space",
      "X-Title": "nodepad",
    },
    body: JSON.stringify({
      model: config.modelId,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userMsg },
      ],
      stream: true,
      temperature: 0.4,
      max_tokens: 1800,
    }),
    signal,
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenRouter error ${response.status}: ${err}`)
  }

  const reader  = response.body!.getReader()
  const decoder = new TextDecoder()

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      const chunk = decoder.decode(value, { stream: true })
      for (const line of chunk.split("\n")) {
        if (!line.startsWith("data: ")) continue
        const data = line.slice(6).trim()
        if (data === "[DONE]") return
        try {
          const json  = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) yield delta
        } catch { /* malformed SSE line */ }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
