import { Await, useLocation, useNavigation, useOutletContext, useSearchParams } from "react-router";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { API_URL, authenticatedFetch } from "../config";
import { FileSystemLayout } from "../components/FileSystemLayout";
import { Button } from "../components/ui/button";
import { EmptyState } from "../components/ui/EmptyState";
import type { FileSystemTreeResponse } from "../../../shared/models/fileSystemTree";
import type { RepositoryDetails } from "../routes/types";

export const handle = {
  appLayoutMode: "fixed",
} as const;

export const meta = () => {
  return [
    { title: "File Explorer" },
    { name: "description", content: "GitHub Repository File Explorer" },
  ];
};

export function shouldRevalidate({
  currentUrl,
  nextUrl,
  defaultShouldRevalidate,
}: {
  currentUrl: URL;
  nextUrl: URL;
  defaultShouldRevalidate: boolean;
}) {
  if (currentUrl.pathname === nextUrl.pathname) {
    const currentParams = new URLSearchParams(currentUrl.search);
    const nextParams = new URLSearchParams(nextUrl.search);
    const currentPath = currentParams.get("path");
    const nextPath = nextParams.get("path");

    currentParams.delete("path");
    nextParams.delete("path");

    if (currentPath !== nextPath && currentParams.toString() === nextParams.toString()) {
      return false;
    }
  }

  return defaultShouldRevalidate;
}

export async function loadFilesystemData(
  request: Request,
  userToken: string,
  repositoryId: string,
) {
  if (!repositoryId) {
    return { treeData: null, repositoryId: null, token: userToken };
  }

  const url = new URL(`${API_URL}/api/filesystem/${repositoryId}/tree`);
  url.searchParams.set("levels", "1");

  const treePromise = (async () => {
    try {
      const response = await authenticatedFetch(url.toString(), userToken, { request });
      if (!response.ok) throw new Error("Failed to fetch filesystem tree");
      const treeData: FileSystemTreeResponse = await response.json();
      return treeData as FileSystemTreeResponse;
    } catch (error) {
      console.error("Error fetching filesystem tree:", error);
      return null as FileSystemTreeResponse | null;
    }
  })();

  return {
    treeData: treePromise,
    repositoryId,
    token: userToken,
  };
}

export type FileSystemPageLoaderData = Awaited<ReturnType<typeof loadFilesystemData>>;

export default function FileSystemPage({ loaderData }: { loaderData: FileSystemPageLoaderData }) {
  const { treeData, repositoryId, token } = loaderData;
  const { repository } = useOutletContext<{ repository: RepositoryDetails | null }>();
  const location = useLocation();
  const navigation = useNavigation();
  const [searchParams, setSearchParams] = useSearchParams();
  const selectedNodePath = searchParams.get("path");
  const [collapseAllVersion, setCollapseAllVersion] = useState(0);
  const [scrollSelectionVersion, setScrollSelectionVersion] = useState(() =>
    searchParams.get("path") ? 1 : 0,
  );
  const lastSelectedNodePathRef = useRef<string | null>(selectedNodePath);
  const pendingPathUpdateRef = useRef<{ path: string | null; shouldScroll: boolean } | null>(null);

  if (repositoryId === null) {
    return (
      <div className="flex-1 font-sans text-white">
        <EmptyState message="Repository not selected." />
      </div>
    );
  }

  useEffect(() => {
    if (lastSelectedNodePathRef.current === selectedNodePath) {
      return;
    }

    const pendingPathUpdate = pendingPathUpdateRef.current;
    const isExpectedPathUpdate = pendingPathUpdate?.path === selectedNodePath;
    const shouldScroll =
      selectedNodePath !== null && (isExpectedPathUpdate ? pendingPathUpdate.shouldScroll : true);

    lastSelectedNodePathRef.current = selectedNodePath;
    pendingPathUpdateRef.current = null;

    if (shouldScroll) {
      setScrollSelectionVersion((current) => current + 1);
    }
  }, [selectedNodePath]);

  const updateSelectedPath = useCallback(
    (path: string | null, options?: { replace?: boolean; scroll?: boolean }) => {
      if (selectedNodePath === path) {
        return;
      }

      const nextParams = new URLSearchParams(searchParams);
      if (path) {
        nextParams.set("path", path);
      } else {
        nextParams.delete("path");
      }

      pendingPathUpdateRef.current = {
        path,
        shouldScroll: options?.scroll ?? false,
      };
      setSearchParams(nextParams, { replace: options?.replace ?? false });
    },
    [searchParams, selectedNodePath, setSearchParams],
  );

  const handleNodeSelect = useCallback(
    (path: string | null) => {
      updateSelectedPath(path, { replace: true, scroll: false });
    },
    [updateSelectedPath],
  );

  const handleRelatedPathNavigate = useCallback(
    (path: string) => {
      updateSelectedPath(path, { replace: false, scroll: true });
    },
    [updateSelectedPath],
  );

  const handleCollapseAll = useCallback(() => {
    setCollapseAllVersion((current) => current + 1);
    updateSelectedPath(null, { replace: true, scroll: false });
  }, [updateSelectedPath]);

  const handleInvalidSelectedPath = useCallback(
    (path: string) => {
      if (selectedNodePath !== path) {
        return;
      }

      updateSelectedPath(null, { replace: true, scroll: false });
    },
    [selectedNodePath, updateSelectedPath],
  );

  const isLoadingState =
    navigation.state === "loading" && navigation.location?.pathname !== location.pathname;
  function FilesystemSkeleton() {
    return (
      <div className="flex-1 min-h-0">
        <div className="animate-pulse h-full border border-gray-700 rounded-lg p-4">
          <div className="h-6 w-40 bg-gray-700 rounded mb-4" />
          <div className="space-y-2">
            <div className="h-4 bg-gray-800 rounded" />
            <div className="h-4 bg-gray-800 rounded w-5/6" />
            <div className="h-4 bg-gray-800 rounded w-2/3" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="font-sans text-white h-full min-h-0 flex flex-col">
      <div className="flex-shrink-0 border-b border-white/10">
        <div className="flex h-16 items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold tracking-tight">File Explorer</h1>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={handleCollapseAll}
            className="border-white/10 bg-slate-900/40 text-slate-200 hover:bg-slate-800 hover:text-white"
          >
            Collapse all
          </Button>
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden pt-4">
        <Suspense fallback={isLoadingState ? null : <FilesystemSkeleton />}>
          <Await resolve={treeData}>
            {(resolved) => (
              <FileSystemLayout
                repositoryId={repositoryId}
                repository={repository}
                treeData={resolved}
                token={token}
                selectedNodePath={selectedNodePath}
                onNodeSelect={handleNodeSelect}
                onRelatedPathNavigate={handleRelatedPathNavigate}
                collapseAllVersion={collapseAllVersion}
                scrollSelectionVersion={scrollSelectionVersion}
                onInvalidSelectedPath={handleInvalidSelectedPath}
                isLoading={isLoadingState}
              />
            )}
          </Await>
        </Suspense>
      </div>
    </div>
  );
}
