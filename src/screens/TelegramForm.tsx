import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SettingsError,
  findTelegramChat,
  forgetTelegram,
  saveTelegramChat,
  saveTelegramToken,
  testTelegram,
  type ServerSettings,
  type TelegramFoundChat,
  type TelegramStatus,
} from '../api/settings'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { useToast } from '../components/Toast'
import { notifyLanguage } from '../i18n/language'
import { useSaves, type SaveOutcome } from '../lib/useSaves'

export interface TelegramFormProps {
  telegram: TelegramStatus
  /** The bot or its chat was saved, or a test message went: the settings the server answered with, and which. */
  onChanged: (settings: ServerSettings, saved: 'token' | 'chat' | 'test') => void
  /** The bot was forgotten. */
  onTurnedOff: (settings: ServerSettings) => void
  /** Telegram refused the test message: the server keeps which of the two it refused, as for a notification. */
  onRefused: (refused: 'token' | 'chat') => void
}

type Step = 'token' | 'chat' | 'connected'

type FormError = 'invalid' | 'no-chat' | 'bot-in-use' | 'token-rejected' | 'chat-rejected' | 'unreachable' | 'storage' | 'failed' | null

/** The bot's requests (`useSaves`): one target, since they all change or read what the server keeps for it. */
const TELEGRAM_SAVES = 'telegram'
const BOT = 'bot'

type Request = 'token' | 'find' | 'chat' | 'test' | 'off'

const KNOWN_ERRORS = new Set<string>(['no-chat', 'bot-in-use', 'token-rejected', 'chat-rejected', 'unreachable', 'storage'])

function formError(e: unknown): FormError {
  const code = e instanceof SettingsError ? e.code : undefined
  if (code === 'invalid-key' || code === 'bad-request') return 'invalid'
  return code && KNOWN_ERRORS.has(code) ? (code as FormError) : 'failed'
}

/**
 * Telegram notifications, set up in three steps on the server: the bot's token, checked with
 * Telegram; the chat that sent the bot /start, shown with its name and kind before it's saved, so a
 * stranger's /start can't slip in unseen; then a test message. Once set up it offers the test, and
 * changing the chat or the bot, or turning it off; with a bot saved and no chat yet, the chat step
 * offers another bot and turning it off too.
 */
