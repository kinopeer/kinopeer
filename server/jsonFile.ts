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
  private readonly strict: boolean
  private cache: T | undefined
  private writing: Promise<unknown> = Promise.resolve()

  /**
   * `strict` is for a file whose loss would open something up (the login's): only a missing file is
   * empty, and one it can't read or parse rejects, as does every change, until a load succeeds.
   */
  constructor(dir: string, name: string, { strict = false }: { strict?: boolean } = {}) {
    this.dir = dir
    this.path = join(dir, name)
    this.strict = strict
  }

  /** Reads the file once; a missing file is an empty object, and so is a broken one unless strict. */
  async load(): Promise<T> {
    if (this.cache) return this.cache
    try {
      const parsed: unknown = JSON.parse(await readFile(this.path, 'utf8'))
      const object = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      if (!object && this.strict) throw new Error(`${this.path} is not a JSON object`)
      this.cache = (object ? parsed : {}) as T
    } catch (error) {
      if (this.strict && (error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      this.cache = {} as T
    }
    return this.cache
  }

  /** The last loaded contents, for code that can't wait. */
  get current(): T {
    return this.cache ?? ({} as T)
  }

  /**
   * Writes what `change` makes of the current contents, after any change still being written.
   * Returning the current object unchanged writes nothing.
   */
  change(change: (current: T) => T): Promise<T> {
    const run = this.writing.then(async () => {
      const current = await this.load()
      const next = change(current)
      if (next === current) return current
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
