import type { DataTableColumnDef as ColumnDef } from "../ui/data-table-features";
import { Link } from "react-router";
import type { UserActivityOverview } from "../../routes/types";
import {
  createCenterCell,
  createCompactHeader,
  createRightCell,
  createStandardHeader,
} from "../../utils/table";
import { formatMetricValue } from "../../utils/numberFormat";
import { buildContributorPath } from "../../utils/repositoryRoutes";

const numberFormatter = new Intl.NumberFormat();
const dateFormatter = new Intl.DateTimeFormat(undefined, {
  year: "2-digit",
  month: "numeric",
  day: "numeric",
});
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
  second: "2-digit",
});

const formatDateLabel = (timestamp: string | number) => {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;

  return {
    label: dateFormatter.format(date),
    tooltip: dateTimeFormatter.format(date),
  };
};

const resolveGithubPathSegment = (activityType: string) => {
  const type = activityType?.toLowerCase() ?? "";
  return type.includes("issue") ? "issues" : "pull";
};

const createTimestampLink = (activity: UserActivityOverview, scope: "first" | "last") => {
  const timestamp = scope === "last" ? activity.last_seen_timestamp : activity.first_seen_timestamp;
  const issueId = scope === "last" ? activity.last_seen_issue_id : activity.first_seen_issue_id;
  const activityType =
    scope === "last" ? activity.last_seen_activity_type : activity.first_seen_activity_type;

  const formatted = formatDateLabel(timestamp);
  if (!formatted) return null;

  const parts = activity.git_repo.split("/");
  if (parts.length !== 2 || !issueId) {
    return (
      <span title={formatted.tooltip} className="text-center text-base">
        {formatted.label}
      </span>
    );
  }

  const [owner, repo] = parts;
  const linkType = resolveGithubPathSegment(activityType);

  return (
    <a
      href={`https://github.com/${owner}/${repo}/${linkType}/${issueId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 hover:text-blue-300"
      title={`View ${scope} activity on GitHub - ${formatted.tooltip}`}
    >
      {formatted.label}
    </a>
  );
};

const isBot = (login: string) => login.includes("[bot]");

const renderMetricCell = (
  value: number,
  rank: number | null | undefined,
  login: string,
  formatter: (input: number) => string = (input) => numberFormatter.format(input),
) => {
  const valueText = formatter(value);
  const rankText = isBot(login)
    ? " (bot)"
    : rank !== null && rank !== undefined
      ? ` (#${numberFormatter.format(rank)})`
      : "";

  return createRightCell(
    <span className="tabular-nums text-base">
      {valueText}
      <span className="text-gray-400">{rankText}</span>
    </span>,
  );
};

export function createColumns(repoRef?: string): ColumnDef<UserActivityOverview>[] {
  return [
    {
      accessorKey: "gh_login",
      header: (props) => createStandardHeader(props, "Name"),
      cell: ({ row }) => {
        const login = row.getValue("gh_login") as string;
        return (
          <div className="max-w-[280px] truncate">
            <Link
              to={buildContributorPath(login, repoRef)}
              className="block truncate text-blue-400 hover:text-blue-300"
              title={login}
            >
              {login}
            </Link>
          </div>
        );
      },
      size: 200,
      minSize: 140,
      maxSize: 280,
    },
    {
      accessorKey: "first_seen_timestamp",
      header: (props) => createCompactHeader(props, "First", "Seen"),
      cell: ({ row }) => {
        const activity = row.original;
        return createCenterCell(createTimestampLink(activity, "first"));
      },
      size: 110,
      minSize: 100,
      maxSize: 120,
    },
    {
      accessorKey: "last_seen_timestamp",
      header: (props) => createCompactHeader(props, "Last", "Seen"),
      cell: ({ row }) => {
        const activity = row.original;
        return createCenterCell(createTimestampLink(activity, "last"));
      },
      size: 110,
      minSize: 100,
      maxSize: 120,
    },
    {
      accessorKey: "prs_merged",
      header: (props) => createCompactHeader(props, "PRs", "Merged"),
      cell: ({ row }) => {
        const activity = row.original;
        return renderMetricCell(activity.prs_merged, activity.prs_merged_rank, activity.gh_login);
      },
      size: 150,
    },
    {
      accessorKey: "prs_reviewed",
      header: (props) => createCompactHeader(props, "PRs", "Reviewed"),
      cell: ({ row }) => {
        const activity = row.original;
        return renderMetricCell(
          activity.prs_reviewed,
          activity.prs_reviewed_rank,
          activity.gh_login,
        );
      },
      size: 150,
    },
    {
      accessorKey: "pr_comments",
      header: (props) => createCompactHeader(props, "PR", "Comments"),
      cell: ({ row }) => {
        const activity = row.original;
        return renderMetricCell(activity.pr_comments, activity.pr_comments_rank, activity.gh_login);
      },
      size: 150,
    },
    {
      accessorKey: "lines_modified",
      header: (props) => createCompactHeader(props, "Lines", "Modified"),
      cell: ({ row }) => {
        const activity = row.original;
        return renderMetricCell(
          activity.lines_modified,
          activity.lines_modified_rank,
          activity.gh_login,
          formatMetricValue,
        );
      },
      size: 160,
    },
  ];
}

export const columns = createColumns();
