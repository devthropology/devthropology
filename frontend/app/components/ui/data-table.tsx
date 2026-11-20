import { flexRender, SortingState, useTable, type RowData } from "@tanstack/react-table";
import * as React from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import "./data-table.css";

import { cn } from "../../lib/utils";
import { dataTableFeatures } from "./data-table-features";
import type { DataTableColumnDef } from "./data-table-features";

import { TableCell, TableRow } from "./table";

type DataTableColumnMeta = {
  headerClassName?: string;
  cellClassName?: string;
};

export type DataTableAppearance = {
  container?: string;
  headerCell?: string;
  pinnedHeaderCell?: string;
  bodyCell?: string;
  bodyCellSurface?: string;
  pinnedBodyCell?: string;
  pinnedBodyCellSurface?: string;
  row?: string;
  pinnedRow?: string;
  pinnedLastRow?: string;
  pinnedSurfaceColor?: string;
};

export type DataTableSurface = {
  headerBg?: string;
  bodyBg?: string;
  pinnedBg?: string;
  pinnedShadowColor?: string;
};

const DEFAULT_BODY_CELL_SURFACE = {
  even: "bg-[#0f1215]",
  odd: "bg-[#0a0c0e]",
};

const useIsomorphicLayoutEffect =
  typeof window !== "undefined" ? React.useLayoutEffect : React.useEffect;

interface DataTableProps<TData extends RowData> {
  columns: DataTableColumnDef<TData>[];
  data: TData[];
  pinnedRows?: TData[];
  pinnedColumn?: string | string[];
  maxHeight?: string;
  showEmptyState?: boolean;
  /** Window ordinary rows; pinned-row tables retain their existing rendering. */
  virtualizeRows?: boolean;
  onScrollNearEnd?: () => void;
  isLoadingMore?: boolean;
  showCustomHorizontalScrollbar?: boolean;
  appearance?: DataTableAppearance;
  surface?: DataTableSurface;
}

