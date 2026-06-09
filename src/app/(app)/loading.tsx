/**
 * Skeleton shown during every (app)/* navigation while the server renders
 * the destination page. Tracks the post-rework page rhythm (28px H1,
 * 4-column metric grid, full-width chart, follow-up panel).
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-10 pt-4">
      <div className="h-9 w-44 bg-ink-150 rounded-lg" />
      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="h-28 bg-panel rounded-2xl shadow-card" />
        ))}
      </div>
      <div className="h-72 bg-panel rounded-2xl shadow-card" />
      <div className="h-56 bg-panel rounded-2xl shadow-card" />
    </div>
  );
}
