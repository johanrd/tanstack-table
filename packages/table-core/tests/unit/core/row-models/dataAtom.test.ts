import { describe, expect, it } from 'vitest'
import { createAtom, shallow } from '@tanstack/store'
import { constructTable } from '../../../../src'
import { testFeatures } from '../../../fixtures/features'
import { generateTestColumnDefs } from '../../../fixtures/data/generateTestColumnDefs'
import { generateTestData } from '../../../fixtures/data/generateTestData'
import type { Person } from '../../../fixtures/data/types'

const features = testFeatures({})

// `table.atoms.data` routes data identity through the reactivity layer:
// row models depend on the atom's value instead of raw `options.data`
// identity, so an external data atom with a content-aware `compare` can
// absorb replacement arrays with identical contents.
describe('data atom', () => {
  it('resolves options.data when no external atom is provided (unchanged default)', () => {
    const data = generateTestData(3)
    const table = constructTable({
      features,
      data,
      columns: generateTestColumnDefs<typeof features>(data),
    })
    const model1 = table.getCoreRowModel()

    // default behavior preserved: new array identity -> rebuilt model
    table.setOptions((prev) => ({ ...prev, data: [...data] }))
    const model2 = table.getCoreRowModel()

    expect(table.atoms.data!.get()).toBe(table.options.data)
    expect(model2).not.toBe(model1)
  })

  it('skips the row-model rebuild when a compare-equipped data atom absorbs an identical-contents array', () => {
    const data = generateTestData(3)
    const dataAtom = createAtom<ReadonlyArray<unknown>>(data, {
      compare: shallow,
    })
    const table = constructTable({
      features,
      data: [],
      columns: generateTestColumnDefs<typeof features>(data),
      atoms: { data: dataAtom },
    })
    const model1 = table.getCoreRowModel()
    expect(model1.rows.length).toBe(3)

    // new array, identical contents -> compare absorbs it, model untouched
    dataAtom.set([...data])
    const model2 = table.getCoreRowModel()
    expect(model2).toBe(model1)
    expect(model2.rows[0]).toBe(model1.rows[0])
  })

  it('still rebuilds every row when the data genuinely changed', () => {
    const data = generateTestData(3)
    const dataAtom = createAtom<ReadonlyArray<unknown>>(data, {
      compare: shallow,
    })
    const table = constructTable({
      features,
      data: [],
      columns: generateTestColumnDefs<typeof features>(data),
      atoms: { data: dataAtom },
    })
    const model1 = table.getCoreRowModel()

    // one-record immutable replacement -> compare sees a difference; without
    // per-row reuse the entire model, including unchanged rows, is rebuilt
    const changed: Person = { ...data[1]!, firstName: 'changed' }
    dataAtom.set(data.map((datum, i) => (i === 1 ? changed : datum)))
    const model2 = table.getCoreRowModel()

    expect(model2).not.toBe(model1)
    expect(model2.rows.length).toBe(3)
    expect(model2.rows[0]).not.toBe(model1.rows[0])
    expect(model2.rows[1]).not.toBe(model1.rows[1])
    expect(model2.rows[2]).not.toBe(model1.rows[2])
  })

  it('ignores options.data while an external data atom is present', () => {
    const data = generateTestData(2)
    const dataAtom = createAtom<ReadonlyArray<unknown>>(data, {
      compare: shallow,
    })
    const table = constructTable({
      features,
      data: [],
      columns: generateTestColumnDefs<typeof features>(data),
      atoms: { data: dataAtom },
    })
    const model1 = table.getCoreRowModel()

    table.setOptions((prev) => ({ ...prev, data: generateTestData(5) }))
    const model2 = table.getCoreRowModel()

    expect(model2).toBe(model1)
    expect(model2.rows.length).toBe(2)
  })
})
