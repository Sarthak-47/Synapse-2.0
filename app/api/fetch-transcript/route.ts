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

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
}

type CaptionTrack = { languageCode: string; kind?: string; baseUrl: string }
type CaptionJson  = { events?: Array<{ segs?: Array<{ utf8?: string }> }> }

function buildText(captionData: CaptionJson): string {
  return (captionData.events ?? [])
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
}

function pickTrack(tracks: CaptionTrack[]): CaptionTrack {
  return (
    tracks.find(t => t.languageCode === "en" && t.kind !== "asr") ||
    tracks.find(t => t.languageCode === "en") ||
    tracks[0]
  )
}

async function fetchCaptions(baseUrl: string): Promise<string> {
  const res = await fetch(`${baseUrl}&fmt=json3`)
  if (!res.ok) throw new Error("Failed to download caption data.")
  return buildText(await res.json() as CaptionJson)
}

// Primary: YouTube InnerTube API — returns player JSON directly, no HTML parsing needed
async function viaInnerTube(videoId: string): Promise<string> {
  const res = await fetch("https://www.youtube.com/youtubei/v1/player?prettyPrint=false", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
      "X-YouTube-Client-Name": "1",
      "X-YouTube-Client-Version": "2.20240101.00.00",
      "Origin": "https://www.youtube.com",
      "Referer": "https://www.youtube.com/",
    },
    body: JSON.stringify({
      context: {
        client: {
          clientName: "WEB",
          clientVersion: "2.20240101.00.00",
          hl: "en",
          gl: "US",
        },
      },
      videoId,
    }),
  })

  if (!res.ok) throw new Error(`InnerTube returned ${res.status}`)

  const player = await res.json() as Record<string, unknown>
  const tracks = (player as any)?.captions?.playerCaptionsTracklistRenderer?.captionTracks as CaptionTrack[] | undefined

  if (!tracks || tracks.length === 0) {
    throw new Error("This video has no captions or transcripts available.")
  }

  return fetchCaptions(pickTrack(tracks).baseUrl)
}

// Fallback: scrape the watch page and parse ytInitialPlayerResponse
async function viaPageScrape(videoId: string): Promise<string> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 12000)

  let html: string
  try {
    const res = await fetch(`https://www.youtube.com/watch?v=${videoId}`, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
        "Accept-Language": "en-US,en;q=0.9",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        Cookie: "CONSENT=YES+1; SOCS=CAI",
      },
    })
    if (!res.ok) throw new Error(`YouTube returned ${res.status}`)
    html = await res.text()
  } finally {
    clearTimeout(timer)
  }

  // Use dotAll flag (s) so . matches newlines across the JSON blob
  const match = html.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]+?\})\s*;?\s*(?:var |const |let |if |<\/script>)/)
  if (!match) throw new Error("Could not parse YouTube page — try again in a moment.")

  let player: Record<string, unknown>
  try { player = JSON.parse(match[1]) } catch {
    throw new Error("Could not parse YouTube page — try again in a moment.")
  }

  const tracks = (player as any)?.captions?.playerCaptionsTracklistRenderer?.captionTracks as CaptionTrack[] | undefined
  if (!tracks || tracks.length === 0) {
    throw new Error("This video has no captions or transcripts available.")
  }

  return fetchCaptions(pickTrack(tracks).baseUrl)
}

async function fetchTranscript(videoId: string): Promise<string> {
  try {
    return await viaInnerTube(videoId)
  } catch (primaryErr) {
    // InnerTube failed — try page scrape as fallback
    try {
      return await viaPageScrape(videoId)
    } catch {
      // Surface the original InnerTube error (more informative)
      throw primaryErr
    }
  }
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
