import { NextRequest, NextResponse } from "next/server"

function extractVideoId(url: string): string | null {
  const patterns = [
    /[?&]v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/shorts\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ]
  for (const p of patterns) {
    const m = url.match(p)
    if (m) return m[1]
  }
  return null
}

// Decode HTML entities in caption text
function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
}

async function fetchTranscript(videoId: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)

  let html: string
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      signal: controller.signal,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Accept:
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    })
    if (!res.ok) throw new Error(`YouTube returned ${res.status}`)
    html = await res.text()
  } finally {
    clearTimeout(timer)
  }

  // ytInitialPlayerResponse is a large JSON blob assigned as a variable on the page
  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{.+?\})\s*;?\s*(?:var |const |let |if |<\/script>)/)
  if (!match) throw new Error("Could not parse YouTube page — try again in a moment.")

  let playerResponse: Record<string, unknown>
  try {
    playerResponse = JSON.parse(match[1])
  } catch {
    throw new Error("Could not parse YouTube page — try again in a moment.")
  }

  const trackList = (playerResponse as any)
    ?.captions
    ?.playerCaptionsTracklistRenderer
    ?.captionTracks as Array<{ languageCode: string; kind?: string; baseUrl: string }> | undefined

  if (!trackList || trackList.length === 0) {
    throw new Error("This video has no captions or transcripts available.")
  }

  // Prefer: English manual → English auto-generated → any first track
  const track =
    trackList.find(t => t.languageCode === "en" && t.kind !== "asr") ||
    trackList.find(t => t.languageCode === "en") ||
    trackList[0]

  const captionRes = await fetch(`${track.baseUrl}&fmt=json3`)
  if (!captionRes.ok) throw new Error("Failed to download caption data.")

  const captionData = await captionRes.json() as {
    events?: Array<{ segs?: Array<{ utf8?: string }> }>
  }

  const text = (captionData.events ?? [])
    .filter(e => e.segs)
    .flatMap(e => e.segs!.map(s => s.utf8 ?? ""))
    .join("")
    .replace(/\n/g, " ")
    .split(/\s+/)
    .map(decodeEntities)
    .join(" ")
    .replace(/\[Music\]/gi, "")
    .replace(/\[Applause\]/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim()

  return text
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()
    const videoId = extractVideoId(String(url ?? ""))

    if (!videoId) {
      return NextResponse.json(
        { error: "Could not find a YouTube video ID in this URL." },
        { status: 400 }
      )
    }

    const text = await fetchTranscript(videoId)

    if (!text) {
      return NextResponse.json(
        { error: "No transcript content found. The video may have empty captions." },
        { status: 400 }
      )
    }

    return NextResponse.json({ text, videoId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Failed to fetch transcript."
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
