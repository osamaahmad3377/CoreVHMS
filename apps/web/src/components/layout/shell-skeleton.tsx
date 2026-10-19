/** Shown while the session loads: the app's outline instead of a blank page, so the app feels instant. */
export function ShellSkeleton() {
  return (
    <div className="flex min-h-screen" aria-busy="true" aria-label="Loading">
      <aside className="hidden h-screen w-[232px] shrink-0 flex-col gap-4 border-r border-sidebar-border bg-sidebar p-3 lg:flex">
        <div className="flex items-center gap-2 px-1 py-1">
          {/* The clinic's own logo and name appear once the session has loaded (white label). */}
          <div className="h-7 w-7 rounded-md bg-sidebar-strong/10" />
          <div className="h-3 w-24 rounded bg-sidebar-strong/10" />
        </div>
        {Array.from({ length: 4 }, (_, g) => (
          <div key={g} className="grid gap-2 pt-2">
            <div className="h-2 w-16 rounded bg-sidebar-strong/10" />
            {Array.from({ length: g === 0 ? 2 : 3 }, (_, i) => <div key={i} className="h-7 rounded-md bg-sidebar-strong/[0.06]" />)}
          </div>
        ))}
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex h-14 items-center gap-3 border-b bg-card px-4">
          <div className="h-8 w-full max-w-md animate-pulse rounded-md bg-muted" />
          <div className="ml-auto h-8 w-24 animate-pulse rounded-md bg-muted" />
          <div className="h-8 w-32 animate-pulse rounded-md bg-muted" />
        </div>
        <main className="mx-auto grid w-full max-w-[1600px] content-start gap-4 px-4 py-5 sm:px-6">
          <div className="h-7 w-64 animate-pulse rounded bg-muted" />
          <div className="h-4 w-96 max-w-full animate-pulse rounded bg-muted" />
          <div className="grid gap-3 sm:grid-cols-3">
            {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-20 animate-pulse rounded-lg bg-muted" />)}
          </div>
          <div className="h-72 animate-pulse rounded-lg bg-muted" />
        </main>
      </div>
    </div>
  );
}
