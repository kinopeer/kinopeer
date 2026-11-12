// Reads the paired timing trial's JSON lines (e2e/timing-trial/paired.trial.ts) and prints Markdown.
//
//   node scripts/timing-trial/paired.mjs --job-summary <file.jsonl>
//     one job's arm medians and ratios, for the job's summary in CI;
//   node scripts/timing-trial/paired.mjs --report <dir> [--rounds <n>] [--ratios <out.json>]
//     the report over every job in <dir> (*.jsonl, read recursively), a job being one `job` value:
//     per job, metric, screen and size, each arm's median over its rounds (the first <n> when given)
//     against the base's, as a ratio and as a difference in ms.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SCREEN_METRICS = [
  ['fcp', 'First contentful paint'],
  ['lcp', 'Largest contentful paint'],
  ['loaded', 'Loaded content shows'],
  ['tbt', 'Total blocking time'],
  ['script', 'CDP ScriptDuration'],
  ['layout', 'CDP LayoutDuration'],
  ['style', 'CDP RecalcStyleDuration'],
  ['task', 'CDP TaskDuration'],
]
const MOVE_METRICS = [['nextPaint', 'Input to next paint']]
const SIZES = ['phone', 'desktop']
const ARMS = ['base', 'head', 'head+30', 'head+100']

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
const fixed = (value, digits) => (value === null || Number.isNaN(value) ? 'n/a' : value.toFixed(digits))
const ratio = (value) => fixed(value, 3)
const ms = (value) => fixed(value, 1)

function readLines(path) {
  const files = statSync(path).isDirectory()
    ? readdirSync(path, { recursive: true }).filter((name) => String(name).endsWith('.jsonl')).map((name) => join(path, String(name)))
    : [path]
  return files.flatMap((file) =>
    readFileSync(file, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line)),
  )
}

/**
 * { job → { kind|size|name|metric → { arm → median } } } over rounds 1..`rounds` (all when not given);
 * round 0, the warm-up, and failed loads are left out.
 */
function armMedians(records, rounds) {
  const values = new Map()
  for (const record of records) {
    if ((record.kind !== 'screen' && record.kind !== 'move') || record.error || record.round === 0) continue
    if (rounds && record.round > rounds) continue
    const metrics = record.kind === 'screen' ? SCREEN_METRICS : MOVE_METRICS
    for (const [metric] of metrics) {
      if (typeof record[metric] !== 'number') continue
      const key = [record.job, record.kind, record.size, record.name, metric, record.arm].join('|')
      if (!values.has(key)) values.set(key, [])
      values.get(key).push(record[metric])
    }
  }
  const jobs = new Map()
  for (const [key, list] of values) {
    const [job, kind, size, name, metric, arm] = key.split('|')
    if (!jobs.has(job)) jobs.set(job, new Map())
    const item = [kind, size, name, metric].join('|')
    if (!jobs.get(job).has(item)) jobs.get(job).set(item, {})
    jobs.get(job).get(item)[arm] = median(list)
  }
  return jobs
}

/** Per job and item, each arm against the base: the ratio of medians (NaN when the base's is 0) and the difference. */
function versusBase(jobs) {
  const out = new Map()
  for (const [job, items] of jobs) {
    const compared = new Map()
    for (const [item, arms] of items) {
      if (!ARMS.every((arm) => arm in arms)) continue
      const entry = {}
      for (const arm of ARMS.slice(1)) {
        entry[arm] = { ratio: arms.base === 0 ? NaN : arms[arm] / arms.base, diff: arms[arm] - arms.base }
      }
      entry.base = arms.base
      compared.set(item, entry)
    }
    out.set(job, compared)
  }
  return out
}

const CLASSES = ["a check 'no more than a fifth slower' is workable", "only a wide check, 'no more than twice as slow'", 'no check']
const classOf = (spread) => (spread <= 0.1 ? 0 : spread <= 0.3 ? 1 : 2)

/**
 * For one metric and size, per screen (or move): the `head` value over the jobs (ratio or difference),
 * its median, range and spread, and whether `head+30` and `head+100` stand clear of every `head`
 * value (their lowest above its highest) with the gap.
 */
