import { constructRow } from '../rows/constructRow'
import { makeObjectMap, tableMemo } from '../../utils'
import { table_autoResetPageIndex } from '../../features/row-pagination/rowPaginationFeature.utils'
import type { Table_Internal } from '../../types/Table'
import type { RowModel } from './coreRowModelsFeature.types'
import type { TableFeatures } from '../../types/TableFeatures'
import type { Row } from '../../types/Row'
import type { RowData } from '../../types/type-utils'

/**
 * Creates a memoized core row model factory.
 *
 * The factory reads the relevant table state atoms and options, then returns a row model function used by the table row-model pipeline.
 */
export function createCoreRowModel<
  TFeatures extends TableFeatures,
  TData extends RowData,
>(): (
  table: Table_Internal<TFeatures, TData>,
) => () => RowModel<TFeatures, TData> {
  return (table) => {
    let previous: RowModel<TFeatures, TData> | undefined
    return tableMemo({
      feature: 'coreRowModelsFeature',
      table,
      fnName: 'table.getCoreRowModel',
      memoDeps: () => [table.options.data],
      fn: () => {
        previous = _createCoreRowModel(table, table.options.data, previous)
        return previous
      },
      onAfterUpdate: () => table_autoResetPageIndex(table),
    })
  }
}

function _createCoreRowModel<
  TFeatures extends TableFeatures,
  TData extends RowData,
>(
  table: Table_Internal<TFeatures, TData>,
  data: ReadonlyArray<TData>,
  previous?: RowModel<TFeatures, TData>,
): {
  rows: Array<Row<TFeatures, TData>>
  flatRows: Array<Row<TFeatures, TData>>
  rowsById: Record<string, Row<TFeatures, TData>>
} {
  const rowModel: RowModel<TFeatures, TData> = {
    rows: [],
    flatRows: [],
    rowsById: makeObjectMap(),
  }

  // A row from the previous model can be reused verbatim (preserving its
  // instance identity, value caches, and per-instance memos) when its original
  // datum, position, and entire subtree are unchanged. This keeps row
  // identities stable across the very common "new data array, same (or mostly
  // same) row objects" update shape produced by immutable stores and
  // normalized caches, so downstream row models and framework renderers only
  // see changes for rows that actually changed.
  const canReuse = (
    prev: Row<TFeatures, TData> | undefined,
    originalRow: TData,
    rowIndex: number,
    depth: number,
    parentId: string | undefined,
  ): prev is Row<TFeatures, TData> => {
    if (
      !prev ||
      prev.original !== originalRow ||
      prev.index !== rowIndex ||
      prev.depth !== depth ||
      prev.parentId !== parentId
    ) {
      return false
    }
    if (table.options.getSubRows) {
      const subOriginals =
        table.options.getSubRows(originalRow, rowIndex) ?? []
      const prevSubRows = prev.subRows
      if (subOriginals.length !== prevSubRows.length) return false
      for (let j = 0; j < subOriginals.length; j++) {
        if (
          !canReuse(prevSubRows[j], subOriginals[j]!, j, depth + 1, prev.id)
        ) {
          return false
        }
      }
    }
    return true
  }

  const registerRow = (row: Row<TFeatures, TData>): void => {
    rowModel.flatRows.push(row)
    rowModel.rowsById[row.id] = row
    for (let j = 0; j < row.subRows.length; j++) {
      registerRow(row.subRows[j]!)
    }
  }

  const accessRows = (
    originalRows: ReadonlyArray<TData>,
    depth = 0,
    parentRow?: Row<TFeatures, TData>,
  ): Array<Row<TFeatures, TData>> => {
    const rows = [] as Array<Row<TFeatures, TData>>

    for (let i = 0; i < originalRows.length; i++) {
      const originalRow = originalRows[i]!
      const rowId = table.getRowId(originalRow, i, parentRow)

      // Reuse the previous row instance when nothing about it changed
      const previousRow = previous?.rowsById[rowId]
      if (canReuse(previousRow, originalRow, i, depth, parentRow?.id)) {
        registerRow(previousRow)
        rows.push(previousRow)
        continue
      }

      // Make the row
      const row = constructRow(
        table,
        rowId,
        originalRow,
        i,
        depth,
        undefined,
        parentRow?.id,
      )

      // Keep track of every row in a flat array
      rowModel.flatRows.push(row)
      // Also keep track of every row by its ID
      rowModel.rowsById[row.id] = row
      // Push table row into parent
      rows.push(row)

      // Get the original subrows
      if (table.options.getSubRows) {
        row.originalSubRows = table.options.getSubRows(originalRow, i)

        // Then recursively access them
        if (row.originalSubRows?.length) {
          row.subRows = accessRows(row.originalSubRows, depth + 1, row)
        }
      }
    }

    return rows
  }

  rowModel.rows = accessRows(data)

  // If every row was reused in the same order, return the previous model
  // object itself so downstream memoized row models see an unchanged input
  // and skip recomputation entirely.
  if (previous && previous.rows.length === rowModel.rows.length) {
    let identical = true
    for (let i = 0; i < rowModel.rows.length; i++) {
      if (rowModel.rows[i] !== previous.rows[i]) {
        identical = false
        break
      }
    }
    if (identical) return previous
  }

  return rowModel
}
