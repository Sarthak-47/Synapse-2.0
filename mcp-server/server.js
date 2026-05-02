#!/usr/bin/env node
/**
 * Synapse MCP Server
 *
 * Exposes a Synapse canvas (.synapse file) to any MCP-compatible AI client
 * (Claude Desktop, Cursor, etc.) via four tools:
 *
 *   get_canvas_summary  - overview of note counts, categories, and themes
 *   list_notes          - list all notes with type, category, and text
 *   search_notes        - full-text search across note content
 *   add_note            - append a new note to the canvas file
 *
 * Usage:
 *   node server.js --file /path/to/project.synapse
 *
 * Claude Desktop config (~/.config/claude/claude_desktop_config.json):
 *   {
 *     "mcpServers": {
 *       "synapse": {
 *         "command": "node",
 *         "args": ["/path/to/synapse/mcp-server/server.js", "--file", "/path/to/project.synapse"]
 *       }
 *     }
 *   }
 */

import { Server }               from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import * as fs   from "node:fs"
import * as path from "node:path"

// ── CLI arg parsing ───────────────────────────────────────────────────────────

const args     = process.argv.slice(2)
const fileIdx  = args.indexOf("--file")
const filePath = fileIdx !== -1 ? path.resolve(args[fileIdx + 1]) : null

if (!filePath) {
  process.stderr.write("Error: --file <path> argument is required\n")
  process.exit(1)
}

// ── .synapse file helpers ─────────────────────────────────────────────────────

function loadCanvas() {
  const raw  = fs.readFileSync(filePath, "utf-8")
  const data = JSON.parse(raw)
  if (!data?.project?.blocks) throw new Error("Invalid .synapse file")
  return data
}

function saveCanvas(data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8")
}

function makeId() {
  return Math.random().toString(36).substring(2, 10)
}

// ── Tool definitions ──────────────────────────────────────────────────────────

const TOOLS = [
  {
    name: "get_canvas_summary",
    description:
      "Returns a high-level summary of the Synapse canvas: project name, total note count, breakdown by content type and by AI-assigned category, and the most recently added notes.",
    inputSchema: {
      type: "object",
      properties: {},
      required: [],
    },
  },
  {
    name: "list_notes",
    description:
      "Lists all notes in the canvas. Each note includes its ID, content type (claim, idea, question, etc.), AI-assigned category, the note text, and the AI annotation if present.",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description:
            "Optional filter by content type. One of: claim, idea, question, task, entity, reference, quote, definition, opinion, reflection, narrative, comparison, thesis, general",
        },
        category: {
          type: "string",
          description: "Optional filter by AI-assigned category (case-insensitive substring match)",
        },
      },
      required: [],
    },
  },
  {
    name: "search_notes",
    description:
      "Full-text search across note content, annotations, and categories. Returns matching notes ranked by relevance.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search query string",
        },
      },
      required: ["query"],
    },
  },
  {
    name: "add_note",
    description:
      "Appends a new note to the Synapse canvas file. The note will appear in the canvas on next load. Provide the note text; content type defaults to 'general' if omitted.",
    inputSchema: {
      type: "object",
      properties: {
        text: {
          type: "string",
          description: "The note text to add",
        },
        contentType: {
          type: "string",
          description:
            "Content type. One of: claim, idea, question, task, entity, reference, quote, definition, opinion, reflection, narrative, comparison, general. Defaults to 'general'.",
        },
      },
      required: ["text"],
    },
  },
]

// ── Tool handlers ─────────────────────────────────────────────────────────────

function handleGetCanvasSummary() {
  const data    = loadCanvas()
  const project = data.project
  const blocks  = project.blocks ?? []

  const byType     = {}
  const byCategory = {}

  for (const b of blocks) {
    const t = b.contentType || "general"
    byType[t] = (byType[t] || 0) + 1

    const cat = b.category?.trim()
    if (cat) byCategory[cat] = (byCategory[cat] || 0) + 1
  }

  const recent = blocks
    .slice()
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 5)
    .map(b => `- [${b.contentType}] ${b.text.slice(0, 100)}${b.text.length > 100 ? "..." : ""}`)
    .join("\n")

  const typeLines = Object.entries(byType)
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `  ${t}: ${n}`)
    .join("\n")

  const categoryLines = Object.entries(byCategory)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([c, n]) => `  ${c}: ${n}`)
    .join("\n")

  const ghostNotes = (project.ghostNotes ?? []).filter(g => g.text && !g.isGenerating)

  let summary = `Project: ${project.name}\nTotal notes: ${blocks.length}\n`
  summary += `\nNotes by type:\n${typeLines || "  (none)"}`
  summary += `\nTop categories:\n${categoryLines || "  (none)"}`
  if (ghostNotes.length > 0) {
    summary += `\n\nSynthesis insights (ghost notes):\n`
    summary += ghostNotes.map(g => `- [${g.category}] ${g.text}`).join("\n")
  }
  summary += `\n\nMost recent notes:\n${recent || "  (none)"}`

  return summary
}

