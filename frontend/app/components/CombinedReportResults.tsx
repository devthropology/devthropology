import { type ReactNode, useMemo, useState } from "react";
import { X } from "lucide-react";
import type { AuthorStatsResponse } from "../../../shared/models/authorStats";
import type { ReviewerStatsResponse } from "../../../shared/models/reviewerStats";
import type { CombinedReportSelection } from "../../../shared/models/combinedReports";
import { createColumns as createAuthorColumns } from "./author-stats/columns";
import { createColumns as createReviewerColumns } from "./reviewer-stats/columns";
import { DataTable } from "./ui/data-table";
import { Badge } from "./ui/badge";
import { ExportCsvButton } from "./ui/ExportCsvButton";
import { ReportUserFilter } from "./reports/ReportUserFilter";
import { ReportTiersToggle } from "./reports/ReportTiersToggle";
import { buildCsv, buildReportCsvFilename, downloadCsv } from "../utils/csvExport";
import { AUTHOR_CSV_COLUMNS, REVIEWER_CSV_COLUMNS } from "../utils/reportCsvColumns";

export type CombinedReportResult =
  | { report: "authors"; data: AuthorStatsResponse }
  | { report: "reviewers"; data: ReviewerStatsResponse };

export function CombinedReportResults({
  result,
  selection,
  disabled = false,
  controls,
}: {
  result: CombinedReportResult;
  selection: CombinedReportSelection;
  disabled?: boolean;
  controls?: ReactNode;
}) {
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const [showTiers, setShowTiers] = useState(false);
  const authorColumns = useMemo(() => createAuthorColumns(undefined, false), []);
  const reviewerColumns = useMemo(() => createReviewerColumns(undefined, false), []);
  const users = (
    result.report === "authors"
      ? result.data.authors.map((row) => row.author)
      : result.data.reviewers.map((row) => row.reviewer)
  ).sort((a, b) => a.localeCompare(b));
  const authors =
    result.report === "authors"
      ? result.data.authors.filter(
          (row) => !selectedUsers.length || selectedUsers.includes(row.author),
        )
      : [];
  const reviewers =
    result.report === "reviewers"
      ? result.data.reviewers.filter(
          (row) => !selectedUsers.length || selectedUsers.includes(row.reviewer),
        )
      : [];
  const visibleCount = result.report === "authors" ? authors.length : reviewers.length;

  function exportCsv() {
    const filename = buildReportCsvFilename({
      report: `combined_${result.report}`,
      repoRef: selection.repositoryIds.join("-"),
      from: selection.startDate,
      to: selection.endDate,
    });
    downloadCsv(
      filename,
      result.report === "authors"
        ? buildCsv(AUTHOR_CSV_COLUMNS, authors)
        : buildCsv(REVIEWER_CSV_COLUMNS, reviewers),
    );
  }

  return (
    <div className="min-w-0 text-white">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 py-4">
        <h2 className="text-2xl font-semibold tracking-tight">
          {result.report === "authors" ? "Author Reports" : "Reviewer Reports"}
        </h2>
        <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
          <ReportUserFilter
            label={result.report}
            users={users}
            selectedUsers={selectedUsers}
            onToggle={(username) =>
              setSelectedUsers((current) =>
                current.includes(username)
                  ? current.filter((name) => name !== username)
                  : [...current, username],
              )
            }
            onClear={() => setSelectedUsers([])}
            disabled={disabled || !users.length}
          />
          {controls}
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 py-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-xs text-gray-400">
            {visibleCount} of {users.length} people
          </span>
          {selectedUsers.slice(0, 8).map((user) => (
            <Badge key={user} variant="secondary" className="flex items-center gap-1">
              {user}
              <button
                type="button"
                onClick={() =>
                  setSelectedUsers((current) => current.filter((name) => name !== user))
                }
                aria-label={`Remove ${user} filter`}
                className="text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
          {selectedUsers.length > 8 && (
            <span className="text-xs text-gray-400">+{selectedUsers.length - 8} more</span>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <ExportCsvButton disabled={disabled || visibleCount === 0} onExport={exportCsv} />
          {selectedUsers.length > 0 && (
            <button
              type="button"
              onClick={() => setSelectedUsers([])}
              className="text-sm font-medium text-blue-300 hover:text-blue-200"
            >
              Clear all
            </button>
          )}
          <ReportTiersToggle
            checked={showTiers}
            onChange={setShowTiers}
            disabled={disabled || !users.length}
            description={`Compare ${result.report} to percentile tiers across all selected repositories for the loaded period. User filtering does not change these ratings.`}
          />
        </div>
      </div>
      <div className="min-w-0 pt-2">
        {visibleCount === 0 ? (
          <p role="status" className="rounded-lg bg-white/5 p-8 text-center text-gray-400">
            {users.length
              ? "No people match the selected filters."
              : `No ${result.report === "authors" ? "author" : "reviewer"} activity for the selected repositories and period.`}
          </p>
        ) : result.report === "authors" ? (
          <DataTable
            columns={authorColumns}
            data={authors}
            pinnedRows={showTiers ? result.data.thresholds : []}
            pinnedColumn="author"
            maxHeight="70vh"
            showCustomHorizontalScrollbar
          />
        ) : (
          <DataTable
            columns={reviewerColumns}
            data={reviewers}
            pinnedRows={showTiers ? result.data.thresholds : []}
            pinnedColumn="reviewer"
            maxHeight="70vh"
            showCustomHorizontalScrollbar
          />
        )}
      </div>
    </div>
  );
}
