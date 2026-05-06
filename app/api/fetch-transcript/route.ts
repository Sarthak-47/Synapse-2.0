import { NextRequest, NextResponse } from "next/server"
import { YoutubeTranscript } from "youtube-transcript"

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

    const transcript = await YoutubeTranscript.fetchTranscript(videoId)
    const text = transcript
      .map((t: { text: string }) => t.text.trim())
      .filter(Boolean)
      .join(" ")
      // Clean up common transcript artifacts
      .replace(/\[Music\]/gi, "")
      .replace(/\[Applause\]/gi, "")
      .replace(/\s{2,}/g, " ")
      .trim()

    if (!text) {
      return NextResponse.json(
        { error: "No transcript found. The video may have captions disabled." },
        { status: 400 }
      )
    }

    return NextResponse.json({ text, videoId })
  } catch (err) {
    const raw = err instanceof Error ? err.message : ""
    let msg = "Failed to fetch transcript. Please try again."
    if (/disabled/i.test(raw))         msg = "This video has transcripts disabled. Try a video with captions turned on."
    else if (/not find/i.test(raw))    msg = "No transcript found for this video."
    else if (/could not get/i.test(raw)) msg = "Could not retrieve transcript. The video may be private or unavailable."
    else if (/invalid/i.test(raw))     msg = "Invalid YouTube URL."
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
