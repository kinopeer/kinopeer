import { act, fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as serverSettings from '../api/settings'
import type { ServerSettings, TelegramStatus } from '../api/settings'
import { ToastProvider } from '../components/Toast'
import i18n from '../i18n'
import { TELEGRAM_TOKEN as TOKEN } from '../test/fixtures'
import { held } from '../test/held'
import { findToastOnPage, saying } from '../test/render'
import { TelegramForm } from './TelegramForm'

vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof serverSettings>()),
  saveTelegramToken: vi.fn(),
  findTelegramChat: vi.fn(),
  saveTelegramChat: vi.fn(),
  testTelegram: vi.fn(),
  forgetTelegram: vi.fn(),
}))

const NONE: TelegramStatus = { bot: null, chat: null, refused: null }
const BOT: TelegramStatus = { bot: 'kinopeer_home_bot', chat: null, refused: null }
const CONNECTED: TelegramStatus = { bot: 'kinopeer_home_bot', chat: { name: 'Alex', type: 'private' }, refused: null }
const settings = (telegram: TelegramStatus): ServerSettings => ({
  tmdb: { configured: true, source: 'env', fallback: 'env' },
  prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
  qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
  downloads: null,
  telegram,
  notifications: telegram.chat !== null,
})
const FAILED = 'Couldn’t save. Try again.'
const TOKEN_REJECTED = 'Telegram no longer knows the bot’s token. Get a new one from @BotFather and save it here.'
const CHAT_REFUSED = 'Telegram didn’t deliver to “Alex”: the bot was blocked or removed from it. Send the bot /start and choose the chat again.'
const UNREACHABLE = 'Telegram isn’t answering. Kinopeer’s server needs to reach api.telegram.org.'
const STORAGE = 'The Kinopeer server couldn’t save the change. Check that its data folder is writable.'
const NO_CHAT = 'No chat sent the bot /start in the last day. Send it and try again.'
const BOT_IN_USE =
  'Another program gets this bot’s messages (a webhook, or an app that polls it), so Kinopeer can’t see /start. Turn that off, or use another bot.'
const pending = () => new Promise<never>(() => {})
const error = (status: number, code: serverSettings.SettingsErrorBody['error']) => new serverSettings.SettingsError(status, code)

function renderForm(telegram: TelegramStatus) {
  const props = { onChanged: vi.fn(), onTurnedOff: vi.fn(), onRefused: vi.fn() }
  const view = render(<TelegramForm telegram={telegram} {...props} />, { wrapper: ToastProvider })
  return { ...props, rerender: (next: TelegramStatus) => view.rerender(<TelegramForm telegram={next} {...props} />) }
}

beforeEach(async () => {
  vi.resetAllMocks()
  await i18n.changeLanguage('en')
})

