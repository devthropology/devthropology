import { useLocation, useNavigation } from "react-router";
import { createColumns } from "~/components/user-activity-overview/columns";
import type { UserActivityOverview } from "../routes/types";
import { type MetaFunction } from "react-router";
import { DataTable } from "../components/ui/data-table";
import { EmptyState } from "../components/ui/EmptyState";
import { API_URL, authenticatedFetch } from "~/config";
import { Check, ChevronDown, Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import { cn } from "../lib/utils";
import { rankCommandMatch } from "../utils/commandRanking";

export const handle = {
  appLayoutMode: "fixed",
} as const;

export const meta: MetaFunction = () => {
  return [
    { title: "Contributors" },
    { name: "description", content: "GitHub Contributor Activity" },
  ];
};

export async function loadContributorOverviewData(
  request: Request,
  userToken: string,
  repositoryId: string,
) {
  if (!repositoryId) {
    return { data: [] as UserActivityOverview[], repositoryId };
  }

  const url = `${API_URL}/api/repository/${repositoryId}/reports/users/activity`;

  try {
    console.log("Selected Repository ID:", repositoryId);
    const response = await authenticatedFetch(url, userToken, {
      request,
    });
    const data: UserActivityOverview[] = await response.json();

    if (!data || !Array.isArray(data)) {
      console.error("Invalid data received:", data);
      return { data: [] as UserActivityOverview[], repositoryId };
    }

    return { data, repositoryId };
  } catch (error) {
    console.error("Error fetching data:", error);
    return { data: [] as UserActivityOverview[], repositoryId };
  }
}

export function ContributorsIndexPage({
  data,
  repositoryId,
}: {
  data: UserActivityOverview[];
  repositoryId?: string;
}) {
  const location = useLocation();
  const navigation = useNavigation();
  const isRouteTransition =
    navigation.state === "loading" && navigation.location?.pathname !== location.pathname;
  const repoColumns = useMemo(() => createColumns(repositoryId), [repositoryId]);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [selectedUsers, setSelectedUsers] = useState<string[]>([]);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const users = useMemo(
    () =>
      Array.from(
        new Set(
          data
            .map((entry) => entry.gh_login?.trim())
            .filter((login): login is string => Boolean(login)),
        ),
      ).sort((a, b) => a.localeCompare(b)),
    [data],
  );
  const filteredData = useMemo(() => {
    if (selectedUsers.length === 0) return data;
    const selectedUserSet = new Set(selectedUsers);
    return data.filter((entry) => entry.gh_login && selectedUserSet.has(entry.gh_login));
  }, [data, selectedUsers]);

  const focusSearchInput = () => {
    searchInputRef.current?.focus();
  };

  const toggleUser = (username: string) => {
    setSelectedUsers((current) =>
      current.includes(username)
        ? current.filter((item) => item !== username)
        : [...current, username],
    );
  };

  const filterLabel =
    selectedUsers.length > 0 ? `${selectedUsers.length} selected` : "Filter contributors";

  return (
    <div className="font-sans text-white flex h-full min-h-0 min-w-0 flex-1 flex-col">
      <div className="max-w-[1360px] flex-shrink-0 border-b border-white/10">
        <div className="flex min-h-16 flex-col gap-3 py-3 md:h-16 md:flex-row md:items-center md:justify-between md:gap-6 md:py-0">
          <h1 className="text-2xl font-semibold tracking-tight">Contributor Activity</h1>

          <Popover
            open={isFilterOpen}
            onOpenChange={(open) => {
              setIsFilterOpen(open);
              if (open) {
                requestAnimationFrame(focusSearchInput);
              }
            }}
          >
            <PopoverTrigger asChild>
              <button
                type="button"
                className={cn(
                  "inline-flex h-10 w-full md:w-[240px] items-center justify-between rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400",
                  "border-white/20 bg-[#0f172a] text-white hover:border-blue-400 hover:bg-blue-500/10",
                  selectedUsers.length > 0 && "border-blue-400",
                )}
                aria-label="Filter contributors"
              >
                <span>{filterLabel}</span>
                <ChevronDown className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              align="end"
              sideOffset={8}
              className="z-[70] w-80 rounded-lg border border-white/10 bg-[#111827] p-0 text-white shadow-2xl"
              onOpenAutoFocus={(event) => {
                event.preventDefault();
                focusSearchInput();
              }}
            >
              <Command
                className="bg-transparent text-white"
                filter={(value, search, keywords) => rankCommandMatch(value, search, keywords)}
              >
                <div className="space-y-2 px-4 py-4">
                  <p className="text-xs uppercase tracking-wide text-gray-400">
                    Search contributors
                  </p>
                  <div className="rounded-lg border border-white/15 bg-[#0f172a] px-3 py-1.5">
                    <CommandInput
                      ref={searchInputRef}
                      placeholder="Search contributors..."
                      className="h-8 w-full bg-transparent text-sm text-white placeholder:text-gray-500 focus-visible:border-0 focus-visible:ring-0"
                    />
                  </div>
                </div>
                <CommandList className="max-h-64">
                  <CommandEmpty className="py-4 text-center text-sm text-gray-400">
                    No contributors found
                  </CommandEmpty>
                  <CommandGroup className="p-0">
                    {users.map((username) => {
                      const isSelected = selectedUsers.includes(username);
                      return (
                        <CommandItem
                          key={username}
                          value={username}
                          onSelect={() => {
                            toggleUser(username);
                            requestAnimationFrame(focusSearchInput);
                          }}
                          className={cn(
                            "flex cursor-pointer select-none items-center justify-between px-4 py-2 text-sm text-white",
                            "data-[selected=true]:bg-blue-500/20 data-[selected=true]:text-white",
                          )}
                        >
                          <span>{username}</span>
                          {isSelected && <Check className="h-4 w-4 text-blue-300" />}
                        </CommandItem>
                      );
                    })}
                  </CommandGroup>
                </CommandList>
              </Command>
              <div className="flex items-center justify-between border-t border-white/10 px-4 py-3">
                <span className="text-sm text-gray-400">{selectedUsers.length} selected</span>
                <button
                  type="button"
                  className="text-sm font-semibold text-blue-300 hover:text-blue-200"
                  onClick={() => {
                    setSelectedUsers([]);
                    requestAnimationFrame(focusSearchInput);
                  }}
                >
                  Clear all
                </button>
              </div>
            </PopoverContent>
          </Popover>
        </div>
      </div>
      <div className="flex-1 min-h-0 min-w-0 pt-2">
        <div
          className="relative h-full max-w-[1360px] min-h-0 min-w-0"
          aria-busy={!isRouteTransition && navigation.state === "loading"}
        >
          {!isRouteTransition && navigation.state === "loading" && (
            <div role="status" className="absolute right-3 top-3 z-50 rounded bg-gray-900 p-2">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              <span className="sr-only">Refreshing contributors…</span>
            </div>
          )}
          {data.length === 0 ? (
            <EmptyState message="No contributor activity data available for the selected period." />
          ) : filteredData.length === 0 ? (
            <EmptyState message="No contributors match the current filter." />
          ) : (
            <DataTable
              columns={repoColumns}
              data={filteredData}
              pinnedColumn="gh_login"
              maxHeight="100%"
              virtualizeRows
            />
          )}
        </div>
      </div>
    </div>
  );
}
