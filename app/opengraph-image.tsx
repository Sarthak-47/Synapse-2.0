import { ImageResponse } from "next/og"

export const runtime = "edge"
export const alt = "Synapse — spatial AI research tool"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

export default function OGImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-start",
          justifyContent: "flex-end",
          background: "#0a0a0a",
          padding: "80px 96px",
          fontFamily: "sans-serif",
        }}
      >
        {/* Logo mark — neural node */}
        <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "48px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
            <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#8b5cf6" }} />
            <div style={{ width: 28, height: 2, borderRadius: 2, background: "rgba(139,92,246,0.35)" }} />
            <div style={{ width: 16, height: 16, borderRadius: "50%", background: "rgba(139,92,246,0.65)" }} />
            <div style={{ width: 20, height: 2, borderRadius: 2, background: "rgba(139,92,246,0.25)" }} />
            <div style={{ width: 12, height: 12, borderRadius: "50%", background: "rgba(139,92,246,0.40)" }} />
          </div>
          <span style={{ fontSize: 28, fontWeight: 700, color: "#f0f0f0", letterSpacing: "-0.5px" }}>
            Synapse
          </span>
        </div>

        {/* Headline */}
        <div
          style={{
            fontSize: 72,
            fontWeight: 700,
            color: "#f0f0f0",
            lineHeight: 1.05,
            letterSpacing: "-2px",
            marginBottom: 32,
          }}
        >
          Think spatially.
          <br />
          <span style={{ color: "#8b5cf6" }}>Let AI fill the gaps.</span>
        </div>

        {/* Subline */}
        <div style={{ fontSize: 24, color: "#666", fontWeight: 400, letterSpacing: "-0.3px" }}>
          synapse-sarthak-47.vercel.app
        </div>
      </div>
    ),
    { ...size },
  )
}
