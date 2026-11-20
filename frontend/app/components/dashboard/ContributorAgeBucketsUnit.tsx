import type { ContributorAgeBucket } from "../../../../shared/models/dashboardMetrics";
import { MetricUnit } from "./MetricUnit";

const ORDERED_BUCKETS = [
  { title: "New (0-3mo)", color: "from-emerald-400/90 to-emerald-500/70" },
  { title: "Rising (3-12mo)", color: "from-sky-400/90 to-sky-500/70" },
  { title: "Core (1-3y)", color: "from-indigo-400/90 to-indigo-500/70" },
  { title: "Veteran (3y+)", color: "from-amber-400/90 to-amber-500/70" },
] as const;

type Props = {
  buckets: ContributorAgeBucket[];
};

export function ContributorAgeBucketsUnit({ buckets }: Props) {
  const incoming = new Map(buckets.map((bucket) => [bucket.title.toLowerCase(), bucket.count]));

  const ordered = ORDERED_BUCKETS.map((def) => {
    const count = incoming.get(def.title.toLowerCase()) ?? 0;
    return { ...def, count };
  });

  const total = ordered.reduce((sum, bucket) => sum + bucket.count, 0);
  const topBucket = ordered.reduce((current, bucket) => {
    if (!current || bucket.count > current.count) return bucket;
    return current;
  }, ordered[0]);

  const stats = [
    {
      label: "Merged PRs (window)",
      value: total.toLocaleString(),
    },
    {
      label: "Largest group",
      value:
        total === 0
          ? "No merged PRs"
          : `${topBucket.title.split(" ")[0]} • ${topBucket.count.toLocaleString()} (${Math.round(
              (topBucket.count / total) * 100,
            )}%)`,
    },
  ];

  const chart =
    total === 0 ? (
      <div className="text-sm text-muted-foreground text-center">No merged PRs in this window.</div>
    ) : (
      <div className="space-y-3">
        {ordered.map((bucket) => {
          const percent = Math.round((bucket.count / total) * 100);
          const width = Math.max(percent, bucket.count > 0 ? 4 : 0); // keep sliver visible
          return (
            <div key={bucket.title} className="flex items-center gap-3">
              <div className="w-40">
                <div className="text-sm font-semibold text-white">{bucket.title}</div>
                <div className="text-xs text-muted-foreground">
                  {bucket.count.toLocaleString()} PRs
                </div>
              </div>
              <div className="flex-1 h-3 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${bucket.color}`}
                  style={{ width: `${width}%` }}
                />
              </div>
              <div className="w-12 text-right text-xs text-muted-foreground">{percent}%</div>
            </div>
          );
        })}
      </div>
    );

  return (
    <MetricUnit
      title="Contributor Age Mix"
      stats={stats}
      chart={chart}
      className="border border-white/5"
    />
  );
}
