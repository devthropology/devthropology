import { Link } from "react-router";
import { useEffect, useRef } from "react";
import type { MutableRefObject } from "react";
import { Chart, registerables } from "chart.js";
import type { UserActivityByMonth } from "~/routes/types";
import { buildContributorPath, useCurrentRepoRef } from "~/utils/repositoryRoutes";

Chart.register(...registerables);

const NEW_CONTRIBUTOR_DAYS = 30;
const CHURNED_MIN_INACTIVE_DAYS = 30;
const CHURNED_MAX_INACTIVE_DAYS = 60;

type UserDetail = { login: string; date?: string };
type ContributorListItem = { username: string; date: string };

function getUserDetails(
  entry: UserActivityByMonth,
  variant: "active" | "joined" | "churned",
): UserDetail[] {
  const details =
    variant === "active"
      ? entry.active_details
      : variant === "joined"
        ? entry.first_seen_details
        : entry.last_seen_details;

  if (!Array.isArray(details) || details.length === 0) {
    return [];
  }

  return [...details]
    .map(({ login, date }) => ({ login, date }))
    .sort((a, b) => {
      if (!a.date || !b.date) return 0;
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    });
}

function filterChurnDetails(details: UserDetail[], cutoff: Date): UserDetail[] {
  return details.filter((detail) =>
    detail.date ? new Date(detail.date).getTime() <= cutoff.getTime() : false,
  );
}

function ensureTooltipElement(
  parent: HTMLElement,
  tooltipRef: MutableRefObject<HTMLDivElement | null>,
): HTMLDivElement {
  if (tooltipRef.current) {
    return tooltipRef.current;
  }

  const tooltipEl = document.createElement("div");
  tooltipEl.className =
    "pointer-events-none absolute z-50 rounded-md border border-white/10 bg-slate-900/95 text-white shadow-xl backdrop-blur-sm";
  tooltipEl.style.minWidth = "220px";
  tooltipEl.style.maxWidth = "280px";
  tooltipEl.style.opacity = "0";
  tooltipEl.style.transform = "translate(-50%, calc(-100% - 12px))";
  tooltipEl.style.transition = "opacity 120ms ease";
  tooltipEl.style.padding = "0.75rem";

  const contentWrapper = document.createElement("div");
  contentWrapper.dataset.role = "tooltip-content";
  contentWrapper.className = "flex flex-col gap-2 text-xs";
  tooltipEl.appendChild(contentWrapper);

  if (getComputedStyle(parent).position === "static") {
    parent.style.position = "relative";
  }

  parent.appendChild(tooltipEl);
  tooltipRef.current = tooltipEl;
  return tooltipEl;
}

interface Props {
  monthlyData: UserActivityByMonth[];
}

function formatDate(dateString: string): string {
  const date = new Date(dateString);
  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: date.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
    timeZone: "UTC",
  });
}

function formatMonthLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function formatMonthTickLabel(date: Date): string {
  return date.toLocaleDateString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
}

