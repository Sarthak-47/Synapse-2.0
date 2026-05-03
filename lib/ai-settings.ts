"use client"

import { useState, useEffect, useCallback } from "react"

export interface AIModel {
  id: string
  label: string
  shortLabel: string
  description: string
  supportsGrounding: boolean
}

export const AI_MODELS: AIModel[] = [
  {
    id: "anthropic/claude-sonnet-4-5",
    label: "Claude Sonnet 4.5",
    shortLabel: "Claude",
    description: "Best reasoning & annotation quality",
    supportsGrounding: false,
  },
  {
    id: "openai/gpt-4o",
    label: "GPT-4o",
    shortLabel: "GPT-4o",
    description: "Strong structured output, broad knowledge",
    supportsGrounding: true,
  },
  {
    id: "google/gemini-2.5-pro-preview-03-25",
    label: "Gemini 2.5 Pro",
    shortLabel: "Gemini",
    description: "Long-context, web grounding available",
    supportsGrounding: true,
  },
  {
    id: "deepseek/deepseek-chat",
    label: "DeepSeek V3",
    shortLabel: "DeepSeek",
    description: "Cost-efficient frontier model",
    supportsGrounding: false,
  },
  {
    id: "mistralai/mistral-small-3.2-24b-instruct",
    label: "Mistral Small 3.2",
    shortLabel: "Mistral",
    description: "Fast, excellent structured outputs",
    supportsGrounding: false,
  },
]

export const DEFAULT_MODEL_ID = "google/gemini-2.5-pro-preview-03-25"

export interface AISettings {
  apiKey: string
  modelId: string
  webGrounding: boolean
}

const STORAGE_KEY = "synapse-ai-settings"

function loadSettings(): AISettings {
  if (typeof window === "undefined") {
    return { apiKey: "", modelId: DEFAULT_MODEL_ID, webGrounding: false }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { apiKey: "", modelId: DEFAULT_MODEL_ID, webGrounding: false }
    return { apiKey: "", modelId: DEFAULT_MODEL_ID, webGrounding: false, ...JSON.parse(raw) }
  } catch {
    return { apiKey: "", modelId: DEFAULT_MODEL_ID, webGrounding: false }
  }
}

export interface AIConfig {
  apiKey: string
  modelId: string
  supportsGrounding: boolean
}

/** Read AI settings fresh from localStorage and return the resolved config.
 *  Returns null if no API key is configured.
 *  Always call at request time — never store in a closure. */
export function loadAIConfig(): AIConfig | null {
  const s = loadSettings()
  if (!s.apiKey) return null
  const model = AI_MODELS.find(m => m.id === s.modelId) || AI_MODELS.find(m => m.id === DEFAULT_MODEL_ID)!
  const modelId = s.modelId || DEFAULT_MODEL_ID
  return { apiKey: s.apiKey, modelId, supportsGrounding: model.supportsGrounding }
}

/** @deprecated Use loadAIConfig() for direct browser → OpenRouter calls.
 *  Kept for any remaining server-route usage during transition. */
export function getAIHeaders(): Record<string, string> {
  const config = loadAIConfig()
  if (!config) return {}
  const model = AI_MODELS.find(m => m.id === config.modelId) || AI_MODELS.find(m => m.id === DEFAULT_MODEL_ID)!
  const modelId = config.modelId
  return {
    "x-or-key": config.apiKey,
    "x-or-model": modelId,
    "x-or-supports-grounding": model.supportsGrounding ? "true" : "false",
  }
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

  const resolvedModelId = (() => {
    const model = AI_MODELS.find(m => m.id === settings.modelId) || AI_MODELS.find(m => m.id === DEFAULT_MODEL_ID)!
    if (settings.webGrounding && model.supportsGrounding) {
      return `${model.id}:online`
    }
    return model.id
  })()

  const currentModel = AI_MODELS.find(m => m.id === settings.modelId) || AI_MODELS.find(m => m.id === DEFAULT_MODEL_ID)!

  return { settings, updateSettings, resolvedModelId, currentModel }
}
