import { useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "../ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";
import { cn } from "../../lib/utils";
import { rankCommandMatch } from "../../utils/commandRanking";

/** Presentation only: callers decide whether selection updates URL state or local rows. */
export function ReportUserFilter({
  users,
  selectedUsers,
  onToggle,
  onClear,
  label,
  disabled = false,
}: {
  users: string[];
  selectedUsers: string[];
  onToggle: (username: string) => void;
  onClear: () => void;
  label: "authors" | "reviewers";
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const focusSearchInput = () => searchInputRef.current?.focus();

  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next) requestAnimationFrame(focusSearchInput);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          aria-label={`Filter ${label}`}
          className={cn(
            "inline-flex h-10 w-full md:w-[240px] items-center justify-between rounded-md border px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-blue-400",
            "border-white/20 bg-[#0f172a] text-white hover:border-blue-400 hover:bg-blue-500/10",
            disabled && "cursor-not-allowed opacity-50 hover:border-white/20 hover:bg-[#0f172a]",
            selectedUsers.length > 0 && "border-blue-400",
          )}
        >
          <span>Filter {label}</span>
          <ChevronDown className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="z-[70] w-80 max-w-[calc(100vw-2rem)] rounded-lg border border-white/10 bg-[#111827] p-0 text-white shadow-2xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          focusSearchInput();
        }}
      >
        <Command
          label={`Search ${label}`}
          className="bg-transparent text-white"
          filter={rankCommandMatch}
        >
          <div className="space-y-2 px-4 py-4">
            <p className="text-xs uppercase tracking-wide text-gray-400">Search {label}</p>
            <div className="rounded-lg border border-white/15 bg-[#0f172a] px-3 py-1.5">
              <CommandInput
                ref={searchInputRef}
                aria-label={`Search ${label}`}
                placeholder={`Search ${label}...`}
                className="h-8 w-full bg-transparent text-sm text-white placeholder:text-gray-500 focus-visible:border-0 focus-visible:ring-0"
              />
            </div>
          </div>
          <CommandList className="max-h-64">
            <CommandEmpty className="py-4 text-center text-sm text-gray-400">
              No {label} found
            </CommandEmpty>
            <CommandGroup className="p-0">
              {users.map((username) => (
                <CommandItem
                  key={username}
                  value={username}
                  onSelect={() => {
                    if (disabled) return;
                    onToggle(username);
                    requestAnimationFrame(focusSearchInput);
                  }}
                  className="flex cursor-pointer select-none items-center justify-between px-4 py-2 text-sm text-white data-[selected=true]:bg-blue-500/20 data-[selected=true]:text-white"
                >
                  <span>{username}</span>
                  {selectedUsers.includes(username) && <Check className="h-4 w-4 text-blue-300" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
        <div className="flex items-center justify-between border-t border-white/10 px-4 py-3">
          <span className="text-sm text-gray-400">{selectedUsers.length} selected</span>
          <button
            type="button"
            disabled={disabled}
            className="text-sm font-semibold text-blue-300 hover:text-blue-200"
            onClick={() => {
              onClear();
              requestAnimationFrame(focusSearchInput);
            }}
          >
            Clear all
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
