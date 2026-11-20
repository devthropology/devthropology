import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { EnhancedDateRangePicker } from "./EnhancedDateRangePicker";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("reports incomplete edits immediately and cancels a previously queued valid range", () => {
  vi.useFakeTimers();
  const onChange = vi.fn();
  const onDraftValidityChange = vi.fn();
  render(
    <EnhancedDateRangePicker
      value={{ from: new Date(2026, 3, 10), to: new Date(2026, 8, 27) }}
      onChange={onChange}
      onDraftValidityChange={onDraftValidityChange}
    />,
  );
  const month = screen.getAllByRole("spinbutton")[0];
  fireEvent.keyDown(month, { key: "ArrowUp" });
  fireEvent.keyDown(month, { key: "Backspace" });
  expect(onDraftValidityChange).toHaveBeenLastCalledWith(false);
  act(() => vi.advanceTimersByTime(1000));
  expect(onChange).not.toHaveBeenCalled();
  fireEvent(
    month,
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: "5",
    }),
  );
  expect(onDraftValidityChange).toHaveBeenLastCalledWith(true);
  act(() => vi.advanceTimersByTime(1000));
  expect(onChange).toHaveBeenCalledTimes(1);
  expect(onChange.mock.calls[0][0].from.getMonth()).toBe(4);
});

it("detects an impossible visible date even when Aria retains its previous committed value", () => {
  const onChange = vi.fn();
  const onDraftValidityChange = vi.fn();
  render(
    <EnhancedDateRangePicker
      value={{ from: new Date(2026, 1, 10), to: new Date(2026, 8, 27) }}
      onChange={onChange}
      debounceMs={0}
      onDraftValidityChange={onDraftValidityChange}
    />,
  );
  const day = screen.getAllByRole("spinbutton")[1];
  fireEvent.keyDown(day, { key: "Backspace" });
  fireEvent.keyDown(day, { key: "Backspace" });
  onChange.mockClear(); // Deleting 10 to 1 was briefly a valid date.
  fireEvent(
    day,
    new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertText",
      data: "30",
    }),
  );
  expect(day.textContent).toBe("30");
  expect(onDraftValidityChange).toHaveBeenLastCalledWith(false);
  expect(onChange).not.toHaveBeenCalled();
});

it("reports a reversed range as invalid without emitting a fetchable range", () => {
  const onChange = vi.fn();
  const onDraftValidityChange = vi.fn();
  render(
    <EnhancedDateRangePicker
      value={{ from: new Date(2026, 8, 10), to: new Date(2026, 8, 27) }}
      onChange={onChange}
      debounceMs={0}
      onDraftValidityChange={onDraftValidityChange}
    />,
  );
  const month = screen.getAllByRole("spinbutton")[0];
  fireEvent.keyDown(month, { key: "ArrowUp" });
  expect(onDraftValidityChange).toHaveBeenLastCalledWith(false);
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.keyDown(month, { key: "ArrowDown" });
  expect(onDraftValidityChange).toHaveBeenLastCalledWith(true);
  expect(onChange).toHaveBeenCalledTimes(1);
});

for (const debounceMs of [undefined, 0]) {
  it(`date edits ${debounceMs === 0 ? "update explicit-fetch drafts immediately" : "retain the existing automatic-fetch debounce"}`, () => {
    vi.useFakeTimers();
    const onChange = vi.fn();
    render(
      <EnhancedDateRangePicker
        value={{ from: new Date(2026, 3, 10), to: new Date(2026, 8, 27) }}
        onChange={onChange}
        debounceMs={debounceMs}
      />,
    );
    fireEvent.keyDown(screen.getAllByRole("spinbutton")[0], { key: "ArrowUp" });
    if (debounceMs === undefined) {
      expect(onChange).not.toHaveBeenCalled();
      act(() => vi.advanceTimersByTime(1000));
    }
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0].from.getMonth()).toBe(4);
  });
}
