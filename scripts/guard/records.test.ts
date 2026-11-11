import { describe, expect, it } from 'vitest'
import { approval, closed, codeOf, commentsIn, says, secondReview, standing, type Comment } from './records.ts'
import type { Finding } from './signs.ts'

const CODE = '1a2b3c4d'
const OTHER = '99999999'
/** A member's comment with this text. */
const member = (body: string): Comment => ({ association: 'MEMBER', body })
const SOUND = member(`${secondReview(CODE, 'sound')}\n\nEach mark, and why.`)
const WEAKENING = member(secondReview(CODE, 'weakening'))
const APPROVED = member(`${approval(CODE)} the feature is gone, and its tests with it`)

describe('codeOf', () => {
  const marks: Finding[] = [
    { needs: 'review', file: 'src/sum.test.ts', line: 3, what: '1 of 2 assertions in `adds` rewritten or removed' },
    { needs: 'review', file: 'tsconfig.json', what: "the type check's config changed" },
    { needs: 'owner', file: 'checks.json', what: 'the threshold `coverage.thresholds.lines` is lowered: `96` → `95`' },
    { needs: 'owner', what: "the branch's run gave no tests in `vitest.json`" },
  ]
  const blob = (file: string) => `id of ${file}`
  const code = (needs: 'owner' | 'review', found = marks, ids = blob) => codeOf(needs, found, ids)

  it('gives a list of marks a code of eight hex digits, another for each of the two lists', () => {
    expect(code('review')).toMatch(/^[0-9a-f]{8}$/)
    expect(code('owner')).toMatch(/^[0-9a-f]{8}$/)
    expect(code('owner')).not.toBe(code('review'))
  })

  it('gives a code of eight digits also where the hash is a shorter number', () => {
    // The hash of this mark starts with a zero. The value is held here too: a record names a code, so another hash would drop every record in an open PR.
    expect(codeOf('owner', [{ needs: 'owner', what: 'mark 518' }], () => '')).toBe('0afd51e6')
  })

  it('gives an empty list none', () => {
    expect(code('review', marks.filter(({ needs }) => needs === 'owner'))).toBeUndefined()
    expect(code('owner', [])).toBeUndefined()
  })

  it.each([
    ['its marks come in another order', [...marks].reverse()],
    ['a mark moved to another line of its file', marks.map((mark) => (mark.line ? { ...mark, line: mark.line + 10 } : mark))],
    ['the other list changed', [...marks, { needs: 'owner' as const, file: 'package.json', what: 'the npm script `lint` is removed' }]],
  ])('keeps the code when %s', (_name, found) => {
    expect(code('review', found)).toBe(code('review'))
  })

  it.each<[string, Finding[], (file: string) => string]>([
    ['a mark is added', [...marks, { needs: 'review', file: 'package.json', what: 'the npm script `lint` changed' }], blob],
    ['a mark is gone', marks.slice(1), blob],
    ['a mark says something else', marks.map((mark) => (mark.line ? { ...mark, what: '2 of 2 assertions in `adds` rewritten or removed' } : mark)), blob],
    ['a marked file changed', marks, (file) => (file === 'tsconfig.json' ? 'another id' : blob(file))],
  ])('gives another code when %s', (_name, found, ids) => {
    expect(code('review', found, ids)).not.toBe(code('review'))
  })

  it('gives another code when a mark is in another file, be its content the same', () => {
    const same = () => 'one id'
    const moved = marks.map((mark) => (mark.line ? { ...mark, file: 'src/other.test.ts' } : mark))
    expect(code('review', moved, same)).not.toBe(code('review', marks, same))
  })

  it("keeps the code when a file changed that the list doesn't mark", () => {
    expect(code('review', marks, (file) => (file === 'checks.json' ? 'another id' : blob(file)))).toBe(code('review'))
  })

  it('gives a mark about the branch as a whole a code too, which changes with what it says', () => {
    const whole: Finding[] = [{ needs: 'owner', what: 'the runs gave no lists of their tests' }]
    expect(code('owner', whole)).toMatch(/^[0-9a-f]{8}$/)
    expect(code('owner', [{ needs: 'owner', what: 'something else' }])).not.toBe(code('owner', whole))
  })
})

