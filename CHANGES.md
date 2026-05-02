# Synapse — Development Briefing

A summary of all changes made and pushed to GitHub across 5 feature phases.

---

## Phase 1 — Graph View Overhaul

**Commit:** `ad57ffa`
**Files changed:** `components/graph-area.tsx`, `next.config.mjs`

### What was built

The existing graph view had a working force-directed layout but lacked visual identity. This phase made it the most visually distinctive part of the app.

**Category cluster hulls**
Added smooth convex hull regions drawn behind nodes grouped by content type. Each region is filled and stroked using the type's accent colour at low opacity. The hulls are computed on every simulation tick using D3's `polygonHull` with Catmull-Rom closed curves, so they animate fluidly as nodes settle. When the legend filter is active, non-selected hulls fade out.

**Clickable category legend**
Added a floating legend in the top-right of the graph canvas listing all content types present in the current project. Clicking a type filters the entire graph — nodes, edges, and hulls — to highlight only that type. Clicking again clears the filter.

**Node text labels**
Short text labels (first 26 characters of the note) now appear below each node when zoom is 0.65 or above. Label font size is inverse-scaled to stay readable as the user zooms in.

**Reset view button**
A "reset" button next to the node count fits all nodes back into the viewport by computing the bounding box of current node positions and deriving the correct scale and translate transform.

**Turbopack fix**
The dev server was failing with a Turbopack workspace-root detection error. Fixed by adding `turbopack: { root: __dirname }` to `next.config.mjs`.

---

## Phase 2 — RAG Chat ("Ask Your Canvas")

**Commit:** `b40331f`
**Files added:** `lib/ai-chat.ts`, `components/chat-panel.tsx`
**Files changed:** `app/page.tsx`, `components/vim-input.tsx`

### What was built

A streaming chat panel that answers questions about the user's canvas notes using retrieval-augmented generation.

**`lib/ai-chat.ts`**
An async generator function `askCanvas()` that:
- Builds a numbered context block from all current blocks (index, content type, category, truncated text)
- Sends it to OpenRouter with a system prompt instructing the model to answer from the notes and cite them as `[1]`, `[3]` etc.
- Streams the response chunk by chunk via the OpenRouter SSE endpoint
- Supports an `AbortSignal` for the stop button

Also exports `parseCitedIndices()` which extracts `[N]` patterns from the final response and converts them to 0-based block indices.

**`components/chat-panel.tsx`**
A 300px sliding panel (same pattern as the existing ghost panel) with:
- Streaming markdown output rendered with ReactMarkdown
- A blinking cursor during streaming
- A stop button (red square) that aborts the ongoing stream
- Citation pills at the bottom of each AI response — clicking a pill calls `onHighlight` which jumps the canvas to that note
- An auto-resizing textarea input (Enter to send, Shift+Enter for newline)

**`app/page.tsx`**
- Added `isChatPanelOpen` state
- Added `chat` command to `handleCommand`
- Added Escape key handler
- Rendered `ChatPanel` in the right-panel stack alongside `GhostPanel`

**`components/vim-input.tsx`**
Added "Ask your canvas" entry to the command palette nav items.

---

## Phase 3 — AI Research Report Generator

**Commit:** `9f54db6`
**Files added:** `lib/ai-report.ts`, `components/report-panel.tsx`
**Files changed:** `app/page.tsx`, `components/vim-input.tsx`

### What was built

One-click generation of a structured prose research report from all canvas notes, streamed live and downloadable as Markdown.

**`lib/ai-report.ts`**
An async generator `generateReport()` that:
- Groups blocks by their AI-assigned category (falls back to content type label for unenriched notes)
- Builds a structured context block per category, including content type, confidence, and annotation snippet for each note
- Sends to OpenRouter with a prompt specifying the exact report structure: Executive Summary, per-topic sections, Open Questions, Key Insights, Conclusion
- Streams the response at temperature 0.4, max 1800 tokens

**`components/report-panel.tsx`**
A 360px sliding panel with:
- Generate / Regenerate button (triggers `generateReport`)
- Stop button during generation
- Live streaming markdown preview with proper heading, blockquote, list, and code styling
- Download as `.md` button (uses existing `downloadMarkdown` from `lib/export.ts`)
- Copy to clipboard button with a 2-second "Copied" confirmation state
- An empty state with instructions when no report has been generated yet

