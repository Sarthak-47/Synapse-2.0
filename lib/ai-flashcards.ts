"use client"

import { loadAIConfig } from "@/lib/ai-settings"
import { getAIProviderParams } from "@/lib/ai-client"
import type { TextBlock } from "@/components/tile-card"

export interface Flashcard {
  question: string
  answer: string
  blockId: string
}

/**
 * Generates Q&A flashcards from enriched canvas notes using the user's active AI provider.
 * Sends up to 40 notes in a single batch; the model returns 1–2 cards per note.
 * Only enriched notes (those with an annotation) are used — unenriched notes lack
 * enough structured context for reliable question generation.
 */
export async function generateFlashcards(blocks: TextBlock[]): Promise<Flashcard[]> {
  const config = loadAIConfig()
  if (!config) throw new Error("No AI provider configured. Add an API key in Settings first.")

  const enriched = blocks.filter(b => b.annotation && !b.isEnriching && !b.isError)
  if (enriched.length === 0) {
    throw new Error(
      "No enriched notes found. Add some notes and wait for the AI to annotate them first."
    )
  }

  const batch = enriched.slice(0, 40)
  const notesList = batch
    .map((b, i) =>
      `[${i + 1}] (${b.contentType ?? "general"}) ${b.text}`
    )
    .join("\n\n")

  const { url, headers } = getAIProviderParams(config)

  const useJsonObject = config.provider === "groq"

  const systemPrompt = `You are a study assistant generating flashcards from research notes.
For each note, create 1–2 concise Q&A pairs that test a specific fact, concept, definition, or claim from that note.
Questions must be answerable from the note alone. Answers must be 1–3 sentences maximum.

${useJsonObject ? 'Return a JSON object matching this schema exactly:\n{ "flashcards": [ { "question": "...", "answer": "...", "noteIndex": 1 } ] }\nnoteIndex is the [N] number from the input.' : ""}
Return ONLY valid JSON — no markdown fences, no prose.`

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model: config.modelId,
      temperature: 0.3,
      max_tokens: 2500,
      ...(useJsonObject
        ? { response_format: { type: "json_object" } }
        : {
            response_format: {
              type: "json_schema",
              json_schema: {
                name: "flashcards",
                strict: true,
                schema: {
                  type: "object",
                  properties: {
                    flashcards: {
                      type: "array",
                      items: {
                        type: "object",
                        properties: {
                          question:  { type: "string" },
                          answer:    { type: "string" },
                          noteIndex: { type: "number" },
                        },
                        required: ["question", "answer", "noteIndex"],
                        additionalProperties: false,
                      },
                    },
                  },
                  required: ["flashcards"],
                  additionalProperties: false,
                },
              },
            },
          }),
      messages: [
        { role: "system", content: systemPrompt },
        {
          role: "user",
          content: `Generate flashcards from these notes:\n\n${notesList}`,
        },
      ],
    }),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => "")
    throw new Error(`AI error ${res.status}: ${errText.slice(0, 200)}`)
  }

  const data = await res.json()
  let content: string = data.choices?.[0]?.message?.content ?? ""

  // Strip markdown fences if the model added them despite instructions
  const fenceMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
  if (fenceMatch) content = fenceMatch[1]

  const parsed = JSON.parse(content)
  const cards: { question: string; answer: string; noteIndex?: number }[] =
    parsed.flashcards ?? []

  return cards.map(c => ({
    question: c.question,
    answer:   c.answer,
    blockId:  batch[Math.max(0, (c.noteIndex ?? 1) - 1)]?.id ?? "",
  }))
}
