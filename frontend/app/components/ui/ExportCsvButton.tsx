import { Download } from "lucide-react";
import { cn } from "../../lib/utils";

export function ExportCsvButton({
  onExport,
  disabled = false,
  title = "Export the current table as CSV",
}: {
  onExport: () => void;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      type="button"
      onClick={onExport}
      disabled={disabled}
      title={title}
      aria-label="Export CSV"
      className={cn(
        "flex items-center gap-1.5 rounded-md border border-white/20 px-2.5 py-1 text-xs font-medium text-gray-300 transition-colors",
        disabled ? "cursor-not-allowed opacity-50" : "hover:border-white/40 hover:text-white",
      )}
    >
      <Download className="h-3.5 w-3.5" />
      <span>Export CSV</span>
    </button>
  );
}
