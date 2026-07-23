import { describe, expect, it, vi } from 'vitest'
import { constructTable } from '../../../../src'
import { testFeatures } from '../../../fixtures/features'
import { generateTestColumnDefs } from '../../../fixtures/data/generateTestColumnDefs'
import { generateTestData } from '../../../fixtures/data/generateTestData'
import type { Person } from '../../../fixtures/data/types'

const features = testFeatures({})

function makeTable(data: Array<Person>) {
  return constructTable({
    features,
    data,
    columns: generateTestColumnDefs<typeof features>(data),
    getRowId: (row: Person) => row.id,
  })
}

// Immutable stores and normalized caches (Redux, Apollo InMemoryCache, ...)
// deliver updates as "new data array, same (or mostly same) element objects".
// The core row model should keep row instances (and their caches) stable for
// elements that did not change, instead of rebuilding every row on any array
// identity change.
describe('core row model row-identity reuse', () => {
  it('returns the same row model when the data array identity changes but contents do not', () => {
    const data = generateTestData(5)
    const table = makeTable(data)
    const model1 = table.getCoreRowModel()

    table.setOptions((prev) => ({ ...prev, data: [...data] }))
    const model2 = table.getCoreRowModel()

    expect(model2.rows[0]).toBe(model1.rows[0])
    // every row reused in order -> the whole model object is reused, so
    // downstream memoized row models see an unchanged input
    expect(model2).toBe(model1)
  })

  it('keeps existing row instances when rows are appended', () => {
    const data = generateTestData(5)
    const table = makeTable(data)
    const rows1 = [...table.getCoreRowModel().rows]

    table.setOptions((prev) => ({
      ...prev,
      data: [...data, ...generateTestData(2)],
    }))
    const model2 = table.getCoreRowModel()

    expect(model2.rows).toHaveLength(7)
    for (let i = 0; i < 5; i++) {
      expect(model2.rows[i]).toBe(rows1[i])
    }
  })

  it('replaces only the changed row on an immutable one-record update', () => {
    const data = generateTestData(5)
    const table = makeTable(data)
    const rows1 = [...table.getCoreRowModel().rows]

    const changed = { ...data[2]!, firstName: 'changed' }
    table.setOptions((prev) => ({
      ...prev,
      data: data.map((datum, i) => (i === 2 ? changed : datum)),
    }))
    const model2 = table.getCoreRowModel()

    for (let i = 0; i < 5; i++) {
      if (i === 2) {
        expect(model2.rows[i]).not.toBe(rows1[i])
        expect(model2.rows[i]!.original).toBe(changed)
      } else {
        expect(model2.rows[i]).toBe(rows1[i])
      }
    }
  })

  it('preserves value caches on reused rows (accessor not re-run)', () => {
    const data = generateTestData(3)
    const accessor = vi.fn((row: Person) => row.firstName)
    const table = constructTable({
      features,
      data,
      columns: [{ id: 'firstName', accessorFn: accessor }],
      getRowId: (row: Person) => row.id,
    })

    expect(table.getCoreRowModel().rows[0]!.getValue('firstName')).toBe(
      data[0]!.firstName,
    )
    expect(accessor).toHaveBeenCalledTimes(1)

    table.setOptions((prev) => ({ ...prev, data: [...data] }))
    expect(table.getCoreRowModel().rows[0]!.getValue('firstName')).toBe(
      data[0]!.firstName,
    )
    // reused row keeps its _valuesCache, so the accessor is not re-run
    expect(accessor).toHaveBeenCalledTimes(1)
  })

  it('rebuilds rows whose position changed (conservative reuse)', () => {
    const data = generateTestData(3)
    const table = makeTable(data)
    const rows1 = [...table.getCoreRowModel().rows]

    table.setOptions((prev) => ({ ...prev, data: [...data].reverse() }))
    const model2 = table.getCoreRowModel()

    // middle row kept its index and is reused; moved rows are rebuilt
    expect(model2.rows[1]).toBe(rows1[1])
    expect(model2.rows[0]).not.toBe(rows1[2])
    expect(model2.rows[2]).not.toBe(rows1[0])
  })

  it('reuses whole subtrees, and rebuilds a parent when a child changed', () => {
    const data = generateTestData(3, 2)
    const table = constructTable({
      features,
      data,
      columns: generateTestColumnDefs<typeof features>(data),
      getRowId: (row: Person) => row.id,
      getSubRows: (row: Person) => row.subRows,
    })
    const rows1 = [...table.getCoreRowModel().rows]

    // identical contents -> parents and children all reused
    table.setOptions((prev) => ({ ...prev, data: [...data] }))
    const model2 = table.getCoreRowModel()
    expect(model2.rows[0]).toBe(rows1[0])
    expect(model2.rows[0]!.subRows[0]).toBe(rows1[0]!.subRows[0])

    // replace one child of parent 1 -> parent 1 rebuilt, parent 0 reused
    const changedChild = { ...data[1]!.subRows![0]!, firstName: 'changed' }
    const changedParent = {
      ...data[1]!,
      subRows: [changedChild, data[1]!.subRows![1]!],
    }
    table.setOptions((prev) => ({
      ...prev,
      data: data.map((datum, i) => (i === 1 ? changedParent : datum)),
    }))
    const model3 = table.getCoreRowModel()
    expect(model3.rows[0]).toBe(model2.rows[0])
    expect(model3.rows[1]).not.toBe(model2.rows[1])
    expect(model3.rows[2]).toBe(model2.rows[2])
  })
})
