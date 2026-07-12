function DarkSkeleton({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-lg bg-white/10 motion-reduce:animate-none ${className}`} />;
}

export default function BillingLoading() {
  return (
    <main
      className="min-h-screen w-full bg-[#172929] px-4 py-6 text-white sm:py-10"
      role="status"
      aria-live="polite"
      aria-busy="true"
      aria-label="Loading billing and plans"
    >
      <div className="mx-auto max-w-6xl" aria-hidden="true">
        <div className="mb-8 flex items-center justify-between">
          <DarkSkeleton className="h-4 w-28" />
          <DarkSkeleton className="h-4 w-20" />
        </div>

        <div className="flex flex-col items-center text-center">
          <DarkSkeleton className="h-9 w-72 max-w-[80vw]" />
          <DarkSkeleton className="mt-4 h-4 w-[min(38rem,85vw)]" />
          <DarkSkeleton className="mt-2 h-4 w-[min(28rem,70vw)]" />
          <div className="mt-5 h-16 w-full max-w-2xl rounded-xl border border-[#7de8eb]/15 bg-[#7de8eb]/5" />
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <section
              key={item}
              className={`flex min-h-[32rem] flex-col rounded-2xl border bg-[#1f3535] p-6 ${
                item === 1 ? "border-[#7de8eb]/60" : "border-white/10"
              }`}
            >
              <DarkSkeleton className="h-6 w-32" />
              <DarkSkeleton className="mt-3 h-3 w-48 max-w-full" />
              <DarkSkeleton className="mt-6 h-9 w-24" />
              <div className="mt-6 space-y-3 border-y border-white/10 py-5">
                {[0, 1, 2, 3].map((row) => (
                  <div key={row} className="flex items-center gap-2">
                    <DarkSkeleton className="h-3 w-3 rounded-full" />
                    <DarkSkeleton className="h-3 w-44 max-w-[80%]" />
                  </div>
                ))}
              </div>
              <DarkSkeleton className="mt-5 h-11 w-full" />
              <div className="mt-6 space-y-3">
                {[0, 1, 2, 3, 4].map((row) => (
                  <div key={row} className="flex items-center gap-3">
                    <DarkSkeleton className="h-4 w-4 rounded-full" />
                    <DarkSkeleton className="h-3 w-36" />
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      </div>
    </main>
  );
}