describe('standing', () => {
  it('finds nothing posted for a list without a record', () => {
    expect(standing('review', CODE, [])).toBe('none')
    expect(standing('owner', CODE, [member('Looks fine to me.')])).toBe('none')
  })

  it("closes the owner's list with the owner's approval of its code", () => {
    expect(standing('owner', CODE, [APPROVED])).toBe('approved')
  })

  it("closes the second review's list with a second review that found it sound", () => {
    expect(standing('review', CODE, [SOUND])).toBe('sound')
  })

  it("leaves the second review's list open after a weakening found, until the owner approves that code", () => {
    expect(standing('review', CODE, [WEAKENING])).toBe('weakening')
    expect(standing('review', CODE, [WEAKENING, APPROVED])).toBe('approved')
    expect(standing('review', CODE, [APPROVED, WEAKENING])).toBe('approved')
  })

  it.each([
    ["the owner's approval alone", [APPROVED], 'none'],
    ["the owner's approval beside a sound second review, which closes it by itself", [SOUND, APPROVED], 'sound'],
  ] as const)("doesn't close the second review's list with %s", (_name, comments, state) => {
    expect(standing('review', CODE, [...comments])).toBe(state)
  })

  it("doesn't close the owner's list with a second review", () => {
    expect(standing('owner', CODE, [SOUND, WEAKENING])).toBe('none')
  })

  it("doesn't clear a weakening found with another second review of the same code that finds it sound, before it or after", () => {
    expect(standing('review', CODE, [WEAKENING, SOUND])).toBe('weakening')
    expect(standing('review', CODE, [SOUND, WEAKENING])).toBe('weakening')
    expect(standing('review', CODE, [WEAKENING, SOUND, APPROVED])).toBe('approved')
  })

  it('leaves a sound second review standing beside a weakening found in a list of another code', () => {
    expect(standing('review', CODE, [SOUND, member(secondReview(OTHER, 'weakening'))])).toBe('sound')
  })

  it.each([
    ['of another code', member(secondReview(OTHER, 'sound')), member(`${approval(OTHER)} a reason`)],
    ['below the first line', member(`Here it is:\n${secondReview(CODE, 'sound')}`), member(`Here it is:\n${approval(CODE)} a reason`)],
    ['after other words on the line', member(`So: ${secondReview(CODE, 'sound')}`), member(`So: ${approval(CODE)} a reason`)],
    ['with a code that only starts so', member(secondReview(`${CODE}0`, 'sound')), member(`${approval(`${CODE}0`)} a reason`)],
    ['without its bold', member(`Second review ${CODE}: sound`), member(`Owner's approval ${CODE}: a reason`)],
  ])("doesn't count a record %s", (_name, review, approved) => {
    expect(standing('review', CODE, [review])).toBe('none')
    expect(standing('owner', CODE, [approved])).toBe('none')
  })

  it.each(['passed', 'Sound', '', 'soundly', 'sound, mostly', 'weakening?'])("doesn't count a second review whose verdict is %j", (verdict) => {
    expect(standing('review', CODE, [member(`**Second review ${CODE}: ${verdict}**`)])).toBe('none')
  })

  it.each([approval(CODE), `${approval(CODE)}   `, `${approval(CODE)}\nthe reason is below`, `${approval(CODE)} …`, `${approval(CODE)}… `])("doesn't count an owner's approval without a reason on its line, or with the placeholder it is printed with: %j", (body) => {
    expect(standing('owner', CODE, [member(body)])).toBe('none')
  })

  it.each([`${approval(CODE)}the tests are gone`, `${approval(CODE)}   the tests are gone`])('counts an owner’s approval whose reason comes after no space or several: %j', (body) => {
    expect(standing('owner', CODE, [member(body)])).toBe('approved')
  })

  it('counts an owner’s approval whose reason starts with the placeholder’s character and goes on', () => {
    expect(standing('owner', CODE, [member(`${approval(CODE)} … and so the threshold moves`)])).toBe('approved')
  })

  it('reads a record after blank lines at the top of a comment', () => {
    expect(standing('review', CODE, [member(`\n\n${secondReview(CODE, 'sound')}`)])).toBe('sound')
  })

  it.each(['MEMBER', 'OWNER'])('counts a record from one who is %s to the repository', (association) => {
    expect(standing('owner', CODE, [{ ...APPROVED, association }])).toBe('approved')
    expect(standing('review', CODE, [{ ...SOUND, association }])).toBe('sound')
  })

  it.each(['COLLABORATOR', 'CONTRIBUTOR', 'FIRST_TIME_CONTRIBUTOR', 'NONE', 'member', ''])("doesn't count one from %j: an outside contributor, a collaborator or a bot", (association) => {
    expect(standing('owner', CODE, [{ ...APPROVED, association }])).toBe('none')
    expect(standing('review', CODE, [{ ...SOUND, association }])).toBe('none')
  })
})

