import { useCallback, useMemo, useState } from "react";
import type { DateRange } from "react-day-picker";
import { EnhancedDateRangePicker } from "../components/ui/EnhancedDateRangePicker";
import { Form, useNavigation, useRouteLoaderData } from "react-router";
import { Layers, Loader2, Search } from "lucide-react";
import { z } from "zod";
import { API_URL, authenticatedFetch } from "../config";
import { requireUserSession } from "../utils/session.server";
import { formatDateForQuery, getDefaultDateRange, parseDateParam } from "../utils/dateRange";
import {
  CombinedReportSelectionSchema as SelectionSchema,
  MAX_REPORT_REPOSITORIES,
} from "../../../shared/models/combinedReports";
import { AuthorStatsResponseSchema } from "../../../shared/models/authorStats";
import { ReviewerStatsResponseSchema } from "../../../shared/models/reviewerStats";
import {
  CombinedReportResults,
  type CombinedReportResult,
} from "../components/CombinedReportResults";
import type { loader as appLoader } from "./app";
import type { Route } from "./+types/app.reports";

const WorkspacesSchema = z.array(
  z.object({
    workspaceId: z.string(),
    name: z.string(),
    repositoryIds: z.array(z.string()),
  }),
);

type Selection = z.infer<typeof SelectionSchema>;

export const meta = () => [{ title: "Combined Reports" }];

export async function loader({ request, url }: Route.LoaderArgs) {
  const user = await requireUserSession(request, url);
  if (user.role !== "superuser") {
    throw new Response("Superuser role required", { status: 403 });
  }
  const params = url.searchParams;
  const range = getDefaultDateRange();
  const defaults = {
    startDate: formatDateForQuery(range.from),
    endDate: formatDateForQuery(range.to),
  };
  let workspaces: z.infer<typeof WorkspacesSchema> = [];
  let loadError: string | null = null;
  try {
    const response = await authenticatedFetch(
      `${API_URL}/api/workspaces?includeRepositories=1`,
      user.token,
      { request },
    );
    if (!response.ok) throw new Error(`Workspace request failed: ${response.status}`);
    workspaces = WorkspacesSchema.parse(await response.json());
  } catch (error) {
    console.error("Failed to load combined report workspaces:", error);
    loadError = "Workspaces could not be loaded. Reload the page to try again.";
  }

  let applied: Selection | null = null;
  let selectionError: string | null = null;
  if (params.has("report")) {
    const parsed = SelectionSchema.safeParse({
      workspaceId: params.get("workspaceId"),
      repositoryIds: [...new Set(params.getAll("repositoryIds"))].sort(),
      report: params.get("report"),
      startDate: params.get("startDate"),
      endDate: params.get("endDate"),
    });
    if (!parsed.success) {
      selectionError = `Choose 1–${MAX_REPORT_REPOSITORIES} repositories and a valid date range.`;
    } else if (!loadError) {
      const workspace = workspaces.find((item) => item.workspaceId === parsed.data.workspaceId);
      if (
        !workspace ||
        !parsed.data.repositoryIds.every((id) => workspace.repositoryIds.includes(id))
      ) {
        selectionError = "Choose repositories from a workspace you can access.";
      } else {
        applied = parsed.data;
      }
    }
  }

  let result: CombinedReportResult | null = null;
  let reportError: string | null = null;
  if (applied) {
    const url = new URL(`${API_URL}/api/reports/${applied.report}`);
    url.searchParams.set("workspaceId", applied.workspaceId);
    url.searchParams.set("startDate", applied.startDate);
    url.searchParams.set("endDate", applied.endDate);
    applied.repositoryIds.forEach((id) => url.searchParams.append("repositoryIds", id));
    try {
      const response = await authenticatedFetch(url.toString(), user.token, {
        request,
        // Combined reports can scan several repos; don't automatically launch
        // another expensive query if the first request times out.
        timeoutMs: 60_000,
        retryCount: 0,
      });
      if (!response.ok) {
        reportError =
          response.status === 403
            ? "You no longer have access to this report selection. Choose repositories again."
            : "Could not load the report. Click Fetch report to try again.";
      } else {
        const body: unknown = await response.json();
        result =
          applied.report === "authors"
            ? { report: "authors", data: AuthorStatsResponseSchema.parse(body) }
            : { report: "reviewers", data: ReviewerStatsResponseSchema.parse(body) };
      }
    } catch (error) {
      console.error("Failed to load combined report:", error);
      reportError = "Could not load the report. Click Fetch report to try again.";
    }
  }
  return { workspaces, loadError, selectionError, applied, defaults, result, reportError };
}

const fieldClass =
  "min-w-0 w-full rounded-md border border-gray-600 bg-gray-900 px-3 py-2 text-sm text-white focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400";

export default function CombinedReports({ loaderData }: Route.ComponentProps) {
  // Remount draft controls when the applied URL changes (including back/forward).
  return <CombinedReportsShell key={JSON.stringify(loaderData.applied)} data={loaderData} />;
}

