import 'i18next'
import type en from './locales/en.json'
import type webui from './locales/webui/en.json'

declare module 'i18next' {
  interface CustomTypeOptions {
    // The WebUI build's own texts only that build loads (src/i18n/language.ts), typed with the rest.
    resources: { translation: typeof en & typeof webui }
  }
}
