"use client"

import { loadAIConfig } from "@/lib/ai-settings"
import type { TextBlock } from "@/components/tile-card"
import { CONTENT_TYPE_CONFIG } from "@/lib/content-types"

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

export function parseCitedIndices(text: string): number[] {
  const matches = text.matchAll(/\[(\d+)\]/g)
  const indices = new Set<number>()
  for (const m of matches) {
    const n = parseInt(m[1], 10)
    if (n >= 1) indices.add(n - 1) // convert to 0-based
  }
  return Array.from(indices)
}

export async function* askCanvas(
  question: string,
  blocks: TextBlock[],
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const config = loadAIConfig()
  if (!config) throw new Error("No API key configured. Open Settings and add your OpenRouter key.")

  const context = buildContext(blocks)
  const userMessage = `## Canvas notes\n\n${context}\n\n## Question\n\n${question}`

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
        { role: "user",   content: userMessage },
      ],
      stream: true,
      temperature: 0.3,
      max_tokens: 512,
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
      const lines = chunk.split("\n")

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue
        const data = line.slice(6).trim()
        if (data === "[DONE]") return

        try {
          const json  = JSON.parse(data)
          const delta = json.choices?.[0]?.delta?.content
          if (delta) yield delta
        } catch {
          // malformed SSE line — skip
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}
