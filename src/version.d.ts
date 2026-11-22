/** Kinopeer's version from package.json, set at build time in vite.config.ts. */
declare const __APP_VERSION__: string

/**
 * Whether this is the WebUI build, which qBittorrent serves as its Alternative WebUI with no Kinopeer
 * server (`vite build --mode webui`), set at build time in vite.config.ts. Read it inside a function,
 * not as a module loads: tests stub it per test (`vi.stubGlobal`), and in a build it's a constant
 * that drops the other build's code.
 */
declare const __WEBUI__: boolean
