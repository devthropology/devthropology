import {
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  createSortedRowModel,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
} from "@tanstack/react-table";
import type { Column, ColumnDef, RowData, SortFn } from "@tanstack/react-table";

// Keep the column types and the two table instances on the same set of features.
export const dataTableFeatures = tableFeatures({
  columnPinningFeature,
  columnSizingFeature,
  columnVisibilityFeature,
  rowSortingFeature,
  rowSelectionFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    datetime: sortFn_datetime,
    text: sortFn_text,
  },
});

export type DataTableColumnDef<TData extends RowData, TValue = unknown> = ColumnDef<
  typeof dataTableFeatures,
  TData,
  TValue
>;
export type DataTableColumn<TData extends RowData, TValue = unknown> = Column<
  typeof dataTableFeatures,
  TData,
  TValue
>;
export type DataTableSortFn<TData extends RowData> = SortFn<typeof dataTableFeatures, TData>;
