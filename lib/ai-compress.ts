"use client"

/**
 * lib/ai-compress.ts — AI Lossless Information Compression
 *
 * This module is responsible for taking large walls of raw text (e.g., from an imported PDF or PPTX)
 * and intelligently condensing them into highly-dense, atomic study notes using an AI provider.
 * 
 * Unlike standard extraction which might arbitrarily cut sentences or include useless filler,
 * this pipeline uses a strict system prompt to instruct the AI to preserve 100% of the factual
 * information, definitions, and concepts, while discarding conversational "fluff".
 */

import { loadAIConfig } from "@/lib/ai-settings"
import { getAIProviderParams } from "@/lib/ai-client"

// The strict instruction set that forces the AI to compress without losing data
const SYSTEM_PROMPT = `You are a strict, highly-efficient study-guide generator.
Your task is to perform Lossless Information Compression on the provided text.

RULES:
1. Rewrite the text to be as concise and dense as possible.
2. Convert long paragraphs into atomic bullet points or short notes.
3. CRITICAL: You must preserve EVERY single fact, definition, formula, concept, and detail. Do NOT omit any information.
4. Remove conversational filler, introductions, repetitive fluff, and academic throat-clearing.
5. Return the result as a JSON array of strings, where each string is a self-contained, dense note.`

// The JSON schema used to guarantee the AI returns a consistently parseable array of strings
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
 * Splits raw text into larger blocks (~3000 chars) before sending to the AI.
 * 
 * Why chunking is necessary:
 * If we send a massive 50-page PDF to the AI all at once, it will likely exceed
 * token limits or suffer from "lost in the middle" syndrome (forgetting facts).
 * By splitting it into paragraph-aware chunks, we ensure the AI successfully processes
 * and compresses every single section of the document.
 * 
 * @param text The raw text extracted from the document
 * @param maxLength The maximum character length of a single chunk (default 3000)
 */
function chunkForAI(text: string, maxLength = 3000): string[] {
  const chunks: string[] = []
  let current = ""
  
  // Split by double newlines to avoid cutting paragraphs in half
  const paragraphs = text.split(/\n+/)

  for (const para of paragraphs) {
    if (current.length + para.length > maxLength && current.length > 0) {
      chunks.push(current)
      current = ""
    }
    current += (current ? "\n\n" : "") + para
  }
  
  // Push the final remaining text
  if (current) chunks.push(current)
  return chunks
}

/**
 * The main pipeline function that condenses raw document text into study notes.
 * 
 * @param text The raw string extracted from a PDF/DOCX/PPTX
 * @returns A promise that resolves to an array of highly-dense string notes
 */
export async function compressDocument(text: string): Promise<string[]> {
  const config = loadAIConfig()
  if (!config) throw new Error("No API key configured for AI Compression.")

  const rawChunks = chunkForAI(text)
  const allNotes: string[] = []
  
  // Retrieve the correct endpoint URL and authentication headers for the active provider
  const params = getAIProviderParams(config)

  // Handle provider-specific prompt injection
  // Groq does not fully support strict json_schema enforcement, so we inject the schema directly into the prompt
  // and use the standard 'json_object' response format instead.
  const finalSystemPrompt = config.provider === "groq"
    ? `${SYSTEM_PROMPT}\n\nYou MUST respond in pure JSON format matching this exact schema:\n${JSON.stringify(SCHEMA.schema, null, 2)}`
    : SYSTEM_PROMPT

  // Route the correct structured output format based on provider capabilities
  const response_format = config.provider === "groq"
    ? { type: "json_object" }
    : { type: "json_schema", json_schema: SCHEMA }

  // Process chunks sequentially to respect API rate limits. 
  // (Using Promise.all here could trigger 429 Too Many Requests errors on free tiers)
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
        temperature: 0.1, // Low temperature ensures factual consistency rather than creative deviation
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

    // Safely parse the AI's JSON output
    try {
      const parsed = JSON.parse(content)
      if (parsed.notes && Array.isArray(parsed.notes)) {
        allNotes.push(...parsed.notes)
      }
    } catch (e) {
      console.error("Failed to parse AI compressed chunk:", e)
      // Fallback: if JSON parsing fails but the AI returned text, just push the raw string as a single note
      allNotes.push(content)
    }
  }

  return allNotes
}
