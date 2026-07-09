// Loading placeholders (RF-5) — no more blank flashes while queries load.
export function Skeleton({ lines = 3 }: { lines?: number }) {
  return (
    <div className="card" aria-busy="true" aria-label="loading">
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="skeleton-line" style={{ width: `${100 - i * 12}%` }} />
      ))}
    </div>
  )
}