**`app/page.tsx`**
- Added `isReportPanelOpen` state
- Added `report` command to `handleCommand`
- Added Escape key handler
- Rendered `ReportPanel` with `projectName` derived from the active project

**`components/vim-input.tsx`**
Added "Research Report" entry to the command palette nav items.

---

## Phase 4 — Contradiction & Tension Detection

**Commit:** `22ee0e8`
**Files added:** `lib/ai-contradiction.ts`
**Files changed:** `components/graph-area.tsx`, `app/page.tsx`, `components/vim-input.tsx`

### What was built

AI-powered detection of logical contradictions between notes, visualised as red dashed edges in the graph view.

**`lib/ai-contradiction.ts`**
`detectContradictions()` function that:
- Filters blocks to contradiction-prone types (claim, opinion, entity, definition, quote, comparison, thesis) and caps the sample at 22 blocks to keep prompts short
- Sends the sampled notes as a numbered list to OpenRouter with structured JSON output (strict schema) asking for contradiction pairs with a one-sentence reason each
- Returns typed `Contradiction[]` objects with `blockAId`, `blockBId`, and `reason`
- Validates index bounds before mapping back from sample indices to block IDs

**`components/graph-area.tsx`**
- Added `contradictions`, `isDetectingTensions`, and `onDetectTensions` props
- New SVG layer rendering red dashed `<line>` elements for each contradiction pair, with a midpoint red circle as a visual marker
- Each contradiction line has `onMouseEnter` / `onMouseLeave` handlers that show a dark red tooltip with the tension reason
- Contradicted nodes get a red dashed ring around them (distinct from the hub and enriching rings)
- The top-bar stat line shows tension count when contradictions exist
- A "detect tensions" / "re-detect" button in the top bar triggers detection directly from the graph view

**`app/page.tsx`**
- Added `contradictions` field to the `Project` interface
- Added `isDetectingTensions` state
- Added `runContradictionDetection` callback (async, sets state, calls `detectContradictions`, stores results on active project)
- Added `detect-tensions` and `clear-tensions` commands
- Derived `contradictions` from `activeProject` and passed it to `GraphArea`

**`components/vim-input.tsx`**
Added "Detect Tensions" entry to the command palette nav items.

---

## Phase 5 — MCP Server + README

**Commit:** `2aad7a5`
**Files added:** `mcp-server/server.js`, `mcp-server/package.json`
**Files changed:** `README.md`

### What was built

**`mcp-server/server.js`**
A standalone Node.js MCP server that exposes any exported Synapse canvas (`.synapse` file) to MCP-compatible AI clients such as Claude Desktop and Cursor.

Accepts a `--file <path>` argument pointing to a `.synapse` file. Exposes four tools:

| Tool | What it does |
|------|-------------|
| `get_canvas_summary` | Returns project name, note counts by type, top 10 categories, ghost notes, and 5 most recent notes |
| `list_notes` | Lists all notes with optional filter by `type` or `category` (substring match) |
| `search_notes` | Full-text search across note text, annotations, and categories with relevance scoring |
| `add_note` | Appends a new note to the `.synapse` file on disk with optional `contentType` |

The server communicates via stdio using the JSON-RPC protocol from `@modelcontextprotocol/sdk`. It reads the file fresh on each tool call (so changes from the app are always visible) and writes back immediately on `add_note`.

**`mcp-server/package.json`**
Minimal package with `@modelcontextprotocol/sdk` as the only dependency. Node 18+ required.

**`README.md`**
Complete rewrite of the original placeholder README covering:
- What the app does and the core philosophy
- All five feature areas with descriptions
- Setup instructions (prerequisites, clone, npm install, run)
- Full commands table with every palette command documented
- MCP setup guide with exact config JSON for Claude Desktop (macOS and Windows paths)
- Tech stack table
- Project structure tree
- Models comparison table
- Author: Sarthak Singh (Sarthak-47)

---

## Git History

```
2aad7a5  feat(mcp): add MCP server + write final README
22ee0e8  feat(graph): contradiction and tension detection
9f54db6  feat(report): add AI research report generator
b40331f  feat(chat): add RAG chat panel - Ask Your Canvas
ad57ffa  feat(graph): category cluster hulls, legend, node labels, reset view
630c61c  somewhat working prototype  (original)
```
