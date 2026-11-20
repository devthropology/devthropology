const DESKTOP_SIDEBAR_RAIL_KEY = "desktopSidebarRailMode";
const ONE_YEAR_SECONDS = 60 * 60 * 24 * 365;

export function persistDesktopSidebarRailMode(railMode: boolean): void {
  if (typeof document === "undefined") {
    return;
  }

  document.cookie = `${DESKTOP_SIDEBAR_RAIL_KEY}=${railMode ? "1" : "0"}; Path=/; Max-Age=${ONE_YEAR_SECONDS}`;
}
