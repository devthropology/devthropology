import { CircleHelp, Loader2 } from "lucide-react";
import { cn } from "../../lib/utils";

export function ReportTiersToggle({
  checked,
  onChange,
  description,
  loading = false,
  disabled = false,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  description: string;
  loading?: boolean;
  disabled?: boolean;
}) {
  const unavailable = disabled || loading;
  return (
    <div className={cn("flex items-center gap-2", unavailable && "opacity-50")}>
      <span className="flex items-center gap-1 text-xs text-slate-400">
        <span>Show Tiers</span>
        <span className="inline-flex text-slate-500" title={description} aria-label={description}>
          <CircleHelp className="h-3.5 w-3.5" />
        </span>
        {loading && <Loader2 className="inline h-3 w-3 animate-spin" />}
      </span>
      <button
        type="button"
        role="switch"
        aria-label="Show Tiers"
        aria-checked={checked}
        disabled={unavailable}
        onClick={() => onChange(!checked)}
        className={cn(
          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400",
          unavailable
            ? "bg-slate-700 cursor-not-allowed"
            : checked
              ? "bg-blue-600"
              : "bg-slate-600",
        )}
      >
        <span
          className={cn(
            "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
            checked && !unavailable ? "translate-x-4" : "translate-x-0.5",
          )}
        />
      </button>
    </div>
  );
}
