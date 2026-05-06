import type { Metadata } from 'next'
import { Space_Grotesk, Space_Mono, Vazirmatn } from 'next/font/google'
import { MobileWall } from '@/components/mobile-wall'
import './globals.css'

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  display: "swap",
})

const spaceMono = Space_Mono({
  subsets: ["latin"],
  weight: ["400", "700"],
  variable: "--font-space-mono",
  display: "swap",
})

const vazirmatn = Vazirmatn({
  subsets: ["arabic"],
  variable: "--font-vazirmatn",
  display: "swap",
});

export const metadata: Metadata = {
  title: 'Synapse',
  description: 'A spatial research tool where AI augments your thinking — not replaces it.',
  icons: {
    icon: [{ url: '/icon.svg', type: 'image/svg+xml' }],
    apple: '/apple-icon.png',
  },
  openGraph: {
    title: 'Synapse',
    description: 'A spatial research tool where AI augments your thinking — not replaces it.',
    url: 'https://synapse-sarthak-47.vercel.app',
    siteName: 'Synapse',
    locale: 'en_US',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Synapse',
    description: 'A spatial research tool where AI augments your thinking — not replaces it.',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
      </head>
      <body className={`font-sans antialiased ${spaceGrotesk.variable} ${spaceMono.variable} ${vazirmatn.variable}`} suppressHydrationWarning>
        <MobileWall />
        {children}
      </body>
    </html>
  )
}
