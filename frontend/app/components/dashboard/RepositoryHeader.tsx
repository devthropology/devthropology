import type { LanguageStats } from "./MirroredBarChart";
import { MirroredBarChart } from "./MirroredBarChart";
import { differenceInCalendarDays } from "date-fns";

export interface RepositoryHeaderData {
  name: string;
  fullName: string; // "anthropics/gh-track"
  description: string;
  githubUrl: string;
  ownerAvatarUrl: string;
  languageStats: LanguageStats[];

  // Repository Overview - Simple Metrics
  firstActivity: string | null; // ISO date string
  lastActivity: string | null; // ISO date string
  totalContributors: number;
  activeContributors3mo: number;
  medianAuthorAge3moDays: number | null;
  totalMergedPRs: number;
  prMergeRate: number; // percentage
  openPRs: number;
  estimatedLOC: number;
  estimatedFiles: number;
  topFileTypes: Array<{ type: string; percentage: number }>; // by count
  topFileTypesByLoc: Array<{ type: string; percentage: number }>; // by size/LOC
  computedAt: string;
}

function formatDuration(days: number): string {
  if (days <= 0) {
    return "0 days";
  }

  const years = Math.floor(days / 365);
  const months = Math.floor((days % 365) / 30);
  const remainingDays = days % 30;

  const parts = [];
  if (years > 0) parts.push(`${years} ${years === 1 ? "year" : "years"}`);
  if (months > 0) {
    parts.push(`${months} ${months === 1 ? "month" : "months"}`);
  }
  if (remainingDays > 0) {
    parts.push(`${remainingDays} ${remainingDays === 1 ? "day" : "days"}`);
  }

  return parts.join(", ");
}

function getRelativeDayLabel(days: number): string {
  if (days <= 0) {
    return "today";
  }

  if (days === 1) {
    return "yesterday";
  }

  return `${formatDuration(days)} ago`;
}

function formatAgeDuration(days: number | null): string {
  if (days === null) return "N/A";
  if (days < 30) {
    const value = Number(days.toFixed(1));
    return value === 1 ? "1 day" : `${value} days`;
  }
  if (days < 365) {
    const months = Number((days / 30).toFixed(1));
    return months === 1 ? "1 month" : `${months} months`;
  }
  const years = Number((days / 365).toFixed(1));
  return years === 1 ? "1 year" : `${years} years`;
}

export function RepositoryHeader({ data }: { data: RepositoryHeaderData }) {
  const now = new Date();
  const firstActivityDays = data.firstActivity
    ? Math.max(0, differenceInCalendarDays(now, new Date(data.firstActivity)))
    : null;
  const lastActivityDays = data.lastActivity
    ? Math.max(0, differenceInCalendarDays(now, new Date(data.lastActivity)))
    : null;

  return (
    <div className="flex flex-col gap-6">
      {/* Identity Row */}
      <div className="flex items-center gap-3">
        <img
          src={data.ownerAvatarUrl}
          alt={`${data.fullName} owner avatar`}
          className="h-12 w-12 flex-shrink-0 rounded-lg shadow-lg"
        />
        <div className="flex flex-col">
          <h1 className="text-2xl font-bold text-white">
            {data.name} (
            <a
              href={data.githubUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-400 hover:text-blue-300"
            >
              {data.fullName}
            </a>
            )
          </h1>
          {data.description && <p className="mt-1 text-gray-300">{data.description}</p>}
        </div>
      </div>

      {/* Metrics Row */}
      <div className="border-t border-gray-700 pt-4">
        <h2 className="text-xl font-semibold text-white mb-4">Repository Overview</h2>
        <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-16">
          {/* Column 1: Who & When */}
          <div className="space-y-2">
            {data.firstActivity && (
              <p className="text-gray-300">
                First activity:{" "}
                <span className="font-semibold text-white">
                  {new Date(data.firstActivity).toLocaleDateString()}
                </span>{" "}
                <span className="text-gray-400">
                  ({getRelativeDayLabel(firstActivityDays ?? 0)})
                </span>
              </p>
            )}
            {data.lastActivity && (
              <p className="text-gray-300">
                Last activity:{" "}
                <span className="font-semibold text-white">
                  {new Date(data.lastActivity).toLocaleDateString()}
                </span>
                <span className="text-gray-400">
                  {" "}
                  ({getRelativeDayLabel(lastActivityDays ?? 0)})
                </span>
              </p>
            )}
            <p className="text-gray-300">
              Total contributors:{" "}
              <span className="font-semibold text-white">
                {data.totalContributors.toLocaleString()}
              </span>
            </p>
            <p className="text-gray-300">
              Active contributors (3 mo):{" "}
              <span className="font-semibold text-white">
                {data.activeContributors3mo.toLocaleString()}
              </span>
            </p>
            <p className="text-gray-300">
              Median author age (3 mo):{" "}
              <span className="font-semibold text-white">
                {formatAgeDuration(data.medianAuthorAge3moDays)}
              </span>
            </p>
          </div>

          {/* Column 2: Volume */}
          <div className="space-y-2">
            <p className="text-gray-300">
              Merged PRs:{" "}
              <span className="font-semibold text-white">
                {data.totalMergedPRs.toLocaleString()}
              </span>
              <span className="text-gray-400">({data.prMergeRate}%)</span>
            </p>
            <p className="text-gray-300">
              Open PRs:{" "}
              <span className="font-semibold text-white">{data.openPRs.toLocaleString()}</span>
            </p>
            <p className="text-gray-300">
              Est. LOC:{" "}
              <span className="font-semibold text-white">{data.estimatedLOC.toLocaleString()}</span>
            </p>
            <p className="text-gray-300">
              Est. files:{" "}
              <span className="font-semibold text-white">
                {data.estimatedFiles.toLocaleString()}
              </span>
            </p>
          </div>

          {/* Column 3: Composition */}
          <div className="w-full max-w-[400px] space-y-2">
            <div className="mb-1 grid grid-cols-[4rem_1fr_7rem_1fr_2.5rem] items-center">
              <span className="text-right text-xs font-medium uppercase tracking-wide text-gray-400 whitespace-nowrap">
                Count %
              </span>
              <span aria-hidden="true"></span>
              <h3 className="text-center text-sm font-semibold text-white">Files</h3>
              <span aria-hidden="true"></span>
              <span className="text-left text-xs font-medium uppercase tracking-wide text-gray-400 whitespace-nowrap">
                Size %
              </span>
            </div>
            <MirroredBarChart className="w-full max-w-[400px]" data={data.languageStats ?? []} />
          </div>
        </div>
      </div>
    </div>
  );
}
