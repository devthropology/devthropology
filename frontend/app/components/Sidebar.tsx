import { Form, NavLink, useLocation, useNavigate, useRevalidator } from "react-router";
import { useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./ui/dropdown-menu";
import { Button } from "./ui/button";
import {
  ChevronsUpDown,
  Database,
  Folder,
  FolderTree,
  Glasses,
  Home,
  LogOut,
  PanelLeftClose,
  PanelLeftOpen,
  RefreshCw,
  SquarePen,
  Shield,
  TrendingUp,
  User,
  Users,
  UsersRound,
  Waypoints,
  X,
} from "lucide-react";
import { cn } from "../lib/utils";
import { RepositoryDetails } from "../routes/types";
import { clearFilesystemCache } from "../utils/storageKeys";
import { persistRepositoryId } from "../utils/repositoryPreferences";
import { persistDesktopSidebarRailMode } from "../utils/sidebarPreferences";
import {
  buildRepoScopedPath,
  matchRepoScopedPath,
  replaceRepoRefInPath,
} from "../utils/repositoryRoutes";

type UserSession = {
  userId: string;
  username: string;
  role: string;
  token: string;
};

type SidebarProps = {
  user: UserSession;
  repositories: RepositoryDetails[];
  selectedRepository: RepositoryDetails | null;
  initialRailMode: boolean;
  isMobileOpen: boolean;
  onMobileClose: () => void;
  isCompactLayout: boolean;
  enableLayoutTransitions: boolean;
};

type NavItem = { name: string; suffix: string; icon: LucideIcon };

const navSections: { label: string; items: NavItem[] }[] = [
  {
    label: "Explore",
    items: [
      { name: "Contributors", suffix: "/explore/contributors", icon: Users },
      { name: "Filesystem", suffix: "/explore/filesystem", icon: FolderTree },
      { name: "Relationships", suffix: "/relationships", icon: Waypoints },
      { name: "Trends", suffix: "/explore/trends", icon: TrendingUp },
    ],
  },
  {
    label: "Reports",
    items: [
      { name: "Authors", suffix: "/reports/authors", icon: SquarePen },
      { name: "Reviewers", suffix: "/reports/reviewers", icon: Glasses },
    ],
  },
  {
    label: "Admin",
    items: [
      { name: "Data Sync", suffix: "/admin/sync", icon: Database },
      { name: "Teams", suffix: "/admin/teams", icon: UsersRound },
    ],
  },
];

function getRepoBadgeLabel(repository: RepositoryDetails | null): string | null {
  if (!repository) {
    return null;
  }

  const tokens = repository.name
    .split("-")
    .map((token) => token.replace(/[^a-z0-9]/gi, ""))
    .filter(Boolean);

  if (tokens.length >= 2) {
    return `${tokens.at(-2)?.[0] ?? ""}${tokens.at(-1)?.[0] ?? ""}`.toUpperCase();
  }

  return repository.name
    .replace(/[^a-z0-9]/gi, "")
    .slice(0, 2)
    .toUpperCase();
}

function getNavigationPath(suffix: string, repository: RepositoryDetails | null): string {
  if (!repository) {
    return "/app";
  }

  return buildRepoScopedPath(repository.id, suffix);
}

export function Sidebar({
  user,
  repositories,
  selectedRepository,
  initialRailMode,
  isMobileOpen,
  onMobileClose,
  isCompactLayout,
  enableLayoutTransitions,
}: SidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const revalidator = useRevalidator();
  const [railMode, setRailMode] = useState(initialRailMode);

  const isRefreshing = revalidator.state === "loading";

  const handleRefresh = async () => {
    try {
      void revalidator.revalidate();
    } catch (err) {
      console.error("Failed to refresh repositories:", err);
    }
  };

  const handleSelectRepository = (repo: RepositoryDetails) => {
    persistRepositoryId(repo.id);

    // Clear filesystem cache when switching repositories
    clearFilesystemCache();

    const params = new URLSearchParams(location.search);
    const repoScopedMatch = matchRepoScopedPath(location.pathname);
    if (repoScopedMatch?.suffix.startsWith("/explore/filesystem")) {
      params.delete("path");
    }

    const nextSearch = params.toString();
    const nextPathname =
      replaceRepoRefInPath(location.pathname, repo.id) ?? buildRepoScopedPath(repo.id);
    const nextUrl = nextSearch ? `${nextPathname}?${nextSearch}` : nextPathname;
    void navigate(nextUrl, { replace: true });

    if (isMobileOpen) {
      onMobileClose();
    }
  };

  useEffect(() => {
    if (!isMobileOpen) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onMobileClose();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isMobileOpen, onMobileClose]);

  const showLabels = isCompactLayout || !railMode;
  const sidebarWidth = showLabels ? "w-64" : "w-14";
  const sidebarPadding = showLabels ? "p-4" : "p-2";
  const repoBadgeLabel = getRepoBadgeLabel(selectedRepository);
  const handleNavLinkClick = () => {
    if (isMobileOpen) {
      onMobileClose();
    }
  };

  const getLinkClass = (suffix: string, end = false, narrow = false) => {
    const targetPath = getNavigationPath(suffix, selectedRepository);
    const isActive = selectedRepository
      ? end
        ? location.pathname === targetPath
        : location.pathname === targetPath || location.pathname.startsWith(`${targetPath}/`)
      : end
        ? location.pathname === targetPath
        : false;

    return cn(
      "rounded transition",
      narrow ? "flex items-center justify-center p-2" : "block p-2",
      isActive
        ? "bg-gray-700 text-white"
        : "text-gray-300 hover:bg-gray-700 focus-visible:bg-gray-700",
    );
  };

  const filteredNavSections =
    user.role === "demo" ? navSections.filter(({ label }) => label !== "Admin") : navSections;

  return (
    <nav
      className={cn(
        "z-[60] flex flex-col bg-gray-800 ease-in-out",
        isCompactLayout
          ? cn("w-64 transform p-4", enableLayoutTransitions && "transition-transform duration-300")
          : cn(
              "relative h-screen shadow-none max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:-translate-x-full max-lg:pointer-events-none",
              enableLayoutTransitions && "transition-[width,padding] duration-200",
              sidebarWidth,
              sidebarPadding,
              !showLabels && "overflow-x-hidden",
            ),
        isCompactLayout ? "fixed inset-y-0 left-0 shadow-lg" : "shadow-none",
        isCompactLayout
          ? isMobileOpen
            ? "translate-x-0 pointer-events-auto"
            : "-translate-x-full pointer-events-none"
          : "translate-x-0 pointer-events-auto",
      )}
      aria-label="Primary"
    >
      {isCompactLayout && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-semibold text-white">Navigation</span>
          <Button
            variant="ghost"
            size="icon"
            className="text-gray-300 hover:text-white"
            onClick={onMobileClose}
            aria-label="Close navigation"
          >
            <X className="h-5 w-5" />
          </Button>
        </div>
      )}

      <div className={cn("mb-6", isCompactLayout ? "mt-4" : "mt-0")}>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              className={cn(
                "bg-gray-700 text-white hover:bg-gray-600 border-gray-600",
                showLabels ? "w-full justify-between" : "h-10 w-10 shrink-0 justify-center p-0",
              )}
              title={
                selectedRepository
                  ? `${selectedRepository.org}/${selectedRepository.name}`
                  : "Select repository"
              }
            >
              {showLabels ? (
                <>
                  <div className="flex min-w-0 flex-1 items-center overflow-hidden">
                    <Folder className="mr-2 h-5 w-5 flex-shrink-0" />
                    <span className="truncate">
                      {selectedRepository
                        ? selectedRepository.name
                        : repositories.length > 0
                          ? "Select Repository"
                          : "No repositories"}
                    </span>
                  </div>
                  <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                </>
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-md bg-gray-600 text-sm font-semibold text-white">
                  {repoBadgeLabel ? (
                    repoBadgeLabel
                  ) : (
                    <Folder className="h-4 w-4 text-gray-200" aria-hidden />
                  )}
                </span>
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="min-w-[var(--radix-dropdown-menu-trigger-width)] bg-gray-800 border-gray-700 text-gray-100"
            align="start"
          >
            {repositories.length > 0 ? (
              <>
                <DropdownMenuLabel className="text-gray-300">Select Repository</DropdownMenuLabel>
                <DropdownMenuSeparator className="bg-gray-700" />
                {repositories.map((repo) => (
                  <DropdownMenuItem
                    key={repo.id}
                    onSelect={() => handleSelectRepository(repo)}
                    className={cn(
                      "cursor-pointer focus:bg-gray-700 focus:text-white",
                      selectedRepository?.id === repo.id && "bg-gray-700",
                    )}
                  >
                    <span className="truncate">
                      {repo.org}/{repo.name}
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator className="bg-gray-700" />
                <DropdownMenuItem
                  onSelect={handleRefresh}
                  className="cursor-pointer focus:bg-gray-700 focus:text-white"
                  disabled={isRefreshing}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                  <span>{isRefreshing ? "Refreshing..." : "Refresh"}</span>
                </DropdownMenuItem>
              </>
            ) : (
              <>
                <DropdownMenuItem disabled className="text-gray-400">
                  No repositories found
                </DropdownMenuItem>
                <DropdownMenuSeparator className="bg-gray-700" />
                <DropdownMenuItem
                  onSelect={handleRefresh}
                  className="cursor-pointer focus:bg-gray-700 focus:text-white"
                  disabled={isRefreshing}
                >
                  <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
                  <span>{isRefreshing ? "Refreshing..." : "Refresh"}</span>
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="space-y-4 overflow-y-auto flex-1 min-h-0">
        <NavLink
          to={getNavigationPath("", selectedRepository)}
          className={getLinkClass("", true, !showLabels)}
          end
          title="Home"
          aria-label="Home"
          onClick={handleNavLinkClick}
        >
          {showLabels ? "Home" : <Home className="h-5 w-5 shrink-0" />}
        </NavLink>

        {selectedRepository &&
          filteredNavSections.map(({ label, items }) => (
            <div key={label}>
              <p
                className={cn(
                  "px-2 text-xs uppercase tracking-wide text-gray-500",
                  !showLabels && "sr-only",
                )}
              >
                {label}
              </p>
              <ul className={cn("space-y-2", showLabels ? "mt-2" : "mt-0")}>
                {items.map(({ name, suffix, icon: Icon }) => (
                  <li key={suffix}>
                    <NavLink
                      to={getNavigationPath(suffix, selectedRepository)}
                      className={getLinkClass(suffix, false, !showLabels)}
                      title={name}
                      aria-label={name}
                      onClick={handleNavLinkClick}
                    >
                      {showLabels ? name : <Icon className="h-5 w-5 shrink-0" />}
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>

      {!isCompactLayout && (
        <div className={cn("flex shrink-0", showLabels ? "justify-end" : "justify-center")}>
          <button
            type="button"
            className="inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
            onClick={() => {
              setRailMode((currentRailMode) => {
                const nextRailMode = !currentRailMode;
                persistDesktopSidebarRailMode(nextRailMode);
                return nextRailMode;
              });
            }}
            aria-pressed={railMode}
            title={railMode ? "Expand sidebar (stay open)" : "Collapse sidebar to icons"}
            aria-label={railMode ? "Expand sidebar" : "Collapse sidebar to icons"}
          >
            {railMode ? (
              <PanelLeftOpen className="h-5 w-5" aria-hidden />
            ) : (
              <PanelLeftClose className="h-5 w-5" aria-hidden />
            )}
          </button>
        </div>
      )}

      <div className="mt-auto pt-4 border-t border-gray-700 shrink-0">
        {user.role === "superuser" && (
          <NavLink
            to="/app/admin"
            title="Admin center"
            aria-label="Admin center"
            onClick={handleNavLinkClick}
            className={({ isActive }) =>
              cn(
                "mb-2 flex items-center gap-2 rounded p-2 text-sm hover:bg-gray-700 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400",
                isActive ? "bg-gray-700 text-white" : "text-gray-300",
                !showLabels && "justify-center",
              )
            }
          >
            <Shield className="h-5 w-5 shrink-0" aria-hidden />
            {showLabels && <span>Admin center</span>}
          </NavLink>
        )}
        <div
          className={cn(
            "flex items-center gap-2 p-2 text-gray-300",
            !showLabels && "flex-col justify-center",
          )}
        >
          <NavLink
            to="/app/settings"
            className={cn(
              "flex min-w-0 flex-1 items-center rounded hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400",
              !showLabels && "flex-none",
            )}
            title="Account & workspaces"
            aria-label="Account & workspaces"
            onClick={handleNavLinkClick}
          >
            <User className={cn("h-5 w-5 shrink-0", showLabels && "mr-2")} aria-hidden />
            {showLabels && (
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium truncate">{user.username}</div>
                <div className="text-xs text-gray-400 truncate">{user.role}</div>
              </div>
            )}
          </NavLink>
          <Form method="post" action="/app" className="shrink-0">
            <Button
              type="submit"
              name="_action"
              value="logout"
              variant="destructive"
              size="icon"
              className={showLabels ? "h-8 w-8" : undefined}
              title="Sign Out"
              aria-label="Sign Out"
            >
              <LogOut className="h-4 w-4" aria-hidden />
            </Button>
          </Form>
        </div>
      </div>
    </nav>
  );
}
