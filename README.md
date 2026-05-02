# Synapse

A spatial AI thinking tool. Drop notes onto a canvas, and AI classifies, connects, and synthesises them in the background. Three views — tiling canvas, kanban, and graph — for different thinking modes.

Built with Next.js 16, React 19, TypeScript, Tailwind CSS 4, D3, and OpenRouter.

---

## What it does

Synapse is designed around one idea: **AI should augment thinking, not replace it.** You add notes to a spatial canvas in whatever order they come to mind. The AI works quietly in the background to:

- Classify each note into one of 14 content types (claim, idea, question, task, entity, etc.)
- Assign an AI-generated category and annotation surfacing what you likely don't know yet
- Detect connections between notes and build a live knowledge graph
- Synthesise cross-category tensions into emergent "ghost notes"
- Detect contradictions between notes and flag them visually
- Answer questions about your canvas via a RAG chat interface
- Generate a structured research report from your notes

---

## Features

### Three Views

| View | Description |
|------|-------------|
| **Tiling** | Infinite spatial canvas — arrange notes freely, like a thinking space |
| **Kanban** | Column layout organised by AI-assigned category |
| **Graph** | Force-directed knowledge graph with category cluster regions, contradiction edges, and connection highlighting |

### AI Layer (via OpenRouter)

**Note enrichment** — every note is classified and annotated automatically after an 800ms debounce. Supports 14 content types and multi-language input.

**Ghost notes** — emergent synthesis notes generated every 5 minutes when your canvas has enough diversity. The AI finds cross-category tensions, not just summaries.

**Ask your canvas** — streaming RAG chat that answers questions grounded in your notes. Responses cite specific notes; clicking a citation highlights it on the canvas.

**Research report** — one-click AI-generated prose report: executive summary, per-topic sections, open questions, key insights, and conclusion. Streams live, downloadable as Markdown.

**Contradiction detection** — finds pairs of notes that logically contradict each other. Contradictions appear as red dashed edges in the graph view with hover explanations.

### Graph View

- Force-directed layout: high-degree nodes near centre, isolated nodes at the edge
- Category cluster hulls: smooth convex regions show which notes share a topic
- Clickable category legend: filter the graph to a single type with one click
- Red dashed edges for detected contradictions, with midpoint markers and tooltips
- Node text labels appear at normal zoom levels
- Zoom, pan, drag nodes, reset view

### Persistence

All data is stored in `localStorage` — no account, no backend, no tracking. Export and import as `.synapse` files for backup or transfer between devices.

### MCP Server

Expose any canvas to Claude Desktop or other MCP-compatible AI clients. See [MCP Setup](#mcp-server-setup) below.

---

## Getting Started

### Prerequisites

- Node.js 18+
- An OpenRouter API key ([openrouter.ai](https://openrouter.ai))

### Run locally

```bash
git clone https://github.com/Sarthak-47/Synapse.git
cd Synapse
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

On first launch, open **Settings** (bottom-right of the status bar) and enter your OpenRouter API key. Choose a model — GPT-4o is the default; Claude Sonnet gives the best annotation quality.

---

## Commands

Open the command palette with `Cmd+K` (Mac) or `Ctrl+K` (Windows/Linux).

| Command | Description |
|---------|-------------|
| `tiling` | Switch to tiling canvas view |
| `kanban` | Switch to kanban view |
| `graph` | Switch to graph view |
| `chat` | Open "Ask your canvas" RAG chat |
| `report` | Open AI research report generator |
| `detect-tensions` | Run contradiction detection across notes |
| `clear-tensions` | Clear detected contradictions |
| `open-synthesis` | Open ghost notes synthesis panel |
| `open-index` | Open note index sidebar |
| `open-projects` | Open project switcher |
| `new-project` | Create a new canvas |
| `export-md` | Export canvas as Markdown |
| `copy-md` | Copy Markdown to clipboard |
| `export-synapse` | Export as `.synapse` file |
| `import-synapse` | Import a `.synapse` file |
| `clear` | Clear all notes from canvas |

Type anything without a command prefix to add it as a new note. Prefix with `#type` to set the content type directly, e.g. `#claim The earth is 4.5 billion years old`.

---

## MCP Server Setup

The MCP server lets any MCP-compatible AI client (Claude Desktop, Cursor, etc.) read and write your Synapse canvas directly.

### Install

```bash
cd mcp-server
npm install
```

### Configure Claude Desktop

Export your canvas as a `.synapse` file from within the app (command: `export-synapse`), then add the following to your Claude Desktop config:

**macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
**Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "synapse": {
      "command": "node",
      "args": [
        "/absolute/path/to/Synapse/mcp-server/server.js",
        "--file",
        "/absolute/path/to/your-project.synapse"
      ]
    }
  }
}
```

Restart Claude Desktop. You will see Synapse tools available in Claude.

### Available tools

| Tool | Description |
|------|-------------|
| `get_canvas_summary` | Overview: note counts by type, top categories, recent notes, ghost notes |
| `list_notes` | List all notes, optionally filtered by type or category |
| `search_notes` | Full-text search across note text, annotations, and categories |
| `add_note` | Append a new note to the canvas file |

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16.1, React 19, TypeScript 5.7 |
| Styling | Tailwind CSS 4, Radix UI, shadcn/ui |
| Animation | Framer Motion |
| Graph | D3 (force simulation, convex hull, Catmull-Rom curves) |
| AI | OpenRouter (Claude Sonnet 4.5, GPT-4o, Gemini 2.5 Pro, DeepSeek V3, Mistral Small) |
| MCP | @modelcontextprotocol/sdk |
| Persistence | localStorage + `.synapse` JSON format |

---

## Project Structure

```
app/
  page.tsx              Main application (state, AI workflow, views)
  api/fetch-url/        URL metadata extraction with SSRF protection
components/
  graph-area.tsx        D3 graph with hulls, contradiction edges, legend
  tiling-area.tsx       Infinite spatial canvas
  kanban-area.tsx       Category column view
  tile-card.tsx         Individual note card
  ghost-panel.tsx       AI synthesis panel
  chat-panel.tsx        RAG chat ("Ask your canvas")
  report-panel.tsx      AI research report generator
  vim-input.tsx         Command palette
lib/
  ai-enrich.ts          Note classification and annotation via OpenRouter
  ai-ghost.ts           Cross-category synthesis (ghost notes)
  ai-chat.ts            Streaming RAG chat
  ai-report.ts          Streaming research report generation
  ai-contradiction.ts   Contradiction detection between notes
  ai-settings.ts        API key and model management
  content-types.ts      14 content type definitions
  nodepad-format.ts     .synapse file serialisation
  export.ts             Markdown export
mcp-server/
  server.js             Standalone MCP server for AI client integration
  package.json
```

---

## Models

All AI calls go through [OpenRouter](https://openrouter.ai). Switch models in Settings at any time.

| Model | Best for |
|-------|---------|
| Claude Sonnet 4.5 | Annotation quality, nuanced reasoning |
| GPT-4o | Structured output, broad knowledge |
| Gemini 2.5 Pro | Long context, web grounding |
| DeepSeek V3 | Cost-efficient bulk enrichment |
| Mistral Small 3.2 | Fast turnaround |

---

## Author

**Sarthak Singh** ([Sarthak-47](https://github.com/Sarthak-47))
