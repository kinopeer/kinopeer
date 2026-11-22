import { useState } from 'react'
import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PushError } from '../api/push'
import { ToastProvider } from '../components/Toast'
import * as push from '../pwa/push'
import { held } from '../test/held'
import { findToastOnPage, saying } from '../test/render'
import { usePushDevice } from './usePushDevice'

vi.mock('../pwa/push', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../pwa/push')>()),
  pushState: vi.fn(),
  turnOnPush: vi.fn(),
  turnOffPush: vi.fn(),
  testPushDevice: vi.fn(),
}))

const ENDPOINT = 'https://fcm.googleapis.com/fcm/send/abc'

/** The card's parts the hook gives, without Settings around it. */
function Card() {
  const card = usePushDevice('en')
  return (
    <>
      <output aria-label="State">{card.state?.kind ?? 'reading'}</output>
      <output aria-label="Busy">{card.busy ?? 'idle'}</output>
      <output aria-label="Outcome">{card.outcome ? `${card.outcome.ok ? 'ok' : 'failed'}: ${card.outcome.message}` : 'none'}</output>
      <button type="button" onClick={card.turnOn}>
        Turn on
      </button>
      <button type="button" onClick={card.test}>
        Test
      </button>
      <button type="button" onClick={card.turnOff}>
        Turn off
      </button>
    </>
  )
}

/** Settings with the card, which a test leaves and opens again; the toasts outlive it, as in `App`. */
function renderLeavable() {
  function Page() {
    const [open, setOpen] = useState(true)
    return (
      <>
        <button type="button" onClick={() => setOpen(!open)}>
          {open ? 'Leave' : 'Open'}
        </button>
        {open && <Card />}
      </>
    )
  }
  render(<Page />, { wrapper: ToastProvider })
  return { toggle: () => userEvent.click(screen.getByRole('button', { name: /^(Leave|Open)$/ })) }
}

const shows = (name: string) => screen.getByRole('status', { name })

beforeEach(() => {
  vi.mocked(push.pushState).mockResolvedValue({ kind: 'off' })
})

describe('usePushDevice: an action that settles after Settings is left (#500)', () => {
  it.each([
    ['turned on', 'Turn on', () => vi.mocked(push.turnOnPush), { kind: 'on', endpoint: ENDPOINT } as const, 'Push notifications are on for this device'],
    ['blocked by the browser', 'Turn on', () => vi.mocked(push.turnOnPush), { kind: 'denied' } as const, 'Notifications are blocked for Kinopeer. Allow them in the browser’s settings for this site.'],
    ['a test sent', 'Test', () => vi.mocked(push.testPushDevice), undefined, 'Test notification sent'],
    ['turned off', 'Turn off', () => vi.mocked(push.turnOffPush), { kind: 'off' } as const, 'Push notifications are off on this device'],
  ])('says %s in a toast', async (_name, button, action, answer, message) => {
    if (button !== 'Turn on') vi.mocked(push.pushState).mockResolvedValue({ kind: 'on', endpoint: ENDPOINT })
    const settled = held<push.PushState | void>()
    action().mockReturnValue(settled.promise as never)
    const { toggle } = renderLeavable()
    await screen.findByRole('status', { name: 'State' }).then((state) => expect(state).not.toHaveTextContent('reading'))
    await userEvent.click(screen.getByRole('button', { name: button }))
    await toggle()
    await act(async () => settled.resolve(answer))
    expect(await findToastOnPage(message)).toBeInTheDocument()
  })

  it('says nothing once turning on was dismissed, which changed nothing', async () => {
    const settled = held<push.PushState>()
    vi.mocked(push.turnOnPush).mockReturnValue(settled.promise)
    const { toggle } = renderLeavable()
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    await toggle()
    await act(async () => settled.resolve({ kind: 'off' }))
    // The card is gone, so any status left would be a toast.
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it.each([
    ['the browser couldn’t subscribe', new DOMException('push service error', 'AbortError'), 'Push notifications: The browser couldn’t turn them on. Try again.'],
    ['the server forgot this device', new PushError(404, 'unknown-device'), 'Push notifications: Kinopeer’s server no longer sends to this device. Turn them on again.'],
    ['Kinopeer didn’t answer', new TypeError('Failed to fetch'), 'Push notifications: Kinopeer isn’t answering'],
  ])('says in a toast why it failed, naming push: %s', async (_name, error, message) => {
    const settled = held<push.PushState>()
    vi.mocked(push.turnOnPush).mockReturnValue(settled.promise)
    const { toggle } = renderLeavable()
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    await toggle()
    await act(async () => settled.reject(error))
    expect(await findToastOnPage(message)).toBeInTheDocument()
  })
})

describe('usePushDevice: the card shown again while an action is on its way (#500)', () => {
  it('shows it busy, sends nothing more, and shows what it did, with no toast', async () => {
    const settled = held<push.PushState>()
    vi.mocked(push.turnOnPush).mockReturnValue(settled.promise)
    const { toggle } = renderLeavable()
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    await toggle()
    await toggle()
    expect(shows('Busy')).toHaveTextContent('on')
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    expect(push.turnOnPush).toHaveBeenCalledOnce()

    await act(async () => settled.resolve({ kind: 'on', endpoint: ENDPOINT }))
    expect(shows('Busy')).toHaveTextContent('idle')
    expect(shows('State')).toHaveTextContent('on')
    expect(screen.queryByRole('status', { name: saying(/Push notifications/) })).not.toBeInTheDocument()
  })

  it('shows a failure on the card, with no toast', async () => {
    vi.mocked(push.pushState).mockResolvedValue({ kind: 'on', endpoint: ENDPOINT })
    const settled = held<void>()
    vi.mocked(push.testPushDevice).mockReturnValue(settled.promise)
    const { toggle } = renderLeavable()
    await screen.findByText('on')
    await userEvent.click(screen.getByRole('button', { name: 'Test' }))
    await toggle()
    await toggle()
    await act(async () => settled.reject(new PushError(502, 'refused')))
    expect(shows('Outcome')).toHaveTextContent('failed: The push service refused the notification')
    expect(screen.queryByRole('status', { name: saying(/Push notifications/) })).not.toBeInTheDocument()
  })

  it('keeps what the action did over what the browser said as the card showed, read after it', async () => {
    const settled = held<push.PushState>()
    vi.mocked(push.turnOnPush).mockReturnValue(settled.promise)
    const { toggle } = renderLeavable()
    await userEvent.click(screen.getByRole('button', { name: 'Turn on' }))
    await toggle()
    // The browser is read again as the card shows, still from before the subscription.
    const read = held<push.PushState>()
    vi.mocked(push.pushState).mockReturnValue(read.promise)
    await toggle()
    await act(async () => settled.resolve({ kind: 'on', endpoint: ENDPOINT }))
    await act(async () => read.resolve({ kind: 'off' }))
    expect(shows('State')).toHaveTextContent('on')
  })
})
