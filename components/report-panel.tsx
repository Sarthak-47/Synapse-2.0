"use client"

/**
 * report-panel.tsx — AI Research Report Panel
 *
 * A 360 px sliding side panel that generates a structured prose research report
 * from all canvas notes. The report streams live from the generateReport()
 * async generator in lib/ai-report.ts and is rendered as markdown.
 *
 * Features:
 *   - Generate / Regenerate button triggers a fresh report generation.
 *   - Stop button (shown during generation) aborts the stream cleanly via
 *     AbortController, preserving whatever has been generated so far.
 *   - Download saves the current report as a named .md file.
 *   - Copy puts the markdown text on the clipboard with a 2-second "Copied"
 *     confirmation state.
 *   - A blinking cursor is shown at the end of the report while streaming.
 *   - The panel auto-scrolls to the bottom as new content arrives.
 *   - The panel slides in via CSS width/opacity transition — same pattern used
 *     by ChatPanel and GhostPanel.
 */

import * as React from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ClipboardCopy, Download, FileText, RefreshCw, Square, X } from "lucide-react"
import { generateReport } from "@/lib/ai-report"
import { downloadMarkdown, copyToClipboard } from "@/lib/export"
import type { TextBlock } from "@/components/tile-card"

// ── Markdown render components ────────────────────────────────────────────────
// Each element is styled to match the panel's dark theme. The report uses
// h2 headings for sections, blockquotes for direct quotes from the notes, and
// horizontal rules to separate major sections.

const MdComponents = {
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="text-base font-bold text-foreground mt-4 mb-2 first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="text-sm font-bold text-foreground/90 mt-4 mb-1.5 border-b border-white/8 pb-1">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="text-[13px] font-semibold text-foreground/80 mt-3 mb-1">{children}</h3>
  ),
  p: ({ children }: { children?: React.ReactNode }) => (
    <p className="text-[13px] leading-relaxed text-foreground/75 mb-2">{children}</p>
  ),
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-bold text-foreground/90">{children}</strong>
  ),
  em: ({ children }: { children?: React.ReactNode }) => (
    <em className="italic text-foreground/70">{children}</em>
  ),
  // blockquote is used for direct quotes lifted from the notes
  blockquote: ({ children }: { children?: React.ReactNode }) => (
    <blockquote className="border-l-2 border-primary/40 pl-3 my-2 text-foreground/60 italic text-[12px]">
      {children}
    </blockquote>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="list-disc pl-4 mb-2 space-y-0.5">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="list-decimal pl-4 mb-2 space-y-0.5">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => (
    <li className="text-[13px] leading-relaxed text-foreground/75">{children}</li>
  ),
  hr: () => <hr className="border-white/8 my-3" />,
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded-sm bg-white/10 px-1 py-0.5 font-mono text-[11px] text-foreground/80">{children}</code>
  ),
}

// ── Component ─────────────────────────────────────────────────────────────────

interface ReportPanelProps {
  projectName: string   // used as the report title and in the download filename
  blocks: TextBlock[]
  isOpen: boolean
  onClose: () => void
}

