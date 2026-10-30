import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { Torrent, TorrentFile } from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { torrent } from '../test/fixtures'
import { saying } from '../test/render'
import { TorrentRequestsProvider } from '../torrents/TorrentRequestsProvider'
import type { TorrentFilesState } from '../torrents/useTorrentFiles'
import { useFilePriorities } from './useFilePriorities'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  setFilePriority: vi.fn(),
}))
const setFilePriority = vi.mocked(api.setFilePriority)

const DUNE = torrent('dune', { added_on: 1 })
const FILES: TorrentFile[] = [
  { index: 0, name: 'Dune/Dune.mkv', size: 19e9, progress: 0.4, priority: 1 },
  { index: 1, name: 'Dune/Extras.mkv', size: 1e9, progress: 0, priority: 0 },
]
const FAILED = 'Couldn’t change the priority. Try again.'

/** A file list for Dune, as the torrent's page has: `list` is what its poll says. */
function List({ name, list, target = DUNE }: { name: string; list: TorrentFilesState; target?: Torrent }) {
  const priorities = useFilePriorities(target, list)
  return (
    <section aria-label={name}>
      <output aria-label="Priorities">{priorities.files?.map((file) => file.priority).join()}</output>
      <output aria-label="Busy">{FILES.filter((file) => priorities.busy(file.index)).map((file) => file.index).join()}</output>
      {priorities.failed && <p role="alert">Failed</p>}
      <button type="button" onClick={() => priorities.set(1, 6)}>
        Extras high
      </button>
      <button type="button" onClick={() => priorities.set(1, 0)}>
        Extras skip
      </button>
      <button type="button" onClick={() => priorities.set(0, 0)}>
        Main skip
      </button>
    </section>
  )
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <TorrentRequestsProvider>{children}</TorrentRequestsProvider>
    </ToastProvider>
  )
}

const POLLED: TorrentFilesState = { files: FILES, failed: false, requestedAt: 500 }

/** The torrent's page, and the same page opened again, each with its list; either can be left. */
function renderLists() {
  const lists = (names: string[], list: TorrentFilesState) => (
    <>
      {names.map((name) => (
        <List key={name} name={name} list={list} />
      ))}
    </>
  )
  const view = render(lists(['Page', 'Again'], POLLED), { wrapper: Providers })
  return {
    update: (names: string[], list = POLLED) => view.rerender(lists(names, list)),
    in: (name: string) => {
      const list = screen.getByRole('region', { name })
      return {
        priorities: () => within(list).getByRole('status', { name: 'Priorities' }).textContent,
        busy: () => within(list).getByRole('status', { name: 'Busy' }).textContent,
        failed: () => within(list).queryByRole('alert'),
        press: (button: string) => userEvent.click(within(list).getByRole('button', { name: button })),
      }
    },
  }
}

/** A change that answers when the test says so. */
function pendingChange() {
  let answer = () => {}
  let fail = () => {}
  setFilePriority.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        answer = () => resolve()
        fail = () => reject(new Error('500'))
      }),
  )
  return { answer: () => act(async () => answer()), fail: () => act(async () => fail()) }
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(1_000)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('useFilePriorities', () => {
  it('shows a change on its way, busy everywhere for that file alone, and doesn’t send it again', async () => {
    pendingChange()
    const lists = renderLists()
    await lists.in('Page').press('Extras high')
    expect(setFilePriority).toHaveBeenCalledWith('dune', [1], 6)
    expect(lists.in('Again').priorities()).toBe('1,6')
    expect(lists.in('Again').busy()).toBe('1')

    await lists.in('Again').press('Extras skip')
    expect(setFilePriority).toHaveBeenCalledOnce()
    // Another file goes out meanwhile.
    pendingChange()
    await lists.in('Again').press('Main skip')
    expect(setFilePriority).toHaveBeenLastCalledWith('dune', [0], 0)
    expect(lists.in('Page').busy()).toBe('0,1')
  })

  it('keeps a priority qBittorrent took until a poll sent after the answer has the final word', async () => {
    const change = pendingChange()
    const lists = renderLists()
    await lists.in('Page').press('Extras high')
    vi.setSystemTime(2_000)
    await change.answer()
    expect(lists.in('Page').busy()).toBe('')
    expect(lists.in('Page').priorities()).toBe('1,6')

    // A poll sent before the answer still has the old priority.
    lists.update(['Page'], { ...POLLED, requestedAt: 1_999 })
    expect(lists.in('Page').priorities()).toBe('1,6')
    // One sent at the answer or later says what qBittorrent has, even if it disagrees.
    lists.update(['Page'], { ...POLLED, requestedAt: 2_000 })
    expect(lists.in('Page').priorities()).toBe('1,0')
  })

  it('keeps a failure in the list that shows the torrent, not in a toast as well, until it’s tried again', async () => {
    const change = pendingChange()
    const lists = renderLists()
    await lists.in('Page').press('Extras high')
    await change.fail()
    expect(lists.in('Page').failed()).toBeInTheDocument()
    expect(lists.in('Page').priorities()).toBe('1,0')
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()

    pendingChange()
    await lists.in('Page').press('Extras high')
    expect(lists.in('Page').failed()).not.toBeInTheDocument()
  })

  it('says a failure in a toast once no list shows the torrent, which the next try takes back', async () => {
    const change = pendingChange()
    const lists = renderLists()
    await lists.in('Page').press('Extras high')
    lists.update([])
    await change.fail()
    expect(screen.getByRole('status', { name: saying(FAILED) })).toBeInTheDocument()

    lists.update(['Page'])
    pendingChange()
    await lists.in('Page').press('Extras high')
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()
  })

  it('gives the same files back while nothing it shows changed, so the list doesn’t build its tree again', async () => {
    const { result, rerender } = renderHook(({ list }) => useFilePriorities(DUNE, list), {
      wrapper: Providers,
      initialProps: { list: POLLED },
    })
    const first = result.current.files
    rerender({ list: POLLED })
    expect(result.current.files).toBe(first)

    pendingChange()
    act(() => result.current.set(1, 6))
    expect(result.current.files).not.toBe(first)
    expect(result.current.files?.map((file) => file.priority)).toEqual([1, 6])
  })

  it('leaves a failure to a toast when the list shows another torrent with the same hash, added again', async () => {
    const change = pendingChange()
    const view = render(<List name="Page" list={POLLED} />, { wrapper: Providers })
    await userEvent.click(screen.getByRole('button', { name: 'Extras high' }))
    view.rerender(<List name="Page" list={POLLED} target={{ ...DUNE, added_on: 2 }} />)
    await change.fail()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: saying(FAILED) })).toBeInTheDocument()
  })
})
