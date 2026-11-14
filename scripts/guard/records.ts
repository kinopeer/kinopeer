// The checks guard's records: what a PR with marks has to hold before its check passes
// (docs/QUALITY.md → What a marked PR needs). Each list of marks, the owner's, the coordinator's and
// the second review's, has a code; a record is a comment on the PR whose first line names the code; the guard
// reads the PR's comments as data and says where each list stands.
import type { Finding, Needs } from './signs.ts'

/** A comment on the PR, as the workflow hands it over: what its author is to the repository, and its text. */
export type Comment = { association: string; body: string }

/**
 * Where a list of marks stands by the PR's records: nothing posted for its code; a second review
 * that found it sound; one that found a weakening; an approval: the owner's, which closes the owner's
 * list, and the second review's only after a weakening found, or the coordinator's, which closes the
 * coordinator's list, as the owner's does.
 */
export type State = 'none' | 'sound' | 'weakening' | 'approved'

/** A short hash (FNV-1a, 32 bits, as 8 hex digits): a name for a list as it is, not a secret. */
function hash(text: string): string {
  let value = 0x811c9dc5
  for (let index = 0; index < text.length; index++) {
    value ^= text.charCodeAt(index)
    value = Math.imul(value, 0x01000193)
  }
  return (value >>> 0).toString(16).padStart(8, '0')
}

/**
 * The code of one of the lists, or nothing for an empty one: what each of its marks says (not
 * its line, which moves with an edit elsewhere in the file) and the marked files, by path, as they
 * are at the head (`blob` gives git's id of a file's content). A record names the code, so it
 * holds while the marks and the marked files are the same, and no longer once either changes.
 */
export function codeOf(needs: Needs, found: Finding[], blob: (file: string) => string): string | undefined {
  const marks = found.filter((finding) => finding.needs === needs)
  if (marks.length === 0) return undefined
  const files = [...new Set(marks.flatMap(({ file }) => (file ? [file] : [])))].sort()
  return hash([...marks.map(({ what }) => what).sort(), ...files.map((file) => `${file}\t${blob(file)}`)].join('\n'))
}

/** The records' first lines, as the guard prints them to be copied and as it reads them back. */
export const secondReview = (code: string, verdict: 'sound' | 'weakening'): string => `**Second review ${code}: ${verdict}**`
export const approval = (code: string): string => `**Owner's approval ${code}:**`
export const coordinatorApproval = (code: string): string => `**Coordinator's approval ${code}:**`
const SECOND_REVIEW = /^\*\*Second review ([0-9a-f]{8}): (sound|weakening)\*\*/
/** With a reason after it: an approval without one isn't a record, nor is the line as the guard prints it, with `…` where the reason goes. */
const APPROVAL = /^\*\*Owner's approval ([0-9a-f]{8}):\*\*\s*(?!…\s*$)\S/
const COORDINATOR_APPROVAL = /^\*\*Coordinator's approval ([0-9a-f]{8}):\*\*\s*(?!…\s*$)\S/

/**
 * Whose comments can be records: those the owner let into the repository, the organization's
 * members and the collaborators invited to it. Not an outside contributor's or a bot's: the
 * repository is public, and anyone can comment. A collaborator counts because GitHub answers by
 * who asks: a member whose membership is private is a collaborator to the workflow's token.
 */
const LET_IN = ['OWNER', 'MEMBER', 'COLLABORATOR']
export const counts = ({ association }: Comment): boolean => LET_IN.includes(association)

/**
 * Where the list with this code stands. The owner's list is closed by the owner's approval, the
 * coordinator's by the coordinator's approval or the owner's: the owner is a coordinator too. The
 * second review's is closed by its `sound`; after its `weakening`, by the owner's approval of the
 * same code, which doesn't count without that verdict: the owner isn't asked to judge rewritten
 * assertions in the second review's place. A weakening found isn't cleared by another second
 * review of the same code that finds it sound, only by a fix, which changes the code: reviewing
 * the same files again isn't a way past the first verdict.
 */
export function standing(needs: Needs, code: string, comments: Comment[]): State {
  const lines = comments.filter(counts).map(({ body }) => body.trimStart().split('\n')[0])
  const approved = lines.some((line) => APPROVAL.exec(line)?.[1] === code)
  if (needs === 'owner') return approved ? 'approved' : 'none'
  if (needs === 'coordinator') return approved || lines.some((line) => COORDINATOR_APPROVAL.exec(line)?.[1] === code) ? 'approved' : 'none'
  const verdicts = lines.map((line) => SECOND_REVIEW.exec(line)).flatMap((record) => (record?.[1] === code ? [record[2]] : []))
  if (verdicts.includes('weakening')) return approved ? 'approved' : 'weakening'
  return verdicts.includes('sound') ? 'sound' : 'none'
}

/** Whether a list that stands so lets the PR through. */
export const closed = (state: State): boolean => state === 'sound' || state === 'approved'

/**
 * What the report says under a list: the record to post, with its code, to be copied rather than
 * composed, and where the list stands. `state` is missing when the PR's records weren't read.
 */
export function says(needs: Needs, code: string, state: State | undefined): string {
  const reason = `\`${approval(code)} …\`, the owner's reason, in English`
  const posted = state === 'none' ? ' Not posted yet.' : ''
  if (needs === 'coordinator') {
    if (state === 'approved') return `The PR holds the coordinator's approval of \`${code}\`.`
    return `Record to post once the coordinator approves: \`${coordinatorApproval(code)} …\`, the coordinator's reason, in English.${posted}`
  }
  if (state === 'approved') return needs === 'owner' ? `The PR holds the owner's approval of \`${code}\`.` : `The second review of \`${code}\` found a weakening, and the PR holds the owner's approval of it.`
  if (needs === 'owner') return `Record to post once the owner approves: ${reason}.${posted}`
  if (state === 'sound') return `The PR holds a second review of \`${code}\`: sound.`
  if (state === 'weakening') return `The second review of \`${code}\` found a weakening. It needs a fix, and a second review of what the fix makes of it, or ${reason}.`
  return `Record to post after the second review (\`/second-review\`): \`${secondReview(code, 'sound')}\` or \`${secondReview(code, 'weakening')}\`.${posted}`
}

/** The comments in what the workflow hands over, one JSON object a line; a line that isn't one is no comment. */
export function commentsIn(text: string): Comment[] {
  return text.split('\n').flatMap((line): Comment[] => {
    let comment: Partial<Comment> | null = null
    try {
      comment = JSON.parse(line)
    } catch {
      // Not JSON: no comment.
    }
    return typeof comment?.association === 'string' && typeof comment.body === 'string' ? [{ association: comment.association, body: comment.body }] : []
  })
}
