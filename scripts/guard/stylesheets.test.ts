import { describe, expect, it } from 'vitest'
import { atRulesIn, castsShadow, declarations, isStylesheet, problem, rawColors, rawMotion, rawValues, roles, tokensIn, TOKENS_FILE, type Sheet } from './stylesheets.ts'

/** A scale of two spacings, a radius and a type role, as tokens.css writes them. */
const TOKENS = ':root {\n  --space-2: 8px;\n  --space-4: 16px;\n  --r-sm: 10px;\n  --t-cap: 400 13px/18px var(--font-sans);\n}\n'

/** The raw values in one stylesheet beside those tokens, as the test reports them, and whether a comment lets each through. */
function raw(text: string, more: Sheet[] = []) {
  return rawValues([{ file: TOKENS_FILE, text: TOKENS }, { file: 'src/a.css', text }, ...more]).map((value) => `${value.allowed ? 'allowed' : 'fails'} ${value.kind} ${problem(value)}`)
}

describe('isStylesheet', () => {
  it("takes the app's stylesheets, the tokens among them, and nothing outside src/", () => {
    expect(['src/a.css', 'src/styles/tokens.css', 'src/b/c.css'].every(isStylesheet)).toBe(true)
    expect(['a.css', 'e2e/a.css', 'src/a.css.map', 'src/a.ts'].some(isStylesheet)).toBe(false)
  })
})

describe('declarations', () => {
  const one = (text: string) => declarations({ file: 'src/a.css', text })

  it('reads a value whole, a ; or a comment inside its strings included', () => {
    const [image, content] = one(`.a { background: url("data:image/svg+xml;utf8,<svg/>"); content: '/* not a comment */'; }`)
    expect(image.value).toBe('url("data:image/svg+xml;utf8,<svg/>")')
    expect(content.value).toBe("'/* not a comment */'")
    expect(content.commented(1)).toBe(false)
    const [escaped] = one(`.a { content: 'it\\' /* not a comment */'; }`)
    expect(escaped.commented(1)).toBe(false)
  })

  it('blanks a comment inside a value to spaces and keeps `!important` out of it', () => {
    const [d] = one('.a { padding: 3px /* why */ 4px !important; }')
    expect(d.value).toBe('3px           4px')
    expect(d.commented(1)).toBe(true)
  })

  it('gives the line of each part of a value across lines, and which lines a comment covers', () => {
    const [d] = one('.a {\n  transition:\n    opacity 1s,\n    /* two\n       lines */ transform 2s;\n}\n')
    expect(d.lineAt(d.value.indexOf('1s'))).toBe(3)
    expect(d.lineAt(d.value.indexOf('2s'))).toBe(5)
    expect([2, 3, 4, 5].map(d.commented)).toEqual([false, false, true, true])
  })

  it('says where a declaration sits: its at-rules and selector, outermost first, in single spaces', () => {
    const sits = one('@media (min-width:\n 1024px) { :root,\n[data-theme="dark"] { --a: 1; } }\n.b { --a: 2; }').map(({ where, prop }) => `${where} ${prop}`)
    expect(sits).toEqual(['@media (min-width: 1024px) :root, [data-theme="dark"] --a', '.b --a'])
  })

  it('throws on a stylesheet it cannot parse, a comment or a string left open at its end among them', () => {
    expect(() => one('.a { color: red;')).toThrow(/Unclosed block/)
    expect(() => one('.a { color: red; } /* open')).toThrow(/Unclosed comment/)
    expect(() => one('.a { content: "open')).toThrow(/Unclosed string/)
  })
})

