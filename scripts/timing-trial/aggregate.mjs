// Reads the timing trial's JSON lines (e2e/timing-trial/timings.trial.ts) and prints Markdown.
//
//   node scripts/timing-trial/aggregate.mjs --job-summary <file.jsonl>
//     one job's medians per screen, for the job's summary in CI;
//   node scripts/timing-trial/aggregate.mjs --report --ci <dir> --local <dir> [--medians <out.json>]
//     the trial's report: each folder's *.jsonl read recursively, a job being one `job` value, a
//     check's number being one job's median over its repeats.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const SCREEN_METRICS = [
  ['fcp', 'First contentful paint, ms'],
  ['lcp', 'Largest contentful paint, ms'],
  ['loaded', 'Loaded content shows, ms from navigation start'],
  ['tbt', 'Total blocking time, ms (long tasks from navigation start)'],
  ['script', 'CDP ScriptDuration, ms'],
  ['layout', 'CDP LayoutDuration, ms'],
  ['style', 'CDP RecalcStyleDuration, ms'],
  ['task', 'CDP TaskDuration, ms'],
]
const MOVE_METRICS = [['nextPaint', 'Input to next paint, ms']]
const REGIMES = ['clean', 'cpu4x', 'planted']
const SIZES = ['phone', 'desktop']

