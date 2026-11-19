import { useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import {
  SettingsError,
  findTelegramChat,
  forgetTelegram,
  saveTelegramChat,
  saveTelegramToken,
  testTelegram,
  type NotifyLanguage,
  type ServerSettings,
  type TelegramFoundChat,
  type TelegramStatus,
} from '../api/settings'
import { Banner } from '../components/Banner'
import { Button } from '../components/Button'
import { Input } from '../components/Input'
import { useToast } from '../components/Toast'

export interface TelegramFormProps {
  telegram: TelegramStatus
  /** The bot or its chat was saved: the settings the server answered with. */
  onChanged: (settings: ServerSettings) => void
  /** The bot was forgotten. */
  onTurnedOff: (settings: ServerSettings) => void
  /** Telegram refused the test message: the server keeps which of the two it refused, as for a notification. */
  onRefused: (refused: 'token' | 'chat') => void
}

type Step = 'token' | 'chat' | 'connected'

type FormError = 'invalid' | 'no-chat' | 'token-rejected' | 'chat-rejected' | 'unreachable' | 'storage' | 'failed' | null

const KNOWN_ERRORS = new Set<string>(['no-chat', 'token-rejected', 'chat-rejected', 'unreachable', 'storage'])

function formError(e: unknown): FormError {
  const code = e instanceof SettingsError ? e.code : undefined
  if (code === 'invalid-key' || code === 'bad-request') return 'invalid'
  return code && KNOWN_ERRORS.has(code) ? (code as FormError) : 'failed'
}

/** The language the server writes notifications in: the interface's. */
function notifyLanguage(language: string | undefined): NotifyLanguage {
  return language?.startsWith('ru') ? 'ru' : 'en'
}

/**
 * Telegram notifications, set up in three steps on the server: the bot's token, checked with
 * Telegram; the chat that sent the bot /start, shown with its name and kind before it's saved, so a
 * stranger's /start can't slip in unseen; then a test message. Once set up it offers the test, and
 * changing the chat or the bot, or turning it off.
 */
export function TelegramForm({ telegram, onChanged, onTurnedOff, onRefused }: TelegramFormProps) {
  const { t, i18n } = useTranslation()
  const toast = useToast()
  // A step the user went back to; otherwise the one the settings are at.
  const [editing, setEditing] = useState<Step | null>(null)
  const step: Step = editing ?? (!telegram.bot ? 'token' : !telegram.chat ? 'chat' : 'connected')
  const [token, setToken] = useState('')
  const [found, setFound] = useState<TelegramFoundChat | null>(null)
  // One request at a time: they all change or read what the server keeps for the bot.
  const [busy, setBusy] = useState<'token' | 'find' | 'chat' | 'test' | 'off' | null>(null)
  const [error, setError] = useState<FormError>(null)
  const language = notifyLanguage(i18n.resolvedLanguage)

  const run = async <T,>(kind: NonNullable<typeof busy>, request: () => Promise<T>, done: (result: T) => void) => {
    if (busy) return
    setBusy(kind)
    setError(null)
    try {
      done(await request())
    } catch (e) {
      const failed = formError(e)
      setError(failed)
      if (kind === 'test' && failed === 'token-rejected') onRefused('token')
      if (kind === 'test' && failed === 'chat-rejected') onRefused('chat')
    } finally {
      setBusy(null)
    }
  }

  const goTo = (next: Step | null) => {
    setEditing(next)
    setFound(null)
    setError(null)
  }

  const saveToken = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    void run('token', () => saveTelegramToken(token.trim()), (settings) => {
      setToken('')
      goTo(null)
      onChanged(settings)
    })
  }

  const banner = (chat = telegram.chat?.name ?? '') =>
    error === 'unreachable' ? (
      <Banner tone="error">{t('telegram.unreachable')}</Banner>
    ) : error === 'token-rejected' ? (
      <Banner tone="error">{t('telegram.tokenRejected')}</Banner>
    ) : error === 'chat-rejected' ? (
      <Banner tone="error">{t('telegram.chatRefused', { chat })}</Banner>
    ) : error === 'no-chat' ? (
      <Banner tone="info">{t('telegram.noChatFound')}</Banner>
    ) : error === 'storage' ? (
      <Banner tone="error">{t('keyForm.storage')}</Banner>
    ) : error === 'failed' ? (
      <Banner tone="error">{t('telegram.failed')}</Banner>
    ) : null

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
                onClick={() => void run('chat', () => saveTelegramChat(found.id, language), (settings) => {
                  goTo(null)
                  onChanged(settings)
                })}
              >
                {t('telegram.useChat')}
              </Button>
              <Button
                variant="secondary"
                size="lg"
                block
                loading={busy === 'find'}
                disabled={busy !== null && busy !== 'find'}
                onClick={() => void run('find', () => findTelegramChat(), setFound)}
              >
                {t('telegram.findAgain')}
              </Button>
            </>
          ) : (
            <Button size="lg" block loading={busy === 'find'} onClick={() => void run('find', () => findTelegramChat(), setFound)}>
              {t('telegram.findChat')}
            </Button>
          )}
          {editing && (
            <Button variant="secondary" size="lg" block disabled={busy !== null} onClick={() => goTo(null)}>
              {t('common.cancel')}
            </Button>
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
      {banner(chat.name)}
      <div className="key-form-actions">
        <Button
          size="lg"
          block
          loading={busy === 'test'}
          disabled={busy !== null && busy !== 'test'}
          onClick={() => void run('test', () => testTelegram(language), (settings) => {
            onChanged(settings)
            toast.show(t('telegram.testSent'), { icon: 'check' })
          })}
        >
          {t('telegram.sendTest')}
        </Button>
        <Button variant="secondary" size="lg" block disabled={busy !== null} onClick={() => goTo('chat')}>
          {t('telegram.changeChat')}
        </Button>
        <Button variant="secondary" size="lg" block disabled={busy !== null} onClick={() => goTo('token')}>
          {t('telegram.changeBot')}
        </Button>
        <Button
          variant="secondary"
          size="lg"
          block
          loading={busy === 'off'}
          disabled={busy !== null && busy !== 'off'}
          onClick={() => void run('off', forgetTelegram, onTurnedOff)}
        >
          {t('telegram.turnOff')}
        </Button>
      </div>
    </div>
  )
}
