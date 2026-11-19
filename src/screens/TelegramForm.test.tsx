import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as serverSettings from '../api/settings'
import type { ServerSettings, TelegramStatus } from '../api/settings'
import { ToastProvider } from '../components/Toast'
import i18n from '../i18n'
import { saying } from '../test/render'
import { TelegramForm } from './TelegramForm'

vi.mock('../api/settings', async (importOriginal) => ({
  ...(await importOriginal<typeof serverSettings>()),
  saveTelegramToken: vi.fn(),
  findTelegramChat: vi.fn(),
  saveTelegramChat: vi.fn(),
  testTelegram: vi.fn(),
  forgetTelegram: vi.fn(),
}))

const TOKEN = '123456:ABCdefGhIJKlmNoPQRsTUVwxyZ-_0123456'
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
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalledWith(settings(BOT)))
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
    [error(502, 'unreachable'), 'Telegram isn’t answering. Kinopeer’s server needs to reach api.telegram.org.'],
    [error(500, 'storage'), 'The Kinopeer server couldn’t save the change. Check that its data folder is writable.'],
    [new Error('offline'), 'Couldn’t save. Try again.'],
  ])('says why it couldn’t save: %s', async (failure, message) => {
    vi.mocked(serverSettings.saveTelegramToken).mockRejectedValue(failure)
    renderForm(NONE)
    await userEvent.type(screen.getByLabelText('Bot token'), TOKEN)
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('takes the token without spell checking, and submits without leaving the page', () => {
    renderForm(NONE)
    const field = screen.getByLabelText('Bot token')
    expect(field).toHaveAttribute('spellcheck', 'false')
    expect(screen.queryByText(FAILED)).not.toBeInTheDocument()
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
    expect(await screen.findByText(UNREACHABLE)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText('Bot token'), 'x')
    expect(screen.getByText(UNREACHABLE)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.queryByText(UNREACHABLE)).not.toBeInTheDocument()
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
    await vi.waitFor(() => expect(onChanged).toHaveBeenCalled())
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
    [error(404, 'no-chat'), 'No chat sent the bot /start in the last day. Send it and try again.'],
    [error(422, 'token-rejected'), 'Telegram no longer knows the bot’s token. Get a new one from @BotFather and save it here.'],
  ])('says why no chat was found: %s', async (failure, message) => {
    vi.mocked(serverSettings.findTelegramChat).mockRejectedValue(failure)
    renderForm(BOT)
    await userEvent.click(screen.getByRole('button', { name: 'Find chat' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
  })

  it('shows the search in progress and sends it once however often it’s pressed', async () => {
    vi.mocked(serverSettings.findTelegramChat).mockReturnValue(pending())
    renderForm(BOT)
    await userEvent.click(screen.getByRole('button', { name: 'Find chat' }))
    await userEvent.click(screen.getByRole('button', { name: 'Find chat' }))
    expect(screen.getByRole('button', { name: 'Find chat' })).toHaveAttribute('aria-busy', 'true')
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
    expect(await screen.findByText(UNREACHABLE)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Choose another chat' }))
    expect(screen.queryByText(UNREACHABLE)).not.toBeInTheDocument()
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
    expect(await screen.findByText(TOKEN_REJECTED)).toBeInTheDocument()
    expect(onRefused).not.toHaveBeenCalled()
  })
})

describe('TelegramForm: connected', () => {
  it('says where notifications go and sends a test message in the interface’s language', async () => {
    vi.mocked(serverSettings.testTelegram).mockResolvedValue(settings(CONNECTED))
    const { onChanged } = renderForm(CONNECTED)
    expect(screen.getByText('Notifications go to “Alex” (Private chat) from @kinopeer_home_bot.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }))
    expect(serverSettings.testTelegram).toHaveBeenCalledWith('en')
    expect(await screen.findByRole('status', { name: saying('Test message sent') })).toBeInTheDocument()
    expect(onChanged).toHaveBeenCalledWith(settings(CONNECTED))
  })

  it.each([
    ['chat-rejected', 'chat', 'Telegram didn’t deliver to “Alex”: the bot was blocked or removed from it. Send the bot /start and choose the chat again.'],
    ['token-rejected', 'token', 'Telegram no longer knows the bot’s token. Get a new one from @BotFather and save it here.'],
  ] as const)('says a test refused for %s and hands what was refused on', async (code, refused, message) => {
    vi.mocked(serverSettings.testTelegram).mockRejectedValue(error(422, code))
    const { onRefused } = renderForm(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }))
    expect(await screen.findByText(message)).toBeInTheDocument()
    expect(onRefused).toHaveBeenCalledWith(refused)
  })

  it('hands nothing on when a test fails for another reason', async () => {
    vi.mocked(serverSettings.testTelegram).mockRejectedValue(error(502, 'unreachable'))
    const { onRefused } = renderForm(CONNECTED)
    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }))
    expect(await screen.findByText(/Telegram isn’t answering/)).toBeInTheDocument()
    expect(onRefused).not.toHaveBeenCalled()
  })

  it('shows what Telegram refused a notification before', () => {
    renderForm({ ...CONNECTED, refused: 'token' })
    expect(screen.getByText('Telegram no longer knows the bot’s token. Get a new one from @BotFather and save it here.')).toBeInTheDocument()
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
    expect(screen.getByText(message)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Send a test message' }))
    expect(await screen.findByText(UNREACHABLE)).toBeInTheDocument()
    expect(screen.queryByText(message)).not.toBeInTheDocument()
  })
})
