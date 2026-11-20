import * as React from "react";
import {
  Button,
  CalendarCell,
  CalendarGrid,
  CalendarGridBody,
  CalendarGridHeader,
  CalendarHeaderCell,
  DateInput,
  DateFieldStateContext,
  DateRangePicker,
  DateSegment,
  Dialog,
  Group,
  Heading,
  Label,
  Popover,
  RangeCalendar,
} from "react-aria-components";
import { CalendarDate } from "@internationalized/date";
import { startOfMonth, startOfYear, subMonths } from "date-fns";
import { ChevronDown, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";
import { type DateRange } from "react-day-picker";

interface EnhancedDateRangePickerProps {
  className?: string;
  value?: DateRange;
  onChange: (range: DateRange) => void;
  /** Use zero when the caller applies a draft with an explicit Fetch button. */
  debounceMs?: number;
  /** Reports visible draft validity immediately, including incomplete segment edits. */
  onDraftValidityChange?: (valid: boolean) => void;
}

type Preset = { label: string; getValue: () => DateRange };

// Debounce timing constants
const DEBOUNCE_DELAY = 1000; // 1 second for both API calls and validation

// Convert Date to CalendarDate
function dateToCalendarDate(date: Date): CalendarDate {
  const year = date.getFullYear();
  const month = date.getMonth() + 1; // month is 0-indexed in Date
  const day = date.getDate();
  return new CalendarDate(year, month, day);
}

// Convert CalendarDate to Date
function calendarDateToDate(calendarDate: CalendarDate): Date {
  return new Date(calendarDate.year, calendarDate.month - 1, calendarDate.day);
}

// Convert DateRange to React Aria date range format
function dateRangeToAriaRange(range: DateRange) {
  if (!range.from || !range.to) return null;
  return {
    start: dateToCalendarDate(range.from),
    end: dateToCalendarDate(range.to),
  };
}

// Convert React Aria date range to DateRange format
function ariaRangeDateRange(
  ariaRange: { start: CalendarDate; end: CalendarDate } | null,
): DateRange {
  if (!ariaRange) return { from: undefined, to: undefined };
  return {
    from: calendarDateToDate(ariaRange.start),
    to: calendarDateToDate(ariaRange.end),
  };
}

function isValidDateRange(range: { start: CalendarDate; end: CalendarDate } | null): boolean {
  return Boolean(
    range &&
    range.start.year >= 1000 &&
    range.end.year >= 1000 &&
    range.start.compare(range.end) <= 0,
  );
}

const useDraftLayoutEffect =
  typeof window === "undefined" ? React.useEffect : React.useLayoutEffect;

// React Aria retains the committed value during partial/invalid segment edits.
// Observe its public field state so validity describes what is visibly edited,
// not just the last range emitted through DateRangePicker.onChange.
function DateDraftObserver({ onChange }: { onChange: (matches: boolean) => void }) {
  const state = React.useContext(DateFieldStateContext);
  const matches = Boolean(
    state?.value &&
    ["year", "month", "day"].every((type) => {
      const segment = state.segments.find((item) => item.type === type);
      return (
        segment &&
        !segment.isPlaceholder &&
        segment.value === state.value?.[type as "year" | "month" | "day"]
      );
    }),
  );
  useDraftLayoutEffect(() => onChange(matches), [matches, onChange]);
  return null;
}

export function EnhancedDateRangePicker({
  className,
  value,
  onChange,
  debounceMs = DEBOUNCE_DELAY,
  onDraftValidityChange,
}: EnhancedDateRangePickerProps) {
  // Initialize default value if none provided
  const [internalValue, setInternalValue] = React.useState<{
    start: CalendarDate;
    end: CalendarDate;
  } | null>(null);

  // Debounced onChange to prevent excessive API calls
  const debounceTimeoutRef = React.useRef<NodeJS.Timeout | undefined>(undefined);
  const pendingRangeRef = React.useRef<DateRange | null>(null);
  const validationTimeoutRef = React.useRef<NodeJS.Timeout | undefined>(undefined);
  const [showValidation, setShowValidation] = React.useState(false);
  const [startDraftMatches, setStartDraftMatches] = React.useState(false);
  const [endDraftMatches, setEndDraftMatches] = React.useState(false);
  const draftValid = startDraftMatches && endDraftMatches && isValidDateRange(internalValue);
  const debouncedOnChange = React.useCallback(
    (range: DateRange) => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      pendingRangeRef.current = range;
      if (debounceMs === 0) {
        pendingRangeRef.current = null;
        onChange(range);
        return;
      }
      debounceTimeoutRef.current = setTimeout(() => {
        pendingRangeRef.current = null;
        onChange(range);
      }, debounceMs);
    },
    [onChange, debounceMs],
  );

  useDraftLayoutEffect(() => {
    if (!draftValid) {
      clearTimeout(debounceTimeoutRef.current);
    } else if (pendingRangeRef.current) {
      // Restoring the same committed date may not emit another Aria onChange.
      debouncedOnChange(pendingRangeRef.current);
    }
    onDraftValidityChange?.(draftValid);
  }, [draftValid, onDraftValidityChange, debouncedOnChange]);

  // Debounced validation display
  const debouncedValidation = React.useCallback((shouldShow: boolean) => {
    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current);
    }
    validationTimeoutRef.current = setTimeout(() => {
      setShowValidation(shouldShow);
    }, DEBOUNCE_DELAY);
  }, []);

  // Initialize with default range on first render
  React.useEffect(() => {
    if (!internalValue && (!value?.from || !value?.to)) {
      const today = new Date();
      const defaultRange = { from: subMonths(today, 1), to: today };
      const ariaRange = dateRangeToAriaRange(defaultRange);
      setInternalValue(ariaRange);
      onChange(defaultRange); // Initial load - no debounce needed
    }
  }, [internalValue, value, onChange]);

  // Update internal value when prop changes
  React.useEffect(() => {
    if (value?.from && value?.to) {
      clearTimeout(debounceTimeoutRef.current);
      pendingRangeRef.current = null;
      const range = dateRangeToAriaRange(value);
      setInternalValue(range);
    }
  }, [value]);

  // Cleanup debounce timeouts on unmount
  React.useEffect(() => {
    return () => {
      if (debounceTimeoutRef.current) {
        clearTimeout(debounceTimeoutRef.current);
      }
      if (validationTimeoutRef.current) {
        clearTimeout(validationTimeoutRef.current);
      }
    };
  }, []);

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

  const handleChange = (ariaRange: { start: CalendarDate; end: CalendarDate } | null) => {
    setInternalValue(ariaRange);
    const dateRange = ariaRangeDateRange(ariaRange);

    // Cancel stale callbacks even when the new edit is incomplete or invalid.
    clearTimeout(debounceTimeoutRef.current);
    clearTimeout(validationTimeoutRef.current);
    const isValid = isValidDateRange(ariaRange);

    // Handle validation display
    if (dateRange.from && dateRange.to) {
      if (isValid) {
        setShowValidation(false); // Hide validation immediately for valid ranges
        debouncedOnChange(dateRange);
      } else {
        debouncedValidation(true); // Show validation after delay for invalid ranges
      }
    } else {
      setShowValidation(false); // Hide validation for incomplete ranges
    }
  };

  const handlePresetClick = (preset: Preset) => {
    // Clear any pending debounced calls
    if (debounceTimeoutRef.current) {
      clearTimeout(debounceTimeoutRef.current);
    }
    if (validationTimeoutRef.current) {
      clearTimeout(validationTimeoutRef.current);
    }
    pendingRangeRef.current = null;
    setShowValidation(false); // Hide validation for presets
    const range = preset.getValue();
    const ariaRange = dateRangeToAriaRange(range);
    setInternalValue(ariaRange);
    onChange(range); // Presets apply immediately
  };

  // Only show red styling if validation is being shown
  const shouldShowRedStyling = showValidation && internalValue && !isValidDateRange(internalValue);

  return (
    <DateRangePicker
      value={internalValue}
      onChange={handleChange}
      className={cn("relative", className)}
    >
      <Label className="sr-only">Date range</Label>
      <Group
        className={cn(
          "flex items-center w-full rounded-md border px-3 py-2 text-sm h-10",
          shouldShowRedStyling
            ? "border-red-500 bg-red-900/20 text-white"
            : "border-gray-600 bg-gray-800 text-white",
        )}
      >
        <DateInput slot="start" className="flex-none">
          {(segment) => (
            <React.Fragment>
              {segment.type === "year" && <DateDraftObserver onChange={setStartDraftMatches} />}
              <DateSegment
                segment={segment}
                className={cn(
                  "px-0 py-0 rounded outline-none focus:bg-gray-600 text-center min-w-[2ch]",
                  shouldShowRedStyling ? "text-red-200" : "text-white",
                )}
              />
            </React.Fragment>
          )}
        </DateInput>
        <span
          className={cn("mx-2 flex-none", shouldShowRedStyling ? "text-red-400" : "text-gray-400")}
        >
          –
        </span>
        <DateInput slot="end" className="flex-none">
          {(segment) => (
            <React.Fragment>
              {segment.type === "year" && <DateDraftObserver onChange={setEndDraftMatches} />}
              <DateSegment
                segment={segment}
                className={cn(
                  "px-0 py-0 rounded outline-none focus:bg-gray-600 text-center min-w-[2ch]",
                  shouldShowRedStyling ? "text-red-200" : "text-white",
                )}
              />
            </React.Fragment>
          )}
        </DateInput>
        <div className="flex-1" />
        <Button
          aria-label="Choose date range"
          className="flex-none p-1 bg-transparent hover:bg-gray-600 rounded text-white"
        >
          <ChevronDown className="h-4 w-4" />
        </Button>
      </Group>

      <Popover className="z-50 w-[400px] max-w-[calc(100vw-2rem)] overflow-hidden rounded-md border border-gray-600 bg-gray-800 text-white shadow-lg">
        <Dialog className="outline-none">
          <div className="flex flex-col sm:flex-row">
            {/* Presets sidebar (wrapped above the calendar on narrow screens). */}
            <div className="border-b border-gray-600 bg-gray-700/50 p-3 sm:w-32 sm:shrink-0 sm:border-b-0 sm:border-r">
              <div className="flex flex-wrap gap-1 sm:block sm:space-y-1">
                {presets.map((preset) => (
                  <button
                    key={preset.label}
                    onClick={() => handlePresetClick(preset)}
                    type="button"
                    className="sm:w-full text-left text-sm px-2 py-1 text-white hover:bg-gray-600 rounded transition-colors"
                  >
                    {preset.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Calendar */}
            <div className="p-3">
              <RangeCalendar className="outline-none">
                <div className="flex items-center justify-between mb-4">
                  <Button
                    slot="previous"
                    className="p-1 hover:bg-gray-600 rounded transition-colors text-white"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Heading className="font-medium text-sm text-white" />
                  <Button
                    slot="next"
                    className="p-1 hover:bg-gray-600 rounded transition-colors text-white"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                <CalendarGrid className="border-spacing-1">
                  <CalendarGridHeader>
                    {(day) => (
                      <CalendarHeaderCell className="w-8 h-8 text-xs font-medium text-gray-400">
                        {day}
                      </CalendarHeaderCell>
                    )}
                  </CalendarGridHeader>
                  <CalendarGridBody>
                    {(date) => (
                      <CalendarCell
                        date={date}
                        className="w-8 h-8 text-sm rounded text-white hover:bg-gray-600 focus:bg-gray-600 outline-none cursor-pointer data-[selected=true]:bg-blue-600 data-[selected=true]:text-white data-[range-selection=true]:bg-blue-600/30 data-[range-start=true]:bg-blue-600 data-[range-start=true]:text-white data-[range-end=true]:bg-blue-600 data-[range-end=true]:text-white data-[unavailable=true]:text-gray-500 data-[unavailable=true]:cursor-not-allowed"
                      />
                    )}
                  </CalendarGridBody>
                </CalendarGrid>
              </RangeCalendar>
            </div>
          </div>
        </Dialog>
      </Popover>
    </DateRangePicker>
  );
}