export function ReportPanel({ projectName, blocks, isOpen, onClose }: ReportPanelProps) {
  const [report, setReport]             = React.useState("")
  const [isGenerating, setIsGenerating] = React.useState(false)
  // isDone distinguishes "generation finished" from "never started" so the
  // Download and Copy buttons only appear when there is a complete (or partial) report.
  const [isDone, setIsDone]             = React.useState(false)
  const [error, setError]               = React.useState<string | null>(null)
  // copied drives the 2-second "Copied" feedback on the clipboard button
  const [copied, setCopied]             = React.useState(false)

  const abortRef  = React.useRef<AbortController | null>(null)
  const scrollRef = React.useRef<HTMLDivElement>(null)

  // Auto-scroll to the bottom while the report is being generated
  React.useEffect(() => {
    if (isGenerating && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [report, isGenerating])

  // Abort any in-flight generation when the panel is closed
  React.useEffect(() => {
    if (!isOpen) abortRef.current?.abort()
  }, [isOpen])

  /**
   * Starts (or restarts) report generation.
   * Resets all previous state, creates a new AbortController, then iterates
   * the generateReport() async generator, appending each chunk to `acc` and
   * pushing it into React state for live rendering.
   */
  const startGeneration = async () => {
    if (isGenerating || blocks.length === 0) return
    setReport("")
    setError(null)
    setIsDone(false)
    setIsGenerating(true)

    const ctrl = new AbortController()
    abortRef.current = ctrl

    let acc = ""
    try {
      for await (const chunk of generateReport(projectName, blocks, ctrl.signal)) {
        acc += chunk
        setReport(acc)  // update state on every chunk for live preview
      }
      setIsDone(true)
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        // User pressed Stop — mark done if there is any content, so
        // Download and Copy remain available for the partial report.
        setIsDone(acc.length > 0)
      } else {
        setError(err instanceof Error ? err.message : "Unknown error")
      }
    } finally {
      setIsGenerating(false)
    }
  }

  /** Aborts the current generation stream. */
  const stopGeneration = () => {
    abortRef.current?.abort()
  }

  /** Downloads the current report as "<project-name>-report.md". */
  const handleDownload = () => {
    const filename = `${projectName.toLowerCase().replace(/\s+/g, "-")}-report.md`
    downloadMarkdown(filename, report)
  }

  /** Copies markdown to clipboard and shows a brief "Copied" confirmation. */
  const handleCopy = async () => {
    const ok = await copyToClipboard(report)
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  return (
    <div
      style={{
        width: isOpen ? 360 : 0,
        opacity: isOpen ? 1 : 0,
        visibility: isOpen ? "visible" : "hidden",
      }}
      className="flex flex-col h-full bg-black/20 backdrop-blur-3xl border-l border-border shrink-0 overflow-hidden relative z-50 transition-all duration-200 ease-in-out"
    >
      <div className="w-[360px] flex flex-col h-full">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="flex h-10 items-center justify-between border-b border-border bg-card/5 px-3 py-1.5 shrink-0">
          <div className="flex items-center gap-2">
            <div className="flex items-center justify-center h-5 w-5 bg-primary/10 rounded-sm">
              <FileText className="h-3.5 w-3.5 text-primary" />
            </div>
            <h3 className="font-mono text-xs font-bold uppercase tracking-tight text-foreground/80 select-none">
              Research Report
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

        {/* ── Toolbar: Generate / Stop / Download / Copy ───────────────── */}
        <div className="flex items-center gap-1.5 px-3 py-2 border-b border-border/50 bg-card/3 shrink-0">
          {isGenerating ? (
            // Show Stop button while stream is active
            <button
              onClick={stopGeneration}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-red-500/15 border border-red-500/25 text-red-400/80 hover:bg-red-500/25 transition-colors font-mono text-[10px] uppercase tracking-wide"
            >
              <Square className="h-2.5 w-2.5" />
              Stop
            </button>
          ) : (
            // Show Generate (first time) or Regenerate (if a report exists)
            <button
              onClick={startGeneration}
              disabled={blocks.length === 0}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-primary/15 border border-primary/25 text-primary/80 hover:bg-primary/25 transition-colors font-mono text-[10px] uppercase tracking-wide disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <RefreshCw className="h-2.5 w-2.5" />
              {report ? "Regenerate" : "Generate"}
            </button>
          )}

          {/* Download and Copy are only shown once generation is done */}
          {isDone && report && (
            <>
              <button
                onClick={handleDownload}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-white/8 border border-white/10 text-foreground/50 hover:text-foreground/80 hover:bg-white/12 transition-colors font-mono text-[10px] uppercase tracking-wide"
              >
                <Download className="h-2.5 w-2.5" />
                Download
              </button>
              <button
                onClick={handleCopy}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded-sm bg-white/8 border border-white/10 text-foreground/50 hover:text-foreground/80 hover:bg-white/12 transition-colors font-mono text-[10px] uppercase tracking-wide"
              >
                <ClipboardCopy className="h-2.5 w-2.5" />
                {copied ? "Copied" : "Copy"}
              </button>
            </>
          )}
        </div>

        {/* ── Report body ─────────────────────────────────────────────────── */}
        <div ref={scrollRef} className="flex-1 overflow-y-auto custom-scrollbar px-4 py-3">

          {/* Empty state — before generation has started */}
          {!report && !isGenerating && !error && (
            <div className="flex flex-col items-center justify-center h-40 gap-3 opacity-25">
              <FileText className="h-6 w-6" />
              <p className="font-mono text-[9px] uppercase tracking-[0.2em] text-center leading-relaxed">
                {blocks.length === 0
                  ? "Add notes to your canvas first"
                  : "Click generate to create\na research report"}
              </p>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div className="rounded-sm bg-red-500/10 border border-red-500/20 px-2.5 py-2 text-[11px] text-red-400/80 font-mono mt-2">
              {error}
            </div>
          )}

          {/* Streaming markdown preview — updates on every chunk */}
          {report && (
            <div className="prose prose-invert prose-sm max-w-none">
              <ReactMarkdown remarkPlugins={[remarkGfm]} components={MdComponents as any}>
                {report}
              </ReactMarkdown>
              {/* Blinking cursor at the end while streaming */}
              {isGenerating && (
                <span className="inline-block w-1.5 h-3.5 bg-primary/70 ml-0.5 align-middle animate-pulse" />
              )}
            </div>
          )}
        </div>

        {/* ── Footer hint ─────────────────────────────────────────────────── */}
        <div className="border-t border-border/40 px-3 py-1.5 shrink-0">
          <p className="font-mono text-[8px] text-muted-foreground/20 uppercase tracking-widest">
            AI synthesises your notes into prose
          </p>
        </div>
      </div>
    </div>
  )
}
