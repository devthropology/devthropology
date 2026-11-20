import type { TrendsPrSizeBucket } from "../../../../shared/models/trendsInsights";

export const SIZE_BUCKET_COLORS: Record<TrendsPrSizeBucket, string> = {
  "Micro (0-10)": "#0ea5e9",
  "Small (11-75)": "#10b981",
  "Medium (76-250)": "#6366f1",
  "Large (251-500)": "#eab308",
  "XL (501-1000)": "#f97316",
  "Oversized (1000+)": "#ef4444",
};

export const PR_SIZE_BUCKET_SHORT_LABELS: Record<TrendsPrSizeBucket, string> = {
  "Micro (0-10)": "Micro",
  "Small (11-75)": "Small",
  "Medium (76-250)": "Medium",
  "Large (251-500)": "Large",
  "XL (501-1000)": "XL",
  "Oversized (1000+)": "Oversized",
};