function handleListNotes({ type, category } = {}) {
  const data   = loadCanvas()
  const blocks = data.project.blocks ?? []

  let filtered = blocks
  if (type)     filtered = filtered.filter(b => b.contentType === type)
  if (category) filtered = filtered.filter(b =>
    b.category?.toLowerCase().includes(category.toLowerCase())
  )

  if (filtered.length === 0) return "No notes match the given filters."

  return filtered.map((b, i) => {
    const lines = [
      `[${i + 1}] ID: ${b.id}`,
      `    Type: ${b.contentType}${b.category ? ` | Category: ${b.category}` : ""}`,
      `    Text: ${b.text}`,
    ]
    if (b.annotation) lines.push(`    Annotation: ${b.annotation.slice(0, 150)}${b.annotation.length > 150 ? "..." : ""}`)
    if (b.confidence != null) lines.push(`    Confidence: ${b.confidence}%`)
    if (b.isPinned) lines.push(`    Pinned: yes`)
    return lines.join("\n")
  }).join("\n\n")
}

function handleSearchNotes({ query }) {
  if (!query?.trim()) return "Query cannot be empty."

  const data   = loadCanvas()
  const blocks = data.project.blocks ?? []
  const q      = query.toLowerCase()

  const scored = blocks
    .map(b => {
      let score = 0
      if (b.text.toLowerCase().includes(q))       score += 3
      if (b.annotation?.toLowerCase().includes(q)) score += 2
      if (b.category?.toLowerCase().includes(q))   score += 1
      return { b, score }
    })
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10)

  if (scored.length === 0) return `No notes found matching "${query}".`

  return `Found ${scored.length} note${scored.length !== 1 ? "s" : ""} matching "${query}":\n\n` +
    scored.map(({ b }, i) => {
      const lines = [
        `[${i + 1}] ID: ${b.id} | Type: ${b.contentType}${b.category ? ` | Category: ${b.category}` : ""}`,
        `    ${b.text}`,
      ]
      if (b.annotation) lines.push(`    Annotation: ${b.annotation.slice(0, 120)}${b.annotation.length > 120 ? "..." : ""}`)
      return lines.join("\n")
    }).join("\n\n")
}

function handleAddNote({ text, contentType = "general" }) {
  if (!text?.trim()) return "Error: note text cannot be empty."

  const VALID_TYPES = new Set([
    "claim","idea","question","task","entity","reference",
    "quote","definition","opinion","reflection","narrative",
    "comparison","thesis","general",
  ])
  const resolvedType = VALID_TYPES.has(contentType) ? contentType : "general"

  const data  = loadCanvas()
  const block = {
    id:          makeId(),
    text:        text.trim(),
    timestamp:   Date.now(),
    contentType: resolvedType,
  }

  data.project.blocks.push(block)
  data.exportedAt = Date.now()
  saveCanvas(data)

  return `Note added successfully (ID: ${block.id}).\nType: ${resolvedType}\nText: ${block.text}`
}

// ── Server setup ──────────────────────────────────────────────────────────────

const server = new Server(
  { name: "synapse", version: "1.0.0" },
  { capabilities: { tools: {} } },
)

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }))

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args = {} } = request.params

  try {
    let result
    switch (name) {
      case "get_canvas_summary": result = handleGetCanvasSummary();        break
      case "list_notes":         result = handleListNotes(args);            break
      case "search_notes":       result = handleSearchNotes(args);          break
      case "add_note":           result = handleAddNote(args);              break
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        }
    }

    return { content: [{ type: "text", text: result }] }
  } catch (err) {
    return {
      content: [{ type: "text", text: `Error: ${err.message}` }],
      isError: true,
    }
  }
})

// ── Start ─────────────────────────────────────────────────────────────────────

async function main() {
  // Verify the file exists before starting
  if (!fs.existsSync(filePath)) {
    process.stderr.write(`Error: file not found: ${filePath}\n`)
    process.exit(1)
  }

  const transport = new StdioServerTransport()
  await server.connect(transport)
  process.stderr.write(`Synapse MCP server running — canvas: ${filePath}\n`)
}

main().catch(err => {
  process.stderr.write(`Fatal: ${err.message}\n`)
  process.exit(1)
})