describe('TelegramForm: the token', () => {
  it('saves the trimmed token and hands the settings on', async () => {
    vi.mocked(serverSettings.saveTelegramToken).mockResolvedValue(settings(BOT))
    const { onChanged } = renderForm(NONE)
    await userEvent.type(screen.getByLabelText('Bot token'), `  ${TOKEN} `)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(serverSettings.saveTelegramToken).toHaveBeenCalledWith(TOKEN)
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(settings(BOT), 'token'))
  })

  it.each([
    [422, 'invalid-key'],
    [400, 'bad-request'],
  ] as const)('marks the token invalid when the server refuses it (%s %s), until it’s edited', async (status, code) => {
    vi.mocked(serverSettings.saveTelegramToken).mockRejectedValue(error(status, code))
    const { onChanged } = renderForm(NONE)
    const field = screen.getByLabelText('Bot token')
    await userEvent.type(field, 'wrong')
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText('Telegram doesn’t know this token. Copy it from @BotFather again.')).toBeInTheDocument()
    expect(field).toHaveAttribute('aria-invalid', 'true')
    await userEvent.type(field, 'x')
    expect(field).not.toHaveAttribute('aria-invalid', 'true')
    expect(onChanged).not.toHaveBeenCalled()
  })

  it.each([
    [error(502, 'unreachable'), UNREACHABLE],
    [error(500, 'storage'), STORAGE],
    [new Error('offline'), FAILED],
    // Another device forgot the bot meanwhile: a code the form has no words of its own for.
    [error(409, 'not-configured'), FAILED],
  ])('says why it couldn’t save: %s', async (failure, message) => {
    vi.mocked(serverSettings.saveTelegramToken).mockRejectedValue(failure)
    renderForm(NONE)
    await userEvent.type(screen.getByLabelText('Bot token'), TOKEN)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert', { name: saying(message) })).toBeInTheDocument()
  })

  it('takes the token without spell checking, and submits without leaving the page', () => {
    renderForm(NONE)
    expect(screen.getByRole('button', { name: 'Save' })).not.toHaveAttribute('aria-busy')
    const field = screen.getByLabelText('Bot token')
    expect(field).toHaveAttribute('spellcheck', 'false')
    expect(screen.queryByRole('alert', { name: saying(FAILED) })).not.toBeInTheDocument()
    expect(fireEvent.submit(field.closest('form')!)).toBe(false)
  })

  it('empties the field once the token is saved', async () => {
    vi.mocked(serverSettings.saveTelegramToken).mockResolvedValue(settings(BOT))
    const { onChanged } = renderForm(NONE)
    const field = screen.getByLabelText('Bot token')
    await userEvent.type(field, TOKEN)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled())
    expect(field).toHaveValue('')
  })

  it('shows the save in progress and holds Cancel, and sends it once however often it’s pressed', async () => {
    vi.mocked(serverSettings.saveTelegramToken).mockReturnValue(pending())
    renderForm(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Use another bot' }))
    await userEvent.type(screen.getByLabelText('Bot token'), TOKEN)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByRole('button', { name: 'Save' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(serverSettings.saveTelegramToken).toHaveBeenCalledTimes(1)
  })

  it('keeps a failure other than an invalid token while typing, and clears it when trying again', async () => {
    vi.mocked(serverSettings.saveTelegramToken).mockRejectedValueOnce(error(502, 'unreachable')).mockReturnValueOnce(pending())
    renderForm(NONE)
    await userEvent.type(screen.getByLabelText('Bot token'), TOKEN)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByRole('alert', { name: saying(UNREACHABLE) })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Bot token'), 'x')
    expect(screen.getByRole('alert', { name: saying(UNREACHABLE) })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.queryByRole('alert', { name: saying(UNREACHABLE) })).not.toBeInTheDocument()
  })
})

describe('TelegramForm: the chat', () => {
  it('shows the chat that sent /start with its kind before saving it, in the interface’s language', async () => {
    vi.mocked(serverSettings.findTelegramChat).mockResolvedValue({ id: -7, name: 'Home', type: 'group' })
    vi.mocked(serverSettings.saveTelegramChat).mockResolvedValue(settings({ ...CONNECTED, chat: { name: 'Home', type: 'group' } }))
    const { onChanged } = renderForm(BOT)
    expect(screen.getByText(/Send @kinopeer_home_bot \/start/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Find chat' }))
    const found = await screen.findByRole('group', { name: 'Is this the chat?' })
    expect(found).toHaveTextContent('Home')
    expect(found).toHaveTextContent('Group')
    expect(serverSettings.saveTelegramChat).not.toHaveBeenCalled()

    await i18n.changeLanguage('ru')
    await userEvent.click(screen.getByRole('button', { name: 'Использовать этот чат' }))
    expect(serverSettings.saveTelegramChat).toHaveBeenCalledWith(-7, 'ru')
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(settings({ ...CONNECTED, chat: { name: 'Home', type: 'group' } }), 'chat'))
  })

  it('holds Find chat while turning off is in progress', async () => {
    vi.mocked(serverSettings.forgetTelegram).mockReturnValue(pending())
    renderForm(BOT)
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    expect(screen.getByRole('button', { name: 'Find chat' })).toBeDisabled()
  })

  it('lets the bot be changed or turned off before a chat is chosen, as from a token Telegram no longer knows', async () => {
    vi.mocked(serverSettings.forgetTelegram).mockResolvedValue(settings(NONE))
    const { onTurnedOff } = renderForm(BOT)
    await userEvent.click(screen.getByRole('button', { name: 'Use another bot' }))
    expect(screen.getByLabelText('Bot token')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    await vi.waitFor(() => expect(onTurnedOff).toHaveBeenCalledWith(settings(NONE)))
  })

  it('finds again when it isn’t the chat', async () => {
    vi.mocked(serverSettings.findTelegramChat)
      .mockResolvedValueOnce({ id: 9, name: 'Stranger', type: 'private' })
      .mockResolvedValueOnce({ id: 42, name: 'Alex', type: 'private' })
    renderForm(BOT)
    await userEvent.click(screen.getByRole('button', { name: 'Find chat' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Find again' }))
    expect(await screen.findByRole('group', { name: 'Is this the chat?' })).toHaveTextContent('Alex')
  })

  it.each([
    [error(404, 'no-chat'), 'status', NO_CHAT],
    [error(422, 'token-rejected'), 'alert', TOKEN_REJECTED],
    [error(409, 'bot-in-use'), 'alert', BOT_IN_USE],
  ] as const)('says why no chat was found: %s', async (failure, role, message) => {
    vi.mocked(serverSettings.findTelegramChat).mockRejectedValue(failure)
    renderForm(BOT)
    await userEvent.click(screen.getByRole('button', { name: 'Find chat' }))
    expect(await screen.findByRole(role, { name: saying(message) })).toBeInTheDocument()
  })

  it('shows the search in progress, holds the other buttons, and sends it once however often it’s pressed', async () => {
    vi.mocked(serverSettings.findTelegramChat).mockReturnValue(pending())
    renderForm(BOT)
    expect(screen.getByRole('button', { name: 'Find chat' })).not.toHaveAttribute('aria-busy')
    await userEvent.click(screen.getByRole('button', { name: 'Find chat' }))
    await userEvent.click(screen.getByRole('button', { name: 'Find chat' }))
    expect(screen.getByRole('button', { name: 'Find chat' })).toHaveAttribute('aria-busy', 'true')
    // The button in progress keeps its look, its spinner in place of a greyed-out button.
    expect(screen.getByRole('button', { name: 'Find chat' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Use another bot' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeDisabled()
    expect(serverSettings.findTelegramChat).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['Use this chat', 'saveTelegramChat', 'Find again'],
    ['Find again', 'findTelegramChat', 'Use this chat'],
  ] as const)('holds the other buttons while %s is in progress', async (pressed, request, other) => {
    vi.mocked(serverSettings.findTelegramChat).mockResolvedValueOnce({ id: 42, name: 'Alex', type: 'private' })
    vi.mocked(serverSettings[request]).mockReturnValue(pending())
    renderForm(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Choose another chat' }))
    await userEvent.click(screen.getByRole('button', { name: 'Find chat' }))
    await userEvent.click(await screen.findByRole('button', { name: pressed }))
    expect(screen.getByRole('button', { name: pressed })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: pressed })).toBeEnabled()
    expect(screen.getByRole('button', { name: other })).toBeDisabled()
    expect(screen.getByRole('button', { name: other })).not.toHaveAttribute('aria-busy')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
  })

  it('starts afresh each time it’s opened again: no chat found before, no failure', async () => {
    vi.mocked(serverSettings.findTelegramChat).mockResolvedValueOnce({ id: 42, name: 'Alex', type: 'private' })
    vi.mocked(serverSettings.testTelegram).mockRejectedValue(error(502, 'unreachable'))
    renderForm(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }))
    expect(await screen.findByRole('alert', { name: saying(UNREACHABLE) })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Choose another chat' }))
    expect(screen.queryByRole('alert', { name: saying(UNREACHABLE) })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Find chat' }))
    expect(await screen.findByRole('group', { name: 'Is this the chat?' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Choose another chat' }))
    expect(screen.queryByRole('group', { name: 'Is this the chat?' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Find chat' })).toBeInTheDocument()
  })

  it('hands nothing on when the bot’s token is refused while finding the chat, since no notification was', async () => {
    vi.mocked(serverSettings.findTelegramChat).mockRejectedValue(error(422, 'token-rejected'))
    const { onRefused } = renderForm(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Choose another chat' }))
    await userEvent.click(screen.getByRole('button', { name: 'Find chat' }))
    expect(await screen.findByRole('alert', { name: saying(TOKEN_REJECTED) })).toBeInTheDocument()
    expect(onRefused).not.toHaveBeenCalled()
  })
})

describe('TelegramForm: connected', () => {
  it('says where notifications go and sends a test message in the interface’s language', async () => {
    vi.mocked(serverSettings.testTelegram).mockResolvedValue(settings(CONNECTED))
    const { onChanged } = renderForm(CONNECTED)
    expect(screen.getByText('Notifications go to “Alex” (Private chat) from @kinopeer_home_bot.')).toBeInTheDocument()
    expect(screen.queryByRole('alert', { name: saying(CHAT_REFUSED) })).not.toBeInTheDocument()
    expect(screen.queryByRole('alert', { name: saying(TOKEN_REJECTED) })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }))
    expect(serverSettings.testTelegram).toHaveBeenCalledWith('en')
    expect(await screen.findByRole('status', { name: saying('Test message sent') })).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalledWith(settings(CONNECTED), 'test')
  })

  it.each([
    ['chat-rejected', 'chat', CHAT_REFUSED],
    ['token-rejected', 'token', TOKEN_REJECTED],
  ] as const)('says a test refused for %s and hands what was refused on', async (code, refused, message) => {
    vi.mocked(serverSettings.testTelegram).mockRejectedValue(error(422, code))
    const { onRefused } = renderForm(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }))
    expect(await screen.findByRole('alert', { name: saying(message) })).toBeInTheDocument()
    expect(onRefused).toHaveBeenCalledWith(refused)
  })

  it('hands nothing on when a test fails for another reason', async () => {
    vi.mocked(serverSettings.testTelegram).mockRejectedValue(error(502, 'unreachable'))
    const { onRefused } = renderForm(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }))
    expect(await screen.findByRole('alert', { name: saying(UNREACHABLE) })).toBeInTheDocument()
    expect(onRefused).not.toHaveBeenCalled()
  })

  it('shows what Telegram refused a notification before', () => {
    renderForm({ ...CONNECTED, refused: 'token' })
    expect(screen.getByRole('alert', { name: saying(TOKEN_REJECTED) })).toBeInTheDocument()
  })

  it('goes back to the chat or the token, and Cancel returns', async () => {
    renderForm(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Choose another chat' }))
    expect(screen.getByRole('button', { name: 'Find chat' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Use another bot' }))
    expect(screen.getByLabelText('Bot token')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Send a test message' })).toBeInTheDocument()
  })

  it.each([
    ['another bot', 'Use another bot', BOT, 'token'],
    ['another chat', 'Choose another chat', CONNECTED, 'chat'],
  ] as const)('follows the settings once %s is saved', async (_name, button, saved, kind) => {
    vi.mocked(serverSettings.saveTelegramToken).mockResolvedValue(settings(BOT))
    vi.mocked(serverSettings.findTelegramChat).mockResolvedValue({ id: 42, name: 'Alex', type: 'private' })
    vi.mocked(serverSettings.saveTelegramChat).mockResolvedValue(settings(CONNECTED))
    const { onChanged, rerender } = renderForm(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: button }))
    if (saved === BOT) {
      await userEvent.type(screen.getByLabelText('Bot token'), TOKEN)
      await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    } else {
      await userEvent.click(screen.getByRole('button', { name: 'Find chat' }))
      await userEvent.click(await screen.findByRole('button', { name: 'Use this chat' }))
    }
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(settings(saved), kind))
    rerender(saved)
    const next = saved === BOT ? 'Find chat' : 'Send a test message'
    expect(screen.getByRole('button', { name: next })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument()
  })

  it('turns notifications off', async () => {
    vi.mocked(serverSettings.forgetTelegram).mockResolvedValue(settings(NONE))
    const { onTurnedOff } = renderForm(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    await vi.waitFor(() => expect(onTurnedOff).toHaveBeenCalledWith(settings(NONE)))
  })

  it('sends one request at a time', async () => {
    vi.mocked(serverSettings.testTelegram).mockReturnValue(new Promise(() => {}))
    renderForm(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }))
    expect(screen.getByRole('button', { name: 'Send a test message' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Send a test message' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Turn off' })).not.toHaveAttribute('aria-busy')
    expect(screen.getByRole('button', { name: 'Choose another chat' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Use another bot' })).toBeDisabled()
  })

  it('shows turning off in progress and holds the rest', async () => {
    vi.mocked(serverSettings.forgetTelegram).mockReturnValue(pending())
    renderForm(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    expect(screen.getByRole('button', { name: 'Turn off' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Send a test message' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send a test message' })).not.toHaveAttribute('aria-busy')
  })

  it('sends the test in Russian when the interface is', async () => {
    vi.mocked(serverSettings.testTelegram).mockResolvedValue(settings(CONNECTED))
    await i18n.changeLanguage('ru')
    renderForm(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Отправить тестовое сообщение' }))
    expect(serverSettings.testTelegram).toHaveBeenCalledWith('ru')
  })

  it.each([
    ['chat', CHAT_REFUSED],
    ['token', TOKEN_REJECTED],
  ] as const)('shows the failure of a test in place of the %s Telegram refused before', async (refused, message) => {
    vi.mocked(serverSettings.testTelegram).mockRejectedValue(error(502, 'unreachable'))
    renderForm({ ...CONNECTED, refused })
    expect(screen.getByRole('alert', { name: saying(message) })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }))
    expect(await screen.findByRole('alert', { name: saying(UNREACHABLE) })).toBeInTheDocument()
    expect(screen.queryByRole('alert', { name: saying(message) })).not.toBeInTheDocument()
  })
})

/** The sheet's form under a Close that takes it away and an Open that brings it back, as Settings' sheet does. */
function renderClosable(telegram: TelegramStatus) {
  const props = { onChanged: vi.fn(), onTurnedOff: vi.fn(), onRefused: vi.fn() }
  function Sheet() {
    const [open, setOpen] = useState(true)
    return (
      <>
        <button type="button" onClick={() => setOpen(!open)}>
          {open ? 'Close' : 'Open'}
        </button>
        {open && <TelegramForm telegram={telegram} {...props} />}
      </>
    )
  }
  render(<Sheet />, { wrapper: ToastProvider })
  return { ...props, toggle: () => userEvent.click(screen.getByRole('button', { name: /^(Close|Open)$/ })) }
}

describe('TelegramForm: a request that settles after the sheet closed', () => {
  it('hands the saved token on and says it in a toast', async () => {
    const save = held<ServerSettings>()
    vi.mocked(serverSettings.saveTelegramToken).mockReturnValue(save.promise)
    const { onChanged, toggle } = renderClosable(NONE)
    await userEvent.type(screen.getByLabelText('Bot token'), TOKEN)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await toggle()
    await act(async () => save.resolve(settings(BOT)))
    expect(onChanged).toHaveBeenCalledWith(settings(BOT), 'token')
    expect(await findToastOnPage('Telegram bot saved')).toBeInTheDocument()
  })

  it('hands the saved chat on and says it in a toast', async () => {
    vi.mocked(serverSettings.findTelegramChat).mockResolvedValue({ id: 1, name: 'Alex', type: 'private' })
    const save = held<ServerSettings>()
    vi.mocked(serverSettings.saveTelegramChat).mockReturnValue(save.promise)
    const { onChanged, toggle } = renderClosable(BOT)
    await userEvent.click(screen.getByRole('button', { name: 'Find chat' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Use this chat' }))
    await toggle()
    await act(async () => save.resolve(settings(CONNECTED)))
    expect(onChanged).toHaveBeenCalledWith(settings(CONNECTED), 'chat')
    expect(await findToastOnPage('Telegram chat saved')).toBeInTheDocument()
  })

  it('hands a test message’s settings on and says it went in a toast', async () => {
    const test = held<ServerSettings>()
    vi.mocked(serverSettings.testTelegram).mockReturnValue(test.promise)
    const { onChanged, toggle } = renderClosable(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }))
    await toggle()
    await act(async () => test.resolve(settings(CONNECTED)))
    expect(onChanged).toHaveBeenCalledWith(settings(CONNECTED), 'test')
    expect(await findToastOnPage('Test message sent')).toBeInTheDocument()
  })

  it('hands turning off on, which says it itself', async () => {
    const off = held<ServerSettings>()
    vi.mocked(serverSettings.forgetTelegram).mockReturnValue(off.promise)
    const { onTurnedOff, toggle } = renderClosable(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Turn off' }))
    await toggle()
    await act(async () => off.resolve(settings(NONE)))
    expect(onTurnedOff).toHaveBeenCalledWith(settings(NONE))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('hands a refused token on and says it in a toast', async () => {
    const test = held<ServerSettings>()
    vi.mocked(serverSettings.testTelegram).mockReturnValue(test.promise)
    const { onRefused, onChanged, toggle } = renderClosable(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }))
    await toggle()
    await act(async () => test.reject(error(422, 'token-rejected')))
    expect(onRefused).toHaveBeenCalledWith('token')
    expect(onChanged).not.toHaveBeenCalled()
    expect(await findToastOnPage(TOKEN_REJECTED)).toBeInTheDocument()
  })

  it('names Telegram notifications in the toast for a failure the sheet would say without', async () => {
    const save = held<ServerSettings>()
    vi.mocked(serverSettings.saveTelegramToken).mockReturnValue(save.promise)
    const { onChanged, toggle } = renderClosable(NONE)
    await userEvent.type(screen.getByLabelText('Bot token'), TOKEN)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await toggle()
    await act(async () => save.reject(new Error('network')))
    expect(onChanged).not.toHaveBeenCalled()
    expect(await findToastOnPage('Couldn’t save Telegram notifications. Try again.')).toBeInTheDocument()
  })

  it('says a token Telegram doesn’t know in the toast as its field would', async () => {
    const save = held<ServerSettings>()
    vi.mocked(serverSettings.saveTelegramToken).mockReturnValue(save.promise)
    const { toggle } = renderClosable(NONE)
    await userEvent.type(screen.getByLabelText('Bot token'), TOKEN)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    await toggle()
    await act(async () => save.reject(error(400, 'invalid-key')))
    expect(await findToastOnPage('Telegram doesn’t know this token. Copy it from @BotFather again.')).toBeInTheDocument()
  })

  it('forgets a chat found once the sheet closed, saying nothing, and says nothing of a search that failed then', async () => {
    const find = held<serverSettings.TelegramFoundChat>()
    vi.mocked(serverSettings.findTelegramChat).mockReturnValue(find.promise)
    const { toggle } = renderClosable(BOT)
    await userEvent.click(screen.getByRole('button', { name: 'Find chat' }))
    await toggle()
    await act(async () => find.resolve({ id: 1, name: 'Alex', type: 'private' }))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    await toggle()
    expect(screen.queryByRole('group', { name: 'Is this the chat?' })).not.toBeInTheDocument()

    const again = held<serverSettings.TelegramFoundChat>()
    vi.mocked(serverSettings.findTelegramChat).mockReturnValue(again.promise)
    await userEvent.click(screen.getByRole('button', { name: 'Find chat' }))
    await toggle()
    await act(async () => again.reject(error(404, 'no-chat')))
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
  })

  it('shows a request from the sheet closed as busy in the one opened again, which then takes its outcome', async () => {
    const test = held<ServerSettings>()
    vi.mocked(serverSettings.testTelegram).mockReturnValue(test.promise)
    const { onChanged, toggle } = renderClosable(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }))
    await toggle()
    await toggle()
    expect(screen.getByRole('button', { name: 'Send a test message' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByRole('button', { name: 'Turn off' })).toBeDisabled()
    await act(async () => test.reject(error(502, 'unreachable')))
    expect(await screen.findByRole('alert', { name: saying(UNREACHABLE) })).toBeInTheDocument()
    expect(onChanged).not.toHaveBeenCalled()
    expect(screen.queryByRole('status')).not.toBeInTheDocument()
    expect(serverSettings.testTelegram).toHaveBeenCalledTimes(1)
  })
})
