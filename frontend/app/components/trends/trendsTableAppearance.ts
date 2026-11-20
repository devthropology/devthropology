import type { DataTableAppearance, DataTableSurface } from "~/components/ui/data-table";

export const CONTRIBUTION_FLOW_TABLE_APPEARANCE: DataTableAppearance = {
  container: "border-white/10 bg-transparent",
  headerCell: "text-sm font-semibold tracking-tight text-slate-100 border-white/10",
  pinnedHeaderCell: "border-white/10 shadow-[1px_0_0_rgba(255,255,255,0.08)]",
  bodyCell: "py-2.5 border-white/10",
  pinnedBodyCell: "border-white/10 shadow-[1px_0_0_rgba(255,255,255,0.08)]",
  row: "hover:bg-transparent data-[state=selected]:bg-transparent",
  pinnedRow: "border-white/10",
  pinnedLastRow: "border-white/10 shadow-[0_8px_24px_-18px_rgba(15,23,42,0.9)]",
};

export const CONTRIBUTION_FLOW_TABLE_SURFACE: DataTableSurface = {
  headerBg: "#333a4a",
  bodyBg: "transparent",
  pinnedBg: "rgba(51,58,74,0.98)",
  pinnedShadowColor: "rgba(15,23,42,0.55)",
};
