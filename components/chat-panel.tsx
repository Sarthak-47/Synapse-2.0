"use client"

/**
 * chat-panel.tsx — "Ask Your Canvas" Chat Panel
 *
 * A 300 px sliding side panel that lets the user ask natural-language questions
 * about their canvas notes. Answers are streamed live from the OpenRouter RAG
 * engine defined in lib/ai-chat.ts.
 *
 * Key behaviours:
 *   - Each assistant reply streams word-by-word via an async generator. A
 *     blinking cursor is shown while streaming is in progress.
 *   - An AbortController is created per request so the Stop button can cancel
 *     mid-stream cleanly without leaving a dangling fetch connection.
 *   - After streaming completes, parseCitedIndices() extracts [N] citation
 *     markers from the full reply. Each cited note becomes a clickable pill
 *     that calls onHighlight, which scrolls the canvas to that note.
 *   - The textarea auto-resizes as the user types (up to 100 px max height).
 *     Enter sends; Shift+Enter inserts a newline.
 *   - The panel is animated via CSS width/opacity transition — same slide-in
 *     pattern used by GhostPanel and ReportPanel.
 */

import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { MessageSquare, Send, Square, X } from "lucide-react"
import { askCanvas, parseCitedIndices } from "@/lib/ai-chat"
import type { TextBlock } from "@/components/tile-card"

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single message in the conversation history.
 * citedIndices holds 0-based block indices parsed from [N] markers in the reply.
 * isStreaming is true while the assistant is still generating text.
 */
interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  citedIndices?: number[]   // 0-based indices into the blocks array
  isStreaming?: boolean
}

interface ChatPanelProps {
  blocks: TextBlock[]
  isOpen: boolean
  onClose: () => void
  /** Called when the user clicks a citation pill — parent scrolls to that block. */
  onHighlight: (id: string | null) => void
}

// ── Markdown render components ────────────────────────────────────────────────
// Custom renderers keep the markdown styled consistently with the panel's
// dark theme rather than using default prose defaults.

