import { beforeAll, describe, expect, it } from 'vitest'
import { lint, type LintProblem } from '../test/oxlint'

/**
 * UI texts go through translation keys (CLAUDE.md → Conventions): oxlint's `react/jsx-no-literals`
 * in `.oxlintrc.json` refuses a string that is a whole child in the app's JSX or the quoted value of
 * an attribute a user reads or hears. These tests plant each kind where the rule applies and where it
 * doesn't. A string in braces in an attribute, inside an expression or outside JSX passes the rule
 * and is left to review.
 */

const RULE = 'react(jsx-no-literals)'

/** A component whose JSX is the snippet, with `t` from i18next as the app has it. */
const component = (jsx: string) => `import { useTranslation } from 'react-i18next'
import { Button } from '../components/Button'

export function Example({ count, name }: { count: number; name: string }) {
  const { t } = useTranslation()
  return (
    ${jsx}
  )
}
`

/**
 * The attributes a user reads or hears: the ones HTML and ARIA define, the text props of the
 * app's own components (`label` on `IconButton`, `hint` on `MenuItem`, `actionLabel` on
 * `EmptyState`…) and their slots for content (`footer` on `Sheet` and `Menu`, `actions` on
 * `Dialog`, `overlay` on `PosterCard`…). The rule goes by the name, on any element.
 */
const READ_ATTRIBUTES = [
  'aria-label',
  'aria-description',
  'aria-roledescription',
  'aria-valuetext',
  'aria-placeholder',
  'title',
  'placeholder',
  'alt',
  'label',
  'subtitle',
  'heading',
  'hint',
  'help',
  'error',
  'message',
  'text',
  'dot',
  'actionLabel',
  'secondaryActionLabel',
  'editLabel',
  'footer',
  'action',
  'actions',
  'leading',
  'secondary',
  'overlay',
]

const REFUSED: [string, string][] = [
  ['text between tags', '<p>Downloads</p>'],
  ['text in braces', "<p>{'Downloads'}</p>"],
  ['a template literal', '<p>{`${count} downloading`}</p>'],
  ['text beside a key', "<p>{t('common.close')} now</p>"],
  ['text in a nested element', "<Button icon=\"close\">{t('common.close')}<span>now</span></Button>"],
  ...READ_ATTRIBUTES.map((name): [string, string] => [`text in ${name}`, `<Button ${name}="Close" />`]),
]

const ALLOWED: [string, string][] = [
  ['a key', "<p>{t('common.close')}</p>"],
  ['a key in an attribute', "<button type=\"button\" aria-label={t('common.close')} />"],
  ['a value from the data', '<p title={name}>{name}</p>'],
  ['an attribute nobody reads', '<p className="ks-row t-cap" data-state="open" role="status" />'],
  ['a decorative image', '<img src="/a.png" alt="" />'],
  ['a space between elements', "<p>{t('common.close')}{' '}{name}</p>"],
  ['a separator between values', '<p>{count} · {name} / {count} — {name}</p>'],
  ["a comma before a count read out, and the queue position's mark", '<p><span>, {name}</span><span>#{count}</span></p>'],
  ['the arrows before speeds', '<p><span aria-hidden="true">↓</span><span aria-hidden="true">↑</span></p>'],
]

describe('texts in the code', () => {
  let problems: LintProblem[]
  const at = (file: string) => problems.filter((problem) => problem.rule === RULE && problem.file === file)

  beforeAll(() => {
    problems = lint({
      ...Object.fromEntries(REFUSED.map(([, jsx], index) => [`src/screens/Refused${index}.tsx`, component(jsx)])),
      ...Object.fromEntries(ALLOWED.map(([, jsx], index) => [`src/screens/Allowed${index}.tsx`, component(jsx)])),
      'src/screens/Example.test.tsx': component('<p>Downloads</p>'),
      'src/test/render.tsx': component('<p>Downloads</p>'),
    })
  })

  it.each(REFUSED.map(([what, jsx], index) => [what, jsx, index] as const))('refuses %s: %s', (_what, _jsx, index) => {
    expect(at(`src/screens/Refused${index}.tsx`)).toHaveLength(1)
  })

  it.each(ALLOWED.map(([what, jsx], index) => [what, jsx, index] as const))('allows %s: %s', (_what, _jsx, index) => {
    expect(at(`src/screens/Allowed${index}.tsx`)).toEqual([])
  })

  it('leaves the tests and their helpers alone, which name what they look for', () => {
    expect(at('src/screens/Example.test.tsx')).toEqual([])
    expect(at('src/test/render.tsx')).toEqual([])
  })
})
