import type { CSSProperties, KeyboardEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  File,
  Folder,
  FolderOpen,
  GitPullRequest,
  Loader2,
  Users,
} from "lucide-react";
import { Button } from "./ui/button";
import type { FileSystemNode } from "../../../shared/models/fileSystemTree";

export const TREE_INDENT_PX = 12;

interface TreeNodeProps {
  node: FileSystemNode;
  displayName?: string;
  isExpanded: boolean;
  hasChildren: boolean;
  depth: number;
  onToggle: (path: string, isExpanded: boolean, collapsePath?: string) => void;
  togglePath?: string;
  collapsePath?: string;
  isLoading?: boolean;
  isSelected: boolean;
  onSelect: (path: string | null) => void;
  nodeRef?: (element: HTMLDivElement | null) => void;
}

export function TreeNode({
  node,
  displayName,
  isExpanded,
  hasChildren,
  depth,
  onToggle,
  togglePath,
  collapsePath,
  isLoading = false,
  isSelected,
  onSelect,
  nodeRef,
}: TreeNodeProps) {
  const handleToggle = () => {
    if (node.type === "folder" && hasChildren) {
      const nextTogglePath = togglePath ?? node.path;
      onToggle(nextTogglePath, !isExpanded, collapsePath ?? nextTogglePath);
    }
  };

  const handleSelect = () => {
    onSelect(isSelected ? null : node.path);
  };

  const getIcon = () => {
    if (node.type === "folder") {
      return isExpanded ? (
        <FolderOpen className="h-4 w-4 text-blue-400" />
      ) : (
        <Folder className="h-4 w-4 text-blue-400" />
      );
    }
    return <File className="h-4 w-4 text-gray-400" />;
  };

  const getExpandIcon = () => {
    if (isLoading) {
      return <Loader2 className="h-4 w-4 animate-spin text-gray-400" />;
    }

    if (node.type === "folder" && hasChildren) {
      return isExpanded ? (
        <ChevronDown className="h-4 w-4 text-gray-400" />
      ) : (
        <ChevronRight className="h-4 w-4 text-gray-400" />
      );
    }
    return <div className="h-4 w-4" />; // Spacer
  };

  // Compact formatting that always prefers suffix for >= 1000
  // Ensures the result length <= maxLen. Uses k/M/B and trims decimals if needed.
  const formatCompact = (num: number, maxLen: number): string => {
    const abs = Math.abs(num);
    const scales: Array<{ v: number; s: string }> = [
      { v: 1e9, s: "B" },
      { v: 1e6, s: "M" },
      { v: 1e3, s: "k" },
    ];
    // Prefer suffix for >= 1000
    if (abs >= 1000) {
      for (const { v, s } of scales) {
        if (abs >= v) {
          const val = abs / v;
          // Try with 1 decimal, then 0
          let str = val.toFixed(1);
          if (str.endsWith(".0")) str = str.slice(0, -2);
          const withS = str + s;
          if (withS.length <= maxLen) return withS;
          const intStr = Math.round(val).toString() + s;
          if (intStr.length <= maxLen) return intStr;
          // If still too long, fall back to truncation of the integer part
          const bare = Math.round(val).toString();
          return (bare + s).slice(0, maxLen);
        }
      }
    }
    // For < 1000, use raw (
    const raw = abs.toString();
    if (raw.length <= maxLen) return raw;
    return raw.slice(0, maxLen);
  };

  // For churn sub-blocks: 7 chars, no explicit sign, color indicates semantics
  const formatChurnBlock = (value: number): string => {
    return formatCompact(value, 7);
  };

  // Right-hand data view: fixed column widths (in characters)
  const COL_WIDTHS = {
    files: 5, // 📄
    contributors: 4, // 👤
    pulls: 5, // 🔀
    churn: 15, // adds(7) + space(1) + subs(7)
    author: 24, // username (pct)
  } as const;

  // Fixed-width block styling helpers
  const blockStyle = (ch: number): CSSProperties => ({
    width: `${ch}ch`,
    display: "inline-block",
    textAlign: "right",
  });
  const ICON_CH = 2; // width we reserve for an icon glyph

  const getTopContributor = () => {
    if (node.contributors && node.contributors.length > 0) {
      return node.contributors[0];
    }
    return null;
  };

  const topContributor = getTopContributor();
  const nodeDisplayName = displayName ?? node.name;

  // Build right-hand column values (as strings for padding width calc)
  const filesStr = formatCompact(node.total_files, COL_WIDTHS.files);
  const contributorsStr = formatCompact(node.total_contributors, COL_WIDTHS.contributors);
  const pullsStr = formatCompact(node.total_prs, COL_WIDTHS.pulls);

  const addsStr = formatChurnBlock(node.total_adds);
  const subsStr = formatChurnBlock(node.total_subs);

  const displayAuthor = (() => {
    if (!topContributor) return null;
    const username = topContributor.gh_login || "";
    const pct = `${topContributor.pct_of_changes.toFixed(1)}%`;
    const truncated = username.length > 15 ? username.slice(0, 12) + "..." : username;
    const text = `${truncated} (${pct})`;
    return { text, title: username };
  })();

  const getHealthNameClass = () => {
    if (!node.health || node.health.state === "neutral") return "text-white";
    switch (node.health.state) {
      case "good":
        return "text-green-400";
      case "caution":
        return "text-yellow-400";
      case "warn":
        return "text-orange-400";
      case "critical":
        return "text-red-400";
      default:
        return "text-white";
    }
  };

  return (
    <div
      ref={nodeRef}
      className={`group relative cursor-pointer rounded px-2 py-1 hover:bg-gray-700/70 ${
        isSelected ? "bg-gray-600/80" : ""
      }`}
      onClick={(e) => {
        e.stopPropagation();
        handleSelect();
      }}
      onKeyDown={(event: KeyboardEvent<HTMLDivElement>) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          handleSelect();
        }
      }}
      role="button"
      tabIndex={0}
      style={{ paddingLeft: `${depth * TREE_INDENT_PX}px` }}
    >
      <div className="flex w-full items-center gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 p-0 hover:bg-transparent"
          onClick={(e) => {
            e.stopPropagation();
            handleToggle();
          }}
          disabled={isLoading || node.type === "file" || !hasChildren}
        >
          {getExpandIcon()}
        </Button>

        <div className="flex min-w-0 flex-1 items-center gap-2">
          <span className="flex h-6 w-6 items-center justify-center text-blue-400">
            {getIcon()}
          </span>
          <span className={`truncate text-sm font-sans ${getHealthNameClass()}`} title={node.path}>
            {nodeDisplayName}
          </span>
        </div>

        <div
          className="hidden shrink-0 text-xs text-gray-300 md:block"
          style={{
            fontFamily:
              "Fira Code, Source Code Pro, ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
          }}
        >
          <span style={blockStyle(COL_WIDTHS.files + 1 + ICON_CH)}>
            {node.type === "folder" ? (
              <>
                <span>{filesStr}</span>
                <span></span>
                <span
                  className="inline-flex items-center justify-center text-gray-300"
                  style={{ width: `${ICON_CH}ch` }}
                >
                  <File className="h-[1em] w-[1em]" />
                </span>
              </>
            ) : null}
          </span>
          <span className="inline-block" style={{ width: "1ch" }} />

          <span style={blockStyle(COL_WIDTHS.contributors + 1 + ICON_CH)}>
            <span>{contributorsStr}</span>
            <span></span>
            <span
              className="inline-flex items-center justify-center text-gray-300"
              style={{ width: `${ICON_CH}ch` }}
            >
              <Users className="h-[1em] w-[1em]" />
            </span>
          </span>
          <span className="inline-block" style={{ width: "1ch" }} />

          <span style={blockStyle(COL_WIDTHS.pulls + 1 + ICON_CH)}>
            <span>{pullsStr}</span>
            <span></span>
            <span
              className="inline-flex items-center justify-center text-gray-300"
              style={{ width: `${ICON_CH}ch` }}
            >
              <GitPullRequest className="h-[1em] w-[1em]" />
            </span>
          </span>
          <span className="inline-block" style={{ width: "1ch" }} />

          <span
            style={{
              display: "inline-flex",
              width: `${COL_WIDTHS.churn}ch`,
              justifyContent: "flex-end",
              columnGap: "1ch",
              whiteSpace: "nowrap",
            }}
          >
            <span className="text-green-400">{addsStr}</span>
            <span className="text-red-400">{subsStr}</span>
          </span>
          <span className="inline-block" style={{ width: "1ch" }} />

          {displayAuthor ? (
            <span
              title={displayAuthor.title}
              className="text-gray-200"
              style={blockStyle(COL_WIDTHS.author)}
            >
              {displayAuthor.text}
            </span>
          ) : (
            <span style={blockStyle(COL_WIDTHS.author)}>-</span>
          )}
        </div>

        <div className="ml-2 flex flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[11px] text-gray-300 md:hidden">
          {node.type === "folder" && (
            <span className="inline-flex items-center gap-1">
              <File className="h-3 w-3" />
              {filesStr}
            </span>
          )}
          <span className="inline-flex items-center gap-1">
            <Users className="h-3 w-3" />
            {contributorsStr}
          </span>
          <span className="inline-flex items-center gap-1">
            <GitPullRequest className="h-3 w-3" />
            {pullsStr}
          </span>
          <span className="inline-flex items-center gap-1">
            <span className="text-green-400">{addsStr}</span>
            <span className="text-red-400">{subsStr}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
