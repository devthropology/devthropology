import * as React from "react";
import { format, parse } from "date-fns";
import { CalendarIcon } from "lucide-react";
import type { DateRange } from "react-day-picker";

import { cn } from "../../lib/utils";
import { Button } from "./button";
import { Calendar } from "./calendar";
import { Popover, PopoverContent, PopoverTrigger } from "./popover";
import { Input } from "./input";

interface DatePickerWithRangeProps extends Omit<React.HTMLAttributes<HTMLDivElement>, "onChange"> {
  value: DateRange;
  onChange: (date: DateRange) => void;
}

export function DatePickerWithRange({ className, value, onChange }: DatePickerWithRangeProps) {
  const [isEditing, setIsEditing] = React.useState(false);
  const [inputValue, setInputValue] = React.useState(() =>
    value?.from && value?.to
      ? `${format(value.from, "MM/dd/yyyy")} - ${format(value.to, "MM/dd/yyyy")}`
      : "",
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setInputValue(e.target.value);
  };

  const handleInputBlur = () => {
    setIsEditing(false);
    const dates = inputValue.split(" - ");
    if (dates.length === 2) {
      const from = parse(dates[0], "MM/dd/yyyy", new Date());
      const to = parse(dates[1], "MM/dd/yyyy", new Date());
      if (!isNaN(from.getTime()) && !isNaN(to.getTime())) {
        onChange({ from, to });
      }
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      handleInputBlur();
    }
  };

  const handleCalendarChange = (range: DateRange | undefined) => {
    const nextRange = range ?? { from: undefined, to: undefined };
    if (range?.from && range?.to) {
      setInputValue(`${format(range.from, "MM/dd/yyyy")} - ${format(range.to, "MM/dd/yyyy")}`);
    }
    onChange(nextRange);
  };

  return (
    <div className={cn("grid gap-2", className)}>
      <Popover>
        <PopoverTrigger asChild>
          {!isEditing ? (
            <Button
              id="date"
              variant="outline"
              className={cn(
                "w-[300px] justify-start text-left font-normal",
                !value && "text-muted-foreground",
              )}
              onDoubleClick={() => setIsEditing(true)}
            >
              <CalendarIcon className="mr-2 h-4 w-4" />
              {value?.from ? (
                value.to ? (
                  <>
                    {format(value.from, "LLL dd, y")} - {format(value.to, "LLL dd, y")}
                  </>
                ) : (
                  format(value.from, "LLL dd, y")
                )
              ) : (
                <span>Pick a date</span>
              )}
            </Button>
          ) : (
            <Input
              className="w-[300px]"
              value={inputValue}
              onChange={handleInputChange}
              onBlur={handleInputBlur}
              onKeyDown={handleInputKeyDown}
              autoFocus
            />
          )}
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            autoFocus
            mode="range"
            defaultMonth={value?.from}
            selected={value}
            onSelect={handleCalendarChange}
            numberOfMonths={2}
          />
        </PopoverContent>
      </Popover>
    </div>
  );
}
