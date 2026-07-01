import type { ContentItem, ContentVersion } from "@/lib/marketing/types";

export function ContentLibraryPanel({
  items,
}: {
  items: (ContentItem & { latest_version?: ContentVersion | null })[];
}) {
  return (
    <div className="mx-auto max-w-6xl space-y-4 px-4 py-8">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-white">Content Library</h2>
        <span className="text-sm text-muted">{items.length} drafts</span>
      </div>

      <div className="space-y-4">
        {items.map((item) => (
          <article
            key={item.id}
            className="rounded-2xl border border-accent/10 bg-panel/50 p-5"
          >
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="rounded-full bg-accent/10 px-2 py-0.5 text-xs uppercase text-accent">
                {item.platform}
              </span>
              <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs uppercase text-muted">
                {item.status}
              </span>
              <span className="text-xs text-muted">
                {new Date(item.created_at).toLocaleString("en-GB")}
              </span>
            </div>

            <h3 className="font-medium text-white">{item.topic}</h3>
            {item.audience ? (
              <p className="mt-1 text-sm text-muted">Audience: {item.audience}</p>
            ) : null}

            {item.latest_version ? (
              <pre className="mt-4 max-h-64 overflow-auto whitespace-pre-wrap rounded-xl bg-background/50 p-4 text-sm text-muted">
                {item.latest_version.body}
              </pre>
            ) : (
              <p className="mt-4 text-sm text-muted">No version saved.</p>
            )}

            {item.latest_version?.model ? (
              <p className="mt-2 text-xs text-muted">
                Model: {item.latest_version.model} · Prompt {item.latest_version.prompt_version}
              </p>
            ) : null}
          </article>
        ))}

        {items.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-accent/20 p-8 text-center text-sm text-muted">
            No drafts yet. Use Draft Studio to generate your first piece of content.
          </p>
        ) : null}
      </div>
    </div>
  );
}