function CombinedReportsShell({ data }: { data: Route.ComponentProps["loaderData"] }) {
  const app = useRouteLoaderData<typeof appLoader>("routes/app");
  const navigation = useNavigation();
  const { workspaces, applied, defaults, loadError, selectionError } = data;
  const [workspaceId, setWorkspaceId] = useState(
    applied?.workspaceId ?? workspaces[0]?.workspaceId ?? "",
  );
  const [repositoryIds, setRepositoryIds] = useState<string[]>(applied?.repositoryIds ?? []);
  const [report, setReport] = useState<Selection["report"]>(applied?.report ?? "authors");
  const [startDate, setStartDate] = useState(applied?.startDate ?? defaults.startDate);
  const [endDate, setEndDate] = useState(applied?.endDate ?? defaults.endDate);
  const [dateDraftValid, setDateDraftValid] = useState(true);
  const [search, setSearch] = useState("");
  const [scopeExpanded, setScopeExpanded] = useState(!applied);
  const dateRange = useMemo(
    () => ({ from: parseDateParam(startDate), to: parseDateParam(endDate) }),
    [startDate, endDate],
  );
  const handleDateRangeChange = useCallback((range: DateRange) => {
    setStartDate(range.from ? formatDateForQuery(range.from) : "");
    setEndDate(range.to ? formatDateForQuery(range.to) : "");
  }, []);
  const workspace = workspaces.find((item) => item.workspaceId === workspaceId);
  const repositories = (app?.repositories ?? []).filter((repo) =>
    workspace?.repositoryIds.includes(repo.id),
  );
  const visibleRepositories = repositories.filter((repo) =>
    `${repo.org}/${repo.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  const busy = navigation.state !== "idle";
  const unavailable = Boolean(loadError || !app || app.repositoriesError);
  const valid =
    dateDraftValid &&
    repositoryIds.length > 0 &&
    repositoryIds.length <= MAX_REPORT_REPOSITORIES &&
    Boolean(startDate && endDate) &&
    startDate <= endDate &&
    !unavailable;
  const draftChanged =
    applied &&
    (!dateDraftValid ||
      workspaceId !== applied.workspaceId ||
      report !== applied.report ||
      startDate !== applied.startDate ||
      endDate !== applied.endDate ||
      [...repositoryIds].sort().join(",") !== applied.repositoryIds.join(","));
  const appliedWorkspace = workspaces.find((item) => item.workspaceId === applied?.workspaceId);
  const appliedRepositories = (app?.repositories ?? []).filter((repo) =>
    applied?.repositoryIds.includes(repo.id),
  );

  const reportControls = (
    <>
      <EnhancedDateRangePicker
        className="w-full md:w-[240px]"
        value={dateRange}
        onChange={handleDateRangeChange}
        debounceMs={0}
        onDraftValidityChange={setDateDraftValid}
      />
      <button
        type="submit"
        form="combined-report-scope"
        disabled={!valid || busy}
        className="h-10 rounded-md bg-blue-600 px-4 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy ? "Fetching report…" : "Fetch report"}
      </button>
    </>
  );

  return (
    <div className="min-w-0 space-y-4 text-sm text-gray-200">
      <header className="space-y-2">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold tracking-tight text-white">Combined Reports</h1>
        </div>
        <p className="text-gray-400">
          A single people report across repositories in one workspace.
        </p>
      </header>

      {(loadError || app?.repositoriesError || selectionError) && (
        <p
          role="alert"
          className="rounded-lg border border-amber-700 bg-amber-950/30 p-4 text-amber-200"
        >
          {loadError ||
            (app?.repositoriesError
              ? "Repositories could not be loaded. Reload the page to try again."
              : selectionError)}
        </p>
      )}

      <Form
        id="combined-report-scope"
        method="get"
        action="/app/reports"
        className="rounded-lg bg-white/5"
        onSubmit={(event) => {
          if (!valid || busy) event.preventDefault();
        }}
      >
        <input type="hidden" name="startDate" value={dateDraftValid ? startDate : ""} />
        <input type="hidden" name="endDate" value={dateDraftValid ? endDate : ""} />
        <details
          open={scopeExpanded}
          onToggle={(event) => setScopeExpanded(event.currentTarget.open)}
        >
          <summary className="cursor-pointer px-5 py-3 font-medium text-white">
            {workspace?.name ?? "Choose workspace"} · {repositoryIds.length} repositories ·{" "}
            {report === "authors" ? "Authors" : "Reviewers"}
            <span className="ml-3 text-xs font-normal text-blue-300">
              {scopeExpanded ? "Hide selection" : "Edit selection"}
            </span>
          </summary>
          <div className="space-y-4 border-t border-white/10 p-5">
            <div className="grid min-w-0 gap-5 md:grid-cols-2">
              <label className="space-y-2">
                <span className="block font-medium">Workspace</span>
                <select
                  name="workspaceId"
                  aria-label="Workspace"
                  className={fieldClass}
                  value={workspaceId}
                  disabled={unavailable}
                  onChange={(event) => {
                    setWorkspaceId(event.target.value);
                    setRepositoryIds([]);
                    setSearch("");
                  }}
                >
                  {workspaces.length === 0 && <option value="">No workspaces available</option>}
                  {workspaces.map((item) => (
                    <option key={item.workspaceId} value={item.workspaceId}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="space-y-2">
                <span className="block font-medium">Report</span>
                <select
                  name="report"
                  aria-label="Report"
                  className={fieldClass}
                  value={report}
                  onChange={(event) => setReport(event.target.value as Selection["report"])}
                >
                  <option value="authors">Authors</option>
                  <option value="reviewers">Reviewers</option>
                </select>
              </label>
            </div>

            <fieldset className="min-w-0 space-y-3" disabled={unavailable}>
              <legend className="font-medium">
                Repositories{" "}
                <span className="font-normal text-gray-400">({repositoryIds.length} selected)</span>
              </legend>
              <div className="flex flex-wrap items-center gap-3">
                <div className="relative min-w-0 flex-1 basis-56">
                  <Search aria-hidden className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
                  <input
                    aria-label="Search repositories"
                    type="search"
                    className={`${fieldClass} pl-9`}
                    placeholder="Search repositories…"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                  />
                </div>
                <button
                  type="button"
                  className="text-blue-300 hover:text-blue-200"
                  onClick={() => setRepositoryIds(repositories.map((repo) => repo.id))}
                >
                  Select all
                </button>
                <button
                  type="button"
                  className="text-gray-400 hover:text-white"
                  onClick={() => setRepositoryIds([])}
                >
                  Clear
                </button>
              </div>
              {repositoryIds.map((id) => (
                <input key={id} type="hidden" name="repositoryIds" value={id} />
              ))}
              <div className="grid max-h-56 gap-2 overflow-y-auto rounded-lg bg-white/5 p-3 md:grid-cols-2">
                {visibleRepositories.map((repo) => (
                  <label
                    key={repo.id}
                    className="flex min-w-0 cursor-pointer items-center gap-3 rounded-md p-2 hover:bg-white/5"
                  >
                    <input
                      type="checkbox"
                      className="h-4 w-4 shrink-0 accent-blue-500"
                      checked={repositoryIds.includes(repo.id)}
                      onChange={(event) => {
                        setRepositoryIds((ids) =>
                          event.target.checked
                            ? [...ids, repo.id]
                            : ids.filter((id) => id !== repo.id),
                        );
                      }}
                    />
                    <span className="break-all">
                      {repo.org}/{repo.name}
                    </span>
                  </label>
                ))}
                {visibleRepositories.length === 0 && (
                  <p className="p-2 text-gray-400 md:col-span-2">
                    {unavailable
                      ? "Repository selection unavailable."
                      : repositories.length
                        ? "No repositories match your search."
                        : "No repositories in this workspace."}
                  </p>
                )}
              </div>
            </fieldset>

            <p className="text-xs text-gray-400">
              Select up to {MAX_REPORT_REPOSITORIES} repositories. Reports use PR creation dates,
              including the start date and excluding the end date, matching per-repository reports.
            </p>
          </div>
        </details>
      </Form>

      <section className="min-w-0 space-y-4" aria-label="Combined report results" aria-busy={busy}>
        {!data.result && (
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 py-4">
            <h2 className="text-2xl font-semibold tracking-tight text-white">
              {report === "authors" ? "Author Reports" : "Reviewer Reports"}
            </h2>
            <div className="flex w-full flex-wrap items-center gap-3 md:w-auto">
              {reportControls}
            </div>
          </div>
        )}
        {busy && (
          <p role="status" className="flex items-center gap-2 text-blue-300">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
            Loading combined report…
          </p>
        )}
        {applied && (
          <p className="text-xs text-gray-400 break-words">
            Loaded: {appliedWorkspace?.name} ·{" "}
            {appliedRepositories.map((repo) => `${repo.org}/${repo.name}`).join(", ")} ·{" "}
            {applied.startDate} – {applied.endDate}
          </p>
        )}
        {!dateDraftValid && (
          <p role="status" className="text-amber-300">
            Complete a valid date range before fetching a report.
          </p>
        )}
        {draftChanged && (
          <p role="status" className="text-amber-300">
            Selection changed. Fetch report to apply your changes; the results below still reflect
            the previous selection.
          </p>
        )}
        {data.reportError && (
          <p
            role="alert"
            className="rounded-lg border border-amber-700 bg-amber-950/30 p-4 text-amber-200"
          >
            {data.reportError}
          </p>
        )}
        {!applied && (
          <div
            role="status"
            className="flex flex-col items-center gap-2 rounded-lg bg-white/5 px-6 py-10 text-center"
          >
            <Layers className="mb-1 h-6 w-6 text-gray-400" aria-hidden />
            <p className="font-medium text-white">Choose repositories to get started</p>
            <p className="max-w-xl text-gray-400">
              Choose a workspace, repositories, and date range, then fetch a report. You can
              bookmark the applied selection.
            </p>
          </div>
        )}
        {applied && data.result && (
          <CombinedReportResults
            result={data.result}
            selection={applied}
            disabled={busy}
            controls={reportControls}
          />
        )}
      </section>
    </div>
  );
}
