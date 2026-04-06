import type { ContentType } from "./content-types"

const URL_REGEX = /https?:\/\/[^\s]+/i

export function detectContentType(text: string): ContentType {
  const trimmed = text.trim()
  const lower = trimmed.toLowerCase()

  // Quote: starts with quotation marks
  if (/^["'\u201C\u201D\u2018\u2019]/.test(trimmed)) {
    return "quote"
  }

  // Task: starts with checkbox syntax, TODO/FIXME, or conversational action verbs
  if (/^\[[\sx]?\]/i.test(trimmed) || 
      /^(todo|fixme|hack|buy|call|send|finish|complete|remind|need to)\b/i.test(trimmed)) {
    return "task"
  }

  // Question: starts with ? or ends with ? within first sentence
  if (trimmed.startsWith("?") || /^[^.!]{3,}\?/.test(trimmed)) {
    return "question"
  }

  // Definition: contains "is defined as", "means", "refers to"
  if (/\b(is defined as|means|refers to|is the)\b/i.test(lower)) {
    return "definition"
  }

  // Comparison: contains "vs", "compared to", "versus", "on the other hand"
  if (/\b(vs\.?|versus|compared to|on the other hand|differs from|difference between)\b/i.test(lower)) {
    return "comparison"
  }

  // Reference: contains a URL
  if (URL_REGEX.test(trimmed)) {
    return "reference"
  }

  // Idea: starts with "what if", "could we", "imagine", "how about"
  if (/^(what if|could we|imagine|how about|maybe we)\b/i.test(trimmed)) {
    return "idea"
  }

  // Reflection: contains reflective patterns
  if (/\b(i remember|looking back|in retrospect|upon reflection|thinking about it)\b/i.test(lower)) {
    return "reflection"
  }

  // Opinion: contains opinion markers
  if (/\b(i think|i feel|i believe|imo|imho|in my opinion|personally)\b/i.test(lower)) {
    return "opinion"
  }

  // Entity: short, no verb-like structure (less than 4 words, no period)
  const wordCount = trimmed.split(/\s+/).length
  if (wordCount <= 3 && !trimmed.includes(".") && !trimmed.includes("!")) {
    return "entity"
  }

  // Claim: assertive statements (between 4 and 25 words)
  if (wordCount >= 4 && wordCount <= 25 && !trimmed.endsWith("?")) {
    return "claim"
  }

  // Narrative: longer text blocks
  if (wordCount > 25) {
    return "narrative"
  }

  return "general"
}
