"use client"

/**
 * flashcard-panel.tsx — AI Flashcard Study Mode
 *
 * Full-screen overlay that generates Q&A flashcards from the canvas notes
 * and presents them one at a time with a flip animation.
 *
 * Flow:
 *   1. Generating — AI creates Q&A pairs from enriched notes
 *   2. Reviewing  — flip cards one by one (Space/Enter to flip, arrows to navigate)
 *   3. Done       — summary screen showing known vs review counts
 */

import * as React from "react"
import { motion, AnimatePresence } from "framer-motion"
import { X, Loader2, RotateCcw, ChevronLeft, ChevronRight, Check, RefreshCw } from "lucide-react"
import { generateFlashcards, type Flashcard } from "@/lib/ai-flashcards"
import type { TextBlock } from "@/components/tile-card"

interface FlashcardPanelProps {
  isOpen: boolean
  onClose: () => void
  blocks: TextBlock[]
}

type Phase = "generating" | "reviewing" | "done" | "error"

export function FlashcardPanel({ isOpen, onClose, blocks }: FlashcardPanelProps) {
  const [phase,     setPhase]     = React.useState<Phase>("generating")
  const [cards,     setCards]     = React.useState<Flashcard[]>([])
  const [index,     setIndex]     = React.useState(0)
  const [flipped,   setFlipped]   = React.useState(false)
  const [known,     setKnown]     = React.useState<Set<number>>(new Set())
  const [error,     setError]     = React.useState<string | null>(null)

  const current = cards[index]

  // Generate cards when panel opens
  React.useEffect(() => {
    if (!isOpen) return
    setPhase("generating")
    setCards([])
    setIndex(0)
    setFlipped(false)
    setKnown(new Set())
    setError(null)

    generateFlashcards(blocks)
      .then(result => {
        if (result.length === 0) {
          setError("No flashcards could be generated. Make sure you have enriched notes on the canvas.")
          setPhase("error")
        } else {
          setCards(result)
          setPhase("reviewing")
        }
      })
      .catch(err => {
        setError(err instanceof Error ? err.message : "Failed to generate flashcards.")
        setPhase("error")
      })
  }, [isOpen]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard shortcuts
  React.useEffect(() => {
    if (!isOpen || phase !== "reviewing") return
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape")      { onClose(); return }
      if (e.key === " " || e.key === "Enter") { e.preventDefault(); setFlipped(f => !f) }
      if (e.key === "ArrowRight")  { e.preventDefault(); goNext() }
      if (e.key === "ArrowLeft")   { e.preventDefault(); goPrev() }
      if (e.key === "k" || e.key === "K") markKnown()
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }) // eslint-disable-line react-hooks/exhaustive-deps

  React.useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [isOpen, onClose])

  const goNext = React.useCallback(() => {
    setFlipped(false)
    setTimeout(() => {
      setIndex(i => {
        if (i + 1 >= cards.length) { setPhase("done"); return i }
        return i + 1
      })
    }, 150)
  }, [cards.length])

  const goPrev = React.useCallback(() => {
    setFlipped(false)
    setTimeout(() => setIndex(i => Math.max(0, i - 1)), 150)
  }, [])

  const markKnown = React.useCallback(() => {
    setKnown(prev => new Set([...prev, index]))
    goNext()
  }, [index, goNext])

  const restart = () => {
    setIndex(0)
    setFlipped(false)
    setKnown(new Set())
    setPhase("reviewing")
  }

  if (!isOpen) return null

  return (
    <div
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/85 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="relative flex flex-col bg-[#0c0c0e] border border-white/10 rounded-sm shadow-[0_32px_80px_rgba(0,0,0,0.7)] w-full max-w-xl">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/8 shrink-0">
          <div className="flex items-center gap-2.5">
            <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-foreground/80">
              Flashcards
            </h2>
            {phase === "reviewing" && (
              <span className="font-mono text-[9px] bg-white/8 text-foreground/40 px-1.5 py-0.5 rounded-sm">
                {index + 1} / {cards.length}
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-sm hover:bg-white/5 text-muted-foreground/30 hover:text-white transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 p-6">

          {/* Generating */}
          {phase === "generating" && (
            <div className="flex flex-col items-center justify-center gap-4 py-12">
              <Loader2 className="h-6 w-6 text-primary/60 animate-spin" />
              <p className="font-mono text-xs text-foreground/50 uppercase tracking-widest">
                Generating flashcards…
              </p>
            </div>
          )}

          {/* Error */}
          {phase === "error" && (
            <div className="flex flex-col items-center gap-4 py-10">
              <p className="font-mono text-[11px] text-red-400/70 text-center max-w-sm leading-relaxed">
                {error}
              </p>
              <button
                onClick={onClose}
                className="font-mono text-[10px] uppercase tracking-widest text-foreground/40 hover:text-foreground/70 transition-colors border border-white/10 px-3 py-1.5 rounded-sm hover:bg-white/5"
              >
                Close
              </button>
            </div>
          )}

          {/* Reviewing */}
          {phase === "reviewing" && current && (
            <div className="flex flex-col gap-5">
              {/* Progress bar */}
              <div className="w-full h-0.5 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-primary/50 transition-all duration-300"
                  style={{ width: `${((index + 1) / cards.length) * 100}%` }}
                />
              </div>

              {/* Flip card */}
              <div
                className="relative w-full cursor-pointer select-none"
                style={{ perspective: "1000px", minHeight: "220px" }}
                onClick={() => setFlipped(f => !f)}
              >
                <motion.div
                  className="relative w-full h-full"
                  style={{ transformStyle: "preserve-3d" }}
                  animate={{ rotateY: flipped ? 180 : 0 }}
                  transition={{ duration: 0.35, ease: "easeInOut" }}
                >
                  {/* Front — question */}
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-white/[0.03] border border-white/8 rounded-sm px-8 py-10"
                    style={{ backfaceVisibility: "hidden", minHeight: "220px" }}
                  >
                    <span className="font-mono text-[8px] uppercase tracking-widest text-primary/50">Question</span>
                    <p className="text-sm leading-relaxed text-foreground/85 text-center">
                      {current.question}
                    </p>
                    <span className="font-mono text-[8px] uppercase tracking-widest text-foreground/20 mt-2">
                      Click or press Space to reveal answer
                    </span>
                  </div>

                  {/* Back — answer */}
                  <div
                    className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-primary/5 border border-primary/20 rounded-sm px-8 py-10"
                    style={{ backfaceVisibility: "hidden", transform: "rotateY(180deg)", minHeight: "220px" }}
                  >
                    <span className="font-mono text-[8px] uppercase tracking-widest text-primary/50">Answer</span>
                    <p className="text-sm leading-relaxed text-foreground/85 text-center">
                      {current.answer}
                    </p>
                  </div>
                </motion.div>
              </div>

              {/* Controls */}
              <div className="flex items-center justify-between gap-3 pt-1">
                <button
                  onClick={goPrev}
                  disabled={index === 0}
                  className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-foreground/40 hover:text-foreground/70 disabled:opacity-20 transition-colors"
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Prev
                </button>

                <div className="flex items-center gap-2">
                  <button
                    onClick={markKnown}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-primary/15 border border-primary/25 text-primary/70 hover:bg-primary/25 transition-colors font-mono text-[9px] uppercase tracking-widest"
                  >
                    <Check className="h-3 w-3" /> Got it
                  </button>
                  <button
                    onClick={goNext}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-sm bg-white/5 border border-white/10 text-foreground/50 hover:bg-white/8 transition-colors font-mono text-[9px] uppercase tracking-widest"
                  >
                    Review again <ChevronRight className="h-3 w-3" />
                  </button>
                </div>
              </div>

              {/* Keyboard hints */}
              <div className="flex items-center justify-center gap-4 pt-1">
                {[["Space", "flip"], ["→", "next"], ["←", "prev"], ["K", "got it"]].map(([key, label]) => (
                  <div key={key} className="flex items-center gap-1">
                    <kbd className="font-mono text-[8px] text-white/30 bg-white/5 border border-white/10 rounded px-1 py-0.5">{key}</kbd>
                    <span className="font-mono text-[7px] uppercase tracking-wider text-white/25">{label}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Done */}
          {phase === "done" && (
            <div className="flex flex-col items-center gap-5 py-8">
              <div className="text-center">
                <p className="font-mono text-xs font-bold uppercase tracking-widest text-foreground/70">
                  Session complete
                </p>
                <p className="font-mono text-[10px] text-foreground/40 mt-1">
                  {known.size} of {cards.length} marked as known
                </p>
              </div>

              {/* Stats */}
              <div className="flex items-center gap-4">
                <div className="flex flex-col items-center gap-1 px-5 py-3 bg-primary/8 border border-primary/15 rounded-sm">
                  <span className="font-mono text-lg font-bold text-primary/80">{known.size}</span>
                  <span className="font-mono text-[8px] uppercase tracking-widest text-foreground/40">Known</span>
                </div>
                <div className="flex flex-col items-center gap-1 px-5 py-3 bg-white/4 border border-white/8 rounded-sm">
                  <span className="font-mono text-lg font-bold text-foreground/60">{cards.length - known.size}</span>
                  <span className="font-mono text-[8px] uppercase tracking-widest text-foreground/40">Review</span>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={restart}
                  className="flex items-center gap-2 px-4 py-2 rounded-sm bg-white/5 border border-white/10 text-foreground/50 hover:bg-white/8 transition-colors font-mono text-[10px] uppercase tracking-widest"
                >
                  <RotateCcw className="h-3 w-3" /> Restart
                </button>
                <button
                  onClick={onClose}
                  className="flex items-center gap-2 px-4 py-2 rounded-sm bg-primary/15 border border-primary/25 text-primary/70 hover:bg-primary/25 transition-colors font-mono text-[10px] uppercase tracking-widest"
                >
                  <Check className="h-3 w-3" /> Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
