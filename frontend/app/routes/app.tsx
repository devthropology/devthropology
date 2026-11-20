import {
  isRouteErrorResponse,
  Outlet,
  useLocation,
  useMatches,
  useNavigationType,
  useRevalidator,
  useRouteError,
  useRouteLoaderData,
} from "react-router";
import { captureException } from "~/utils/sentry";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;
import { InShellNotFound } from "../components/InShellNotFound";
import { Sidebar } from "../components/Sidebar";
import {
  getDesktopSidebarRailModeFromCookie,
  logout,
  requireUserSession,
} from "~/utils/session.server";
import type { RepositoryDetails } from "./types";
import { RouteLoadingOverlay } from "../components/ui/RouteLoadingOverlay";
import { Button } from "../components/ui/button";
import { Menu } from "lucide-react";
import { fetchRepositoriesWithRetry } from "../utils/repositoryRequests";
import { persistRepositoryId } from "../utils/repositoryPreferences";
import { sortRepositories } from "../utils/repositorySelection";
import { matchRepoScopedPath } from "../utils/repositoryRoutes";
import type { Route } from "./+types/app";
type AppContentLayoutMode = "scroll" | "fixed";

type AppLoaderData = Awaited<ReturnType<typeof loader>>;

function getIsCompactLayout() {
  if (typeof window === "undefined") {
    return false;
  }

  return window.innerWidth < 1024;
}

function resolveSelectedRepository(pathname: string, repositories: RepositoryDetails[]) {
  const repoRouteMatch = matchRepoScopedPath(pathname);

  if (repoRouteMatch) {
    return repositories.find((repository) => repository.id === repoRouteMatch.repoRef) ?? null;
  }

  return null;
}

function getLayoutModeFromMatches(matches: ReturnType<typeof useMatches>): AppContentLayoutMode {
  for (let index = matches.length - 1; index >= 0; index -= 1) {
    const mode = (matches[index].handle as { appLayoutMode?: AppContentLayoutMode } | undefined)
      ?.appLayoutMode;
    if (mode === "fixed" || mode === "scroll") {
      return mode;
    }
  }

  return "scroll";
}

export async function loader({ request, url }: Route.LoaderArgs) {
  const userSession = await requireUserSession(request, url);
  const pathname = url.pathname;

  try {
    const repositories = sortRepositories(
      await fetchRepositoriesWithRetry(userSession.token, { request }),
    );
    const repoRouteMatch = matchRepoScopedPath(pathname);

    if (
      repoRouteMatch &&
      !repositories.some((repository) => repository.id === repoRouteMatch.repoRef)
    ) {
      throw new Response("Not Found", { status: 404, statusText: "Repository not found" });
    }

    return {
      user: userSession,
      repositories,
      repositoriesError: false,
      desktopSidebarRailMode: getDesktopSidebarRailModeFromCookie(request),
    };
  } catch (error) {
    if (error instanceof Response) throw error;
    console.error("Failed to fetch repositories:", error);

    return {
      user: userSession,
      repositories: [] as RepositoryDetails[],
      repositoriesError: true,
      desktopSidebarRailMode: getDesktopSidebarRailModeFromCookie(request),
    };
  }
}

export async function action({ request }: Route.ActionArgs) {
  const formData = await request.formData();
  const actionType = formData.get("_action");

  if (actionType === "logout") {
    return logout(request);
  }

  throw new Response("Bad Request", { status: 400, statusText: "Bad Request" });
}

export default function AppLayout({ loaderData }: Route.ComponentProps) {
  const { user, repositories, desktopSidebarRailMode } = loaderData;
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // Match SSR on the first client render; CSS handles mobile first paint until measurement runs.
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [enableLayoutTransitions, setEnableLayoutTransitions] = useState(false);
  const matches = useMatches();
  const layoutMode = getLayoutModeFromMatches(matches);
  const handleCloseSidebar = useCallback(() => setIsSidebarOpen(false), []);
  const handleOpenSidebar = useCallback(() => setIsSidebarOpen(true), []);

  const selectedRepository = resolveSelectedRepository(location.pathname, repositories);

  useEffect(() => {
    if (selectedRepository) {
      persistRepositoryId(selectedRepository.id);
    }
  }, [selectedRepository?.id]);

  useEffect(() => {
    const updateLayoutMode = () => {
      setIsCompactLayout(getIsCompactLayout());
    };

    updateLayoutMode();
    const transitionFrame = window.requestAnimationFrame(() => {
      setEnableLayoutTransitions(true);
    });
    window.addEventListener("resize", updateLayoutMode);
    window.addEventListener("orientationchange", updateLayoutMode);

    return () => {
      window.cancelAnimationFrame(transitionFrame);
      window.removeEventListener("resize", updateLayoutMode);
      window.removeEventListener("orientationchange", updateLayoutMode);
    };
  }, []);

  useEffect(() => {
    if (!isCompactLayout) {
      setIsSidebarOpen(false);
    }
  }, [isCompactLayout]);

  const navigationType = useNavigationType();
  const contentRef = useRef<HTMLDivElement>(null);

  useIsomorphicLayoutEffect(() => {
    if (navigationType !== "POP" && contentRef.current && layoutMode === "scroll") {
      contentRef.current.scrollTo({ top: 0, behavior: "instant" });
    }
  }, [location.pathname, location.search, navigationType, layoutMode]);

  return (
    <div className="flex h-dvh bg-gray-900 overflow-hidden">
      {isSidebarOpen && isCompactLayout && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={handleCloseSidebar}
          aria-hidden="true"
        />
      )}
      <Sidebar
        user={user}
        repositories={repositories}
        selectedRepository={selectedRepository}
        initialRailMode={desktopSidebarRailMode}
        isMobileOpen={isSidebarOpen}
        onMobileClose={handleCloseSidebar}
        isCompactLayout={isCompactLayout}
        enableLayoutTransitions={enableLayoutTransitions}
      />
      <main className="relative flex-1 bg-gray-900 min-w-0 min-h-0 flex flex-col overflow-hidden">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-gray-800 bg-gray-900 px-4 py-3 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="text-gray-200"
            onClick={handleOpenSidebar}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1 truncate text-center text-sm font-semibold text-gray-200">
            {selectedRepository
              ? `${selectedRepository.org}/${selectedRepository.name}`
              : "Repository Overview"}
          </div>
          <span className="inline-flex h-9 w-9 flex-none" aria-hidden="true" />
        </div>
        <div className="h-6 flex-shrink-0" />
        <div
          ref={contentRef}
          className={`flex-1 min-h-0 px-4 md:px-6 lg:px-8 ${
            layoutMode === "fixed" ? "overflow-hidden" : "overflow-y-auto"
          }`}
        >
          <div
            className={
              layoutMode === "fixed" ? "h-full min-h-0 flex flex-col" : "min-h-full flex flex-col"
            }
          >
            <Outlet context={{ repository: selectedRepository }} />
          </div>
        </div>
        <div className="h-6 flex-shrink-0" />
        <RouteLoadingOverlay />
      </main>
    </div>
  );
}