const median = (values) => {
  const sorted = [...values].sort((a, b) => a - b)
  const middle = sorted.length >> 1
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
/** (highest − lowest) / median; 0 when every value is the same, Infinity when the median is 0 but they differ. */
const spread = (values) => {
  const high = Math.max(...values)
  const low = Math.min(...values)
  if (high === low) return 0
  const middle = median(values)
  return middle === 0 ? Infinity : (high - low) / middle
}
const pct = (value) => (value === Infinity ? '∞' : `${(value * 100).toFixed(1)}%`)
const num = (value) => (value === null || value === undefined ? '–' : value >= 100 ? value.toFixed(0) : value.toFixed(1))

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

/** { job → { key → [values over repeats] } }, key = kind|size|regime|name|metric. */
function byJob(records) {
  const jobs = new Map()
  for (const record of records) {
    if (record.kind !== 'screen' && record.kind !== 'move') continue
    if (record.error) continue
    const metrics = record.kind === 'screen' ? SCREEN_METRICS : MOVE_METRICS
    if (!jobs.has(record.job)) jobs.set(record.job, new Map())
    const keyed = jobs.get(record.job)
    for (const [metric] of metrics) {
      const value = record[metric]
      if (typeof value !== 'number') continue
      const key = [record.kind, record.size, record.regime, record.name, metric].join('|')
      if (!keyed.has(key)) keyed.set(key, [])
      keyed.get(key).push(value)
    }
  }
  return jobs
}

const namesOf = (records, kind) => [...new Set(records.filter((record) => record.kind === kind).map((record) => record.name))]

function jobSummary(file) {
  const records = readLines(file)
  const errors = records.filter((record) => record.error)
  const jobs = byJob(records)
  const [[, keyed] = []] = jobs
  const out = []
  const meta = records.find((record) => record.kind === 'meta')
  if (meta) out.push(`**${meta.cpu}**, ${meta.cores} cores, ${meta.memoryGb} GB, Chromium ${meta.browser}, ${meta.repeats} repeats, image ${meta.imageVersion ?? '?'}`, '')
  out.push(`Errors: ${errors.length}`, '')
  if (!keyed) return out.join('\n')
  for (const size of SIZES) {
    for (const regime of REGIMES) {
      out.push(`### ${size}, ${regime}: medians over repeats`, '')
      out.push(`| Screen | ${SCREEN_METRICS.map(([metric]) => metric).join(' | ')} |`, `|---|${SCREEN_METRICS.map(() => '---:').join('|')}|`)
      for (const screen of namesOf(records, 'screen')) {
        const cells = SCREEN_METRICS.map(([metric]) => {
          const values = keyed.get(['screen', size, regime, screen, metric].join('|'))
          return values ? num(median(values)) : '–'
        })
        out.push(`| ${screen} | ${cells.join(' | ')} |`)
      }
      const moves = namesOf(records, 'move').map((move) => {
        const values = keyed.get(['move', size, regime, move, 'nextPaint'].join('|'))
        return `${move} ${values ? num(median(values)) : '–'}`
      })
      out.push('', `Input to next paint, ms: ${moves.join(', ')}`, '')
    }
  }
  return out.join('\n')
}

/** Per job, the median over its repeats; and the within-job spread over those repeats. */
function perJob(jobs) {
  const medians = new Map()
  const within = new Map()
  for (const [job, keyed] of jobs) {
    for (const [key, values] of keyed) {
      if (!medians.has(key)) {
        medians.set(key, new Map())
        within.set(key, new Map())
      }
      medians.get(key).set(job, median(values))
      within.get(key).set(job, spread(values))
    }
  }
  return { medians, within }
}

/**
 * For one metric, regime and size: per screen, the median of the jobs' medians, the spread between
 * jobs, and the spread inside a job (the typical and the worst job); pooled over screens as the
 * median screen and the worst one, named.
 */
function pooled(set, kind, size, regime, names, metric) {
  const rows = names
    .map((name) => {
      const key = [kind, size, regime, name, metric].join('|')
      const medians = set.medians.get(key)
      if (!medians || medians.size === 0) return null
      const jobMedians = [...medians.values()]
      const within = [...set.within.get(key).values()]
      return { name, center: median(jobMedians), between: spread(jobMedians), withinTypical: median(within), withinWorst: Math.max(...within), jobs: jobMedians.length }
    })
    .filter(Boolean)
  if (rows.length === 0) return null
  const worst = (field) => rows.reduce((top, row) => (row[field] > top[field] ? row : top))
  return {
    rows,
    center: median(rows.map((row) => row.center)),
    centerRange: [Math.min(...rows.map((row) => row.center)), Math.max(...rows.map((row) => row.center))],
    betweenTypical: median(rows.map((row) => row.between)),
    betweenWorst: worst('between'),
    withinTypical: median(rows.map((row) => row.withinTypical)),
    withinWorst: worst('withinWorst'),
    jobs: Math.min(...rows.map((row) => row.jobs)),
  }
}

/** Whether every planted job median is above every clean one, per screen; the smallest gap, named. */
function plantedClear(set, kind, size, names, metric) {
  const gaps = names
    .map((name) => {
      const clean = set.medians.get([kind, size, 'clean', name, metric].join('|'))
      const planted = set.medians.get([kind, size, 'planted', name, metric].join('|'))
      if (!clean || !planted) return null
      return { name, gap: Math.min(...planted.values()) - Math.max(...clean.values()) }
    })
    .filter(Boolean)
  if (gaps.length === 0) return null
  const smallest = gaps.reduce((low, entry) => (entry.gap < low.gap ? entry : low))
  return { clear: gaps.every((entry) => entry.gap > 0), smallest, failing: gaps.filter((entry) => entry.gap <= 0).map((entry) => entry.name) }
}

const CLASSES = ['a threshold is workable', 'only a wide threshold', 'no threshold']
const classOf = (between) => (between <= 0.1 ? 0 : between <= 0.3 ? 1 : 2)

function report(ciDir, localDir, mediansOut) {
  const ciRecords = readLines(ciDir)
  const localRecords = localDir ? readLines(localDir) : []
  const ci = perJob(byJob(ciRecords))
  const local = perJob(byJob(localRecords))
  const screens = namesOf(ciRecords, 'screen')
  const moves = namesOf(ciRecords, 'move')
  const out = []

  const metaOf = (records) => records.filter((record) => record.kind === 'meta')
  const ciMeta = metaOf(ciRecords)
  const errors = (records) => records.filter((record) => record.error)
  out.push(`CI jobs: ${ciMeta.length}; local runs: ${metaOf(localRecords).length}. Failed loads: CI ${errors(ciRecords).length}, local ${errors(localRecords).length}.`, '')

  const classes = []
  const section = (kind, metrics, names) => {
    for (const [metric, title] of metrics) {
      out.push(`#### ${title}`, '')
      out.push(
        '| Regime | Size | Median of job medians (range over screens) | Between jobs: typical / worst screen | Inside a job: typical / worst | Local between runs: typical / worst | Local inside a run: typical / worst | Planted 100 ms clear of every clean job (smallest gap) | Class |',
        '|---|---|---|---|---|---|---|---|---|',
      )
      for (const regime of REGIMES) {
        for (const size of SIZES) {
          const c = pooled(ci, kind, size, regime, names, metric)
          if (!c) continue
          const l = pooled(local, kind, size, regime, names, metric)
          let klass = classOf(c.betweenWorst.between)
          let clearCell = 'n/a'
          if (regime === 'clean') {
            const clear = plantedClear(ci, kind, size, names, metric)
            const localClear = plantedClear(local, kind, size, names, metric)
            if (clear) {
              clearCell = `${clear.clear ? 'yes' : `**no** (${clear.failing.join(', ')})`}, ${num(clear.smallest.gap)} ms (${clear.smallest.name})`
              if (localClear) clearCell += `; local ${localClear.clear ? 'yes' : 'no'}, ${num(localClear.smallest.gap)} ms`
              if (!clear.clear) klass = Math.min(2, klass + 1)
            }
          }
          classes.push({ kind, metric, regime, size, klass, between: c.betweenWorst.between, worst: c.betweenWorst.name })
          out.push(
            `| ${regime} | ${size} | ${num(c.center)} (${num(c.centerRange[0])}–${num(c.centerRange[1])}) | ${pct(c.betweenTypical)} / ${pct(c.betweenWorst.between)} (${c.betweenWorst.name}) | ${pct(c.withinTypical)} / ${pct(c.withinWorst.withinWorst)} (${c.withinWorst.name}) | ${l ? `${pct(l.betweenTypical)} / ${pct(l.betweenWorst.between)} (${l.betweenWorst.name})` : '–'} | ${l ? `${pct(l.withinTypical)} / ${pct(l.withinWorst.withinWorst)} (${l.withinWorst.name})` : '–'} | ${clearCell} | ${CLASSES[klass]} |`,
          )
        }
      }
      out.push('')
    }
  }
  out.push('### Screens', '')
  section('screen', SCREEN_METRICS, screens)
  out.push('### Moves', '')
  section('move', MOVE_METRICS, moves)

  // Layout shift: whether every run of each screen, size and regime gave the same number.
  out.push('### Layout shift', '')
  out.push('Exact is judged on CI and locally apart: the two platforms render fonts differently, so their numbers aren\'t expected to match each other.', '')
  out.push('| Screen | Size | Regime | CI: distinct values (runs) | Exact on CI | Local: distinct values (runs) | Exact locally |', '|---|---|---|---|---|---|---|')
  const shiftValues = (records, size, regime, screen) => {
    const counts = new Map()
    for (const record of records) {
      if (record.kind !== 'screen' || record.error || record.size !== size || record.regime !== regime || record.name !== screen) continue
      const value = record.cls.toFixed(6)
      counts.set(value, (counts.get(value) ?? 0) + 1)
    }
    return counts
  }
  const shown = (counts) => [...counts].sort((a, b) => b[1] - a[1]).map(([value, count]) => `${value} (${count})`).join(', ')
  const exactness = []
  for (const screen of screens) {
    for (const size of SIZES) {
      for (const regime of REGIMES) {
        const c = shiftValues(ciRecords, size, regime, screen)
        const l = shiftValues(localRecords, size, regime, screen)
        exactness.push({ screen, size, regime, ci: c.size === 1, local: l.size === 1 })
        const yes = (counts) => (counts.size === 0 ? '–' : counts.size === 1 ? 'yes' : '**no**')
        out.push(`| ${screen} | ${size} | ${regime} | ${shown(c)} | ${yes(c)} | ${shown(l) || '–'} | ${yes(l)} |`)
      }
    }
  }
  out.push('', `Exact on CI: ${exactness.filter((entry) => entry.ci).length} of ${exactness.length} screen, size and regime combinations; locally: ${exactness.filter((entry) => entry.local).length} of ${exactness.length}.`, '')

  // The jobs side by side: each one's clean loaded time relative to the median job, per screen.
  out.push('### The jobs', '')
  out.push('| Job | CPU | Image | Clean `loaded`, median over screens and sizes of job median ÷ median of job medians | Clean `task` likewise |', '|---|---|---|---:|---:|')
  const relative = (job, metric) => {
    const ratios = []
    for (const size of SIZES) {
      for (const screen of screens) {
        const medians = ci.medians.get(['screen', size, 'clean', screen, metric].join('|'))
        if (medians?.has(job)) ratios.push(medians.get(job) / median([...medians.values()]))
      }
    }
    return ratios.length ? median(ratios).toFixed(3) : '–'
  }
  for (const meta of ciMeta) out.push(`| ${meta.job} | ${meta.cpu} (${meta.cores}) | ${meta.imageVersion ?? '?'} | ${relative(meta.job, 'loaded')} | ${relative(meta.job, 'task')} |`)
  out.push('')

  // The same spread between jobs, but only among jobs whose runner had the same CPU model: how much
  // of the spread is the mix of runner hardware behind ubuntu-latest.
  const models = new Map()
  for (const meta of ciMeta) {
    if (!models.has(meta.cpu)) models.set(meta.cpu, [])
    models.get(meta.cpu).push(meta.job)
  }
  const grouped = [...models].filter(([, jobs]) => jobs.length >= 3).sort((a, b) => a[0].localeCompare(b[0]))
  out.push('### Between jobs on the same CPU model', '')
  out.push(`Clean regime (moves: clean too), the worst screen's spread between the job medians of jobs on one CPU model; models with three jobs or more. All jobs, for comparison, in the first column.`, '')
  out.push(`| Metric | Size | All ${ciMeta.length} jobs | ${grouped.map(([model, jobs]) => `${model.replace(/ Processor| \d+-Core/g, '')} (${jobs.length})`).join(' | ')} |`, `|---|---|---:|${grouped.map(() => '---:').join('|')}|`)
  const restricted = (jobs) => {
    const keep = new Set(jobs)
    const filter = (map) => new Map([...map].map(([key, byJob]) => [key, new Map([...byJob].filter(([job]) => keep.has(job)))]))
    return { medians: filter(ci.medians), within: filter(ci.within) }
  }
  for (const [kind, metrics, names] of [['screen', SCREEN_METRICS, screens], ['move', MOVE_METRICS, moves]]) {
    for (const [metric] of metrics) {
      for (const size of SIZES) {
        const all = pooled(ci, kind, size, 'clean', names, metric)
        const cells = grouped.map(([, jobs]) => {
          const p = pooled(restricted(jobs), kind, size, 'clean', names, metric)
          return p ? `${pct(p.betweenWorst.between)} (${p.betweenWorst.name})` : '–'
        })
        out.push(`| ${metric} | ${size} | ${all ? `${pct(all.betweenWorst.between)} (${all.betweenWorst.name})` : '–'} | ${cells.join(' | ')} |`)
      }
    }
  }
  out.push('')

  if (mediansOut) {
    const dump = {}
    for (const [label, set] of [['ci', ci], ['local', local]]) {
      dump[label] = {}
      for (const [key, jobs] of set.medians) dump[label][key] = Object.fromEntries(jobs)
    }
    writeFileSync(mediansOut, `${JSON.stringify(dump, null, 1)}\n`)
  }
  return { markdown: out.join('\n'), classes, exactness }
}

const args = process.argv.slice(2)
const option = (name) => {
  const at = args.indexOf(name)
  return at === -1 ? undefined : args[at + 1]
}
if (args[0] === '--job-summary') {
  console.log(jobSummary(args[1]))
} else if (args[0] === '--report') {
  const { markdown, classes } = report(option('--ci'), option('--local'), option('--medians'))
  console.log(markdown)
  console.log('### Classes', '')
  console.log('| Metric | Regime | phone | desktop |', '|---|---|---|---|')
  const metrics = [...new Set(classes.map((entry) => `${entry.kind}|${entry.metric}`))]
  for (const metric of metrics) {
    for (const regime of REGIMES) {
      const cell = (size) => {
        const entry = classes.find((c) => `${c.kind}|${c.metric}` === metric && c.regime === regime && c.size === size)
        return entry ? `${CLASSES[entry.klass]} (${pct(entry.between)}, ${entry.worst})` : '–'
      }
      console.log(`| ${metric.split('|')[1]} | ${regime} | ${cell('phone')} | ${cell('desktop')} |`)
    }
  }
} else {
  console.error('Usage: aggregate.mjs --job-summary <file.jsonl> | --report --ci <dir> --local <dir> [--medians <out.json>]')
  process.exit(1)
}
