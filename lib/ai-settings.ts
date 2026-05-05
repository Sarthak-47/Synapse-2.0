"use client"

import { useState, useEffect, useCallback } from "react"

export type AIProvider = "openrouter" | "google" | "groq"

export interface AIModel {
  id: string
  label: string
  shortLabel: string
  description: string
  supportsGrounding: boolean
  provider: AIProvider
}

export const AI_MODELS: AIModel[] = [
  // --- Google Models (Direct) ---
  {
    id: "gemini-2.5-pro",
    label: "Gemini 2.5 Pro",
    shortLabel: "Gemini Pro",
    description: "Best for complex reasoning and long context",
    supportsGrounding: true,
    provider: "google",
  },
  {
    id: "gemini-2.5-flash",
    label: "Gemini 2.5 Flash",
    shortLabel: "Gemini Flash",
    description: "Fast and cost-effective",
    supportsGrounding: true,
    provider: "google",
  },
  // --- OpenRouter Models ---
  {
    id: "anthropic/claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    shortLabel: "Claude",
    description: "Best reasoning & annotation quality",
    supportsGrounding: false,
    provider: "openrouter",
  },
  {
    id: "openai/gpt-4o",
    label: "GPT-4o",
    shortLabel: "GPT-4o",
    description: "Strong structured output, broad knowledge",
    supportsGrounding: true,
    provider: "openrouter",
  },
  {
    id: "deepseek/deepseek-chat",
    label: "DeepSeek V3",
    shortLabel: "DeepSeek",
    description: "Cost-efficient frontier model",
    supportsGrounding: false,
    provider: "openrouter",
  },
  {
    id: "mistralai/mistral-small-3.2-24b-instruct",
    label: "Mistral Small 3.2",
    shortLabel: "Mistral",
    description: "Fast, excellent structured outputs",
    supportsGrounding: false,
    provider: "openrouter",
  },
  // --- Groq Models ---
  {
    id: "llama-3.3-70b-versatile",
    label: "Llama 3.3 70B",
    shortLabel: "Llama 3.3",
    description: "Extremely fast, powerful open model",
    supportsGrounding: false,
    provider: "groq",
  },
  {
    id: "llama3-8b-8192",
    label: "Llama 3 8B",
    shortLabel: "Llama 3 8B",
    description: "Lightning fast, smaller context",
    supportsGrounding: false,
    provider: "groq",
  },
  {
    id: "mixtral-8x7b-32768",
    label: "Mixtral 8x7B",
    shortLabel: "Mixtral",
    description: "High speed mixture of experts",
    supportsGrounding: false,
    provider: "groq",
  },
  {
    id: "gemma2-9b-it",
    label: "Gemma 2 9B",
    shortLabel: "Gemma 2",
    description: "Google's open weight model",
    supportsGrounding: false,
    provider: "groq",
  },
]

export const DEFAULT_GOOGLE_MODEL_ID = "gemini-2.5-flash"
export const DEFAULT_OPENROUTER_MODEL_ID = "anthropic/claude-sonnet-4-5"
export const DEFAULT_GROQ_MODEL_ID = "llama-3.3-70b-versatile"

export interface AISettings {
  provider: AIProvider
  googleApiKey: string
  openRouterApiKey: string
  groqApiKey: string
  googleModelId: string
  openRouterModelId: string
  groqModelId: string
  webGrounding: boolean
}

const STORAGE_KEY = "synapse-ai-settings"

const DEFAULT_SETTINGS: AISettings = {
  provider: "openrouter", // Default to OpenRouter for backwards compatibility
  googleApiKey: "",
  openRouterApiKey: "",
  groqApiKey: "",
  googleModelId: DEFAULT_GOOGLE_MODEL_ID,
  openRouterModelId: DEFAULT_OPENROUTER_MODEL_ID,
  groqModelId: DEFAULT_GROQ_MODEL_ID,
  webGrounding: false,
}

function loadSettings(): AISettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_SETTINGS
    const parsed = JSON.parse(raw)
    
    // Migration: If they have the old `apiKey` and `modelId`, map them to OpenRouter
    if ("apiKey" in parsed && !("openRouterApiKey" in parsed)) {
      return {
        ...DEFAULT_SETTINGS,
        provider: "openrouter",
        openRouterApiKey: parsed.apiKey || "",
        openRouterModelId: parsed.modelId || DEFAULT_OPENROUTER_MODEL_ID,
        webGrounding: parsed.webGrounding || false,
      }
    }
    
    return { ...DEFAULT_SETTINGS, ...parsed }
  } catch {
    return DEFAULT_SETTINGS
  }
}

export interface AIConfig {
  provider: AIProvider
  apiKey: string
  modelId: string
  supportsGrounding: boolean
  webGrounding: boolean
}

/** Read AI settings fresh from localStorage and return the resolved config.
 *  Returns null if no API key is configured for the active provider.
 *  Always call at request time — never store in a closure. */
export function loadAIConfig(): AIConfig | null {
  const s = loadSettings()
  
  if (s.provider === "google") {
    if (!s.googleApiKey) return null
    const model = AI_MODELS.find(m => m.id === s.googleModelId && m.provider === "google") || AI_MODELS.find(m => m.id === DEFAULT_GOOGLE_MODEL_ID)!
    return { provider: "google", apiKey: s.googleApiKey, modelId: model.id, supportsGrounding: model.supportsGrounding, webGrounding: s.webGrounding }
  } else if (s.provider === "groq") {
    if (!s.groqApiKey) return null
    const model = AI_MODELS.find(m => m.id === s.groqModelId && m.provider === "groq") || AI_MODELS.find(m => m.id === DEFAULT_GROQ_MODEL_ID)!
    return { provider: "groq", apiKey: s.groqApiKey, modelId: model.id, supportsGrounding: model.supportsGrounding, webGrounding: s.webGrounding }
  } else {
    if (!s.openRouterApiKey) return null
    const model = AI_MODELS.find(m => m.id === s.openRouterModelId && m.provider === "openrouter") || AI_MODELS.find(m => m.id === DEFAULT_OPENROUTER_MODEL_ID)!
    
    // Only OpenRouter uses the :online suffix for web grounding
    const finalModelId = (s.webGrounding && model.supportsGrounding) ? `${model.id}:online` : model.id
    
    return { provider: "openrouter", apiKey: s.openRouterApiKey, modelId: finalModelId, supportsGrounding: model.supportsGrounding, webGrounding: s.webGrounding }
  }
}

/** @deprecated Use loadAIConfig() for direct browser calls. */
export function getAIHeaders(): Record<string, string> {
  return {}
}

export function useAISettings() {
  const [settings, setSettings] = useState<AISettings>(loadSettings)

  const updateSettings = useCallback((patch: Partial<AISettings>) => {
    setSettings(prev => {
      const next = { ...prev, ...patch }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      return next
    })
  }, [])

  const currentModelId = settings.provider === "google" 
    ? settings.googleModelId 
    : settings.provider === "groq"
      ? settings.groqModelId
      : settings.openRouterModelId
      
  const defaultModelId = settings.provider === "google" 
    ? DEFAULT_GOOGLE_MODEL_ID 
    : settings.provider === "groq"
      ? DEFAULT_GROQ_MODEL_ID
      : DEFAULT_OPENROUTER_MODEL_ID

  const currentModel = AI_MODELS.find(m => m.id === currentModelId) || AI_MODELS.find(m => m.id === defaultModelId)!

  return { settings, updateSettings, currentModel }
}