const MdComponents = {
  p:      ({ children }: { children?: React.ReactNode }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => <strong className="font-bold text-foreground">{children}</strong>,
  em:     ({ children }: { children?: React.ReactNode }) => <em className="italic text-foreground/80">{children}</em>,
  ul:     ({ children }: { children?: React.ReactNode }) => <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>,
  ol:     ({ children }: { children?: React.ReactNode }) => <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>,
  li:     ({ children }: { children?: React.ReactNode }) => <li className="text-sm leading-relaxed">{children}</li>,
  code:   ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded-sm bg-white/10 px-1 py-0.5 font-mono text-[11px]">{children}</code>
  ),
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ChatPanel({ blocks, isOpen, onClose, onHighlight }: ChatPanelProps) {
  const [messages, setMessages]       = React.useState<ChatMessage[]>([])
  const [input, setInput]             = React.useState("")
  const [isStreaming, setIsStreaming]  = React.useState(false)
  const [error, setError]             = React.useState<string | null>(null)

  // abortRef holds the current request's AbortController so stopStream() can
  // cancel it without needing it in component state (which would trigger re-renders).
  const abortRef    = React.useRef<AbortController | null>(null)
  const scrollRef   = React.useRef<HTMLDivElement>(null)
  const inputRef    = React.useRef<HTMLTextAreaElement>(null)
  // streamingId tracks which assistant message is currently being written to,
  // so partial updates can target the right message in the array.
  const streamingId = React.useRef<string | null>(null)

  // Auto-scroll the message list to the bottom on every new chunk
  React.useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages])

  // Focus the input 150 ms after the panel opens (transition delay)
  React.useEffect(() => {
    if (isOpen) {
      setTimeout(() => inputRef.current?.focus(), 150)
    }
  }, [isOpen])

  // Abort any in-flight request when the panel is closed
  React.useEffect(() => {
    if (!isOpen) abortRef.current?.abort()
  }, [isOpen])

  /**
   * Cancels the current stream and marks the in-progress assistant message
   * as no longer streaming so the blinking cursor disappears.
   */
  const stopStream = () => {
    abortRef.current?.abort()
    setIsStreaming(false)
    if (streamingId.current) {
      setMessages(prev => prev.map(m =>
        m.id === streamingId.current ? { ...m, isStreaming: false } : m
      ))
    }
  }

  /**
   * Sends the user's question to askCanvas() and streams the reply into the
   * assistant message bubble.
   *
   * Steps:
   *   1. Append a user message and an empty assistant message (isStreaming: true).
   *   2. For each chunk from the async generator, append to `accumulated` and
   *      update the assistant message content in place.
   *   3. On completion, call parseCitedIndices() to extract citation pills.
   *   4. On AbortError (Stop pressed), leave accumulated content as-is and
   *      mark the message finished. On other errors, show an error banner and
   *      remove the empty assistant message.
   */
  const sendMessage = async () => {
    const question = input.trim()
    if (!question || isStreaming) return

    setError(null)
    setInput("")

    const userMsg: ChatMessage = { id: Math.random().toString(36).slice(2), role: "user", content: question }
    const assistantId = Math.random().toString(36).slice(2)
    streamingId.current = assistantId
    const assistantMsg: ChatMessage = { id: assistantId, role: "assistant", content: "", isStreaming: true }

    setMessages(prev => [...prev, userMsg, assistantMsg])
    setIsStreaming(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    let accumulated = ""

    try {
      for await (const chunk of askCanvas(question, blocks, ctrl.signal)) {
        accumulated += chunk
        // Update only the streaming assistant message — other messages are untouched
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, content: accumulated } : m
        ))
      }
      // Stream finished — extract [N] citation markers and convert to 0-based indices
      const cited = parseCitedIndices(accumulated)
      setMessages(prev => prev.map(m =>
        m.id === assistantId
          ? { ...m, isStreaming: false, citedIndices: cited }
          : m
      ))
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        // User pressed Stop — preserve what was generated, just stop the cursor
        setMessages(prev => prev.map(m =>
          m.id === assistantId ? { ...m, isStreaming: false } : m
        ))
      } else {
        // Genuine error — show banner and remove the incomplete assistant bubble
        const msg = err instanceof Error ? err.message : "Unknown error"
        setError(msg)
        setMessages(prev => prev.filter(m => m.id !== assistantId))
      }
    } finally {
      setIsStreaming(false)
      streamingId.current = null
    }
  }

  // Enter sends; Shift+Enter adds a newline (standard chat convention)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  return (
    <div
      style={{
        width: isOpen ? 300 : 0,
        opacity: isOpen ? 1 : 0,
        visibility: isOpen ? "visible" : "hidden",
      }}
      className="flex flex-col h-full bg-black/20 backdrop-blur-3xl border-l border-border shrink-0 overflow-hidden relative z-50 transition-all duration-200 ease-in-out"
    >
      <div className="w-[300px] flex flex-col h-full">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex h-10 items-center justify-between border-b border-border bg-card/5 px-3 py-1.5 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center h-5 w-5 bg-primary/10 rounded-sm">
              <MessageSquare className="h-3.5 w-3.5 text-primary" />
            </div>
            <h3 className="font-mono text-xs font-bold uppercase tracking-tight text-foreground/80 select-none">
              Ask your canvas
            </h3>
            {blocks.length > 0 && (
              <span className="font-mono text-[9px] bg-white/10 text-foreground/40 px-1.5 py-0.5 rounded-sm tabular-nums">
                {blocks.length} notes
              </span>
            )}
          </div>
          <button
            onClick={onClose}
            className="p-1 px-1.5 hover:bg-white/5 rounded-sm transition-colors text-muted-foreground/30 hover:text-white"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* ── Message list ────────────────────────────────────────────────── */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto custom-scrollbar py-3 px-3 space-y-4"
        >
          {/* Empty state — shown before the first message */}
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-32 gap-3 opacity-25">
              <MessageSquare className="h-5 w-5" />
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-center leading-relaxed">
                Ask anything about<br />your canvas notes
              </p>
            </div>
          )}

          {/* Prompt to add notes if canvas is empty */}
          {blocks.length === 0 && messages.length === 0 && (
            <p className="font-mono text-[9px] text-center text-muted-foreground/30 uppercase tracking-widest mt-2">
              Add some notes first
            </p>
          )}

          {messages.map(msg => (
            <div key={msg.id} className={`flex flex-col gap-1.5 ${msg.role === "user" ? "items-end" : "items-start"}`}>
              {/* Role label */}
              <span className="font-mono text-[8px] uppercase tracking-widest text-muted-foreground/30 px-1">
                {msg.role === "user" ? "you" : "canvas"}
              </span>

              {/* Message bubble */}
              <div
                className={`rounded-sm px-2.5 py-2 text-sm leading-relaxed max-w-[90%] ${
                  msg.role === "user"
                    ? "bg-primary/20 text-foreground ml-4"
                    : "bg-white/5 border border-white/8 text-foreground/85"
                }`}
              >
                {msg.role === "assistant" ? (
                  <>
                    <div className="prose prose-invert prose-sm max-w-none text-[13px] leading-relaxed">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={MdComponents as any}>
                        {msg.content || (msg.isStreaming ? " " : "")}
                      </ReactMarkdown>
                    </div>
                    {/* Blinking cursor shown while the stream is active */}
                    {msg.isStreaming && (
                      <span className="inline-block w-1.5 h-3.5 bg-primary/70 ml-0.5 align-middle animate-pulse" />
                    )}
                  </>
                ) : (
                  <p>{msg.content}</p>
                )}
              </div>

              {/* Citation pills — one per cited block, shown after streaming ends */}
              {msg.role === "assistant" && !msg.isStreaming && (msg.citedIndices?.length ?? 0) > 0 && (
                <div className="flex flex-wrap gap-1 px-1">
                  {msg.citedIndices!.map(idx => {
                    const block = blocks[idx]
                    if (!block) return null
                    return (
                      <button
                        key={idx}
                        onClick={() => onHighlight(block.id)}
                        className="font-mono text-[8px] uppercase tracking-wide px-1.5 py-0.5 rounded-sm bg-white/8 border border-white/10 text-muted-foreground/50 hover:text-foreground/80 hover:bg-white/12 transition-colors"
                        title={block.text.slice(0, 80)}
                      >
                        Note {idx + 1}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          ))}

          {/* Error banner — shown when the API call fails */}
          {error && (
            <div className="rounded-sm bg-red-500/10 border border-red-500/20 px-2.5 py-2 text-[11px] text-red-400/80 font-mono">
              {error}
            </div>
          )}
        </div>

        {/* ── Input area ──────────────────────────────────────────────────── */}
        <div className="border-t border-border bg-card/5 p-2 shrink-0">
          <div className="flex items-end gap-2">
            {/* Auto-resizing textarea — grows up to 100px then scrolls */}
            <textarea
              ref={inputRef}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your notes..."
              rows={1}
              className="flex-1 resize-none rounded-sm bg-white/5 border border-white/10 px-2.5 py-2 text-[13px] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary/40 focus:bg-white/8 transition-colors min-h-[36px] max-h-[100px] custom-scrollbar font-sans"
              style={{ height: "auto" }}
              onInput={e => {
                const t = e.target as HTMLTextAreaElement
                t.style.height = "auto"
                t.style.height = `${Math.min(t.scrollHeight, 100)}px`
              }}
            />
            {/* Stop button during streaming; Send button otherwise */}
            {isStreaming ? (
              <button
                onClick={stopStream}
                className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-sm bg-red-500/20 border border-red-500/30 text-red-400/80 hover:bg-red-500/30 transition-colors"
                title="Stop"
              >
                <Square className="h-3 w-3" />
              </button>
            ) : (
              <button
                onClick={sendMessage}
                disabled={!input.trim() || blocks.length === 0}
                className="flex-shrink-0 flex items-center justify-center w-8 h-8 rounded-sm bg-primary/20 border border-primary/30 text-primary/80 hover:bg-primary/30 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                title="Send (Enter)"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <p className="font-mono text-[8px] text-muted-foreground/20 mt-1.5 px-0.5 uppercase tracking-widest">
            Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>
    </div>
  )
}
