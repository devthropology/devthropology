import React from "react";
import type { DataTableColumnDef as ColumnDef } from "./ui/data-table-features";
import type { FileSystemContributor } from "../../../shared/models/fileSystemTree";
import { DataTable } from "./ui/data-table";
import { Link } from "react-router";
import { createCompactHeader, createRightCell } from "../utils/table";
import { buildContributorPath, useCurrentRepoRef } from "../utils/repositoryRoutes";

interface ContributorTableProps {
  contributors: FileSystemContributor[];
}

const formatNumber = (num: number) => {
  if (num >= 1000) {
    return (num / 1000).toFixed(1) + "k";
  }
  return num.toString();
};

const formatShortDate = (iso: string) => {
  const d = new Date(iso);
  // Match app.users.$userName.tsx formatting (default locale date string)
  return d.toLocaleDateString();
};

function createColumns(repoRef?: string): ColumnDef<FileSystemContributor>[] {
  return [
    {
      accessorKey: "gh_login",
      header: (props) => createCompactHeader(props, "Contributor"),
      cell: ({ row }) => {
        const login = row.getValue("gh_login") as string;
        return (
          <Link
            to={buildContributorPath(login, repoRef)}
            className="text-blue-400 hover:text-blue-300 block truncate"
            title={login}
          >
            {login}
          </Link>
        );
      },
      size: 180,
    },
    {
      accessorKey: "total_changes",
      header: (props) => createCompactHeader(props, "Changes"),
      size: 120,
      minSize: 100,
      cell: ({ row }) => {
        const contributor = row.original;
        const total = contributor.total_changes;
        const additions = contributor.total_adds;
        const deletions = contributor.total_subs;

        return createRightCell(
          <div className="whitespace-nowrap">
            {formatNumber(total)}
            {"  "}(<span className="text-green-400">+{formatNumber(additions)}</span>,{" "}
            <span className="text-red-400">-{formatNumber(deletions)}</span>)
          </div>,
        );
      },
    },
    {
      accessorKey: "num_prs",
      header: (props) => createCompactHeader(props, "Pulls"),
      cell: ({ row }) => {
        const prs = row.original.num_prs;
        return createRightCell(prs);
      },
      size: 70,
    },
    {
      accessorKey: "first_seen_in_directory",
      header: (props) => createCompactHeader(props, "First Active"),
      cell: ({ row }) => {
        const iso = row.original.first_seen_in_directory;
        return (
          <div className="text-right text-base" title={new Date(iso).toLocaleString()}>
            {formatShortDate(iso)}
          </div>
        );
      },
      size: 110,
      minSize: 100,
    },
    {
      accessorKey: "last_seen_in_directory",
      header: (props) => createCompactHeader(props, "Last Active"),
      cell: ({ row }) => {
        const iso = row.original.last_seen_in_directory;
        return (
          <div className="text-right text-base" title={new Date(iso).toLocaleString()}>
            {formatShortDate(iso)}
          </div>
        );
      },
      size: 110,
      minSize: 100,
    },
    {
      accessorKey: "pct_of_changes",
      header: (props) => createCompactHeader(props, "Line Share"),
      cell: ({ row }) => {
        const pct = row.original.pct_of_changes;
        return createRightCell(`${pct.toFixed(1)}%`);
      },
      size: 100,
    },
    {
      accessorKey: "pct_of_prs",
      header: (props) => createCompactHeader(props, "Pull Share"),
      cell: ({ row }) => {
        const pct = row.original.pct_of_prs;
        return createRightCell(`${pct.toFixed(1)}%`);
      },
      size: 100,
    },
  ];
}

export function ContributorTable({ contributors }: ContributorTableProps) {
  const repoRef = useCurrentRepoRef();
  // Sort contributors by percentage of changes (descending)
  const sortedContributors = [...contributors].sort((a, b) => b.pct_of_changes - a.pct_of_changes);

  return (
    <DataTable
      columns={createColumns(repoRef ?? undefined)}
      data={sortedContributors}
      maxHeight="100%"
    />
  );
}