describe('the comments rawValues reads', () => {
  it('opens a comment only at `/*`: not at a `*` alone, and not inside a string, after a comment or across lines', () => {
    expect(raw('.a { margin: calc(2*3px); color: #abc }')).toEqual([
      'fails spacing src/a.css:1 margin: 3px is off the scale: add a comment on the line saying why',
      'fails color src/a.css:1 color: #abc is a raw color: use a token from tokens.css, or add a comment on the line saying why',
    ])
    expect(raw('.a {\n  content: /**/"/*";\n  color: #abc;\n}\n')).toEqual([
      'fails color src/a.css:3 color: #abc is a raw color: use a token from tokens.css, or add a comment on the line saying why',
    ])
    expect(raw('.a {\n  content: "a\n/*";\n  color: #abc;\n}\n')).toEqual([
      'fails color src/a.css:4 color: #abc is a raw color: use a token from tokens.css, or add a comment on the line saying why',
    ])
  })

  it('closes a comment at the first `*/` after its `/*`, which `/*/` is not, and opens one right after it', () => {
    expect(raw('.a { /*/ the color\n below */ color: #abc; }')).toEqual([
      'allowed color src/a.css:2 color: #abc is a raw color: use a token from tokens.css, or add a comment on the line saying why',
    ])
    expect(raw('.a { /**//* the color\n below */ color: #abc; }')).toEqual([
      'allowed color src/a.css:2 color: #abc is a raw color: use a token from tokens.css, or add a comment on the line saying why',
    ])
  })

  it('skips an unquoted url(), whose `/*` opens no comment', () => {
    expect(raw('a { background: url(icons/*.svg); }\nb { padding: 13px; color: red; }')).toEqual([
      'fails spacing src/a.css:2 padding: 13px is off the scale: add a comment on the line saying why',
      'fails color src/a.css:2 color: red is a raw color: use a token from tokens.css, or add a comment on the line saying why',
    ])
    // A quoted one is a string, which holds no comment either.
    expect(raw('a { background: URL( "a/*.svg" ) url() ; }\nb { padding: 13px; }')).toEqual(['fails spacing src/a.css:2 padding: 13px is off the scale: add a comment on the line saying why'])
    // A comment after one is still a comment, and a url() left open is a stylesheet PostCSS can't parse.
    expect(raw('a { background: url(a.svg); /* why */ padding: 13px; }')).toEqual(['allowed spacing src/a.css:1 padding: 13px is off the scale: add a comment on the line saying why'])
    expect(() => raw('a { background: url(a/*.svg; }\nb { padding: 13px; }')).toThrow()
    // Read as PostCSS reads it: an escaped `)` doesn't end the url(), and only `url(` in lower case
    // is one, so `URL(` holds a comment here, though a browser reads `URL(` as a url() too.
    expect(raw('.a { background: url(a\\)/*b.svg); }\n.b { padding: 13px; }\n/* x */')).toEqual(['fails spacing src/a.css:2 padding: 13px is off the scale: add a comment on the line saying why'])
    expect(raw('a { background: URL(x/*y*/z); padding: 13px; }')).toEqual(['allowed spacing src/a.css:1 padding: 13px is off the scale: add a comment on the line saying why'])
  })

  it('reads a stylesheet that starts with a byte order mark where its values are', () => {
    expect(raw('\uFEFFa { padding: 13px; }')).toEqual(['fails spacing src/a.css:1 padding: 13px is off the scale: add a comment on the line saying why'])
    // One mark only, as the parse leaves out one.
    expect(raw('\uFEFF\uFEFF.a { gap: 13px; }')).toEqual(['fails spacing src/a.css:1 gap: 13px is off the scale: add a comment on the line saying why'])
    // PostCSS leaves out the other byte order as well.
    expect(raw('\uFFFEa { padding: 13px; }')).toEqual(['fails spacing src/a.css:1 padding: 13px is off the scale: add a comment on the line saying why'])
  })

  it('says where a declaration in an at-rule without a selector sits', () => {
    expect(declarations({ file: 'src/a.css', text: '@font-face { --a: 1 }' }).map(({ where }) => where)).toEqual(['@font-face'])
  })
})

