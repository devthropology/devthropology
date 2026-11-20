import { useEffect, useRef, useState } from "react";
import { useLoaderData, useNavigation } from "react-router";
import { API_URL } from "../config";
import SyncLogFormatter from "../components/SyncLogFormatter";
import { fetchRepositoriesWithRetry } from "../utils/repositoryRequests";
import { sortRepositories } from "../utils/repositorySelection";
import type { RepositoryDetails } from "../routes/types";

type SyncMode =
  | "LATEST"
  | "LAST_SEEN"
  | "LATEST_PULL_REQUESTS"
  | "SYNC_GITHUB_PROFILES"
  | "SYNC_UNSYNCED_GITHUB_PROFILES"
  | "SYNC_GITHUB_TEAMS";
type SyncStatus = "idle" | "syncing" | "completed" | "error";

interface LogMessage {
  type: "info" | "start" | "complete" | "success" | "error" | "progress" | "log";
  message: string;
  timestamp: Date;
  level?: string;
  [key: string]: unknown;
}

export type AdminSyncLoaderData = {
  repositoryId: string | null;
  userToken: string;
  repositories: RepositoryDetails[];
};

export async function loadSyncPageData(
  request: Request,
  userToken: string,
  repositoryId: string | null,
): Promise<AdminSyncLoaderData> {
  let repositories: RepositoryDetails[] = [];

  try {
    repositories = sortRepositories(await fetchRepositoriesWithRetry(userToken, { request }));
  } catch (error) {
    console.error("Failed to fetch repositories for sync page:", error);
  }

  if (!repositoryId) {
    console.error("No repository ID found in sync route context");
    return { repositoryId: null, userToken, repositories };
  }

  return {
    repositoryId,
    userToken,
    repositories,
  };
}

function formatLastSyncDate(dateString: string | null | undefined): string {
  if (!dateString) {
    return "Never";
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return "Unknown";
  }

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function getSyncStatus(dateString: string | null | undefined): {
  label: string;
  className: string;
} {
  if (!dateString) {
    return {
      label: "Never synced",
      className: "bg-gray-700 text-gray-200",
    };
  }

  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) {
    return {
      label: "Unknown",
      className: "bg-gray-700 text-gray-200",
    };
  }

  const diffMs = Date.now() - date.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays > 7) {
    return {
      label: "Stale",
      className: "bg-red-900/60 text-red-200",
    };
  }

  if (diffDays > 3) {
    return {
      label: "Aging",
      className: "bg-yellow-900/60 text-yellow-200",
    };
  }

  return {
    label: "Recent",
    className: "bg-green-900/60 text-green-200",
  };
}

function getProfileCutoffDate(daysAgo: number): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

