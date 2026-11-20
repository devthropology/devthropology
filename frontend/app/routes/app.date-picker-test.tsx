import { useState } from "react";
import { MetaFunction } from "react-router";
import { EnhancedDateRangePicker } from "~/components/ui/EnhancedDateRangePicker";
import { DateRangeSelector } from "~/components/ui/DateRangeSelector";
import { type DateRange } from "react-day-picker";

export const meta: MetaFunction = () => [
  { title: "DatePicker Test" },
  { name: "description", content: "Test Enhanced DatePicker Component" },
];

export default function DatePickerTest() {
  const [enhancedRange, setEnhancedRange] = useState<DateRange>({
    from: undefined,
    to: undefined,
  });
  const [originalRange, setOriginalRange] = useState<DateRange>({
    from: undefined,
    to: undefined,
  });

  return (
    <div className="container mx-auto p-8 space-y-12">
      <h1 className="text-3xl font-bold text-center mb-8">DatePicker Test Comparison</h1>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Enhanced DateRangePicker */}
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">Enhanced DateRangePicker</h2>
          <p className="text-muted-foreground">React Aria implementation with presets sidebar</p>

          <div className="p-4 border rounded-lg">
            <EnhancedDateRangePicker value={enhancedRange} onChange={setEnhancedRange} />
          </div>

          <div className="text-sm space-y-2">
            <p>
              <strong>From:</strong> {enhancedRange.from?.toDateString() || "Not selected"}
            </p>
            <p>
              <strong>To:</strong> {enhancedRange.to?.toDateString() || "Not selected"}
            </p>
          </div>
        </div>

        {/* Original DateRangeSelector */}
        <div className="space-y-4">
          <h2 className="text-2xl font-semibold">Original DateRangeSelector</h2>
          <p className="text-muted-foreground">Current implementation with dropdown presets</p>

          <div className="p-4 border rounded-lg">
            <DateRangeSelector value={originalRange} onChange={setOriginalRange} />
          </div>

          <div className="text-sm space-y-2">
            <p>
              <strong>From:</strong> {originalRange.from?.toDateString() || "Not selected"}
            </p>
            <p>
              <strong>To:</strong> {originalRange.to?.toDateString() || "Not selected"}
            </p>
          </div>
        </div>
      </div>

      {/* Features comparison */}
      <div className="mt-12 p-6 bg-muted/50 rounded-lg">
        <h3 className="text-xl font-semibold mb-4">Features Comparison</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <h4 className="font-medium mb-2">Enhanced DateRangePicker</h4>
            <ul className="text-sm space-y-1 text-muted-foreground">
              <li>✅ Segmented date input (MM/DD/YYYY)</li>
              <li>✅ Presets in sidebar layout</li>
              <li>✅ React Aria accessibility</li>
              <li>✅ Better keyboard navigation</li>
              <li>✅ Datadog-style layout</li>
            </ul>
          </div>
          <div>
            <h4 className="font-medium mb-2">Original DateRangeSelector</h4>
            <ul className="text-sm space-y-1 text-muted-foreground">
              <li>✅ Text display with formatted dates</li>
              <li>✅ Preset dropdown menu</li>
              <li>✅ Calendar selection</li>
              <li>⚠️ Limited keyboard navigation</li>
              <li>⚠️ Dropdown layout</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