function readingOf(compared, kind, size, names, metric, field) {
  const rows = names
    .map((name) => {
      const item = [kind, size, name, metric].join('|')
      const per = [...compared.values()].map((items) => items.get(item)).filter(Boolean)
      if (per.length === 0) return null
      const head = per.map((entry) => entry.head[field])
      if (head.some(Number.isNaN)) return { name, undefined: true, jobs: per.length }
      const plus30 = per.map((entry) => entry['head+30'][field])
      const plus100 = per.map((entry) => entry['head+100'][field])
      const high = Math.max(...head)
      const low = Math.min(...head)
      return {
        name,
        jobs: per.length,
        median: median(head),
        low,
        high,
        spread: high - low,
        gap30: Math.min(...plus30) - high,
        gap100: Math.min(...plus100) - high,
        plus30Median: median(plus30),
        plus100Median: median(plus100),
      }
    })
    .filter(Boolean)
  const defined = rows.filter((row) => !row.undefined)
  if (defined.length === 0) return { undefined: rows.length > 0 }
  const bySpread = [...defined].sort((a, b) => a.spread - b.spread)
  const smallest = (field) => defined.reduce((low, row) => (row[field] < low[field] ? row : low))
  return {
    rows: defined,
    undefinedNames: rows.filter((row) => row.undefined).map((row) => row.name),
    typical: bySpread[(bySpread.length - 1) >> 1],
    worst: bySpread.at(-1),
    clear30: defined.every((row) => row.gap30 > 0),
    clear100: defined.every((row) => row.gap100 > 0),
    gap30: smallest('gap30'),
    gap100: smallest('gap100'),
    jobs: Math.min(...defined.map((row) => row.jobs)),
  }
}

function report(dir, rounds, ratiosOut) {
  const records = readLines(dir)
  const metas = records.filter((record) => record.kind === 'meta')
  const errors = records.filter((record) => record.error)
  const compared = versusBase(armMedians(records, rounds))
  const names = (kind) => [...new Set(records.filter((record) => record.kind === kind).map((record) => record.name))]
  const out = []
  const roundsRun = [...new Set(metas.map((meta) => meta.rounds))]
  out.push(`Jobs: ${metas.length}; rounds per job: ${roundsRun.join(', ')}${rounds ? `, read: the first ${rounds}` : ', read: all'}. Failed loads: ${errors.length}.`, '')

  const classes = []
  for (const [kind, metrics] of [['screen', SCREEN_METRICS], ['move', MOVE_METRICS]]) {
    const list = names(kind)
    for (const [metric, title] of metrics) {
      out.push(`#### ${title}`, '')
      out.push(
        '| Size | `head`/`base` over the jobs, typical screen: median [range] | Worst screen: median [range] | Spread on the worst screen | `head+100` clear (smallest gap) | `head+30` clear (smallest gap) | `head`−`base`, ms, worst screen: median [range], spread | `head+100` clear in ms (gap) | `head+30` clear in ms (gap) | Class |',
        '|---|---|---|---:|---|---|---|---|---|---|',
      )
      for (const size of SIZES) {
        const r = readingOf(compared, kind, size, list, metric, 'ratio')
        const d = readingOf(compared, kind, size, list, metric, 'diff')
        if (!d.rows) continue
        let klass = null
        let ratioCells = ['n/a (the base is 0 ms)', '', '', '', '']
        if (r.rows) {
          klass = classOf(r.worst.spread)
          if (!r.clear100) klass = Math.min(2, klass + 1)
          ratioCells = [
            `${ratio(r.typical.median)} [${ratio(r.typical.low)}–${ratio(r.typical.high)}] (${r.typical.name})`,
            `${ratio(r.worst.median)} [${ratio(r.worst.low)}–${ratio(r.worst.high)}] (${r.worst.name})`,
            ratio(r.worst.spread),
            `${r.clear100 ? 'yes' : '**no**'}, ${ratio(r.gap100.gap100)} (${r.gap100.name})`,
            `${r.clear30 ? 'yes' : '**no**'}, ${ratio(r.gap30.gap30)} (${r.gap30.name})`,
          ]
          if (r.undefinedNames.length) ratioCells[1] += `; n/a for ${r.undefinedNames.join(', ')} (the base is 0)`
        }
        classes.push({ metric, size, klass, spread: r.rows ? r.worst.spread : null, worst: r.rows ? r.worst.name : null, clear30: r.rows ? r.clear30 : null, clear100: r.rows ? r.clear100 : null, d })
        out.push(
          `| ${size} | ${ratioCells.join(' | ')} | ${ms(d.worst.median)} [${ms(d.worst.low)}–${ms(d.worst.high)}] (${d.worst.name}), ${ms(d.worst.spread)} | ${d.clear100 ? 'yes' : '**no**'}, ${ms(d.gap100.gap100)} (${d.gap100.name}) | ${d.clear30 ? 'yes' : '**no**'}, ${ms(d.gap30.gap30)} (${d.gap30.name}) | ${klass === null ? 'n/a' : CLASSES[klass]} |`,
        )
      }
      out.push('')
    }
  }

  if (ratiosOut) {
    const dump = {}
    for (const [job, items] of compared) dump[job] = Object.fromEntries(items)
    writeFileSync(ratiosOut, `${JSON.stringify(dump, null, 1)}\n`)
  }
  return { markdown: out.join('\n'), classes, metas }
}