function ContributorList({
  contributors,
  dateLabel,
  variant,
}: {
  contributors: ContributorListItem[];
  dateLabel: string;
  variant?: "joined" | "churned";
}) {
  const repoRef = useCurrentRepoRef();
  // Sort contributors by date descending (most recent first)
  const sortedContributors = [...contributors].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime(),
  );

  const dateColor =
    variant === "churned"
      ? "text-orange-400"
      : variant === "joined"
        ? "text-green-400"
        : "text-gray-400";

  return (
    <div className="max-h-48 overflow-y-auto">
      {sortedContributors.length === 0 ? (
        <p className="text-gray-400 text-center py-3 text-sm">No contributors</p>
      ) : (
        <div className="space-y-0.5">
          {sortedContributors.map((contributor) => (
            <div
              key={contributor.username}
              className="flex items-center justify-between px-2 py-1.5 rounded hover:bg-white/5 transition-colors"
            >
              <Link
                to={buildContributorPath(contributor.username, repoRef ?? undefined)}
                className="text-blue-400 hover:text-blue-300 font-medium text-sm"
              >
                {contributor.username}
              </Link>
              <span
                className={`text-xs ${dateColor}`}
                title={`${dateLabel}: ${formatDate(contributor.date)}`}
              >
                {formatDate(contributor.date)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function ContributorTrendsChart({ monthlyData }: { monthlyData: UserActivityByMonth[] }) {
  const repoRef = useCurrentRepoRef();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  const tooltipHoveringRef = useRef(false);

  useEffect(() => {
    if (!canvasRef.current) return;

    const churnCutoff = new Date();
    churnCutoff.setDate(churnCutoff.getDate() - 30);

    // Destroy existing chart
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    if (tooltipRef.current) {
      tooltipRef.current.remove();
      tooltipRef.current = null;
    }

    if (!monthlyData.length) return;

    const sortedMonthlyData = [...monthlyData].sort(
      (a, b) => new Date(a.month).getTime() - new Date(b.month).getTime(),
    );
    const now = new Date();
    const currentYear = now.getUTCFullYear();
    const currentMonth = now.getUTCMonth();
    const monthDates = sortedMonthlyData.map((item) => new Date(item.month));
    const lastSeenSeries = sortedMonthlyData.map((item, index) => {
      const date = monthDates[index];
      if (date.getUTCFullYear() === currentYear && date.getUTCMonth() === currentMonth) {
        return null;
      }
      const churnDetails = filterChurnDetails(getUserDetails(item, "churned"), churnCutoff);
      return churnDetails.length;
    });

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    const cancelHide = () => {
      if (hideTimeoutRef.current !== null) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    };

    const hideTooltip = () => {
      cancelHide();
      if (tooltipRef.current) {
        tooltipRef.current.style.opacity = "0";
        tooltipRef.current.style.pointerEvents = "none";
      }
    };

    const scheduleHide = (delay = 160) => {
      cancelHide();
      hideTimeoutRef.current = window.setTimeout(() => {
        if (!tooltipHoveringRef.current) {
          hideTooltip();
        }
      }, delay);
    };

    chartRef.current = new Chart(ctx, {
      type: "line",
      data: {
        labels: monthDates.map((date) => formatMonthTickLabel(date)),
        datasets: [
          {
            label: "New",
            data: sortedMonthlyData.map((item) => item.new_contributors),
            borderColor: "rgba(34, 197, 94, 0.8)",
            backgroundColor: "rgba(34, 197, 94, 0.1)",
            pointStyle: "circle",
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: "rgba(34, 197, 94, 0.9)",
            pointBorderColor: "rgba(34, 197, 94, 0.9)",
            pointBorderWidth: 0,
            fill: false,
            tension: 0.1,
          },
          {
            label: "Churned",
            data: lastSeenSeries,
            borderColor: "rgba(251, 146, 60, 0.8)",
            backgroundColor: "rgba(251, 146, 60, 0.1)",
            pointStyle: "circle",
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: "rgba(251, 146, 60, 0.9)",
            pointBorderColor: "rgba(251, 146, 60, 0.9)",
            pointBorderWidth: 0,
            fill: false,
            tension: 0.1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: {
            top: 10,
            right: 10,
            bottom: 10,
            left: 10,
          },
        },
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: {
              color: "white",
              usePointStyle: true,
            },
          },
          title: {
            display: false,
          },
          tooltip: {
            enabled: false,
            external: (context) => {
              const { chart, tooltip } = context;
              if (!chart || !tooltip) return;

              const parent = chart.canvas.parentNode as HTMLElement | null;
              if (!parent) return;

              const tooltipEl = ensureTooltipElement(parent, tooltipRef);
              const content = tooltipEl.querySelector<HTMLDivElement>(
                "[data-role='tooltip-content']",
              );
              if (!content) return;

              if (!tooltipEl.dataset.listenerAttached) {
                tooltipEl.addEventListener("mouseenter", () => {
                  tooltipHoveringRef.current = true;
                  cancelHide();
                  tooltipEl.style.opacity = "1";
                  tooltipEl.style.pointerEvents = "auto";
                });
                tooltipEl.addEventListener("mouseleave", () => {
                  tooltipHoveringRef.current = false;
                  scheduleHide();
                });
                tooltipEl.dataset.listenerAttached = "true";
              }

              if (tooltip.opacity === 0) {
                scheduleHide();
                return;
              }

              tooltipHoveringRef.current = false;
              cancelHide();

              const dataPoint = tooltip.dataPoints?.[0];
              if (!dataPoint) {
                scheduleHide();
                return;
              }

              const { dataIndex } = dataPoint;
              const seriesLabel = dataPoint.dataset.label ?? "";
              const monthlyEntry = sortedMonthlyData[dataIndex];
              if (!monthlyEntry) {
                scheduleHide();
                return;
              }
              const isJoinedSeries = seriesLabel === "New";
              const isChurnedSeries = seriesLabel === "Churned";
              const lastSeenValue = isChurnedSeries ? lastSeenSeries[dataIndex] : null;

              if (isChurnedSeries && lastSeenValue === null) {
                hideTooltip();
                return;
              }

              const churnedUsers = isChurnedSeries
                ? filterChurnDetails(getUserDetails(monthlyEntry, "churned"), churnCutoff)
                : [];

              const users = isJoinedSeries
                ? getUserDetails(monthlyEntry, "joined")
                : isChurnedSeries
                  ? churnedUsers
                  : [];

              const contributorCount = isJoinedSeries
                ? monthlyEntry.new_contributors
                : isChurnedSeries
                  ? churnedUsers.length
                  : 0;

              content.replaceChildren();

              const header = document.createElement("div");
              header.className = "flex items-center justify-between gap-3 text-white";

              const title = document.createElement("div");
              title.className = "text-sm font-semibold";
              const tooltipTitle = formatMonthLabel(new Date(monthlyEntry.month));
              title.textContent = seriesLabel ? `${tooltipTitle} · ${seriesLabel}` : tooltipTitle;
              header.appendChild(title);

              const countBadge = document.createElement("span");
              countBadge.className =
                seriesLabel === "New"
                  ? "text-xs font-semibold text-green-400"
                  : "text-xs font-semibold text-orange-400";
              countBadge.textContent = `${contributorCount} ${
                contributorCount === 1 ? "user" : "users"
              }`;
              header.appendChild(countBadge);

              content.appendChild(header);

              const listWrapper = document.createElement("div");
              listWrapper.className = "mt-2 max-h-48 overflow-y-auto pr-2 space-y-1";
              listWrapper.style.scrollbarWidth = "thin";
              listWrapper.style.scrollbarColor = "rgba(148, 163, 184, 0.6) transparent";

              if (users.length === 0) {
                const emptyState = document.createElement("p");
                emptyState.className = "text-xs text-slate-300/80";
                emptyState.textContent =
                  seriesLabel === "New"
                    ? "No new contributors recorded."
                    : "No contributors became inactive.";
                listWrapper.appendChild(emptyState);
              } else {
                users.forEach((user) => {
                  const row = document.createElement("div");
                  row.className =
                    "flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-white/10";

                  const link = document.createElement("a");
                  link.href = buildContributorPath(user.login, repoRef ?? undefined);
                  link.className =
                    "text-xs text-blue-300 hover:text-blue-200 font-medium min-w-0 truncate";
                  link.textContent = user.login;
                  link.title = user.login;
                  row.appendChild(link);

                  if (user.date) {
                    const dateEl = document.createElement("span");
                    dateEl.className = isJoinedSeries
                      ? "text-[11px] font-semibold text-green-400 shrink-0 whitespace-nowrap"
                      : "text-[11px] font-semibold text-orange-400 shrink-0 whitespace-nowrap";
                    dateEl.textContent = formatDate(user.date);
                    row.appendChild(dateEl);
                  }

                  listWrapper.appendChild(row);
                });
              }

              content.appendChild(listWrapper);

              tooltipEl.style.opacity = "1";
              tooltipEl.style.pointerEvents = users.length ? "auto" : "none";

              const { offsetLeft, offsetTop } = chart.canvas;
              const caretX = offsetLeft + tooltip.caretX;
              const caretY = offsetTop + tooltip.caretY;
              const horizontalGap = 14;
              const parentWidth = parent.clientWidth;
              const tooltipWidth = tooltipEl.offsetWidth || 260;
              const rightX = caretX + horizontalGap;
              const leftX = caretX - horizontalGap - tooltipWidth;

              let positionedLeft = rightX;
              let translateX = "0";

              if (rightX + tooltipWidth > parentWidth - 12 && leftX >= 12) {
                positionedLeft = leftX;
                translateX = "0";
              }

              tooltipEl.style.left = `${positionedLeft}px`;
              tooltipEl.style.top = `${caretY}px`;
              tooltipEl.style.transform = `translate(${translateX}, -50%)`;
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: "white",
            },
            grid: {
              color: "rgba(255, 255, 255, 0.1)",
            },
          },
          y: {
            beginAtZero: true,
            ticks: {
              color: "white",
              stepSize: 5,
            },
            grid: {
              color: "rgba(255, 255, 255, 0.1)",
            },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
      if (tooltipRef.current) {
        tooltipRef.current.remove();
        tooltipRef.current = null;
      }
      cancelHide();
    };
  }, [monthlyData]);

  return (
    <div className="h-64">
      <canvas ref={canvasRef}></canvas>
    </div>
  );
}

function TotalContributorsChart({ monthlyData }: { monthlyData: UserActivityByMonth[] }) {
  const repoRef = useCurrentRepoRef();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chartRef = useRef<Chart | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);
  const hideTimeoutRef = useRef<number | null>(null);
  const tooltipHoveringRef = useRef(false);

  useEffect(() => {
    if (!canvasRef.current) return;

    // Destroy existing chart
    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    if (tooltipRef.current) {
      tooltipRef.current.remove();
      tooltipRef.current = null;
    }

    if (!monthlyData.length) return;

    const sortedMonthlyData = [...monthlyData].sort(
      (a, b) => new Date(a.month).getTime() - new Date(b.month).getTime(),
    );

    const ctx = canvasRef.current.getContext("2d");
    if (!ctx) return;

    const cancelHide = () => {
      if (hideTimeoutRef.current !== null) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    };

    const hideTooltip = () => {
      cancelHide();
      if (tooltipRef.current) {
        tooltipRef.current.style.opacity = "0";
        tooltipRef.current.style.pointerEvents = "none";
      }
    };

    const scheduleHide = (delay = 160) => {
      cancelHide();
      hideTimeoutRef.current = window.setTimeout(() => {
        if (!tooltipHoveringRef.current) {
          hideTooltip();
        }
      }, delay);
    };

    // Calculate better y-axis range for total contributors
    const values = sortedMonthlyData.map((item) => item.active_users);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    const range = maxValue - minValue;
    const padding = Math.max(range * 0.1, 5); // 10% padding or at least 5
    const stepSize = range > 50 ? 20 : range > 20 ? 10 : 5;
    const yMin = Math.max(0, Math.floor((minValue - padding) / stepSize) * stepSize);
    const yMax = Math.ceil((maxValue + padding) / stepSize) * stepSize;

    chartRef.current = new Chart(ctx, {
      type: "line",
      data: {
        labels: sortedMonthlyData.map((item) => formatMonthTickLabel(new Date(item.month))),
        datasets: [
          {
            label: "Active Contributors",
            data: sortedMonthlyData.map((item) => item.active_users),
            borderColor: "rgba(59, 130, 246, 0.8)",
            backgroundColor: "rgba(59, 130, 246, 0.1)",
            pointStyle: "circle",
            pointRadius: 4,
            pointHoverRadius: 6,
            pointBackgroundColor: "rgba(59, 130, 246, 0.9)",
            pointBorderColor: "rgba(59, 130, 246, 0.9)",
            pointBorderWidth: 0,
            fill: false,
            tension: 0.1,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        layout: {
          padding: {
            top: 10,
            right: 10,
            bottom: 10,
            left: 10,
          },
        },
        plugins: {
          legend: {
            display: true,
            position: "top",
            labels: {
              color: "white",
              usePointStyle: true,
            },
          },
          title: {
            display: false,
          },
          tooltip: {
            enabled: false,
            external: (context) => {
              const { chart, tooltip } = context;
              if (!chart || !tooltip) return;

              const parent = chart.canvas.parentNode as HTMLElement | null;
              if (!parent) return;

              const tooltipEl = ensureTooltipElement(parent, tooltipRef);
              const content = tooltipEl.querySelector<HTMLDivElement>(
                "[data-role='tooltip-content']",
              );
              if (!content) return;

              if (!tooltipEl.dataset.listenerAttached) {
                tooltipEl.addEventListener("mouseenter", () => {
                  tooltipHoveringRef.current = true;
                  cancelHide();
                  tooltipEl.style.opacity = "1";
                  tooltipEl.style.pointerEvents = "auto";
                });
                tooltipEl.addEventListener("mouseleave", () => {
                  tooltipHoveringRef.current = false;
                  scheduleHide();
                });
                tooltipEl.dataset.listenerAttached = "true";
              }

              if (tooltip.opacity === 0) {
                scheduleHide();
                return;
              }

              tooltipHoveringRef.current = false;
              cancelHide();

              const dataPoint = tooltip.dataPoints?.[0];
              if (!dataPoint) {
                scheduleHide();
                return;
              }

              const monthlyEntry = sortedMonthlyData[dataPoint.dataIndex];
              if (!monthlyEntry) {
                scheduleHide();
                return;
              }

              const users = getUserDetails(monthlyEntry, "active");
              const contributorCount = monthlyEntry.active_users;

              content.replaceChildren();

              const header = document.createElement("div");
              header.className = "flex items-center justify-between gap-3 text-white";

              const title = document.createElement("div");
              title.className = "text-sm font-semibold";
              title.textContent = `${formatMonthLabel(new Date(monthlyEntry.month))} · Active`;
              header.appendChild(title);

              const countBadge = document.createElement("span");
              countBadge.className = "text-xs font-semibold text-blue-400";
              countBadge.textContent = `${contributorCount} ${
                contributorCount === 1 ? "user" : "users"
              }`;
              header.appendChild(countBadge);

              content.appendChild(header);

              const listWrapper = document.createElement("div");
              listWrapper.className = "mt-2 max-h-48 overflow-y-auto pr-2 space-y-1";
              listWrapper.style.scrollbarWidth = "thin";
              listWrapper.style.scrollbarColor = "rgba(148, 163, 184, 0.6) transparent";

              if (users.length === 0) {
                const emptyState = document.createElement("p");
                emptyState.className = "text-xs text-slate-300/80";
                emptyState.textContent = "No active contributors recorded.";
                listWrapper.appendChild(emptyState);
              } else {
                users.forEach((user) => {
                  const row = document.createElement("div");
                  row.className =
                    "flex items-center justify-between gap-2 rounded px-2 py-1 hover:bg-white/10";

                  const link = document.createElement("a");
                  link.href = buildContributorPath(user.login, repoRef ?? undefined);
                  link.className =
                    "text-xs text-blue-300 hover:text-blue-200 font-medium min-w-0 truncate";
                  link.textContent = user.login;
                  link.title = user.login;
                  row.appendChild(link);

                  if (user.date) {
                    const dateEl = document.createElement("span");
                    dateEl.className =
                      "text-[11px] font-semibold text-blue-400 shrink-0 whitespace-nowrap";
                    dateEl.textContent = formatDate(user.date);
                    row.appendChild(dateEl);
                  }

                  listWrapper.appendChild(row);
                });
              }

              content.appendChild(listWrapper);

              tooltipEl.style.opacity = "1";
              tooltipEl.style.pointerEvents = users.length ? "auto" : "none";

              const { offsetLeft, offsetTop } = chart.canvas;
              const caretX = offsetLeft + tooltip.caretX;
              const caretY = offsetTop + tooltip.caretY;
              const horizontalGap = 14;
              const parentWidth = parent.clientWidth;
              const tooltipWidth = tooltipEl.offsetWidth || 260;
              const rightX = caretX + horizontalGap;
              const leftX = caretX - horizontalGap - tooltipWidth;

              let positionedLeft = rightX;
              let translateX = "0";

              if (rightX + tooltipWidth > parentWidth - 12 && leftX >= 12) {
                positionedLeft = leftX;
                translateX = "0";
              }

              tooltipEl.style.left = `${positionedLeft}px`;
              tooltipEl.style.top = `${caretY}px`;
              tooltipEl.style.transform = `translate(${translateX}, -50%)`;
            },
            callbacks: {
              title: (items) => {
                const item = items[0];
                if (!item) return "";

                return formatMonthLabel(new Date(sortedMonthlyData[item.dataIndex].month));
              },
            },
          },
        },
        scales: {
          x: {
            ticks: {
              color: "white",
            },
            grid: {
              color: "rgba(255, 255, 255, 0.1)",
            },
          },
          y: {
            beginAtZero: false,
            min: yMin,
            max: yMax,
            ticks: {
              color: "white",
              stepSize: stepSize,
            },
            grid: {
              color: "rgba(255, 255, 255, 0.1)",
            },
          },
        },
      },
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
      }
      if (tooltipRef.current) {
        tooltipRef.current.remove();
        tooltipRef.current = null;
      }
      cancelHide();
    };
  }, [monthlyData, repoRef]);

  return (
    <div className="h-64">
      <canvas ref={canvasRef}></canvas>
    </div>
  );
}

function toContributorList(details: Array<{ login: string; date: string }>): ContributorListItem[] {
  return details.map((detail) => ({
    username: detail.login,
    date: detail.date,
  }));
}

function getRecentNewContributors(monthlyData: UserActivityByMonth[], now: Date) {
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() - NEW_CONTRIBUTOR_DAYS);

  return toContributorList(
    monthlyData
      .flatMap((entry) => entry.first_seen_details)
      .filter((detail) => new Date(detail.date).getTime() >= cutoff.getTime()),
  );
}

function getRecentlyChurnedContributors(monthlyData: UserActivityByMonth[], now: Date) {
  const minCutoff = new Date(now);
  minCutoff.setDate(minCutoff.getDate() - CHURNED_MIN_INACTIVE_DAYS);
  const maxCutoff = new Date(now);
  maxCutoff.setDate(maxCutoff.getDate() - CHURNED_MAX_INACTIVE_DAYS);

  return toContributorList(
    monthlyData
      .flatMap((entry) => entry.last_seen_details)
      .filter((detail) => {
        const lastSeen = new Date(detail.date).getTime();
        return lastSeen <= minCutoff.getTime() && lastSeen >= maxCutoff.getTime();
      }),
  );
}

function EmptyChartState() {
  return (
    <div className="flex h-64 items-center justify-center text-sm text-gray-400">
      No monthly contributor data computed yet.
    </div>
  );
}

export function ContributorInsights({ monthlyData }: Props) {
  const now = new Date();
  const newContributors = getRecentNewContributors(monthlyData, now);
  const churnedContributors = getRecentlyChurnedContributors(monthlyData, now);

  return (
    <div className="bg-white/5 p-6 rounded-lg">
      <h2 className="text-2xl font-bold mb-6 text-white">Contributor Activity</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* New Contributors */}
        <div className="bg-white/5 p-5 rounded-lg">
          <h3 className="text-lg font-semibold text-white mb-3">New Contributors</h3>
          <div className="flex items-baseline justify-between mb-4">
            <span className="text-3xl font-bold text-green-400">{newContributors.length}</span>
            <span className="text-sm text-gray-400">past 30 days</span>
          </div>
          <div className="border-t border-white/10 pt-3">
            <ContributorList contributors={newContributors} dateLabel="Joined" variant="joined" />
          </div>
        </div>

        {/* Churned */}
        <div className="bg-white/5 p-5 rounded-lg">
          <h3 className="text-lg font-semibold text-white mb-3">Churned</h3>
          <div className="flex items-baseline justify-between mb-4">
            <span className="text-3xl font-bold text-orange-400">{churnedContributors.length}</span>
            <span className="text-sm text-gray-400">inactive 30–60 days</span>
          </div>
          <div className="border-t border-white/10 pt-3">
            <ContributorList
              contributors={churnedContributors}
              dateLabel="Last active"
              variant="churned"
            />
          </div>
        </div>
      </div>

      <div className="mt-8 grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white/5 p-5 rounded-lg">
          <h3 className="text-lg font-semibold text-white mb-4 text-center">New and Churned</h3>
          {monthlyData.length > 0 ? (
            <ContributorTrendsChart monthlyData={monthlyData} />
          ) : (
            <EmptyChartState />
          )}
        </div>
        <div className="bg-white/5 p-5 rounded-lg">
          <h3 className="text-lg font-semibold text-white mb-4 text-center">
            Monthly Active Contributors
          </h3>
          {monthlyData.length > 0 ? (
            <TotalContributorsChart monthlyData={monthlyData} />
          ) : (
            <EmptyChartState />
          )}
        </div>
      </div>
    </div>
  );
}