describe('rawValues', () => {
  it('fails a size the scale has, with or without a comment, and one it lacks without a comment', () => {
    expect(raw('.a {\n  padding: 8px 3px;\n  gap: 16px; /* why */\n  margin: 3px; /* why */\n  margin-top: -3px;\n  border-radius: 10px 7px;\n}\n')).toEqual([
      'fails spacing src/a.css:2 padding: 8px is on the scale: use var(--space-2)',
      'fails spacing src/a.css:2 padding: 3px is off the scale: add a comment on the line saying why',
      'fails spacing src/a.css:3 gap: 16px is on the scale: use var(--space-4)',
      'allowed spacing src/a.css:4 margin: 3px is off the scale: add a comment on the line saying why',
      'fails radius src/a.css:6 border-radius: 10px is on the scale: use var(--r-sm)',
      'fails radius src/a.css:6 border-radius: 7px is off the scale: add a comment on the line saying why',
    ])
  })

  it('reads every side and corner of a spacing or a radius, and a size with decimals', () => {
    expect(raw('.a { padding-top: 8px; margin-inline-start: 2.25px; border-top-left-radius: 10px; }')).toEqual([
      'fails spacing src/a.css:1 padding-top: 8px is on the scale: use var(--space-2)',
      'fails spacing src/a.css:1 margin-inline-start: 2.25px is off the scale: add a comment on the line saying why',
      'fails radius src/a.css:1 border-top-left-radius: 10px is on the scale: use var(--r-sm)',
    ])
    expect(raw('.a { -webkit-border-radius: 12px; }')).toEqual(['fails radius src/a.css:1 -webkit-border-radius: 12px is off the scale: add a comment on the line saying why'])
  })

  it('checks font sizes and line heights against the type roles', () => {
    expect(raw('.a { font-size: 13px; line-height: 18px; font: 600 12px/1 x; }')).toEqual([
      'fails type src/a.css:1 font-size: 13px is on a type role: use font: var(--t-cap)',
      'fails type src/a.css:1 line-height: 18px is on a type role: use font: var(--t-cap)',
      'fails type src/a.css:1 font: 12px is off a type role: add a comment on the line saying why',
    ])
  })

  it('fails a raw color and a data: URL unless a comment lets it through', () => {
    expect(raw('.a {\n  color: #abc;\n  background: url("data:image/png;base64,AAAA"); /* why */\n  mask: image-set("data:x" 1x);\n}\n')).toEqual([
      'fails color src/a.css:2 color: #abc is a raw color: use a token from tokens.css, or add a comment on the line saying why',
      'allowed color src/a.css:3 background: a data: URL may draw raw colors: use a file or a token, or add a comment on the line saying why',
      'fails color src/a.css:4 mask: a data: URL may draw raw colors: use a file or a token, or add a comment on the line saying why',
    ])
  })

  it('reads a color after a url() on its own line, and a name in an animation as a keyframe', () => {
    expect(raw('.a {\n  background: url(a-rather-long-file-name.png)\n    red;\n  animation: highlight var(--d-base);\n}\n')).toEqual([
      'fails color src/a.css:3 background: red is a raw color: use a token from tokens.css, or add a comment on the line saying why',
    ])
  })

  it('reads motion only in transitions, animations and custom properties', () => {
    expect(raw('.a { view-transition-name: ease; transition-duration: 1.25s; }')).toEqual([
      'fails motion src/a.css:1 transition-duration: 1.25s is raw motion: use --d-* and --ease*, or add a comment on the line saying why',
    ])
  })

  it("follows a shadow's var() into a custom property another stylesheet defines, and says where the raw shadow is", () => {
    const own = { file: 'src/b.css', text: ':root { --lift: 0 2px 4px var(--scrim); /* why */ }\n' }
    expect(raw('.a { box-shadow: var(--lift), var(--shadow-1) !important; }', [own])).toEqual([
      'allowed shadow src/b.css:1 --lift: 0 2px 4px var(--scrim) is a raw shadow: use a --shadow token, or add a comment on the line saying why',
    ])
  })

  it("reads a var()'s fallback as a shadow of its own, on the line it is on", () => {
    expect(raw('.a {\n  box-shadow: var(\n    --unknown,\n    0 2px 4px var(--scrim));\n}\n')).toEqual([
      'fails shadow src/a.css:4 box-shadow: 0 2px 4px var(--scrim) is a raw shadow: use a --shadow token, or add a comment on the line saying why',
    ])
    expect(raw('.a {\n  box-shadow: inset var(\n--unknown,\n0 2px 4px var(--scrim));\n}\n')).toEqual([
      'fails shadow src/a.css:4 box-shadow: 0 2px 4px var(--scrim) is a raw shadow: use a --shadow token, or add a comment on the line saying why',
    ])
  })

  it('reads each layer of a shadow on its own line, and skips `none` and the --shadow tokens', () => {
    expect(raw('.a {\n  box-shadow:\n    var(--shadow-1),\n    0 2px 4px var(--scrim),  none;\n}\n')).toEqual([
      'fails shadow src/a.css:4 box-shadow: 0 2px 4px var(--scrim) is a raw shadow: use a --shadow token, or add a comment on the line saying why',
    ])
  })

  it('follows a var() with spaces inside its parentheses or beside `inset`, and not one beside other lengths', () => {
    const lift = { file: 'src/b.css', text: ':root {\n  --lift: 0 2px 4px var(--scrim); /* why */\n  --ring: 0 0 0 2px var(--accent);\n}\n' }
    expect(raw('.a { box-shadow: var( --lift), var(--lift ), inset var(--ring), var(--ring) inset; }', [lift])).toEqual([
      'allowed shadow src/b.css:2 --lift: 0 2px 4px var(--scrim) is a raw shadow: use a --shadow token, or add a comment on the line saying why',
    ])
    expect(raw('.a { box-shadow: var(--offset) 2px 4px var(--scrim); }')).toEqual([
      'fails shadow src/a.css:1 box-shadow: var(--offset) 2px 4px var(--scrim) is a raw shadow: use a --shadow token, or add a comment on the line saying why',
    ])
  })

  it('reports a shadow in a custom property once, with each declaration that takes it', () => {
    const lift = { file: 'src/b.css', text: ':root {\n  --lift: 0 2px 4px var(--scrim); /* why */\n}\n' }
    const shadows = rawValues([{ file: TOKENS_FILE, text: TOKENS }, { file: 'src/a.css', text: '.a {\n  box-shadow: var(--lift);\n}\n.b { box-shadow: inset var(--x, var(--lift)); }\n' }, lift])
    expect(shadows.map(({ file, line, via }) => ({ file, line, via }))).toEqual([{ file: 'src/b.css', line: 2, via: [{ file: 'src/a.css', line: 2 }, { file: 'src/a.css', line: 4 }] }])
    expect(rawValues([{ file: 'src/a.css', text: '.a { box-shadow: 0 2px 4px var(--scrim); /* why */ }' }]).map(({ via }) => via)).toEqual([[]])
    // A line that takes it twice is one use; the same line number in another file is another.
    const twice = rawValues([{ file: TOKENS_FILE, text: TOKENS }, { file: 'src/a.css', text: '.a { box-shadow: var(--lift); text-shadow: var(--lift); }' }, { file: 'src/c.css', text: '.c { box-shadow: var(--lift); }' }, lift])
    expect(twice.map(({ via }) => via)).toEqual([[{ file: 'src/a.css', line: 1 }, { file: 'src/c.css', line: 1 }]])
  })

  it('follows custom properties that name each other once', () => {
    expect(raw('.a { --a: var(--b); --b: var(--a); box-shadow: var(--a); }')).toEqual([])
  })

  it('fails a drop-shadow() in a filter or a custom property', () => {
    expect(raw('.a { filter: blur(2px) drop-shadow(0 2px 4px var(--scrim)); --glow: drop-shadow(0 0 2px var(--accent)); }')).toEqual([
      'fails shadow src/a.css:1 filter: drop-shadow() is a raw shadow: use a --shadow token, or add a comment on the line saying why',
      'fails shadow src/a.css:1 --glow: drop-shadow() is a raw shadow: use a --shadow token, or add a comment on the line saying why',
    ])
  })

  it('fails raw motion, in a custom property too', () => {
    expect(raw('.a { transition: opacity 1s ease; --spin: 2s; }')).toEqual([
      'fails motion src/a.css:1 transition: 1s is raw motion: use --d-* and --ease*, or add a comment on the line saying why',
      'fails motion src/a.css:1 transition: ease is raw motion: use --d-* and --ease*, or add a comment on the line saying why',
      'fails motion src/a.css:1 --spin: 2s is raw motion: use --d-* and --ease*, or add a comment on the line saying why',
    ])
  })

  it('leaves the tokens themselves alone, which are the scale', () => {
    expect(rawValues([{ file: TOKENS_FILE, text: ':root { --bg: #000; --pad: 3px; --d: 1s; }' }])).toEqual([])
  })
})

