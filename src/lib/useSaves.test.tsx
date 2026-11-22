import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { saves, type SaveSettled } from '../logic/saves'
import { useSaves, type SaveOutcome } from './useSaves'

type Takes = (outcome: SaveOutcome, sent: string, target: string) => boolean

/** A sheet that saves its target and shows what's in flight for it. */
function Sheet({ kind = 'folder', target = 'default', takes, request, onSettled }: {
  kind?: string
  target?: string
  takes: Takes
  request?: () => Promise<unknown>
  onSettled?: (settled: SaveSettled<unknown> | undefined) => void
}) {
  const folder = useSaves<string>(kind, takes)
  const pending = folder.pending(target)
  return (
    <>
      <output aria-label="Pending">{pending ?? 'nothing'}</output>
      <button type="button" onClick={() => void folder.send(target, '/media', request ?? (() => Promise.resolve())).then(onSettled)}>
        Save
      </button>
    </>
  )
}

/** A request that settles when the test says so. */
function held() {
  let resolve!: () => void
  let reject!: (error: unknown) => void
  const promise = new Promise<void>((done, fail) => {
    resolve = done
    reject = fail
  })
  return { promise, resolve, reject }
}

describe('useSaves', () => {
  it('shows a save in flight from a sheet that’s gone in the one opened again, and gives that one the outcome', async () => {
    const save = held()
    const first = vi.fn<Takes>(() => true)
    const onSettled = vi.fn()
    const view = render(<Sheet takes={first} request={() => save.promise} onSettled={onSettled} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    view.unmount()

    const again = vi.fn<Takes>(() => true)
    render(<Sheet takes={again} />)
    expect(screen.getByRole('status', { name: 'Pending' })).toHaveTextContent('/media')
    await act(async () => save.resolve())
    expect(screen.getByRole('status', { name: 'Pending' })).toHaveTextContent('nothing')
    expect(again).toHaveBeenCalledWith({ ok: true, result: undefined }, '/media', 'default')
    expect(first).not.toHaveBeenCalled()
    expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ ok: true, taken: true }))
  })

  it('leaves the outcome to the caller once the sheet that sent it is gone', async () => {
    const save = held()
    const takes = vi.fn<Takes>(() => true)
    const onSettled = vi.fn()
    const view = render(<Sheet takes={takes} request={() => save.promise} onSettled={onSettled} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    view.unmount()
    const error = new Error('refused')
    await act(async () => save.reject(error))
    expect(takes).not.toHaveBeenCalled()
    expect(onSettled).toHaveBeenCalledWith({ ok: false, error, taken: false })
  })

  it('sends nothing while the target’s save is in flight, from this sheet or another', async () => {
    const save = held()
    const request = vi.fn(() => save.promise)
    const onSettled = vi.fn()
    render(
      <>
        <Sheet takes={() => true} request={request} onSettled={onSettled} />
        <Sheet takes={() => true} request={request} onSettled={onSettled} />
      </>,
    )
    const [mine, other] = screen.getAllByRole('button', { name: 'Save' })
    await userEvent.click(mine)
    await userEvent.click(mine)
    await userEvent.click(other)
    expect(request).toHaveBeenCalledTimes(1)
    expect(screen.getAllByRole('status', { name: 'Pending' }).map((output) => output.textContent)).toEqual(['/media', '/media'])
    expect(onSettled).toHaveBeenCalledWith(undefined)
    await act(async () => save.resolve())
  })

  it('shows another target’s save as nothing in flight for this one', async () => {
    void saves.send('folder', 'category:Movies', '/films', () => new Promise(() => {}))
    render(<Sheet takes={() => true} />)
    expect(screen.getByRole('status', { name: 'Pending' })).toHaveTextContent('nothing')
  })

  it('asks the latest render whether it takes the outcome', async () => {
    const save = held()
    const before = vi.fn<Takes>(() => true)
    const after = vi.fn<Takes>(() => false)
    const onSettled = vi.fn()
    const view = render(<Sheet takes={before} request={() => save.promise} onSettled={onSettled} />)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    view.rerender(<Sheet takes={after} request={() => save.promise} onSettled={onSettled} />)
    await act(async () => save.resolve())
    expect(before).not.toHaveBeenCalled()
    expect(after).toHaveBeenCalledTimes(1)
    expect(onSettled).toHaveBeenCalledWith(expect.objectContaining({ taken: false }))
  })

  it('takes the outcomes of the kind it has now', async () => {
    const takes = vi.fn<Takes>(() => true)
    const view = render(<Sheet kind="folder" takes={takes} />)
    view.rerender(<Sheet kind="telegram" takes={takes} />)
    await expect(saves.send('telegram', 'default', 'token', () => Promise.resolve())).resolves.toMatchObject({ taken: true })
    await expect(saves.send('folder', 'default', '/media', () => Promise.resolve())).resolves.toMatchObject({ taken: false })
  })
})
