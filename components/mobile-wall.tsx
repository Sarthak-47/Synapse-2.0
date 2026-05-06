"use client"

export function MobileWall() {
  return (
    <div className="fixed inset-0 z-[9999] flex flex-col items-center justify-center bg-background px-8 text-center md:hidden" style={{ paddingBottom: "15vh" }}>
      {/* Logo */}
      <div className="mb-8 flex items-center gap-2.5">
        <div className="flex items-center gap-1">
          <span className="inline-block h-3 w-3 rounded-full bg-primary" />
          <span className="inline-block h-px w-3 rounded-full bg-primary/35" />
          <span className="inline-block h-2 w-2 rounded-full bg-primary/65" />
          <span className="inline-block h-px w-2.5 rounded-full bg-primary/25" />
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-primary/40" />
        </div>
        <span className="font-mono text-sm font-semibold tracking-tight text-foreground">
          Synapse
        </span>
      </div>

      {/* Message */}
      <p className="mb-3 max-w-xs text-base font-medium text-foreground">
        Spatial thinking needs space.
      </p>
      <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">
        Synapse is built for large screens. Open it on a desktop or laptop browser to get the full experience.
      </p>
    </div>
  )
}
