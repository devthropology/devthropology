import type { MutableRefObject } from "react";
import type { ChartType, TooltipModel } from "chart.js";

type TooltipRow = {
  label: string;
  value: string;
  delta?: string | null;
  deltaColor?: string;
  seriesColor: string;
};

type TooltipSection = {
  label: string;
  rows: TooltipRow[];
  strokeColor?: string;
  strokeWidth?: number;
  strokeDash?: number[];
};

export function ensureTooltipElement(
  parent: HTMLElement,
  tooltipRef: MutableRefObject<HTMLDivElement | null>,
) {
  if (tooltipRef.current) {
    if (!tooltipRef.current.isConnected || tooltipRef.current.parentElement !== parent) {
      tooltipRef.current.remove();
      tooltipRef.current = null;
    } else {
      return tooltipRef.current;
    }
  }

  const tooltipEl = document.createElement("div");
  tooltipEl.className =
    "pointer-events-none absolute z-50 rounded-md border border-white/10 bg-slate-900/95 text-white shadow-xl backdrop-blur-sm";
  tooltipEl.style.display = "inline-block";
  tooltipEl.style.width = "max-content";
  tooltipEl.style.maxWidth = "340px";
  tooltipEl.style.opacity = "0";
  tooltipEl.style.transform = "translate(0, -50%)";
  tooltipEl.style.transition = "opacity 120ms ease";
  tooltipEl.style.padding = "0.5rem 0.625rem";

  const content = document.createElement("div");
  content.dataset.role = "tooltip-content";
  content.className = "flex flex-col gap-2 text-xs";
  tooltipEl.appendChild(content);

  if (getComputedStyle(parent).position === "static") {
    parent.style.position = "relative";
  }

  parent.appendChild(tooltipEl);
  tooltipRef.current = tooltipEl;
  return tooltipEl;
}

export function positionTooltipElement({
  chart,
  tooltip,
  tooltipEl,
  caretX,
  caretY,
}: {
  chart: { canvas: HTMLCanvasElement };
  tooltip: TooltipModel<ChartType>;
  tooltipEl: HTMLDivElement;
  caretX?: number;
  caretY?: number;
}) {
  const parent = chart.canvas.parentNode as HTMLElement | null;
  if (!parent) {
    return;
  }

  const { offsetLeft, offsetTop } = chart.canvas;
  const resolvedCaretX = offsetLeft + (caretX ?? tooltip.caretX);
  const resolvedCaretY = offsetTop + (caretY ?? tooltip.caretY);
  const horizontalGap = 14;
  const parentWidth = parent.clientWidth;
  const tooltipWidth = tooltipEl.offsetWidth || 280;
  const rightX = resolvedCaretX + horizontalGap;
  const leftX = resolvedCaretX - horizontalGap - tooltipWidth;

  let positionedLeft = rightX;
  if (rightX + tooltipWidth > parentWidth - 12 && leftX >= 12) {
    positionedLeft = leftX;
  }

  tooltipEl.style.left = `${positionedLeft}px`;
  tooltipEl.style.top = `${resolvedCaretY}px`;
}

export function renderLineChartTooltip({
  chart,
  tooltip,
  tooltipRef,
  rows,
  sections,
}: {
  chart: { canvas: HTMLCanvasElement };
  tooltip: TooltipModel<ChartType>;
  tooltipRef: MutableRefObject<HTMLDivElement | null>;
  rows?: TooltipRow[];
  sections?: TooltipSection[];
}) {
  const parent = chart.canvas.parentNode as HTMLElement | null;
  if (!parent) {
    return;
  }

  const tooltipEl = ensureTooltipElement(parent, tooltipRef);
  const content = tooltipEl.querySelector<HTMLDivElement>("[data-role='tooltip-content']");
  if (!content) {
    return;
  }

  const resolvedRows = rows ?? [];
  const resolvedSections = sections ?? [];

  if (
    tooltip.opacity === 0 ||
    (resolvedRows.length === 0 && resolvedSections.every((section) => section.rows.length === 0))
  ) {
    tooltipEl.style.opacity = "0";
    return;
  }

  content.replaceChildren();

  const title = document.createElement("div");
  title.className = "text-sm font-semibold text-white";
  title.textContent = tooltip.title?.[0] ?? "";
  content.appendChild(title);

  function appendRow(row: TooltipRow, parentEl: HTMLElement) {
    const line = document.createElement("div");
    line.className = "flex items-start gap-1.5 text-xs";

    const swatch = document.createElement("span");
    swatch.className = "mt-0.5 inline-block h-3 w-3 shrink-0 rounded-full";
    swatch.style.backgroundColor = row.seriesColor;
    line.appendChild(swatch);

    const label = document.createElement("span");
    label.className = "font-medium text-white";
    label.style.whiteSpace = "normal";
    label.textContent = `${row.label}: ${row.value}`;
    line.appendChild(label);

    if (row.delta) {
      const delta = document.createElement("span");
      delta.className = "shrink-0 font-medium";
      delta.style.color = row.deltaColor ?? "rgba(255, 255, 255, 0.92)";
      delta.textContent = `(${row.delta})`;
      line.appendChild(delta);
    }

    parentEl.appendChild(line);
  }

  if (resolvedSections.length > 0) {
    resolvedSections.forEach((section) => {
      if (section.rows.length === 0) {
        return;
      }

      const sectionEl = document.createElement("div");
      sectionEl.className = "flex flex-col gap-1.5";

      const sectionTitle = document.createElement("div");
      sectionTitle.className =
        "flex items-center justify-between gap-2 text-xs font-semibold text-white";

      const sectionLabel = document.createElement("span");
      sectionLabel.textContent = section.label;
      sectionTitle.appendChild(sectionLabel);

      if (section.strokeColor) {
        const stroke = document.createElement("span");
        stroke.className = "inline-block w-4 shrink-0";
        stroke.style.borderTop = `${section.strokeWidth ?? 2}px solid ${section.strokeColor}`;
        if (section.strokeDash?.length) {
          stroke.style.borderTopStyle = "dashed";
        }
        sectionTitle.appendChild(stroke);
      }
      sectionEl.appendChild(sectionTitle);

      const rowsEl = document.createElement("div");
      rowsEl.className = "ml-2 flex flex-col gap-1";
      section.rows.forEach((row) => appendRow(row, rowsEl));
      sectionEl.appendChild(rowsEl);

      content.appendChild(sectionEl);
    });
  } else {
    resolvedRows.forEach((row) => appendRow(row, content));
  }

  tooltipEl.style.opacity = "1";

  positionTooltipElement({ chart, tooltip, tooltipEl });
}
