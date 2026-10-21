/** Shown while the session loads: the app's outline instead of a blank page, so the app feels instant. */
export function ShellSkeleton() {
  return (
    <div className="app-canvas flex min-h-screen" aria-busy="true" aria-label="Loading">
      <aside className="hidden h-screen w-[272px] shrink-0 p-3 pr-0 lg:block">
        <div className="surface-menu flex h-full flex-col gap-4 rounded-2xl p-4">
          {/* The clinic's own logo appears once the session has loaded (white label). */}
          <div className="mx-auto mb-2 h-12 w-12 rounded-2xl bg-sidebar-strong/10" />
          {Array.from({ length: 4 }, (_, g) => (
            <div key={g} className="grid gap-2 pt-2">
              <div className="h-2 w-16 rounded-pill bg-sidebar-strong/10" />
              {Array.from({ length: g === 0 ? 2 : 3 }, (_, i) => <div key={i} className="h-10 rounded-pill bg-sidebar-strong/[0.06]" />)}
            </div>
          ))}
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="px-3 pt-3 sm:px-4 lg:px-6">
          <div className="glass flex h-14 items-center gap-3 rounded-2xl border border-[hsl(var(--glass-edge))] px-3 shadow-card">
            <div className="shimmer h-10 w-full max-w-md rounded-pill bg-foreground/[0.06]" />
            <div className="shimmer ml-auto h-10 w-24 rounded-pill bg-foreground/[0.06]" />
          </div>
        </div>
        <main className="mx-auto grid w-full max-w-[1600px] content-start gap-6 px-4 pt-6 sm:px-6 lg:px-8 lg:pt-8">
          <div className="shimmer h-9 w-72 max-w-full rounded-pill bg-foreground/[0.06]" />
          <div className="shimmer h-4 w-96 max-w-full rounded-pill bg-foreground/[0.06]" />
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }, (_, i) => <div key={i} className="surface h-24 rounded-2xl" />)}
          </div>
          <div className="surface h-72 rounded-xl" />
        </main>
      </div>
    </div>
  );
}