describe('the patterns rawValues reads by', () => {
  it("takes a role's size and line-height whatever the spaces in it, the first role to have one", () => {
    const token = roles(':root {\n  --t-a:  500  12.25px/16px x;\n  --t-b: 400 12.5px/20px y;\n  --t-c: 400 12.25px/20px z;\n}\n')
    expect(['12.25px', '12.5px'].map((px) => token('font-size', px))).toEqual(['font: var(--t-a)', 'font: var(--t-b)'])
    expect(['16px', '20px', '12.5px'].map((px) => token('line-height', px))).toEqual(['font: var(--t-a)', 'font: var(--t-b)', undefined])
    expect(token('font', '16px')).toBe('font: var(--t-a)')
  })

  it('reads hex colors of each length, and every color function', () => {
    const colors = (value: string) => rawColors('color', value).map(([color]) => color)
    expect(colors('#aabbcc #aabbccdd #aabbc hsl(0 0% 0%)')).toEqual(['#aabbcc', '#aabbccdd', 'hsl(0 0% 0%)'])
    // A whole word only, followed by more or not: `reds` is no color.
    expect(colors('red reds')).toEqual(['red'])
  })

  it('reads a time with decimals, and a call left open to the end of the value', () => {
    expect(rawMotion('1.25s .5ms steps(2').map(([time]) => time)).toEqual(['1.25s', '.5ms', 'steps(2'])
  })

  it('tells a shadow from a ring by its literal zeros, whatever the spaces between them', () => {
    expect(['0 0 10px red', '0 0 0.5px red', '0.00 0 0 red', '0  0  0  2px var(--accent)', 'inset'].map(castsShadow)).toEqual([true, true, false, false, false])
  })
})