export function ErrorBoundary() {
  const error = useRouteError();
  captureException(error);
  const revalidator = useRevalidator();
  const data = useRouteLoaderData<typeof loader>("routes/app") as AppLoaderData | undefined;
  const user = data?.user ?? null;
  const location = useLocation();
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  // Match SSR on the first client render; CSS handles mobile first paint until measurement runs.
  const [isCompactLayout, setIsCompactLayout] = useState(false);
  const [enableLayoutTransitions, setEnableLayoutTransitions] = useState(false);
  const handleCloseSidebar = useCallback(() => setIsSidebarOpen(false), []);
  const handleOpenSidebar = useCallback(() => setIsSidebarOpen(true), []);
  const repositories = data?.repositories ?? [];
  const desktopSidebarRailMode = data?.desktopSidebarRailMode ?? false;
  const selectedRepository = resolveSelectedRepository(location.pathname, repositories);

  useEffect(() => {
    const updateLayoutMode = () => {
      setIsCompactLayout(getIsCompactLayout());
    };

    updateLayoutMode();
    const transitionFrame = window.requestAnimationFrame(() => {
      setEnableLayoutTransitions(true);
    });
    window.addEventListener("resize", updateLayoutMode);
    window.addEventListener("orientationchange", updateLayoutMode);

    return () => {
      window.cancelAnimationFrame(transitionFrame);
      window.removeEventListener("resize", updateLayoutMode);
      window.removeEventListener("orientationchange", updateLayoutMode);
    };
  }, []);

  useEffect(() => {
    if (!isCompactLayout) {
      setIsSidebarOpen(false);
    }
  }, [isCompactLayout]);

  if (!user) {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center px-6">
        <div className="max-w-md text-center space-y-3">
          <h1 className="text-2xl font-semibold">Something went wrong</h1>
          <button
            type="button"
            onClick={() => {
              void revalidator.revalidate();
            }}
            className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : "An unexpected error occurred.";
  const isNotFound = isRouteErrorResponse(error) && error.status === 404;

  return (
    <div className="flex h-dvh bg-gray-900 overflow-hidden">
      {isSidebarOpen && isCompactLayout && (
        <div
          className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          onClick={handleCloseSidebar}
          aria-hidden="true"
        />
      )}
      <Sidebar
        user={user}
        repositories={repositories}
        selectedRepository={selectedRepository}
        initialRailMode={desktopSidebarRailMode}
        isMobileOpen={isSidebarOpen}
        onMobileClose={handleCloseSidebar}
        isCompactLayout={isCompactLayout}
        enableLayoutTransitions={enableLayoutTransitions}
      />
      <main className="relative flex-1 bg-gray-900 min-w-0 min-h-0 flex flex-col overflow-hidden">
        <div className="sticky top-0 z-10 flex items-center justify-between gap-2 border-b border-gray-800 bg-gray-900 px-4 py-3 lg:hidden">
          <Button
            variant="ghost"
            size="icon"
            className="text-gray-200"
            onClick={handleOpenSidebar}
            aria-label="Open navigation"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <div className="flex-1 truncate text-center text-sm font-semibold text-gray-200">
            {selectedRepository
              ? `${selectedRepository.org}/${selectedRepository.name}`
              : "Repository Overview"}
          </div>
          <span className="inline-flex h-9 w-9 flex-none" aria-hidden="true" />
        </div>
        <div className="h-6 flex-shrink-0" />
        <div className="flex-1 min-h-0 overflow-y-auto px-4 md:px-6 lg:px-8">
          {isNotFound ? (
            <div className="min-h-full flex flex-col">
              <InShellNotFound
                title="Page not found"
                message="This route is not available. Use the navigation to continue."
              />
            </div>
          ) : (
            <div className="min-h-full flex flex-col items-center justify-center">
              <div className="flex min-h-[320px] items-center justify-center rounded-lg border border-white/10 bg-slate-950/70 text-center w-full">
                <div className="max-w-md space-y-3 px-6">
                  <h1 className="text-2xl font-semibold text-white">Something went wrong</h1>
                  <p className="text-sm text-slate-300">{message}</p>
                  <button
                    type="button"
                    onClick={() => {
                      void revalidator.revalidate();
                    }}
                    className="inline-flex items-center rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500"
                    disabled={revalidator.state === "loading"}
                  >
                    Retry
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
        <div className="h-6 flex-shrink-0" />
      </main>
    </div>
  );
}
