"use client"

/**
 * file-import-panel.tsx — Study Material Import Panel
 *
 * Full-screen overlay modal that lets students drop a PDF, DOCX, or TXT file
 * onto the canvas. After extraction it shows a numbered, checkbox-driven
 * preview of every chunk so the user can deselect anything irrelevant before
 * adding the notes to their canvas.
 *
 * Flow:
 *   1. Idle   — drag-drop zone + browse button
 *   2. Extract — spinner while pdfjs / mammoth runs
 *   3. Review  — list of chunks with checkboxes, select-all / none toggle
 *   4. Done    — calls onAddChunks() with selected text, panel closes
 */

import * as React from "react"
import {
  FileText, Upload, X, CheckSquare, Square,
  AlertCircle, Loader2, FileUp,
} from "lucide-react"
import { extractAndChunk, ACCEPTED_TYPES } from "@/lib/file-extract"

// ── Types ─────────────────────────────────────────────────────────────────────

interface FileImportPanelProps {
  isOpen: boolean
  onClose: () => void
  /** Called with the final list of selected text chunks to add as notes. */
  onAddChunks: (chunks: string[]) => void
}

type Status = "idle" | "extracting" | "review" | "error"

// ── Component ─────────────────────────────────────────────────────────────────

export function FileImportPanel({ isOpen, onClose, onAddChunks }: FileImportPanelProps) {
  const [status,   setStatus]   = React.useState<Status>("idle")
  const [chunks,   setChunks]   = React.useState<string[]>([])
  const [selected, setSelected] = React.useState<Set<number>>(new Set())
  const [error,    setError]    = React.useState<string | null>(null)
  const [fileName, setFileName] = React.useState<string>("")
  const [dragOver, setDragOver] = React.useState(false)

  const fileInputRef = React.useRef<HTMLInputElement>(null)

  // Reset all state whenever the panel reopens
  React.useEffect(() => {
    if (isOpen) {
      setStatus("idle")
      setChunks([])
      setSelected(new Set())
      setError(null)
      setFileName("")
      setDragOver(false)
    }
  }, [isOpen])

  // Close on Escape
  React.useEffect(() => {
    if (!isOpen) return
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [isOpen, onClose])

  // ── File processing ────────────────────────────────────────────────────────

  const processFile = async (file: File) => {
    setFileName(file.name)
    setStatus("extracting")
    setError(null)
    try {
      const extracted = await extractAndChunk(file)
      setChunks(extracted)
      // Select all chunks by default — student can deselect what they don't want
      setSelected(new Set(extracted.map((_, i) => i)))
      setStatus("review")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Extraction failed.")
      setStatus("error")
    }
  }

  // ── Drag and drop ──────────────────────────────────────────────────────────

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files[0]
    if (file) processFile(file)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(true)
  }

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processFile(file)
    e.target.value = ""
  }

  // ── Chunk selection ────────────────────────────────────────────────────────

  const toggleChunk = (idx: number) => {
    setSelected(prev => {
      const next = new Set(prev)
      if (next.has(idx)) next.delete(idx)
      else next.add(idx)
      return next
    })
  }

  const selectAll  = () => setSelected(new Set(chunks.map((_, i) => i)))
  const selectNone = () => setSelected(new Set())

  // ── Add to canvas ──────────────────────────────────────────────────────────

  const handleAdd = () => {
    const toAdd = chunks.filter((_, i) => selected.has(i))
    if (toAdd.length === 0) return
    onAddChunks(toAdd)
    onClose()
  }

  if (!isOpen) return null

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      {/* Modal */}
      <div className="relative flex flex-col bg-[#0c0c0e] border border-white/10 rounded-sm shadow-[0_32px_80px_rgba(0,0,0,0.7)] w-full max-w-2xl max-h-[85vh] overflow-hidden">

        {/* ── Header ──────────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-white/8 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center h-6 w-6 rounded-sm bg-primary/10">
              <FileUp className="h-3.5 w-3.5 text-primary" />
            </div>
            <h2 className="font-mono text-xs font-bold uppercase tracking-widest text-foreground/80">
              Import Study Material
            </h2>
            {status === "review" && (
              <span className="font-mono text-[9px] bg-white/8 text-foreground/40 px-1.5 py-0.5 rounded-sm">
                {chunks.length} chunks · {fileName}
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

        {/* ── Body ────────────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto custom-scrollbar">

          {/* ── Idle: drop zone ─────────────────────────────────────────── */}
          {status === "idle" && (
            <div className="p-6 flex flex-col items-center gap-4">
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={() => setDragOver(false)}
                onClick={() => fileInputRef.current?.click()}
                className={`w-full border-2 border-dashed rounded-sm flex flex-col items-center justify-center gap-4 py-14 cursor-pointer transition-all duration-150 select-none ${
                  dragOver
                    ? "border-primary/60 bg-primary/5"
                    : "border-white/10 hover:border-white/20 hover:bg-white/[0.02]"
                }`}
              >
                <div className={`flex items-center justify-center h-12 w-12 rounded-sm transition-colors ${dragOver ? "bg-primary/15" : "bg-white/5"}`}>
                  <Upload className={`h-5 w-5 transition-colors ${dragOver ? "text-primary" : "text-foreground/40"}`} />
                </div>
                <div className="text-center">
                  <p className="font-mono text-xs text-foreground/60 uppercase tracking-widest">
                    Drop your file here
                  </p>
                  <p className="font-mono text-[10px] text-muted-foreground/30 uppercase tracking-widest mt-1.5">
                    or click to browse
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  {[".pdf", ".docx", ".txt"].map(ext => (
                    <span
                      key={ext}
                      className="font-mono text-[9px] uppercase tracking-widest px-2 py-0.5 rounded-sm bg-white/6 border border-white/8 text-foreground/35"
                    >
                      {ext}
                    </span>
                  ))}
                </div>
              </div>

              <p className="font-mono text-[9px] text-muted-foreground/25 uppercase tracking-widest text-center leading-relaxed">
                Text is extracted entirely in your browser — nothing is uploaded to any server
              </p>

              <input
                ref={fileInputRef}
                type="file"
                accept={ACCEPTED_TYPES}
                className="hidden"
                onChange={handleFileInput}
              />
            </div>
          )}

          {/* ── Extracting: spinner ──────────────────────────────────────── */}
          {status === "extracting" && (
            <div className="flex flex-col items-center justify-center gap-4 py-20">
              <Loader2 className="h-6 w-6 text-primary/60 animate-spin" />
              <div className="text-center">
                <p className="font-mono text-xs text-foreground/60 uppercase tracking-widest">
                  Extracting text
                </p>
                <p className="font-mono text-[10px] text-muted-foreground/30 mt-1 max-w-[240px] text-center truncate">
                  {fileName}
                </p>
              </div>
            </div>
          )}

          {/* ── Error ────────────────────────────────────────────────────── */}
          {status === "error" && (
            <div className="p-6 flex flex-col items-center gap-4">
              <div className="flex flex-col items-center gap-3 py-8">
                <AlertCircle className="h-6 w-6 text-red-400/70" />
                <p className="font-mono text-[11px] text-red-400/70 text-center max-w-sm leading-relaxed">
                  {error}
                </p>
              </div>
              <button
                onClick={() => setStatus("idle")}
                className="font-mono text-[10px] uppercase tracking-widest text-foreground/40 hover:text-foreground/70 transition-colors border border-white/10 px-3 py-1.5 rounded-sm hover:bg-white/5"
              >
                Try another file
              </button>
            </div>
          )}

          {/* ── Review: chunk list ───────────────────────────────────────── */}
          {status === "review" && (
            <div className="flex flex-col">
              {/* Toolbar */}
              <div className="flex items-center justify-between px-5 py-2.5 border-b border-white/6 bg-white/[0.01] shrink-0">
                <div className="flex items-center gap-3">
                  <button
                    onClick={selectAll}
                    className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-foreground/40 hover:text-foreground/70 transition-colors"
                  >
                    <CheckSquare className="h-3 w-3" />
                    All
                  </button>
                  <span className="text-white/10">·</span>
                  <button
                    onClick={selectNone}
                    className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-widest text-foreground/40 hover:text-foreground/70 transition-colors"
                  >
                    <Square className="h-3 w-3" />
                    None
                  </button>
                </div>
                <span className="font-mono text-[9px] text-muted-foreground/30 uppercase tracking-widest">
                  {selected.size} of {chunks.length} selected
                </span>
              </div>

              {/* Chunks */}
              <div className="divide-y divide-white/[0.04]">
                {chunks.map((chunk, idx) => {
                  const isSelected = selected.has(idx)
                  return (
                    <div
                      key={idx}
                      onClick={() => toggleChunk(idx)}
                      className={`flex items-start gap-3 px-5 py-3 cursor-pointer transition-colors ${
                        isSelected ? "hover:bg-white/[0.03]" : "opacity-35 hover:opacity-60"
                      }`}
                    >
                      {/* Checkbox indicator */}
                      <div className="shrink-0 mt-0.5">
                        {isSelected
                          ? <CheckSquare className="h-3.5 w-3.5 text-primary/70" />
                          : <Square     className="h-3.5 w-3.5 text-foreground/20" />
                        }
                      </div>
                      {/* Chunk number */}
                      <span className="shrink-0 font-mono text-[9px] text-muted-foreground/25 tabular-nums mt-0.5 w-5 text-right">
                        {idx + 1}
                      </span>
                      {/* Text */}
                      <p className="text-[12px] leading-relaxed text-foreground/70 flex-1">
                        {chunk}
                      </p>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>

        {/* ── Footer ──────────────────────────────────────────────────────── */}
        {status === "review" && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-white/8 bg-black/30 shrink-0">
            <p className="font-mono text-[9px] text-muted-foreground/25 uppercase tracking-widest">
              Each chunk becomes a note · AI will classify and annotate them
            </p>
            <button
              onClick={handleAdd}
              disabled={selected.size === 0}
              className="flex items-center gap-2 px-3.5 py-1.5 rounded-sm bg-primary/20 border border-primary/30 text-primary/80 hover:bg-primary/30 transition-colors font-mono text-[10px] uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed"
            >
              <FileText className="h-3 w-3" />
              Add {selected.size} note{selected.size !== 1 ? "s" : ""} to canvas
            </button>
          </div>
        )}
      </div>
    </div>
  )
}
