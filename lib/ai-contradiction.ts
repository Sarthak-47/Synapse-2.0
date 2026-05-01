"use client"

import { loadAIConfig } from "@/lib/ai-settings"
import type { TextBlock } from "@/components/tile-card"
import { CONTENT_TYPE_CONFIG } from "@/lib/content-types"

// ── Types ─────────────────────────────────────────────────────────────────────

export interface Contradiction {
  id: string
  blockAId: string
  blockBId: string
  reason: string
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CANDIDATE_TYPES = new Set([
  "claim", "opinion", "entity", "definition", "quote", "comparison", "thesis",
])

/**
 * Pick up to maxCount blocks, prioritising contradiction-prone types.
 * Returns the subset and the original indices for mapping back to IDs.
 */
function sampleBlocks(blocks: TextBlock[], maxCount = 22): TextBlock[] {
  const priority = blocks.filter(b => CANDIDATE_TYPES.has(b.contentType))
  const rest     = blocks.filter(b => !CANDIDATE_TYPES.has(b.contentType))
  const combined = [...priority, ...rest]
  return combined.slice(0, maxCount)
}

// ── JSON schema for structured output ────────────────────────────────────────

const SCHEMA = {
  name: "contradiction_result",
  strict: true,
  schema: {
    type: "object",
    properties: {
      contradictions: {
        type: "array",
        items: {
          type: "object",
          properties: {
            indexA: { type: "number", description: "0-based index of first note" },
            indexB: { type: "number", description: "0-based index of second note" },
            reason: { type: "string", description: "One sentence explaining the tension (under 25 words)" },
          },
          required: ["indexA", "indexB", "reason"],
          additionalProperties: false,
        },
      },
    },
    required: ["contradictions"],
    additionalProperties: false,
  },
}

// ── System prompt ─────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are analysing a set of research notes for logical contradictions and tensions.

Identify pairs of notes that:
- Directly contradict each other (one asserts X, the other denies X)
- Make mutually exclusive claims about the same subject
- Assert strongly opposing positions or conclusions

Rules:
- Return only clear, genuine contradictions — not minor differences of emphasis or perspective.
- An empty array is correct and expected if the notes are consistent.
- Keep each reason under 25 words, plain English, no markdown.
- indexA and indexB are 0-based indices matching the numbered list in the user message.`

// ── Public API ────────────────────────────────────────────────────────────────

export async function detectContradictions(blocks: TextBlock[]): Promise<Contradiction[]> {
  if (blocks.length < 2) return []

  const config = loadAIConfig()
  if (!config) throw new Error("No API key configured.")

  const sample = sampleBlocks(blocks)

  const noteList = sample
    .map((b, i) => {
      const typeLabel = CONTENT_TYPE_CONFIG[b.contentType]?.label ?? b.contentType
      return `[${i}] (${typeLabel}) ${b.text.slice(0, 200)}${b.text.length > 200 ? "..." : ""}`
    })
    .join("\n")

  const userMessage = `Analyse these notes for contradictions:\n\n${noteList}`

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
      response_format: { type: "json_schema", json_schema: SCHEMA },
      temperature: 0.1,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenRouter error ${response.status}: ${err}`)
  }

  const data    = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error("No content in response")

  const parsed: { contradictions: { indexA: number; indexB: number; reason: string }[] } =
    JSON.parse(content)

  return parsed.contradictions
    .filter(c =>
      c.indexA >= 0 && c.indexA < sample.length &&
      c.indexB >= 0 && c.indexB < sample.length &&
      c.indexA !== c.indexB
    )
    .map(c => ({
      id:       `${sample[c.indexA].id}-${sample[c.indexB].id}`,
      blockAId: sample[c.indexA].id,
      blockBId: sample[c.indexB].id,
      reason:   c.reason,
    }))
}