describe('closed', () => {
  it.each([
    ['sound', true],
    ['approved', true],
    ['none', false],
    ['weakening', false],
  ] as const)('says whether a list that stands %s lets the PR through: %s', (state, through) => {
    expect(closed(state)).toBe(through)
  })
})

describe('says', () => {
  it.each([
    ['owner', undefined, "Record to post once the owner approves: `**Owner's approval 1a2b3c4d:** …`, the reason in the owner's words."],
    ['owner', 'none', "Record to post once the owner approves: `**Owner's approval 1a2b3c4d:** …`, the reason in the owner's words. Not posted yet."],
    ['owner', 'approved', "The PR holds the owner's approval of `1a2b3c4d`."],
    ['review', undefined, 'Record to post after the second review (`/second-review`): `**Second review 1a2b3c4d: sound**` or `**Second review 1a2b3c4d: weakening**`.'],
    ['review', 'none', 'Record to post after the second review (`/second-review`): `**Second review 1a2b3c4d: sound**` or `**Second review 1a2b3c4d: weakening**`. Not posted yet.'],
    ['review', 'sound', 'The PR holds a second review of `1a2b3c4d`: sound.'],
    ['review', 'weakening', "The second review of `1a2b3c4d` found a weakening. It needs a fix, and a second review of what the fix makes of it, or `**Owner's approval 1a2b3c4d:** …`, the reason in the owner's words."],
    ['review', 'approved', "The second review of `1a2b3c4d` found a weakening, and the PR holds the owner's approval of it."],
  ] as const)('says of the list for the %s that stands %s: %s', (needs, state, text) => {
    expect(says(needs, CODE, state)).toBe(text)
  })

  it('prints the records as the guard reads them back', () => {
    expect(standing('review', CODE, [member(/`(\*\*Second review [^`]+)`/.exec(says('review', CODE, 'none'))![1])])).toBe('sound')
    expect(standing('owner', CODE, [member(`${/`(\*\*Owner's approval [^`]+) …`/.exec(says('owner', CODE, 'none'))![1]} a reason`)])).toBe('approved')
  })
})

describe('commentsIn', () => {
  it('reads a comment from each line, with what its author is to the repository and its text', () => {
    const lines = [JSON.stringify({ association: 'MEMBER', body: 'One\nwith two lines' }), JSON.stringify({ association: 'NONE', body: 'Two', id: 7 })]
    expect(commentsIn(`${lines.join('\n')}\n`)).toEqual([
      { association: 'MEMBER', body: 'One\nwith two lines' },
      { association: 'NONE', body: 'Two' },
    ])
  })

  it.each([
    ['is not JSON', 'not json'],
    ['is empty', ''],
    ['is null', 'null'],
    ['is a list', '[]'],
    ['has no text', JSON.stringify({ association: 'MEMBER' })],
    ['has a text that is not one', JSON.stringify({ association: 'MEMBER', body: 7 })],
    ['doesn’t say what its author is', JSON.stringify({ body: 'One' })],
    ['says so with something else', JSON.stringify({ association: null, body: 'One' })],
  ])('takes a line that %s for no comment', (_name, line) => {
    expect(commentsIn(line)).toEqual([])
  })
})
