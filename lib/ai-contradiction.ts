"use client"

/**
 * ai-contradiction.ts — Contradiction & Tension Detection
 *
 * Identifies pairs of canvas notes that logically contradict each other and
 * returns them as typed Contradiction objects so the graph view can draw red
 * dashed edges between the offending nodes.
 *
 * Design decisions:
 *   - Smart sampling: instead of sending every block (which could exceed token
 *     limits on large canvases), the engine prioritises "contradiction-prone"
 *     content types — claims, opinions, definitions, quotes, theses, etc. —
 *     and caps the sample at 22 blocks. Other types are included if slots remain.
 *   - Strict JSON schema: uses OpenRouter's response_format with a json_schema
 *     and strict: true so the response is always well-formed and can be parsed
 *     without a regex fallback.
 *   - Low temperature (0.1): factual, deterministic identification of genuine
 *     contradictions rather than speculative pattern-matching.
 *   - Index validation: sample indices returned by the model are validated
 *     against the sample array length before mapping to block IDs, preventing
 *     array-out-of-bounds errors from hallucinated indices.
 */

import { loadAIConfig } from "@/lib/ai-settings"
import type { TextBlock } from "@/components/tile-card"
import { CONTENT_TYPE_CONFIG } from "@/lib/content-types"

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A detected contradiction between two canvas notes.
 * The id is a stable composite of both block IDs so the graph can key edges.
 */
export interface Contradiction {
  id: string       // "<blockAId>-<blockBId>" — used as a React key for SVG edges
  blockAId: string
  blockBId: string
  reason: string   // one-sentence plain-English explanation of the tension
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Content types most likely to produce contradictions — factual assertions,
 * opinions, definitions, and argumentative statements. Narrative and reflection
 * types rarely produce logical contradictions so they are deprioritised.
 */
const CANDIDATE_TYPES = new Set([
  "claim", "opinion", "entity", "definition", "quote", "comparison", "thesis",
])

/**
 * Selects a representative sample from the block list, prioritising
 * contradiction-prone content types and capping total count at maxCount.
 *
 * Strategy:
 *   1. Collect all CANDIDATE_TYPES blocks first.
 *   2. Append remaining blocks to fill up to maxCount.
 *
 * This ensures the model sees as many "interesting" pairs as possible within
 * the token budget, rather than wasting slots on tasks or reflections.
 */
function sampleBlocks(blocks: TextBlock[], maxCount = 22): TextBlock[] {
  const priority = blocks.filter(b => CANDIDATE_TYPES.has(b.contentType))
  const rest     = blocks.filter(b => !CANDIDATE_TYPES.has(b.contentType))
  const combined = [...priority, ...rest]
  return combined.slice(0, maxCount)
}

// ── JSON schema for structured output ────────────────────────────────────────
// Using response_format: json_schema with strict: true guarantees the model
// always returns a valid contradictions array — no regex fallback needed.
// Each contradiction is a (indexA, indexB, reason) triple using 0-based indices
// matching the numbered note list sent in the user message.

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
// The model is told to return an empty array when there are no genuine
// contradictions — this is explicitly stated to prevent the model from
// inventing tensions just to return something.

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

/**
 * Detects logical contradictions between canvas notes using an AI model with
 * structured JSON output.
 *
 * Returns an array of Contradiction objects. Returns an empty array if:
 *   - Fewer than 2 blocks exist (nothing to compare)
 *   - No API key is configured
 *   - The model finds no genuine contradictions
 *
 * The function does NOT stream — it waits for the full response before
 * returning, since the structured schema requires a complete JSON object.
 *
 * @param blocks - all current canvas notes
 */
export async function detectContradictions(blocks: TextBlock[]): Promise<Contradiction[]> {
  if (blocks.length < 2) return []

  const config = loadAIConfig()
  if (!config) throw new Error("No API key configured.")

  // Sample blocks to stay within token limits while prioritising relevant types
  const sample = sampleBlocks(blocks)

  // Build the numbered note list sent to the model.
  // Notes are 0-indexed (unlike the RAG chat which uses 1-based) so the model's
  // indexA/indexB values map directly to sample array positions.
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
      "HTTP-Referer": typeof window !== "undefined" ? window.location.origin : "",
      "X-Title": "Synapse",
    },
    body: JSON.stringify({
      model: config.modelId,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user",   content: userMessage },
      ],
      // Strict JSON schema ensures a parseable response without a fallback regex
      response_format: { type: "json_schema", json_schema: SCHEMA },
      temperature: 0.1,   // very low temperature for deterministic fact-checking
      max_tokens: 1500,
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`OpenRouter error ${response.status}: ${err}`)
  }

  const data    = await response.json()
  const content = data.choices?.[0]?.message?.content
  if (!content) throw new Error("No content in response")

  // Parse the guaranteed-valid JSON from the strict schema response
  const parsed: { contradictions: { indexA: number; indexB: number; reason: string }[] } =
    JSON.parse(content)

  // Map sample-local indices back to real block IDs.
  // Validate bounds and self-references before mapping to prevent crashes from
  // any hallucinated indices that slip past the strict schema.
  return parsed.contradictions
    .filter(c =>
      c.indexA >= 0 && c.indexA < sample.length &&
      c.indexB >= 0 && c.indexB < sample.length &&
      c.indexA !== c.indexB   // a note cannot contradict itself
    )
    .map(c => ({
      id:       `${sample[c.indexA].id}-${sample[c.indexB].id}`,  // stable composite key
      blockAId: sample[c.indexA].id,
      blockBId: sample[c.indexB].id,
      reason:   c.reason,
    }))
}
