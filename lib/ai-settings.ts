"use client"

import { useState, useEffect, useCallback } from "react"

export type AIProvider = "openrouter" | "google"

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
]

export const DEFAULT_GOOGLE_MODEL_ID = "gemini-2.5-pro"
export const DEFAULT_OPENROUTER_MODEL_ID = "anthropic/claude-sonnet-4-5"

export interface AISettings {
  provider: AIProvider
  googleApiKey: string
  openRouterApiKey: string
  googleModelId: string
  openRouterModelId: string
  webGrounding: boolean
}

const STORAGE_KEY = "synapse-ai-settings"

const DEFAULT_SETTINGS: AISettings = {
  provider: "openrouter", // Default to OpenRouter for backwards compatibility
  googleApiKey: "",
  openRouterApiKey: "",
  googleModelId: DEFAULT_GOOGLE_MODEL_ID,
  openRouterModelId: DEFAULT_OPENROUTER_MODEL_ID,
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
}

/** Read AI settings fresh from localStorage and return the resolved config.
 *  Returns null if no API key is configured for the active provider.
 *  Always call at request time — never store in a closure. */
export function loadAIConfig(): AIConfig | null {
  const s = loadSettings()
  
  if (s.provider === "google") {
    if (!s.googleApiKey) return null
    const model = AI_MODELS.find(m => m.id === s.googleModelId && m.provider === "google") || AI_MODELS.find(m => m.id === DEFAULT_GOOGLE_MODEL_ID)!
    return { provider: "google", apiKey: s.googleApiKey, modelId: model.id, supportsGrounding: model.supportsGrounding }
  } else {
    if (!s.openRouterApiKey) return null
    const model = AI_MODELS.find(m => m.id === s.openRouterModelId && m.provider === "openrouter") || AI_MODELS.find(m => m.id === DEFAULT_OPENROUTER_MODEL_ID)!
    return { provider: "openrouter", apiKey: s.openRouterApiKey, modelId: model.id, supportsGrounding: model.supportsGrounding }
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

  const currentModelId = settings.provider === "google" ? settings.googleModelId : settings.openRouterModelId
  const defaultModelId = settings.provider === "google" ? DEFAULT_GOOGLE_MODEL_ID : DEFAULT_OPENROUTER_MODEL_ID

  const resolvedModelId = (() => {
    const model = AI_MODELS.find(m => m.id === currentModelId) || AI_MODELS.find(m => m.id === defaultModelId)!
    // Only OpenRouter :online grounding needs this string append logic
    if (settings.provider === "openrouter" && settings.webGrounding && model.supportsGrounding) {
      return `${model.id}:online`
    }
    return model.id
  })()

  const currentModel = AI_MODELS.find(m => m.id === currentModelId) || AI_MODELS.find(m => m.id === defaultModelId)!

  return { settings, updateSettings, resolvedModelId, currentModel }
}
