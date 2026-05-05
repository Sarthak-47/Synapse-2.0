"use client"

import { loadAIConfig } from "@/lib/ai-settings"
import { getAIProviderParams } from "@/lib/ai-client"

const SYSTEM_PROMPT = `You are a strict, highly-efficient study-guide generator.
Your task is to perform Lossless Information Compression on the provided text.

RULES:
1. Rewrite the text to be as concise and dense as possible.
2. Convert long paragraphs into atomic bullet points or short notes.
3. CRITICAL: You must preserve EVERY single fact, definition, formula, concept, and detail. Do NOT omit any information.
4. Remove conversational filler, introductions, repetitive fluff, and academic throat-clearing.
5. Return the result as a JSON array of strings, where each string is a self-contained, dense note.`

const SCHEMA = {
  name: "compressed_notes",
  strict: true,
  schema: {
    type: "object",
    properties: {
      notes: {
        type: "array",
        items: {
          type: "string",
          description: "A single, dense, self-contained atomic note containing preserved facts."
        }
      }
    },
    required: ["notes"],
    additionalProperties: false
  }
}

/**
 * Splits raw text into larger chunks (~3000 chars) for AI processing,
 * ensuring we don't cut off in the middle of a word.
 */
function chunkForAI(text: string, maxLength = 3000): string[] {
  const chunks: string[] = []
  let current = ""
  const paragraphs = text.split(/\n+/)

  for (const para of paragraphs) {
    if (current.length + para.length > maxLength && current.length > 0) {
      chunks.push(current)
      current = ""
    }
    current += (current ? "\n\n" : "") + para
  }
  if (current) chunks.push(current)
  return chunks
}

export async function compressDocument(text: string): Promise<string[]> {
  const config = loadAIConfig()
  if (!config) throw new Error("No API key configured for AI Compression.")

  const rawChunks = chunkForAI(text)
  const allNotes: string[] = []
  const params = getAIProviderParams(config)

  const finalSystemPrompt = config.provider === "groq"
    ? `${SYSTEM_PROMPT}\n\nYou MUST respond in pure JSON format matching this exact schema:\n${JSON.stringify(SCHEMA.schema, null, 2)}`
    : SYSTEM_PROMPT

  const response_format = config.provider === "groq"
    ? { type: "json_object" }
    : { type: "json_schema", json_schema: SCHEMA }

  // Process sequentially to avoid aggressive rate limits (especially Google 503s)
  for (const chunk of rawChunks) {
    if (!chunk.trim()) continue

    const response = await fetch(params.url, {
      method: "POST",
      headers: params.headers,
      body: JSON.stringify({
        model: config.modelId,
        messages: [
          { role: "system", content: finalSystemPrompt },
          { role: "user", content: `Compress this text losslessly:\n\n${chunk}` }
        ],
        response_format,
        temperature: 0.1,
        max_tokens: 2000,
      }),
    })

    if (!response.ok) {
      const err = await response.text()
      throw new Error(`AI Compression error ${response.status}: ${err}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    if (!content) throw new Error("No content in response")

    try {
      const parsed = JSON.parse(content)
      if (parsed.notes && Array.isArray(parsed.notes)) {
        allNotes.push(...parsed.notes)
      }
    } catch (e) {
      console.error("Failed to parse AI compressed chunk:", e)
      // Fallback: if JSON parsing fails, just push the raw string as a single note
      allNotes.push(content)
    }
  }

  return allNotes
}
