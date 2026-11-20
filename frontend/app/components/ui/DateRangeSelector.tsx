import * as React from "react";
import { format, startOfMonth, startOfYear, subMonths } from "date-fns";
import { CalendarIcon, ChevronDown } from "lucide-react";
import { type DateRange } from "react-day-picker";

import { cn } from "../../lib/utils";
import { Button } from "./button";
import { Calendar } from "./calendar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "./dropdown-menu";

interface DateRangeSelectorProps {
  className?: string;
  value: DateRange;
  onChange: (range: DateRange) => void;
}

type Preset = { label: string; getValue: () => DateRange };

export function DateRangeSelector({ className, value, onChange }: DateRangeSelectorProps) {
  const [open, setOpen] = React.useState(false);
  const [showCal, setShowCal] = React.useState(false);
  const [tempRange, setTempRange] = React.useState<DateRange>({
    from: undefined,
    to: undefined,
  });

  // seed tempRange to current value when calendar opens (reintroduce shading)
  React.useEffect(() => {
    if (showCal) {
      setTempRange({ from: value.from, to: value.to });
    }
  }, [showCal, value]);

  // on first open, initialize if no value
  React.useEffect(() => {
    if (!value.from && !value.to) {
      const today = new Date();
      onChange({ from: subMonths(today, 1), to: today });
    }
  }, [value, onChange]);

  const presets: Preset[] = React.useMemo(
    () => [
      {
        label: "1 Month",
        getValue: () => ({ from: subMonths(new Date(), 1), to: new Date() }),
      },
      {
        label: "3 Months",
        getValue: () => ({ from: subMonths(new Date(), 3), to: new Date() }),
      },
      {
        label: "6 Months",
        getValue: () => ({ from: subMonths(new Date(), 6), to: new Date() }),
      },
      {
        label: "MTD",
        getValue: () => ({ from: startOfMonth(new Date()), to: new Date() }),
      },
      {
        label: "YTD",
        getValue: () => ({ from: startOfYear(new Date()), to: new Date() }),
      },
      {
        label: "1 Year",
        getValue: () => ({ from: subMonths(new Date(), 12), to: new Date() }),
      },
    ],
    [],
  );

  const label =
    value.from && value.to
      ? `${format(value.from, "LLL d, yyyy")} – ${format(value.to, "LLL d, yyyy")}`
      : "Select date range";

  return (
    <DropdownMenu
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setShowCal(false);
      }}
    >
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          className={cn(
            "w-[300px] justify-between text-left font-normal text-foreground",
            !value.from && !value.to && "text-muted-foreground",
            className,
          )}
        >
          <div className="flex items-center gap-2">
            <CalendarIcon className="h-4 w-4" />
            <span>{label}</span>
          </div>
          <ChevronDown className="h-4 w-4 opacity-50" />
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        side="bottom"
        align="start"
        className="w-[300px] overflow-visible inline-block"
      >
        {!showCal ? (
          <>
            {presets.map((p) => (
              <DropdownMenuItem
                key={p.label}
                onClick={() => {
                  onChange(p.getValue());
                  setOpen(false);
                }}
              >
                {p.label}
              </DropdownMenuItem>
            ))}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={(e) => {
                e.preventDefault();
                setShowCal(true);
              }}
            >
              Select from calendar...
            </DropdownMenuItem>
          </>
        ) : (
          <div className="w-full p-2 bg-white rounded-lg shadow inline-block">
            <Calendar
              autoFocus
              mode="range"
              defaultMonth={value.from || new Date()}
              numberOfMonths={1} // single-month view
              selected={tempRange} // highlights tempRange
              onDayClick={(day) => {
                // first click or resetting after full range
                if (!tempRange.from || (tempRange.from && tempRange.to)) {
                  setTempRange({ from: day, to: undefined });
                  return;
                }
                // second click: if before start, restart; otherwise finalize
                if (day < tempRange.from) {
                  setTempRange({ from: day, to: undefined });
                } else {
                  onChange({ from: tempRange.from, to: day });
                  setShowCal(false);
                  setOpen(false);
                }
              }}
              modifiers={{
                ...(tempRange.from ? { start: tempRange.from } : {}),
                ...(tempRange.to ? { end: tempRange.to } : {}),
              }}
              modifiersClassNames={{
                selected: "bg-primary text-primary-foreground",
                range_middle: "bg-primary/20",
                range_start: "rounded-l-md bg-primary text-primary-foreground",
                range_end: "rounded-r-md bg-primary text-primary-foreground",
              }}
              className="pointer-events-auto"
            />
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