export function TelegramForm({ telegram, onChanged, onTurnedOff, onRefused }: TelegramFormProps) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  // A step the user went back to; otherwise the one the settings are at.
  const [editing, setEditing] = useState<Step | null>(null)
  const step: Step = editing ?? (!telegram.bot ? 'token' : !telegram.chat ? 'chat' : 'connected')
  const [token, setToken] = useState('')
  const [found, setFound] = useState<TelegramFoundChat | null>(null)
  const [error, setError] = useState<FormError>(null)
  const language = notifyLanguage(i18n.resolvedLanguage)

  const goTo = (next: Step | null) => {
    setEditing(next)
    setFound(null)
    setError(null)
  }

  /** What Settings learns from an outcome, whether or not the sheet is still there to show it. */
  const apply = (kind: Request, outcome: SaveOutcome) => {
    if (outcome.ok) {
      const settings = outcome.result as ServerSettings
      if (kind === 'off') onTurnedOff(settings)
      else if (kind !== 'find') onChanged(settings, kind)
    } else if (kind === 'test') {
      const failed = formError(outcome.error)
      if (failed === 'token-rejected') onRefused('token')
      if (failed === 'chat-rejected') onRefused('chat')
    }
  }

  // Open, the sheet takes every outcome: what it moves to, or why it failed.
  const saving = useSaves<Request>(TELEGRAM_SAVES, (outcome, kind) => {
    apply(kind, outcome)
    if (!outcome.ok) setError(formError(outcome.error))
    else if (kind === 'find') setFound(outcome.result as TelegramFoundChat)
    else if (kind === 'test') toast.show(t('telegram.testSent'), { icon: 'check' })
    else if (kind === 'token' || kind === 'chat') {
      if (kind === 'token') setToken('')
      goTo(null)
    }
    return true
  })
  // One request at a time, from this sheet or one opened before it.
  const busy = saving.pending(BOT) ?? null

  const run = async (kind: Request, request: () => Promise<unknown>) => {
    setError(null)
    const settled = await saving.send(BOT, kind, request)
    // Closed meanwhile: Settings learns it, and a toast says it; a chat found then is forgotten.
    if (!settled || settled.taken || kind === 'find') return
    apply(kind, settled)
    if (!settled.ok) toast.show(errorText(formError(settled.error), true), { icon: 'alert' })
    else if (kind !== 'off') toast.show(t(kind === 'test' ? 'telegram.testSent' : kind === 'token' ? 'telegram.botSaved' : 'telegram.chatSaved'), { icon: 'check' })
  }

  const saveToken = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void run('token', () => saveTelegramToken(token.trim()))
  }

  /** What a failure says, in the sheet or, once it's closed, in a toast. Telegram refuses a chat only
   *  for a test message, which only the connected step sends. */
  function errorText(failed: FormError, named = false): string {
    if (failed === 'invalid') return t('telegram.tokenInvalid')
    if (failed === 'unreachable') return t('telegram.unreachable')
    if (failed === 'token-rejected') return t('telegram.tokenRejected')
    if (failed === 'chat-rejected') return t('telegram.chatRefused', { chat: telegram.chat?.name })
    if (failed === 'no-chat') return t('telegram.noChatFound')
    if (failed === 'bot-in-use') return t('telegram.botInUse')
    if (failed === 'storage') return t('keyForm.storage')
    // A toast names what failed.
    return t(named ? 'telegram.failedNamed' : 'telegram.failed')
  }
  const banner = () =>
    error === null || error === 'invalid' ? null : <Banner tone={error === 'no-chat' ? 'info' : 'error'}>{errorText(error)}</Banner>

  const turnOff = (
    <Button
      variant="secondary"
      size="lg"
      block
      loading={busy === 'off'}
      disabled={busy !== null && busy !== 'off'}
      onClick={() => void run('off', forgetTelegram)}
    >
      {t('telegram.turnOff')}
    </Button>
  )

  if (step === 'token') {
    return (
      <form className="key-form" onSubmit={saveToken}>
        <p className="t-body c2">{t('telegram.tokenHelp')}</p>
        {banner()}
        <Input
          label={t('telegram.tokenLabel')}
          name="telegram-bot-token"
          mono
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          required
          value={token}
          onChange={(event) => {
            setToken(event.target.value)
            if (error === 'invalid') setError(null)
          }}
          error={error === 'invalid' && t('telegram.tokenInvalid')}
        />
        <div className="key-form-actions">
          <Button type="submit" size="lg" block loading={busy === 'token'}>
            {t('common.save')}
          </Button>
          {editing && (
            <Button type="button" variant="secondary" size="lg" block disabled={busy !== null} onClick={() => goTo(null)}>
              {t('common.cancel')}
            </Button>
          )}
        </div>
      </form>
    )
  }

  if (step === 'chat') {
    return (
      <div className="key-form">
        <p className="t-body c2">{t('telegram.chatHelp', { bot: telegram.bot })}</p>
        {banner()}
        {found && (
          <div className="ks-card telegram-found" role="group" aria-label={t('telegram.foundChat')}>
            <span className="t-cap c3">{t('telegram.foundChat')}</span>
            <span className="t-body">{found.name}</span>
            <span className="t-cap c2">{t(`telegram.chatTypes.${found.type}`)}</span>
          </div>
        )}
        <div className="key-form-actions">
          {found ? (
            <>
              <Button
                size="lg"
                block
                loading={busy === 'chat'}
                disabled={busy !== null && busy !== 'chat'}
                onClick={() => void run('chat', () => saveTelegramChat(found.id, language))}
              >
                {t('telegram.useChat')}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                block
                loading={busy === 'find'}
                disabled={busy !== null && busy !== 'find'}
                onClick={() => void run('find', () => findTelegramChat())}
              >
                {t('telegram.findAgain')}
              </Button>
            </>
          ) : (
            <Button
              size="lg"
              block
              loading={busy === 'find'}
              disabled={busy !== null && busy !== 'find'}
              onClick={() => void run('find', () => findTelegramChat())}
            >
              {t('telegram.findChat')}
            </Button>
          )}
          {editing ? (
            <Button variant="secondary" size="lg" block disabled={busy !== null} onClick={() => goTo(null)}>
              {t('common.cancel')}
            </Button>
          ) : (
            // The step the settings are at: without these, a wrong bot or a token Telegram no longer
            // knows would leave the sheet nowhere to go.
            <>
              <Button variant="secondary" size="lg" block disabled={busy !== null} onClick={() => goTo('token')}>
                {t('telegram.changeBot')}
              </Button>
              {turnOff}
            </>
          )}
        </div>
      </div>
    )
  }

  const chat = telegram.chat!
  return (
    <div className="key-form">
      <p className="t-body c2">
        {t('telegram.connectedTo', { chat: chat.name, type: t(`telegram.chatTypes.${chat.type}`), bot: telegram.bot })}
      </p>
      {error === null && telegram.refused === 'chat' && <Banner tone="error">{t('telegram.chatRefused', { chat: chat.name })}</Banner>}
      {error === null && telegram.refused === 'token' && <Banner tone="error">{t('telegram.tokenRejected')}</Banner>}
      {banner()}
      <div className="key-form-actions">
        <Button
          size="lg"
          block
          loading={busy === 'test'}
          disabled={busy !== null && busy !== 'test'}
          onClick={() => void run('test', () => testTelegram(language))}
        >
          {t('telegram.sendTest')}
        </Button>
        <Button variant="secondary" size="lg" block disabled={busy !== null} onClick={() => goTo('chat')}>
          {t('telegram.changeChat')}
        </Button>
        <Button variant="secondary" size="lg" block disabled={busy !== null} onClick={() => goTo('token')}>
          {t('telegram.changeBot')}
        </Button>
        {turnOff}
      </div>
    </div>
  )
}