export function DataTable<TData extends RowData>({
  columns,
  data,
  pinnedRows = [],
  pinnedColumn = "contributor",
  maxHeight = "600px",
  showEmptyState = true,
  virtualizeRows = false,
  onScrollNearEnd,
  isLoadingMore = false,
  showCustomHorizontalScrollbar = false,
  appearance,
  surface,
}: DataTableProps<TData>) {
  const [sorting, setSorting] = React.useState<SortingState>([]);
  const tableRef = React.useRef<HTMLTableElement>(null);
  const theadRef = React.useRef<HTMLTableSectionElement>(null);
  const pinnedRowsRef = React.useRef<HTMLTableSectionElement>(null);
  const scrollSentinelRef = React.useRef<HTMLDivElement>(null);
  const scrollContainerRef = React.useRef<HTMLDivElement>(null);
  const horizontalTrackRef = React.useRef<HTMLDivElement>(null);
  const horizontalThumbRef = React.useRef<HTMLDivElement>(null);
  const isDraggingHorizontalRef = React.useRef(false);
  const dragTrackRectRef = React.useRef<DOMRect | null>(null);
  const isLoadingMoreRef = React.useRef(isLoadingMore);
  const onScrollNearEndRef = React.useRef(onScrollNearEnd);
  const [headerHeight, setHeaderHeight] = React.useState(0);
  const [pinnedRowOffsets, setPinnedRowOffsets] = React.useState<number[]>([]);
  const [horizontalMetrics, setHorizontalMetrics] = React.useState({
    clientWidth: 0,
    scrollWidth: 0,
    trackWidth: 0,
  });
  const isPercentageHeight = /^\d*\.?\d+%$/.test(maxHeight.trim());

  // Measure header height after render using ResizeObserver
  useIsomorphicLayoutEffect(() => {
    const thead = theadRef.current;
    if (!thead || (pinnedRows.length === 0 && !virtualizeRows)) return;

    const updateHeaderHeight = () => {
      setHeaderHeight(thead.offsetHeight);
    };

    updateHeaderHeight();
    const observer = new ResizeObserver(updateHeaderHeight);
    observer.observe(thead);

    return () => observer.disconnect();
  }, [pinnedRows.length, virtualizeRows]);

  // Measure actual pinned row heights using ResizeObserver
  useIsomorphicLayoutEffect(() => {
    const pinnedTbody = pinnedRowsRef.current;
    if (!pinnedTbody || pinnedRows.length === 0) {
      setPinnedRowOffsets((current) => (current.length === 0 ? current : []));
      return;
    }

    const updateRowOffsets = () => {
      const rows = pinnedTbody.querySelectorAll("tr");
      const offsets: number[] = [];
      let cumulativeHeight = 0;
      rows.forEach((row) => {
        offsets.push(cumulativeHeight);
        cumulativeHeight += row.getBoundingClientRect().height;
      });
      setPinnedRowOffsets(offsets);
    };

    updateRowOffsets();

    const observer = new ResizeObserver(updateRowOffsets);
    observer.observe(pinnedTbody);

    return () => observer.disconnect();
  }, [pinnedRows.length]);

  const table = useTable({
    features: dataTableFeatures,
    data,
    columns,
    onSortingChange: (updater) => {
      const nextState = typeof updater === "function" ? updater(sorting) : updater;
      // If this is a new sort column, default to desc
      if (nextState.length > 0 && (!sorting.length || sorting[0].id !== nextState[0].id)) {
        setSorting([{ ...nextState[0], desc: true }]);
      } else {
        setSorting(nextState);
      }
    },
    state: {
      sorting,
      columnPinning: {
        start: Array.isArray(pinnedColumn) ? pinnedColumn : [pinnedColumn],
        end: [],
      },
    },
  });

  const hasSizedColumns = table
    .getAllLeafColumns()
    .some((column) => column.columnDef.size !== undefined);
  const tableMinWidth = hasSizedColumns ? table.getTotalSize() : undefined;
  const isVirtualized = virtualizeRows && pinnedRows.length === 0;
  const tableStyle: React.CSSProperties = {
    minWidth: tableMinWidth,
    tableLayout: isVirtualized ? "fixed" : undefined,
  };
  const rows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollContainerRef.current,
    estimateSize: () => 41,
    overscan: 8,
    enabled: isVirtualized,
    // Include the header in the scroll offset, not in the row measurements.
    scrollMargin: isVirtualized ? headerHeight : 0,
    initialRect: { width: 0, height: 600 },
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const renderedRows = isVirtualized
    ? virtualRows.map((item) => ({ row: rows[item.index], index: item.index }))
    : rows.map((row, index) => ({ row, index }));
  const paddingTop =
    isVirtualized && virtualRows.length > 0
      ? Math.max(0, virtualRows[0].start - rowVirtualizer.options.scrollMargin)
      : 0;
  const paddingBottom =
    isVirtualized && virtualRows.length > 0
      ? Math.max(
          0,
          rowVirtualizer.getTotalSize() -
            (virtualRows[virtualRows.length - 1].end - rowVirtualizer.options.scrollMargin),
        )
      : 0;

  // Filtering or replacing the data should not leave the viewport below the results.
  React.useEffect(() => {
    if (isVirtualized) rowVirtualizer.scrollToOffset(0);
  }, [data, sorting, isVirtualized, rowVirtualizer]);

  const updateHorizontalMetrics = React.useCallback(() => {
    if (!showCustomHorizontalScrollbar) return;
    const container = scrollContainerRef.current;
    const track = horizontalTrackRef.current;
    if (!container) return;

    const next = {
      clientWidth: container.clientWidth,
      scrollWidth: Math.max(container.scrollWidth, tableMinWidth ?? 0),
      trackWidth: track?.clientWidth ?? 0,
    };

    setHorizontalMetrics((current) => {
      if (
        current.clientWidth === next.clientWidth &&
        current.scrollWidth === next.scrollWidth &&
        current.trackWidth === next.trackWidth
      ) {
        return current;
      }
      return next;
    });
  }, [showCustomHorizontalScrollbar, tableMinWidth]);

  // Create a separate table instance for pinned rows to get proper cell rendering
  const pinnedTable = useTable({
    features: dataTableFeatures,
    data: pinnedRows,
    columns,
    state: {
      columnPinning: {
        start: Array.isArray(pinnedColumn) ? pinnedColumn : [pinnedColumn],
        end: [],
      },
    },
  });

  // Keep refs in sync so the IntersectionObserver callback always reads
  // current values without needing to be torn down and recreated.
  React.useEffect(() => {
    isLoadingMoreRef.current = isLoadingMore;
  }, [isLoadingMore]);
  React.useEffect(() => {
    onScrollNearEndRef.current = onScrollNearEnd;
  }, [onScrollNearEnd]);

  // Infinite scroll: fire onScrollNearEnd when sentinel enters viewport.
  // The observer is created once (per sentinel/container pair) and reads
  // mutable refs so that toggling isLoadingMore does not recreate it,
  // preventing the re-observe -> immediate-intersect -> fetch loop.
  React.useEffect(() => {
    const sentinel = scrollSentinelRef.current;
    const container = scrollContainerRef.current;
    if (!sentinel || !container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMoreRef.current && onScrollNearEndRef.current) {
          onScrollNearEndRef.current();
        }
      },
      { root: container, rootMargin: "200px" },
    );

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  React.useEffect(() => {
    if (!showCustomHorizontalScrollbar) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    updateHorizontalMetrics();
  }, [showCustomHorizontalScrollbar, updateHorizontalMetrics]);

  const hasHorizontalOverflow = horizontalMetrics.scrollWidth > horizontalMetrics.clientWidth + 1;

  useIsomorphicLayoutEffect(() => {
    if (!showCustomHorizontalScrollbar) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      updateHorizontalMetrics();
    });

    resizeObserver.observe(container);
    // Same-count data replacements can change intrinsic table width without
    // resizing the scroll container. Refresh geometry when the table changes.
    if (tableRef.current) {
      resizeObserver.observe(tableRef.current);
    }
    if (horizontalTrackRef.current) {
      resizeObserver.observe(horizontalTrackRef.current);
    }

    return () => resizeObserver.disconnect();
  }, [
    columns.length,
    data.length,
    pinnedRows.length,
    hasHorizontalOverflow,
    showCustomHorizontalScrollbar,
    updateHorizontalMetrics,
  ]);

  React.useEffect(() => {
    if (!showCustomHorizontalScrollbar) return;
    const frame = requestAnimationFrame(() => {
      updateHorizontalMetrics();
    });
    return () => cancelAnimationFrame(frame);
  }, [showCustomHorizontalScrollbar, tableMinWidth, updateHorizontalMetrics]);

  const maxScrollLeft = Math.max(0, horizontalMetrics.scrollWidth - horizontalMetrics.clientWidth);
  const thumbWidth =
    horizontalMetrics.trackWidth > 0 && horizontalMetrics.scrollWidth > 0
      ? Math.min(
          horizontalMetrics.trackWidth,
          Math.max(
            40,
            (horizontalMetrics.clientWidth / horizontalMetrics.scrollWidth) *
              horizontalMetrics.trackWidth,
          ),
        )
      : 0;
  const maxThumbLeft = Math.max(0, horizontalMetrics.trackWidth - thumbWidth);
  // Scrolling must not rerender every table cell. Only geometry lives in React
  // state; the thumb's position is updated directly on its composited layer.
  const updateHorizontalThumb = React.useCallback(() => {
    const container = scrollContainerRef.current;
    const thumb = horizontalThumbRef.current;
    if (!container || !thumb) return;
    const left =
      maxScrollLeft > 0
        ? Math.max(0, Math.min(maxThumbLeft, (container.scrollLeft / maxScrollLeft) * maxThumbLeft))
        : 0;
    thumb.style.transform = `translateX(${left}px)`;
  }, [maxScrollLeft, maxThumbLeft]);

  useIsomorphicLayoutEffect(() => {
    if (!showCustomHorizontalScrollbar) return;
    const container = scrollContainerRef.current;
    if (!container) return;

    let frame: number | undefined;
    const handleScroll = () => {
      if (frame !== undefined) return;
      frame = requestAnimationFrame(() => {
        frame = undefined;
        updateHorizontalThumb();
      });
    };
    updateHorizontalThumb();
    container.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      container.removeEventListener("scroll", handleScroll);
      if (frame !== undefined) cancelAnimationFrame(frame);
    };
  }, [showCustomHorizontalScrollbar, hasHorizontalOverflow, updateHorizontalThumb]);

  const scrollToThumbPosition = React.useCallback(
    (nextThumbLeft: number) => {
      const container = scrollContainerRef.current;
      if (!container || maxThumbLeft <= 0 || maxScrollLeft <= 0) return;
      const clamped = Math.max(0, Math.min(maxThumbLeft, nextThumbLeft));
      container.scrollLeft = (clamped / maxThumbLeft) * maxScrollLeft;
      updateHorizontalThumb();
    },
    [maxScrollLeft, maxThumbLeft, updateHorizontalThumb],
  );

  const handleTrackPointerDown = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const track = horizontalTrackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      dragTrackRectRef.current = rect;
      const x = event.clientX - rect.left;
      scrollToThumbPosition(x - thumbWidth / 2);
      isDraggingHorizontalRef.current = true;
      track.setPointerCapture(event.pointerId);
    },
    [scrollToThumbPosition, thumbWidth],
  );

  const handleTrackPointerMove = React.useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!isDraggingHorizontalRef.current) return;
      const rect = dragTrackRectRef.current;
      if (!rect) return;
      const x = event.clientX - rect.left;
      scrollToThumbPosition(x - thumbWidth / 2);
    },
    [scrollToThumbPosition, thumbWidth],
  );

  const handleTrackPointerEnd = React.useCallback(() => {
    isDraggingHorizontalRef.current = false;
    dragTrackRectRef.current = null;
  }, []);

  const containerClassName = cn(
    "relative flex flex-col min-h-0 min-w-0 w-full max-w-full border rounded-md",
    appearance?.container,
  );
  const headerCellClassName = cn(
    "sticky top-0 overflow-hidden border-b px-2 py-3 z-30",
    "bg-[#0f1215] text-base font-medium text-gray-200 border-gray-700",
    appearance?.headerCell,
  );
  const pinnedHeaderClassName = cn(
    "sticky left-0 z-40 border-r",
    "shadow-[2px_0_5px_-2px_rgba(0,0,0,0.3)] border-gray-600",
    appearance?.pinnedHeaderCell,
  );
  const bodyCellClassName = cn(
    "px-2 text-base border-b",
    "py-2 border-gray-700",
    appearance?.bodyCell,
  );
  const bodyCellSurfaceClassName = cn(appearance?.bodyCellSurface);
  const pinnedBodyCellClassName = cn(
    "border-r",
    "shadow-[2px_0_5px_-2px_rgba(0,0,0,0.3)] border-gray-600",
    appearance?.pinnedBodyCell,
  );
  const pinnedBodyCellSurfaceClassName = cn(appearance?.pinnedBodyCellSurface);
  const headerBackgroundColor = surface?.headerBg;
  const bodyBackgroundColor = surface?.bodyBg;
  const pinnedSurfaceColor = surface?.pinnedBg ?? appearance?.pinnedSurfaceColor ?? "#0f1215";
  const pinnedShadowColor = surface?.pinnedShadowColor ?? "rgba(15,23,42,0.55)";
  const pinnedRowClassName = cn("border-b border-slate-700", appearance?.pinnedRow);
  const pinnedLastRowClassName = cn(
    "border-b-2 border-slate-600 shadow-[0_4px_6px_-1px_rgba(0,0,0,0.4)]",
    appearance?.pinnedLastRow,
  );

  return (
    <div
      className={containerClassName}
      style={{
        maxHeight,
        height: isPercentageHeight ? maxHeight : undefined,
      }}
    >
      <div
        ref={scrollContainerRef}
        className={cn(
          "flex-auto min-h-0 min-w-0 overflow-x-auto overflow-y-auto data-table-container",
          showCustomHorizontalScrollbar && "custom-hscroll-hidden",
          showCustomHorizontalScrollbar && hasHorizontalOverflow && "pb-3",
        )}
      >
        <table
          ref={tableRef}
          className="w-full min-w-max whitespace-nowrap border-separate border-spacing-0"
          style={tableStyle}
          aria-rowcount={isVirtualized ? rows.length + 1 : undefined}
        >
          <thead ref={theadRef}>
            {table.getHeaderGroups().map((headerGroup) => (
              <tr key={headerGroup.id}>
                {headerGroup.headers.map((header) =>
                  (() => {
                    const meta = header.column.columnDef.meta as DataTableColumnMeta | undefined;
                    return (
                      <th
                        key={header.id}
                        className={cn(
                          headerCellClassName,
                          meta?.headerClassName,
                          header.column.getIsPinned() === "start" && pinnedHeaderClassName,
                        )}
                        style={{
                          width: header.column.getSize(),
                          minWidth: header.column.getSize(),
                          maxWidth: header.column.columnDef.maxSize,
                          backgroundColor: headerBackgroundColor,
                          insetInlineStart:
                            header.column.getIsPinned() === "start"
                              ? `${header.column.getStart("start")}px`
                              : undefined,
                        }}
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    );
                  })(),
                )}
              </tr>
            ))}
          </thead>
          {pinnedRows.length > 0 && (
            <tbody ref={pinnedRowsRef} className="pinned-rows-section">
              {pinnedTable.getRowModel().rows.map((row, rowIndex) => {
                const isLastRow = rowIndex === pinnedRows.length - 1;
                const topOffset = pinnedRowOffsets[rowIndex] ?? rowIndex * 41;
                const effectiveHeaderHeight = headerHeight || 48;
                return (
                  <TableRow
                    key={`pinned-${row.id}`}
                    className={cn(pinnedRowClassName, isLastRow && pinnedLastRowClassName)}
                    style={{
                      position: "sticky",
                      top: `${effectiveHeaderHeight + topOffset}px`,
                      zIndex: 25 - rowIndex,
                      backgroundColor: pinnedSurfaceColor,
                      boxShadow:
                        rowIndex === 0
                          ? `0 -2px 0 0 ${pinnedSurfaceColor}, 0 4px 10px -6px ${pinnedShadowColor}`
                          : `0 -2px 0 0 ${pinnedSurfaceColor}`,
                    }}
                  >
                    {row.getVisibleCells().map((cell) =>
                      (() => {
                        const meta = cell.column.columnDef.meta as DataTableColumnMeta | undefined;
                        return (
                          <TableCell
                            key={cell.id}
                            className={cn(
                              bodyCellClassName,
                              meta?.cellClassName,
                              isLastRow && "border-b-2 border-gray-600",
                              pinnedBodyCellSurfaceClassName,
                              cell.column.getIsPinned() && pinnedBodyCellClassName,
                            )}
                            style={{
                              width: cell.column.getSize(),
                              minWidth: cell.column.getSize(),
                              maxWidth: cell.column.columnDef.maxSize,
                              backgroundColor: cell.column.getIsPinned()
                                ? pinnedSurfaceColor
                                : bodyBackgroundColor,
                              position: cell.column.getIsPinned() ? "sticky" : undefined,
                              insetInlineStart:
                                cell.column.getIsPinned() === "start"
                                  ? `${cell.column.getStart("start")}px`
                                  : undefined,
                              zIndex: cell.column.getIsPinned() ? 26 : undefined,
                            }}
                          >
                            {flexRender(cell.column.columnDef.cell, cell.getContext())}
                          </TableCell>
                        );
                      })(),
                    )}
                  </TableRow>
                );
              })}
            </tbody>
          )}
          <tbody>
            {paddingTop > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={columns.length}
                  style={{ height: paddingTop, padding: 0, border: 0 }}
                />
              </tr>
            )}
            {rows.length ? (
              renderedRows.map(({ row, index }) => (
                <TableRow
                  key={row.id}
                  data-index={isVirtualized ? index : undefined}
                  ref={isVirtualized ? rowVirtualizer.measureElement : undefined}
                  aria-rowindex={isVirtualized ? index + 2 : undefined}
                  data-state={row.getIsSelected() && "selected"}
                  className={appearance?.row}
                >
                  {row.getVisibleCells().map((cell) =>
                    (() => {
                      const meta = cell.column.columnDef.meta as DataTableColumnMeta | undefined;
                      return (
                        <TableCell
                          key={cell.id}
                          className={cn(
                            bodyCellClassName,
                            meta?.cellClassName,
                            !bodyBackgroundColor &&
                              (bodyCellSurfaceClassName ||
                                (row.index % 2 === 0
                                  ? DEFAULT_BODY_CELL_SURFACE.even
                                  : DEFAULT_BODY_CELL_SURFACE.odd)),
                            cell.column.getIsPinned() &&
                              cn(
                                pinnedBodyCellClassName,
                                !surface?.pinnedBg &&
                                  (pinnedBodyCellSurfaceClassName ||
                                    DEFAULT_BODY_CELL_SURFACE.even),
                                "z-10",
                              ),
                          )}
                          style={{
                            width: cell.column.getSize(),
                            minWidth: cell.column.getSize(),
                            maxWidth: cell.column.columnDef.maxSize,
                            backgroundColor: cell.column.getIsPinned()
                              ? pinnedSurfaceColor
                              : bodyBackgroundColor,
                            position: cell.column.getIsPinned() ? "sticky" : undefined,
                            insetInlineStart:
                              cell.column.getIsPinned() === "start"
                                ? `${cell.column.getStart("start")}px`
                                : undefined,
                            zIndex: cell.column.getIsPinned() ? 1 : undefined,
                          }}
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </TableCell>
                      );
                    })(),
                  )}
                </TableRow>
              ))
            ) : showEmptyState ? (
              <TableRow>
                <TableCell colSpan={columns.length} className="h-24 text-center">
                  No results.
                </TableCell>
              </TableRow>
            ) : null}
            {paddingBottom > 0 && (
              <tr aria-hidden="true">
                <td
                  colSpan={columns.length}
                  style={{ height: paddingBottom, padding: 0, border: 0 }}
                />
              </tr>
            )}
          </tbody>
        </table>
        {onScrollNearEnd && <div ref={scrollSentinelRef} className="h-1" aria-hidden="true" />}
        {isLoadingMore && (
          <div className="flex justify-center items-center py-3">
            <div className="text-gray-400 text-sm">Loading more...</div>
          </div>
        )}
      </div>
      {showCustomHorizontalScrollbar && hasHorizontalOverflow && (
        <div
          ref={horizontalTrackRef}
          aria-hidden="true"
          className="absolute bottom-1 left-2 right-2 z-20 h-2 cursor-pointer touch-none select-none rounded bg-slate-800/90"
          onPointerDown={handleTrackPointerDown}
          onPointerMove={handleTrackPointerMove}
          onPointerUp={handleTrackPointerEnd}
          onPointerCancel={handleTrackPointerEnd}
          onLostPointerCapture={handleTrackPointerEnd}
        >
          <div
            ref={horizontalThumbRef}
            className="h-full rounded bg-slate-300 will-change-transform"
            style={{ width: `${thumbWidth}px` }}
          />
        </div>
      )}
    </div>
  );
}
