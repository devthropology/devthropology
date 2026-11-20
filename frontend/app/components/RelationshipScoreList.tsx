import { Link } from "react-router";
import { ChevronDown } from "lucide-react";
import { useState } from "react";
import {
  formatInteger,
  getRelationshipMetrics,
  type RelationshipEdgeData,
} from "./relationshipGraphUtils";
import { buildContributorPath, useCurrentRepoRef } from "../utils/repositoryRoutes";

interface RelationshipScoreListEdge {
  fromUserId: number;
  toUserId: number;
  weight: number;
  edgeData: RelationshipEdgeData;
}

function RelationshipMetricsInline({ edgeData }: { edgeData: RelationshipEdgeData }) {
  const items = getRelationshipMetrics(edgeData);
  const itemRows = [items.slice(0, 2), items.slice(2, 4)].filter((row) => row.length > 0);

  return (
    <div className="space-y-1.5 text-[13px] leading-5 text-gray-400">
      {itemRows.map((row, rowIndex) => (
        <div key={rowIndex} className="grid grid-cols-1 sm:grid-cols-2 items-baseline gap-x-4">
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <span className="text-gray-500">{row[0]?.label}</span>
            <span className="text-right tabular-nums text-gray-200">
              {row[0] ? formatInteger(row[0].value) : ""}
            </span>
          </div>
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            {row[1] ? (
              <>
                <span className="text-gray-500">{row[1].label}</span>
                <span className="text-right tabular-nums text-gray-200">
                  {formatInteger(row[1].value)}
                </span>
              </>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export function RelationshipScoreList({
  title,
  subtitle,
  rows,
  getLogin,
}: {
  title: string;
  subtitle?: string;
  rows: RelationshipScoreListEdge[];
  getLogin: (edge: RelationshipScoreListEdge) => string;
}) {
  const repoRef = useCurrentRepoRef();
  const [expandedRowKey, setExpandedRowKey] = useState<string | null>(null);

  return (
    <div className="rounded-lg border border-white/5 bg-slate-950/20 p-3">
      <div className="mb-3">
        <div>
          <div className="text-[15px] font-semibold text-gray-200">{title}</div>
          {subtitle ? <div className="text-xs text-gray-500">{subtitle}</div> : null}
        </div>
      </div>
      {rows.length === 0 ? (
        <div className="text-xs text-gray-500">No relationships in this direction yet.</div>
      ) : (
        <div className="relationship-scroll-area max-h-[26rem] overflow-y-auto pr-0.5">
          {rows.map((edge) => {
            const login = getLogin(edge);
            const rowKey = `${edge.fromUserId}-${edge.toUserId}`;
            const isExpanded = expandedRowKey === rowKey;
            const toggleExpanded = () => setExpandedRowKey(isExpanded ? null : rowKey);

            return (
              <div
                key={rowKey}
                role="button"
                tabIndex={0}
                onClick={toggleExpanded}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggleExpanded();
                  }
                }}
                aria-expanded={isExpanded}
                className="cursor-pointer border-b border-white/[0.04] outline-none transition-colors last:border-b-0 hover:bg-white/[0.02] focus-visible:bg-white/[0.02]"
              >
                <div className="flex h-10 items-center justify-between gap-1 px-2 sm:px-3">
                  <Link
                    to={buildContributorPath(login, repoRef ?? undefined)}
                    onClick={(event) => event.stopPropagation()}
                    onKeyDown={(event) => event.stopPropagation()}
                    className="min-w-0 truncate text-sm font-medium text-gray-200 transition-colors hover:text-blue-300"
                  >
                    {login}
                  </Link>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <span className="tabular-nums text-sm font-semibold text-white">
                      {formatInteger(edge.weight)}
                    </span>
                    <ChevronDown
                      className={`h-[14px] w-[14px] text-gray-300 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                      aria-hidden="true"
                    />
                  </div>
                </div>
                {isExpanded ? (
                  <div className="mt-1 px-2 pb-2 sm:px-3">
                    <RelationshipMetricsInline edgeData={edge.edgeData} />
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
