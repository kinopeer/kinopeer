import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

/**
 * A JSON object kept in a file in the data directory, readable only by the server. Loaded once and
 * then served from memory; every change is written atomically, one at a time, so a crash never
 * leaves half a file and two changes at once never lose one another.
 */
export class JsonFile<T extends object> {
  private readonly path: string
  private readonly dir: string
  private cache: T | undefined
  private writing: Promise<unknown> = Promise.resolve()

  constructor(dir: string, name: string) {
    this.dir = dir
    this.path = join(dir, name)
  }

  /** Reads the file once; a missing or broken file is an empty object. */
  async load(): Promise<T> {
    if (this.cache) return this.cache
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      this.cache = (parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}) as T
    } catch {
      this.cache = {} as T
    }
    return this.cache
  }

  /** The last loaded contents, for code that can't wait. */
  get current(): T {
    return this.cache ?? ({} as T)
  }

  /** Writes what `change` makes of the current contents, after any change still being written. */
  change(change: (current: T) => T): Promise<T> {
    const run = this.writing.then(async () => {
      const next = change(await this.load())
      await mkdir(this.dir, { recursive: true })
      const temporary = `${this.path}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, this.path)
      this.cache = next
      return next
    })
    this.writing = run.catch(() => {})
    return run
  }
}
