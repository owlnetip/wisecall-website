function Skeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-[#e8edeb] motion-reduce:animate-none ${className}`} />;
}

export default function DashboardLoading() {
  return (
    <div
      className="min-h-screen bg-surface text-ink lg:px-6 lg:py-6"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading dashboard"
    >
      <div className="mx-auto flex min-h-screen max-w-[1920px] overflow-hidden bg-white lg:min-h-[calc(100vh-48px)] lg:rounded-[22px] lg:border lg:border-line lg:shadow-[0_24px_90px_rgba(17,23,22,0.14)]">
        <aside className="hidden w-[280px] shrink-0 flex-col bg-[#172929] md:flex" aria-hidden="true">
          <div className="flex h-[72px] items-center gap-3 px-6">
            <div className="h-8 w-8 rounded-full bg-[#7de8eb]/25" />
            <span className="text-2xl font-black text-white">
              Wise<span className="text-[#7de8eb]">Call</span>
            </span>
          </div>
          <div className="flex-1 space-y-3 px-4 py-5">
            {["w-28", "w-24", "w-32", "w-24", "w-28", "w-36"].map((width, index) => (
              <div key={index} className="flex h-10 items-center gap-3 px-3">
                <div className="h-5 w-5 rounded bg-white/10" />
                <div className={`h-3 rounded bg-white/10 ${width}`} />
              </div>
            ))}
          </div>
          <div className="m-4 h-32 rounded-2xl bg-white/5" />
        </aside>

        <main className="min-w-0 flex-1 bg-white">
          <header className="flex h-[72px] items-center justify-between border-b border-line px-5 lg:px-8">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-[#e8edeb] md:hidden" />
              <Skeleton className="h-3 w-20" />
            </div>
            <div className="flex items-center gap-3">
              <Skeleton className="hidden h-3 w-32 sm:block" />
              <Skeleton className="h-9 w-9 rounded-full" />
              <Skeleton className="h-9 w-9" />
            </div>
          </header>

          <div className="px-4 pb-16 pt-6 sm:px-5 sm:py-8 lg:px-10" aria-hidden="true">
            <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <Skeleton className="h-7 w-52" />
                <Skeleton className="mt-3 h-4 w-[min(28rem,75vw)]" />
              </div>
              <Skeleton className="h-10 w-32" />
            </div>

            <Skeleton className="mb-6 h-28 w-full" />
            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
              {[0, 1, 2, 3].map((item) => (
                <div key={item} className="rounded-xl border border-line bg-white p-4">
                  <Skeleton className="h-3 w-20" />
                  <Skeleton className="mt-4 h-8 w-16" />
                  <Skeleton className="mt-4 h-3 w-28 max-w-full" />
                </div>
              ))}
            </div>

            <div className="mt-6 grid gap-6 lg:grid-cols-2">
              {[0, 1].map((item) => (
                <div key={item} className="rounded-xl border border-line bg-white p-5">
                  <div className="flex items-center justify-between gap-3">
                    <Skeleton className="h-5 w-40" />
                    <Skeleton className="h-8 w-20" />
                  </div>
                  <Skeleton className="mt-5 h-36 w-full" />
                </div>
              ))}
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
