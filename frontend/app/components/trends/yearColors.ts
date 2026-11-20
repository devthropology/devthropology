const YEAR_COLOR_ANCHOR = 2026;

const YEAR_COLOR_PALETTE = [
  "#3B82F6",
  "#22C55E",
  "#EF4444",
  "#F97316",
  "#EAB308",
  "#A855F7",
  "#14B8A6",
  "#93C5FD",
  "#86EFAC",
  "#FCA5A5",
  "#FDBA74",
  "#FDE047",
  "#D8B4FE",
  "#5EEAD4",
  "#1D4ED8",
  "#15803D",
  "#B91C1C",
  "#C2410C",
  "#A16207",
  "#7E22CE",
  "#0F766E",
];

function clampByte(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

export function getYearColor(year: number) {
  const paletteIndex =
    (((YEAR_COLOR_ANCHOR - year) % YEAR_COLOR_PALETTE.length) + YEAR_COLOR_PALETTE.length) %
    YEAR_COLOR_PALETTE.length;
  return YEAR_COLOR_PALETTE[paletteIndex];
}

export function getYearPillStyle(year: number, isSelected: boolean) {
  if (!isSelected) {
    return undefined;
  }

  const yearColor = getYearColor(year);

  return {
    backgroundColor: hexToRgba(yearColor, 0.18),
    borderColor: hexToRgba(yearColor, 0.4),
    color: yearColor,
  };
}

export function hexToRgba(hex: string, alpha: number) {
  const normalized = hex.replace("#", "");
  const expanded =
    normalized.length === 3
      ? normalized
          .split("")
          .map((char) => `${char}${char}`)
          .join("")
      : normalized;

  const red = Number.parseInt(expanded.slice(0, 2), 16);
  const green = Number.parseInt(expanded.slice(2, 4), 16);
  const blue = Number.parseInt(expanded.slice(4, 6), 16);

  return `rgba(${clampByte(red)}, ${clampByte(green)}, ${clampByte(blue)}, ${alpha})`;
}
