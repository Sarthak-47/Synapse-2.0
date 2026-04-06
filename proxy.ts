import { NextRequest, NextResponse } from "next/server"

// ── Sliding-window rate limiter ───────────────────────────────────────────────
// Guards /api/fetch-url from being hammered as a public CORS proxy.
// On serverless (Vercel) this is best-effort per-instance; on persistent
// hosts (Render) it is reliable across requests.

const store = new Map<string, number[]>()

function isRateLimited(ip: string, path: string): boolean {
  const now  = Date.now()
  const key  = `${ip}:${path}`
  const hits = (store.get(key) ?? []).filter(t => now - t < 60_000)
  if (hits.length >= 30) return true // 30 URL fetches/min per IP
  hits.push(now)
  store.set(key, hits)
  return false
}

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl

  if (!pathname.startsWith("/api/fetch-url")) {
    return NextResponse.next()
  }

  // Origin check — block requests from other origins.
  // Use strict URL parsing rather than substring matching to prevent
  // bypasses like https://evil.com?nodepad.space passing the check.
  const origin  = req.headers.get("origin")  ?? ""
  const referer = req.headers.get("referer") ?? ""
  const host    = (req.headers.get("host") ?? "").split(":")[0] // strip port

  function strictHostMatch(headerValue: string): boolean {
    try { return new URL(headerValue).hostname === host } catch { return false }
  }

  const isLocalhost  = strictHostMatch(origin || referer)
    ? ["localhost", "127.0.0.1"].includes(new URL(origin || referer).hostname)
    : (origin + referer).includes("localhost")
  const isSameOrigin = strictHostMatch(origin) || strictHostMatch(referer)

  if (origin && !isLocalhost && !isSameOrigin) {
    return new NextResponse(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    })
  }

  const ip = req.headers.get("x-forwarded-for")?.split(",")[0].trim()
           ?? req.headers.get("x-real-ip")
           ?? "unknown"

  if (isRateLimited(ip, pathname)) {
    return new NextResponse(JSON.stringify({ error: "Rate limit exceeded." }), {
      status: 429,
      headers: { "Content-Type": "application/json", "Retry-After": "60" },
    })
  }

  return NextResponse.next()
}

export const config = {
  matcher: ["/api/fetch-url"],
}