describe('atRulesIn', () => {
  it('names the at-rules that hold no declaration, where they sit, in single spaces', () => {
    expect(atRulesIn("@import './more.css';\n@layer base,\n  app;\n@media (min-width: 1024px) { :root { --a: 1px; } }\n@supports (display: grid) {}\n@media print { @page { } }\n")).toEqual([
      "@import './more.css'",
      '@layer base, app',
      '@supports (display: grid)',
      '@media print',
      '@media print @page',
    ])
  })
})

describe('tokensIn', () => {
  it('names each token by where it sits, with its value in single spaces and without comments', () => {
    const tokens = tokensIn(":root {\n  --space-2: 8px;\n  --stack:\n    a,  b; /* why */\n}\n[data-theme='light'] { --bg: #fff /* light */; color-scheme: light; }\n")
    expect([...tokens]).toEqual([
      [':root\t--space-2', '8px'],
      [':root\t--stack', 'a, b'],
      ["[data-theme='light']\t--bg", '#fff'],
      ["[data-theme='light']\tcolor-scheme", 'light'],
    ])
  })

  it('keeps `!important`, and both values of a name declared twice, in order', () => {
    expect([...tokensIn(':root { --bg: #fff !important; --accent: #0aa; --accent: color(display-p3 0 0.7 0.7); }')]).toEqual([
      [':root\t--bg', '#fff !important'],
      [':root\t--accent', '#0aa; color(display-p3 0 0.7 0.7)'],
    ])
  })
})
