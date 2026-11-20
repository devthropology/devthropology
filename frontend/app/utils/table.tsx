import React from "react";
import { Button } from "../components/ui/button";
import { ArrowUpDown } from "lucide-react";
import { Link } from "react-router";
import type { RowData } from "@tanstack/react-table";
import type { DataTableColumn as Column } from "../components/ui/data-table-features";

// Constants for display limits
export const USERNAME_DISPLAY_MAX_LENGTH = 20;
export const TITLE_DISPLAY_MAX_LENGTH = 80;

/**
 * Truncates a username for display with ellipsis and provides a title hover
 */
export function truncateUsername(username: string): {
  displayName: string;
  shouldTruncate: boolean;
} {
  const shouldTruncate = username.length > USERNAME_DISPLAY_MAX_LENGTH;
  const displayName = shouldTruncate
    ? username.substring(0, USERNAME_DISPLAY_MAX_LENGTH) + "..."
    : username;

  return { displayName, shouldTruncate };
}

/**
 * Creates a username link with truncation and hover tooltip
 */
export function createUsernameLink(
  username: string,
  linkPath: string,
  className = "text-blue-400 hover:text-blue-300",
) {
  const { displayName, shouldTruncate } = truncateUsername(username);

  return (
    <Link to={linkPath} className={className} title={shouldTruncate ? username : undefined}>
      {displayName}
    </Link>
  );
}

/**
 * Creates a compact, multi-line header for table columns
 */
export function createCompactHeader<T extends RowData>(
  { column }: { column: Column<T> },
  line1: string,
  line2?: string,
) {
  return (
    <Button
      variant="ghost"
      className="h-auto px-2 py-1 text-base"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      <div className="flex items-center justify-center space-x-1">
        <div className="flex flex-col items-center leading-tight">
          <span className="whitespace-nowrap">{line1}</span>
          {line2 && <span className="whitespace-nowrap">{line2}</span>}
        </div>
        <ArrowUpDown className="h-3 w-3 flex-shrink-0 ml-1" />
      </div>
    </Button>
  );
}

/**
 * Creates a standard single-line header for table columns
 */
export function createStandardHeader<T extends RowData>(
  { column }: { column: Column<T> },
  title: string,
) {
  return (
    <Button
      variant="ghost"
      className="h-auto px-2 py-1 text-base"
      onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
    >
      <span className="whitespace-nowrap">{title}</span>
      <ArrowUpDown className="ml-1 h-3 w-3" />
    </Button>
  );
}

// Centralized cell styling classes
export const CELL_STYLES = {
  center: "text-center text-base",
  right: "text-right text-base",
  left: "text-left text-base",
  centerTime: "text-center text-base",
  rightTime: "text-right text-base",
} as const;

/**
 * Creates a centered cell with consistent styling
 */
export function createCenterCell(value: React.ReactNode, className?: string) {
  return <div className={`${CELL_STYLES.center} ${className || ""}`}>{value}</div>;
}

/**
 * Creates a right-aligned cell with consistent styling
 */
export function createRightCell(value: React.ReactNode, className?: string) {
  return <div className={`${CELL_STYLES.right} ${className || ""}`}>{value}</div>;
}

/**
 * Creates a time cell with consistent styling
 */
export function createTimeCell(
  value: React.ReactNode,
  align: "left" | "center" | "right" = "right",
  className?: string,
) {
  const alignClass =
    align === "center"
      ? CELL_STYLES.centerTime
      : align === "right"
        ? CELL_STYLES.rightTime
        : "text-left text-base";

  return <div className={`${alignClass} ${className || ""}`}>{value}</div>;
}
