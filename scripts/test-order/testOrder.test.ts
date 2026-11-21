import { describe, expect, it } from 'vitest'
import { relatedFilesFirst, stem } from './testOrder.ts'

describe('stem', () => {
  it.each([
    ['/sandbox/server/container.ts', 'container'],
    ['server/container.test.ts', 'container'],
    ['src/screens/ConnectScreen.test.tsx', 'ConnectScreen'],
    ['src/screens/ConnectScreen.tsx', 'ConnectScreen'],
    ['vite.config.ts', 'vite.config'],
    ['vite.config.test.ts', 'vite.config'],
  ])('reads %s as %s', (path, expected) => {
    expect(stem(path)).toBe(expected)
  })
})

describe('relatedFilesFirst', () => {
  const id = (path: string) => path

  it("moves the tests named after a related file to the front, wherever they sit, each group in Vitest's order", () => {
    const files = ['server/main.test.ts', 'server/integration/container.test.ts', 'src/App.test.tsx', 'server/container.test.ts', 'server/settings.test.ts']
    expect(relatedFilesFirst(files, ['/sandbox/server/container.ts'], id)).toStrictEqual([
      'server/integration/container.test.ts',
      'server/container.test.ts',
      'server/main.test.ts',
      'src/App.test.tsx',
      'server/settings.test.ts',
    ])
  })

  it('takes the tests of every related file', () => {
    const files = ['a.test.ts', 'b.test.ts', 'c.test.ts']
    expect(relatedFilesFirst(files, ['src/c.ts', 'src/b.ts'], id)).toStrictEqual(['b.test.ts', 'c.test.ts', 'a.test.ts'])
  })

  it("keeps Vitest's order when nothing is related", () => {
    const files = ['b.test.ts', 'a.test.ts']
    expect(relatedFilesFirst(files, [], id)).toStrictEqual(['b.test.ts', 'a.test.ts'])
  })

  it("doesn't take a test whose name only starts with the related file's", () => {
    const files = ['server/containerHints.test.ts', 'server/container.test.ts']
    expect(relatedFilesFirst(files, ['server/container.ts'], id)).toStrictEqual(['server/container.test.ts', 'server/containerHints.test.ts'])
  })

  it('reads each file by the path it is given', () => {
    const files = [{ moduleId: 'x.test.ts' }, { moduleId: 'y.test.ts' }]
    expect(relatedFilesFirst(files, ['y.ts'], (file) => file.moduleId)).toStrictEqual([files[1], files[0]])
  })
})
