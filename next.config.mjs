import { fileURLToPath } from "url"
import path from "path"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  turbopack: {
    root: __dirname,
  },
  images: {
    unoptimized: true,
  },
  async headers() {
    return [
      {
        // Apply security headers to every route
        source: "/(.*)",
        headers: [
          {
            // Prevent framing (clickjacking)
            key: "X-Frame-Options",
            value: "DENY",
          },
          {
            // Stop MIME-type sniffing
            key: "X-Content-Type-Options",
            value: "nosniff",
          },
          {
            // Limit referrer info sent to third-party origins
            key: "Referrer-Policy",
            value: "strict-origin-when-cross-origin",
          },
          {
            // Permissions policy — disable features the app doesn't use
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            // Content Security Policy
            // - default-src self: everything defaults to same-origin
            // - script-src: Next.js needs 'unsafe-inline' + 'unsafe-eval' in dev;
            //   nonces are the proper fix but require custom server — this is the
            //   pragmatic baseline for a static/Vercel deployment.
            // - connect-src: allow OpenRouter API calls from the browser (grounding links)
            // - img-src: data URIs for inline images, blob for canvas exports
            // - style-src unsafe-inline: Tailwind injects inline styles at runtime
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "connect-src 'self' https://openrouter.ai https://generativelanguage.googleapis.com https://api.groq.com",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "frame-ancestors 'none'",
            ].join("; "),
          },
        ],
      },
    ]
  },
}

export default nextConfig
