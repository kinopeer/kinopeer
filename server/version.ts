// The image copies package.json next to server/ (Dockerfile), so the import finds it there too.
import pkg from '../package.json' with { type: 'json' }

/**
 * Kinopeer's version as package.json has it. Edge builds' commit isn't in it: their calls go to the
 * TMDB proxy's edge worker by default, which tells them apart, unless TMDB_PROXY_URL names another.
 */
export const VERSION: string = pkg.version
