import { AIConfig } from "./ai-settings"

export interface AIProviderParams {
  url: string
  headers: Record<string, string>
}

/**
 * Resolves the correct base URL and headers depending on the user's selected provider.
 * Both OpenRouter and Google Gemini now support the standard OpenAI chat/completions API format,
 * which means the request payload (messages, temperature, stream, response_format) can remain identical.
 */
export function getAIProviderParams(config: AIConfig): AIProviderParams {
  if (config.provider === "google") {
    return {
      url: "https://generativelanguage.googleapis.com/v1beta/openai/chat/completions",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
    }
  }
  
  if (config.provider === "groq") {
    return {
      url: "https://api.groq.com/openai/v1/chat/completions",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${config.apiKey}`,
      },
    }
  }

  // OpenRouter (Default)
  return {
    url: "https://openrouter.ai/api/v1/chat/completions",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${config.apiKey}`,
      "HTTP-Referer": typeof window !== "undefined" ? window.location.origin : "",
      "X-Title": "Synapse",
    },
  }
}