function jobSummary(file) {
  const records = readLines(file)
  const meta = records.find((record) => record.kind === 'meta')
  const compared = versusBase(armMedians(records))
  const [[, items] = []] = compared
  const out = []
  if (meta) out.push(`**${meta.cpu}**, ${meta.cores} cores, Chromium ${meta.browser}, ${meta.rounds} rounds, image ${meta.imageVersion ?? '?'}`, '')
  out.push(`Failed loads: ${records.filter((record) => record.error).length}`, '')
  if (!items) return out.join('\n')
  for (const size of SIZES) {
    out.push(`### ${size}: base median, and each arm's median ÷ the base's`, '')
    out.push('| Screen | metric | base, ms | head | head+30 | head+100 |', '|---|---|---:|---:|---:|---:|')
    for (const [item, entry] of items) {
      const [, itemSize, name, metric] = item.split('|')
      if (itemSize !== size || !['loaded', 'task', 'nextPaint'].includes(metric)) continue
      out.push(`| ${name} | ${metric} | ${ms(entry.base)} | ${ratio(entry.head.ratio)} | ${ratio(entry['head+30'].ratio)} | ${ratio(entry['head+100'].ratio)} |`)
    }
    out.push('')
  }
  return out.join('\n')
}

const args = process.argv.slice(2)
const option = (name) => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}
if (args[0] === '--job-summary') {
  console.log(jobSummary(args[1]))
} else if (args[0] === '--report') {
  const rounds = option('--rounds') ? Number(option('--rounds')) : undefined
  const { markdown, classes } = report(args[1], rounds, option('--ratios'))
  console.log(markdown)
  console.log('#### Classes', '')
  console.log('| Metric | Size | Class | Spread of `head`/`base` (worst screen) | `head+100` clear | `head+30` clear |', '|---|---|---|---:|---|---|')
  for (const entry of classes) {
    console.log(`| ${entry.metric} | ${entry.size} | ${entry.klass === null ? 'n/a: the base is 0 ms, so no ratio' : CLASSES[entry.klass]} | ${entry.spread === null ? 'n/a' : `${ratio(entry.spread)} (${entry.worst})`} | ${entry.clear100 === null ? `in ms: ${entry.d.clear100 ? 'yes' : 'no'}` : entry.clear100 ? 'yes' : 'no'} | ${entry.clear30 === null ? `in ms: ${entry.d.clear30 ? 'yes' : 'no'}` : entry.clear30 ? 'yes' : 'no'} |`)
  }
} else {
  console.error('Usage: paired.mjs --job-summary <file.jsonl> | --report <dir> [--rounds <n>] [--ratios <out.json>]')
  process.exit(1)
}
