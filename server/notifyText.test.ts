import { describe, expect, it } from 'vitest'
import en from './locales/en.json' with { type: 'json' }
import ru from './locales/ru.json' with { type: 'json' }
import { finishedText, isNotifyLanguage, notifyText } from './notifyText.ts'

describe('the server’s locales', () => {
  const placeholders = (text: string) => [...text.matchAll(/\{\{(\w+)\}\}/g)].map(([, name]) => name).sort()

  it('have the same texts in every language, with the same placeholders and none empty', () => {
    expect(Object.keys(ru).sort()).toEqual(Object.keys(en).sort())
    for (const key of Object.keys(en) as (keyof typeof en)[]) {
      expect(ru[key], key).not.toBe('')
      expect(en[key], key).not.toBe('')
      expect(placeholders(ru[key]), key).toEqual(placeholders(en[key]))
    }
  })
})

describe('notifyText', () => {
  it('takes the text of the language asked, with its placeholders filled', () => {
    expect(notifyText('en', 'finished', { title: 'Dune (2021)' })).toBe('Download finished: Dune (2021)')
    expect(notifyText('ru', 'finished', { title: 'Дюна (2021)' })).toBe('Загрузка завершена: Дюна (2021)')
  })

  it('fills a placeholder with text that looks like another as it is', () => {
    expect(notifyText('en', 'finished', { title: '{{title}} $& $1' })).toBe('Download finished: {{title}} $& $1')
  })
})

describe('finishedText', () => {
  it('names the title, then the torrent on a line of its own', () => {
    expect(finishedText('en', 'Dune.2021.2160p.WEB-DL-GRPA', 'Dune (2021)')).toBe('Download finished: Dune (2021)\nDune.2021.2160p.WEB-DL-GRPA')
  })

  it('names the torrent alone without a title', () => {
    expect(finishedText('ru', 'Dune.2021.2160p.WEB-DL-GRPA', undefined)).toBe('Загрузка завершена: Dune.2021.2160p.WEB-DL-GRPA')
  })
})

describe('isNotifyLanguage', () => {
  it.each([
    ['en', true],
    ['ru', true],
    ['de', false],
    ['toString', false],
    [undefined, false],
    // An array whose one item names a language reads as that name as a key.
    [['en'], false],
  ])('%s: %s', (value, known) => {
    expect(isNotifyLanguage(value)).toBe(known)
  })
})