export default function SyncPage() {
  const loaderData = useLoaderData<AdminSyncLoaderData>();
  const repositoryId = loaderData?.repositoryId;
  const userToken = loaderData?.userToken;
  const repositories = loaderData?.repositories ?? [];
  const navigation = useNavigation();
  // Initialize count and countInput from localStorage, with a fallback to 1000
  const [count, setCount] = useState<number>(() => {
    if (typeof window === "undefined") return 1000;
    const savedCount = localStorage.getItem("syncIssueCount");
    return savedCount ? parseInt(savedCount) : 1000;
  });

  const [countInput, setCountInput] = useState<string>(() => {
    if (typeof window === "undefined") return "1000";
    const savedCount = localStorage.getItem("syncIssueCount");
    return savedCount || "1000";
  });

  const [countError, setCountError] = useState<string>("");
  const [mode, setMode] = useState<SyncMode>("LATEST_PULL_REQUESTS");
  const [profileCutoffDaysInput, setProfileCutoffDaysInput] = useState<string>("60");
  const [profileCutoffDays, setProfileCutoffDays] = useState<number>(60);
  const [profileCutoffDaysError, setProfileCutoffDaysError] = useState<string>("");
  const [status, setStatus] = useState<SyncStatus>("idle");
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const eventSourceRef = useRef<EventSource | null>(null);
  const completedRef = useRef<boolean>(false);
  const [isAutoScrollEnabled, setIsAutoScrollEnabled] = useState<boolean>(true);

  // Auto-scroll logs to bottom when new logs are added (only if auto-scroll is enabled)
  useEffect(() => {
    if (logContainerRef.current && isAutoScrollEnabled) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, isAutoScrollEnabled]);

  // Clean up event source on unmount
  useEffect(() => {
    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, []);

  // Reset sync state when navigation occurs (repository switch)
  useEffect(() => {
    if (navigation.state === "loading") {
      // Close any existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      // Reset sync state
      setStatus("idle");
      setLogs([]);
      completedRef.current = false;
      setIsAutoScrollEnabled(true);
    }
  }, [navigation.state]);

  // Handle scroll events to detect if user has scrolled up
  const handleScroll = () => {
    if (!logContainerRef.current) return;

    const { scrollTop, scrollHeight, clientHeight } = logContainerRef.current;
    // Consider "at bottom" if within 50px of the bottom
    const isAtBottom = scrollTop + clientHeight >= scrollHeight - 50;

    setIsAutoScrollEnabled(isAtBottom);
  };

  // Handle count input changes
  const handleCountChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setCountInput(value);

    // Save to localStorage
    localStorage.setItem("syncIssueCount", value);

    // Validate input
    if (value === "") {
      setCountError("");
      return;
    }

    const numValue = parseInt(value);
    if (isNaN(numValue)) {
      setCountError("Please enter a valid number");
      return;
    }

    if (numValue < 1) {
      setCountError("Minimum value is 1");
      return;
    }

    if (numValue > 5000) {
      setCountError("Maximum value is 5000");
      return;
    }

    setCountError("");
    setCount(numValue);
  };

  // Handle count input blur
  const handleCountBlur = () => {
    if (countInput === "") {
      const defaultValue = "1000";
      setCountInput(defaultValue);
      setCount(1000);
      setCountError("");
      localStorage.setItem("syncIssueCount", defaultValue);
      return;
    }

    const numValue = parseInt(countInput);
    if (isNaN(numValue)) {
      const defaultValue = "1000";
      setCountInput(defaultValue);
      setCount(1000);
      setCountError("");
      localStorage.setItem("syncIssueCount", defaultValue);
      return;
    }

    const clampedValue = Math.min(5000, Math.max(1, numValue));
    const clampedString = clampedValue.toString();
    setCountInput(clampedString);
    setCount(clampedValue);
    setCountError("");
    localStorage.setItem("syncIssueCount", clampedString);
  };

  const handleProfileCutoffDaysChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setProfileCutoffDaysInput(value);

    if (value === "") {
      setProfileCutoffDaysError("");
      return;
    }

    if (!/^\d+$/.test(value)) {
      setProfileCutoffDaysError("Please enter a whole number of days");
      return;
    }

    const numValue = parseInt(value, 10);
    setProfileCutoffDaysError("");
    setProfileCutoffDays(numValue);
  };

  const handleProfileCutoffDaysBlur = () => {
    if (profileCutoffDaysInput === "" || !/^\d+$/.test(profileCutoffDaysInput)) {
      setProfileCutoffDaysInput("60");
      setProfileCutoffDays(60);
      setProfileCutoffDaysError("");
      return;
    }

    const normalizedValue = parseInt(profileCutoffDaysInput, 10).toString();
    setProfileCutoffDaysInput(normalizedValue);
    setProfileCutoffDays(parseInt(normalizedValue, 10));
    setProfileCutoffDaysError("");
  };

  // Optional: Add a useEffect to sync localStorage if needed
  useEffect(() => {
    // This ensures that if count is changed programmatically,
    // localStorage is also updated
    localStorage.setItem("syncIssueCount", count.toString());
  }, [count]);

  const handleSync = async () => {
    // Validate count before starting
    if (countError) {
      return;
    }

    if (
      mode === "SYNC_GITHUB_PROFILES" &&
      (profileCutoffDaysInput === "" || profileCutoffDaysError)
    ) {
      setLogs([
        {
          type: "error",
          message: "Profile cutoff days must be a whole number.",
          timestamp: new Date(),
        },
      ]);
      setStatus("error");
      return;
    }

    // Check if repository ID and user token are available
    if (!repositoryId || !userToken) {
      setLogs([
        {
          type: "error",
          message:
            "No repository selected or user not authenticated. Please select a repository from the sidebar.",
          timestamp: new Date(),
        },
      ]);
      setStatus("error");
      return;
    }

    // Reset logs and set status
    setLogs([]);
    setStatus("syncing");
    completedRef.current = false;
    setIsAutoScrollEnabled(true);

    try {
      // Close any existing connection
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }

      const url = new URL(`${API_URL}/api/repository/${repositoryId}/sync/stream`);
      url.searchParams.append("count", count.toString());
      url.searchParams.append("mode", mode);
      url.searchParams.append("token", userToken);
      if (mode === "SYNC_GITHUB_PROFILES") {
        url.searchParams.append("profileCutoffDate", getProfileCutoffDate(profileCutoffDays));
      }

      const eventSource = new EventSource(url.toString());
      eventSourceRef.current = eventSource;

      // Create a local variable to track received messages
      // This avoids race conditions with React state updates
      const receivedMessageTypes = new Set<string>();

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);

          let eventTimestamp = new Date();
          if (data.timestamp) {
            const parsedTimestamp = new Date(data.timestamp);
            if (!Number.isNaN(parsedTimestamp.getTime())) {
              eventTimestamp = parsedTimestamp;
            }
          }

          // Track message types locally
          receivedMessageTypes.add(data.type);
          if (data.type === "info" && data.message.includes("Stream closing normally")) {
            receivedMessageTypes.add("stream-closing");
          }

          const newLog: LogMessage = {
            ...data,
            message: data.message ?? "",
            timestamp: eventTimestamp,
          };

          setLogs((prevLogs) => [...prevLogs, newLog]);

          // Mark as completed when we receive any of these message types
          if (
            data.type === "success" ||
            data.type === "complete" ||
            (data.type === "info" && data.message.includes("Stream closing normally"))
          ) {
            setStatus("completed");
            completedRef.current = true;

            // Close the connection gracefully after a short delay
            setTimeout(() => {
              if (
                eventSourceRef.current &&
                eventSourceRef.current.readyState !== EventSource.CLOSED
              ) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
              }
            }, 200);
          } else if (data.type === "error") {
            setStatus("error");

            // Close the connection gracefully
            setTimeout(() => {
              if (
                eventSourceRef.current &&
                eventSourceRef.current.readyState !== EventSource.CLOSED
              ) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
              }
            }, 200);
          }
        } catch (error) {
          console.error("Error parsing SSE message:", error);
        }
      };

      eventSource.onerror = () => {
        // Check if we've received a "complete" or "success" message
        // If so, this is likely just the server closing the connection normally
        if (!completedRef.current) {
          // Check if we have any success or complete messages using our local tracker
          // This is more reliable than checking the logs state which might not be updated yet
          const hasSuccessOrComplete =
            receivedMessageTypes.has("success") ||
            receivedMessageTypes.has("complete") ||
            receivedMessageTypes.has("stream-closing");

          if (!hasSuccessOrComplete) {
            setStatus("error");
            setLogs((prevLogs) => [
              ...prevLogs,
              {
                type: "error",
                message: "Connection to server lost",
                timestamp: new Date(),
              },
            ]);
          } else {
            // If we have success/complete messages but completedRef is not set,
            // this is likely a race condition - set status to completed
            setStatus("completed");
            completedRef.current = true;
          }
        }

        // Always close the connection on error
        if (eventSourceRef.current && eventSourceRef.current.readyState !== EventSource.CLOSED) {
          eventSourceRef.current.close();
          eventSourceRef.current = null;
        }
      };
    } catch (error: unknown) {
      setStatus("error");
      setLogs((prevLogs) => [
        ...prevLogs,
        {
          type: "error",
          message: `Error initializing sync: ${
            error instanceof Error ? error.message : String(error)
          }`,
          timestamp: new Date(),
        },
      ]);
    }
  };

  const formatTimestamp = (date: Date) => {
    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  };

  const getLogClass = (log: LogMessage) => {
    if (log.type === "log") {
      if (log.level === "error") {
        return "text-red-400";
      }
      if (log.level === "warn") {
        return "text-yellow-400";
      }
      return "text-gray-300";
    }

    switch (log.type) {
      case "error":
        return "text-red-400";
      case "success":
      case "complete":
        return "text-green-400";
      case "start":
        return "text-blue-400";
      default:
        return "text-gray-300";
    }
  };

  const formatLogMessage = (log: LogMessage) => {
    // Use the SyncLogFormatter to format the message
    return <SyncLogFormatter logMessage={log.message} />;
  };

  const modeDescription =
    mode === "LATEST"
      ? "Sync from the most recent issues backward"
      : mode === "LATEST_PULL_REQUESTS"
        ? "Sync from the most recent pull requests backward (skip open issues)"
        : mode === "SYNC_GITHUB_PROFILES"
          ? "Sync GitHub profiles missing one, on the old avatar-only cache, or synced before the cutoff days"
          : mode === "SYNC_UNSYNCED_GITHUB_PROFILES"
            ? "Sync only contributors that have never had a GitHub profile row synced"
            : mode === "SYNC_GITHUB_TEAMS"
              ? "Import GitHub teams that have access to this repository and sync their members"
              : "Sync starting from where we last left off";
  const hidesCount =
    mode === "SYNC_GITHUB_PROFILES" ||
    mode === "SYNC_UNSYNCED_GITHUB_PROFILES" ||
    mode === "SYNC_GITHUB_TEAMS";

  return (
    <div className="p-8 text-white">
      <h1 className="text-3xl font-bold mb-6">Sync GitHub Data</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Sync Configuration Panel */}
        <div className="bg-gray-800 rounded-lg p-6 shadow-lg">
          <h2 className="text-xl font-semibold mb-4">Sync Configuration</h2>

          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Sync Mode</label>
              <select
                value={mode}
                onChange={(e) => setMode(e.target.value as SyncMode)}
                className="w-full bg-gray-700 border border-gray-600 rounded-md py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="LATEST_PULL_REQUESTS">Latest Pull Requests</option>
                <option value="LATEST">Latest Issues</option>
                <option value="LAST_SEEN">Last Seen</option>
                <option value="SYNC_GITHUB_PROFILES">Sync GitHub Profiles</option>
                <option value="SYNC_UNSYNCED_GITHUB_PROFILES">Sync Unsynced Profiles</option>
                <option value="SYNC_GITHUB_TEAMS">Sync GitHub Teams</option>
              </select>
              <p className="mt-1 text-sm text-gray-500">{modeDescription}</p>
            </div>

            {mode === "SYNC_GITHUB_PROFILES" && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Profile Cutoff Days
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  required
                  value={profileCutoffDaysInput}
                  onChange={handleProfileCutoffDaysChange}
                  onBlur={handleProfileCutoffDaysBlur}
                  className={`w-full bg-gray-700 border rounded-md py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    profileCutoffDaysError ? "border-red-500" : "border-gray-600"
                  }`}
                  placeholder="Enter days ago"
                />
                {profileCutoffDaysError && (
                  <p className="mt-1 text-sm text-red-500">{profileCutoffDaysError}</p>
                )}
                <p className="mt-1 text-sm text-gray-500">
                  Profiles last synced more than this many days ago will be refreshed. Defaults to
                  60.
                </p>
              </div>
            )}

            {!hidesCount && (
              <div>
                <label className="block text-sm font-medium text-gray-400 mb-1">
                  Issue Count Limit
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  value={countInput}
                  onChange={handleCountChange}
                  onBlur={handleCountBlur}
                  className={`w-full bg-gray-700 border rounded-md py-2 px-3 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    countError ? "border-red-500" : "border-gray-600"
                  }`}
                  placeholder="Enter a number (1-5000)"
                />
                {countError && <p className="mt-1 text-sm text-red-500">{countError}</p>}
                <p className="mt-1 text-sm text-gray-500">
                  Maximum number of issues to process (1-5000)
                </p>
              </div>
            )}

            <button
              onClick={handleSync}
              disabled={
                status === "syncing" ||
                (!hidesCount && !!countError) ||
                (mode === "SYNC_GITHUB_PROFILES" &&
                  (profileCutoffDaysInput === "" || !!profileCutoffDaysError))
              }
              className={`w-full py-2 px-4 rounded-md font-medium focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                status === "syncing" ||
                (!hidesCount && !!countError) ||
                (mode === "SYNC_GITHUB_PROFILES" &&
                  (profileCutoffDaysInput === "" || !!profileCutoffDaysError))
                  ? "bg-gray-600 cursor-not-allowed"
                  : "bg-blue-600 hover:bg-blue-700"
              }`}
            >
              {status === "syncing" ? "Syncing..." : "Start Sync"}
            </button>
          </div>
        </div>

        {/* Logs Panel */}
        <div className="bg-gray-800 rounded-lg p-6 shadow-lg">
          <div className="flex justify-between items-center mb-4">
            <h2 className="text-xl font-semibold">Sync Logs</h2>
            <div className="flex space-x-2">
              <span
                className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                  status === "idle"
                    ? "bg-gray-700 text-gray-300"
                    : status === "syncing"
                      ? "bg-blue-700 text-blue-200"
                      : status === "completed"
                        ? "bg-green-700 text-green-200"
                        : "bg-red-700 text-red-200"
                }`}
              >
                {status === "idle"
                  ? "Ready"
                  : status === "syncing"
                    ? "Syncing"
                    : status === "completed"
                      ? "Completed"
                      : "Error"}
              </span>
              {logs.length > 0 && (
                <button
                  onClick={() => setLogs([])}
                  className="text-xs text-gray-400 hover:text-white"
                >
                  Clear
                </button>
              )}
            </div>
          </div>

          <div className="relative">
            <div
              ref={logContainerRef}
              onScroll={handleScroll}
              className="bg-gray-900 rounded-md p-4 h-96 overflow-y-auto font-mono text-sm"
            >
              {logs.length === 0 ? (
                <div className="text-gray-500 italic">Sync logs will appear here...</div>
              ) : (
                <div className="space-y-1">
                  {logs.map((log, index) => (
                    <div key={index} className={`${getLogClass(log)}`}>
                      <span className="text-gray-500">[{formatTimestamp(log.timestamp)}]</span>{" "}
                      <span className="font-semibold">
                        {log.type === "log"
                          ? log.level
                            ? log.level.toUpperCase()
                            : "LOG"
                          : log.type.toUpperCase()}
                      </span>
                      : {formatLogMessage(log)}
                    </div>
                  ))}
                </div>
              )}
            </div>
            {!isAutoScrollEnabled && logs.length > 0 && (
              <div className="absolute bottom-2 left-1/2 transform -translate-x-1/2">
                <button
                  onClick={() => {
                    if (logContainerRef.current) {
                      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
                      setIsAutoScrollEnabled(true);
                    }
                  }}
                  className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1 rounded-full shadow-lg flex items-center space-x-1"
                >
                  <span>↓</span>
                  <span>New messages below</span>
                </button>
              </div>
            )}
          </div>

          <div className="mt-4 text-sm text-gray-500">
            Updates are streamed in real-time from the server.
          </div>
        </div>
      </div>

      <div className="mt-8 bg-gray-800 rounded-lg p-6 shadow-lg">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-xl font-semibold">Repository Sync Status</h2>
            <p className="mt-1 text-sm text-gray-400">
              Quick view of the last sync time for each accessible repository.
            </p>
          </div>
          <div className="text-sm text-gray-500">
            {repositories.length} {repositories.length === 1 ? "repository" : "repositories"}
          </div>
        </div>

        {repositories.length === 0 ? (
          <div className="rounded-md border border-gray-700 bg-gray-900/70 px-4 py-6 text-sm text-gray-400">
            No repositories available.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-gray-700">
            <table className="min-w-full divide-y divide-gray-700 text-sm">
              <thead className="bg-gray-900/80 text-left text-gray-400">
                <tr>
                  <th className="px-4 py-3 font-medium">Org</th>
                  <th className="px-4 py-3 font-medium">Repo</th>
                  <th className="px-4 py-3 font-medium">Last Sync</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700 bg-gray-800/60">
                {repositories.map((repository) => {
                  const syncStatus = getSyncStatus(repository.lastSyncAt);
                  const isSelectedRepository = repository.id === repositoryId;

                  return (
                    <tr
                      key={repository.id}
                      className={isSelectedRepository ? "bg-blue-950/30" : undefined}
                    >
                      <td className="px-4 py-3 text-gray-200">{repository.org}</td>
                      <td className="px-4 py-3 text-white">
                        <div className="flex items-center gap-2">
                          <span>{repository.name}</span>
                          {isSelectedRepository && (
                            <span className="rounded-full bg-blue-900/70 px-2 py-0.5 text-xs text-blue-200">
                              Selected
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-gray-300">
                        {formatLastSyncDate(repository.lastSyncAt)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${syncStatus.className}`}
                        >
                          {syncStatus.label}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
