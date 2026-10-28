const formats = new Map<string, Intl.ListFormat>()

/**
 * Items joined as a list in the interface language: "A, B, and C" in English, "A, B и C" in Russian;
 * the narrow style leaves out the conjunction ("A, B, C"). One formatter per language and style.
 */
export function formatList(
  items: string[],
  i18n: { language: string; resolvedLanguage?: string },
  style: Intl.ListFormatStyle = 'long',
): string {
  const language = i18n.resolvedLanguage ?? i18n.language
  const key = `${language}|${style}`
  let format = formats.get(key)
  if (!format) {
    format = new Intl.ListFormat(language, { type: 'conjunction', style })
    formats.set(key, format)
  }
  return format.format(items)
}
