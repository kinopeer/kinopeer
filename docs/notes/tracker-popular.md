# Popular on your trackers (design note, 0.7)

A row on the Search screen with titles that are popular **and already out in 4K** on the user's own
trackers, in place of (or above) TMDB's trending rows, which are mostly titles not on trackers yet.
It is built only from the user's Prowlarr. Kinopeer never bypasses Cloudflare or site protection:
if Kinozal is reachable, it is because the user's Prowlarr (with FlareSolverr) reaches it.

Status: research, no code. Findings come from Prowlarr's source (`develop`) and the Prowlarr/Indexers
definitions (`definitions/v11`) as of 2026-10-28; check them on a real Prowlarr with the checklist below.

## What Prowlarr can give us

- **No "popular" or "top" anywhere.** Torznab/Newznab have no sort or popularity mode, and Prowlarr's
  request (`NewznabRequest`) has no sort parameter. `/api/v1/search` takes only `query`, `type`,
  `indexerIds`, `categories`, `limit` and `offset` (`SearchResource`); `minage`/`maxage` exist in
  Torznab but not in this endpoint. Kinozal's own top page (`top.php`) is not exposed by its definition.
- **An empty query is an RSS search.** `IsRssSearch` is true when the search term is blank; Prowlarr
  then skips its title filter and returns what each indexer shows without keywords:
  - **Kinozal** (Cardigann): `browse.php` with `c=0` (the definition hardcodes all categories), so the
    newest ~50 torrents of every kind, in the order of the indexer's own "Sort requested from site"
    setting (default: created, desc). No paging.
  - **RuTracker** (C#, `RuTracker.cs`): `tracker.php?nm=`, the newest torrents; categories are
    passed to the site as forums (`f=`), so `categories=2045` (Movies/UHD) gives the newest UHD movies
    server-side. One page, no paging.
  - **Rutor** (Cardigann): the site's home page, which lists the top torrents of the last 24 hours
    by section (to confirm with the checklist). The closest thing to "popular" we get. Rutor maps everything to Other (8000).
- **A keyword works as a quality filter.** Russian trackers put the resolution in the title
  ("… / WEB-DL (2160p) / HDR10"), so `query=2160p` returns the newest ~50 4K releases on Kinozal,
  RuTracker and Rutor alike (the site searches titles; Cardigann indexers also drop results
  without the term). We still check the resolution with `parseRelease()`.
- **Categories exclude indexers.** With `categories`, Prowlarr queries only indexers whose caps
  contain that exact id (`SupportedCategories`): `2045` drops Kinozal (it maps only to 2000) and
  `2000` drops Rutor (8000 only). So, as in our release search, the job sends **no categories** and
  filters locally.
- **Limits are Prowlarr's, and silent.** Each indexer has a rate limit (2 s between requests by
  default, `requestDelay` in Cardigann) and optional user-set Query/Grab limits. At the query limit
  Prowlarr returns an empty list, not an error (`IndexerLimitService.AtQueryLimit`). Failing indexers
  are disabled for a back-off period (`/api/v1/indexerstatus` shows `disabledTill`). Searching does
  not use Kinozal's daily download quota; only grabs do.

So "popular" has to be our own ranking over a recent pool: about 50 newest 4K releases per indexer
per query, ranked by seeders, plus Rutor's real 24-hour top.

## Data flow

1. **Server job**, every 3 hours (decision 5), started by `startJobs()`
   only when Prowlarr is configured, the first run on the first request to the row.
2. `GET /api/v1/indexer`, keep enabled torrent indexers; skip ones `indexerstatus` disables.
3. **One indexer at a time** (`indexerIds=<id>`, not one fan-out), so a slow FlareSolverr indexer
   or a failure affects only itself: `query=2160p` and an empty query, no categories, `limit=100`.
   Two requests per indexer per run; no retries.
4. `toRelease()` (existing) → `parseRelease()` → keep `2160p`; drop releases whose categories say
   neither movies nor TV (when there are any) and those with fewer than 5 seeders.
5. **Match to TMDB** with the existing guessing: `parseName()` → TMDB search through the server's
   key → `pickBest()`. Each release name is looked up once (cached by name with `GUESS_VERSION`), at
   most ~40 new lookups per run. No confident match → the release is left out.
6. **Rank** in a rolling window: keep releases seen in the last 14 days by guid, with their latest
   seeders. A title's score is the sum of its releases' seeders, each halved per 7 days of age
   (`publishDate`); a title on several trackers adds up. Top 20 movies and top 20 series (decision 1).
7. **Store** `{ updatedAt, releases, titles }` in `$KINOPEER_DATA_DIR/popular.json` through
   `server/jsonFile.ts`. `GET /api/popular` returns `{ updatedAt, movies: [{ id, score, trackers }],
   tv: [...] }`, ids only; the browser fetches names and posters through `/tmdb` in its own
   language, as the other rows do. A card opens the title page; "Find releases" works as today.

Code to move first: `pickBest` lives in `titleMatches.ts` next to React hooks, and server code must
import `.ts` paths without DOM or React. `parseRelease.ts` and `parseName.ts` are already pure.

## Without the server

The row is an extra the app works without (CLAUDE.md, "runnable without its server"). Without
Kinopeer's server there is no Prowlarr access at all, so there is nothing to fall back to: when
`/api/popular` is missing, returns nothing yet or Prowlarr isn't set up, Search shows the TMDB rows
as today. Building the row in the browser on every Search visit was rejected: it would hit every
indexer per visit instead of a few times a day.

## Risks

- **It isn't Kinozal's top.** The pool is the newest uploads, so a film that came out in 4K a month
  ago and is still heavily seeded drops out once it leaves the window. Rutor's home page and the
  14-day window soften this; the checklist measures how many days ~50 releases actually cover.
- **Load on trackers.** 2 requests × N indexers × 8 runs a day, sequential, through Prowlarr's rate
  limits: less than one person browsing. Each run shows in Prowlarr's History, and counts toward a
  user-set Query Limit, which then silently empties the user's own searches. Settings should say so.
- **FlareSolverr is slow** (tens of seconds per Kinozal request). Fine for a background job; the
  job needs a generous timeout and must never block a user search.
- **Wrong matches.** Guessing from release names misses sometimes; a wrong card costs one tap.
  Matches are kept apart from torrent matches (`matches.json`), so they never touch Downloads.
- **Indexer settings change results.** Kinozal's "Sort requested from site" decides which ~50
  releases come back; "Strip Cyrillic Letters" (default on) helps TMDB matching.

## Decisions

Settled without Alfred on 2026-10-28 so the work could go on; each is a default, change any you
disagree with.

1. **Movies and series, as two rows.** Decision (default, change if you disagree): "4K movies on
   your trackers" first, "4K series on your trackers" under it; a row with fewer than 5 titles is
   hidden, since 4K series packs are rarer.
2. **Above the TMDB rows, not instead of them.** Decision (default, change if you disagree): the
   tracker rows open the Search screen; "Trending this week" and the popular rows stay below for
   discovery and are all that shows without Prowlarr.
3. **All enabled torrent indexers, no setting.** Decision (default, change if you disagree):
   Prowlarr's own Enable switch already picks the indexers; a per-indexer choice in Settings can come
   later if a noisy indexer spoils the row.
4. **4K only, no 1080p fallback.** Decision (default, change if you disagree): the row exists to
   show what is out in good quality; a 1080p fallback would bring back the titles it is meant to
   filter out.
5. **Every 3 hours, a 14-day window.** Decision (default, change if you disagree): seeders change
   slowly and Kinozal goes through FlareSolverr, so hourly would add load for little gain; 14 days
   keeps a title on the row about as long as it stays in a tracker's top.
6. **No TMDB "out digitally" row in this feature.** Decision (default, change if you disagree): it
   is cheap and works without Prowlarr, but it answers a different question ("released", not "out
   in 4K"); it goes to Ideas in GitHub Discussions as its own proposal.

## Checklist to run on your Prowlarr

Set `P` to Prowlarr's address and `K` to its API key (Settings → General); don't paste the key
anywhere. Note the ids of Kinozal, RuTracker and Rutor from the first command.

```sh
P=http://<umbrel-address>:<prowlarr-port>; K=<api-key>
curl -s -H "X-Api-Key: $K" "$P/api/v1/indexer" | jq '.[] | {id, name, enable, protocol}'
curl -s -H "X-Api-Key: $K" "$P/api/v1/indexerstatus" | jq
# Empty query (RSS) for one indexer: how many, how old, how many 2160p, seeders
time curl -s -H "X-Api-Key: $K" "$P/api/v1/search?type=search&indexerIds=<ID>&limit=100" \
  | jq '{n: length, k4: [.[] | select(.title | test("2160p"))] | length,
         oldest: (map(.publishDate) | min), top: (sort_by(-.seeders) | .[:5] | map({title, seeders}))}'
# The same with the keyword
time curl -s -H "X-Api-Key: $K" "$P/api/v1/search?type=search&query=2160p&indexerIds=<ID>&limit=100" \
  | jq '{n: length, oldest: (map(.publishDate) | min), top: (sort_by(-.seeders) | .[:5] | map({title, seeders}))}'
# RuTracker only: UHD movies by category
curl -s -H "X-Api-Key: $K" "$P/api/v1/search?type=search&categories=2045&indexerIds=<RUTRACKER_ID>&limit=100" \
  | jq '{n: length, oldest: (map(.publishDate) | min)}'
```

Worth sending back: `n`, `k4` and `oldest` per indexer and query (how many days the pool covers),
whether the top titles look like what Kinozal's 4K top shows, how long each request took, and
Kinozal's "Sort requested from site" value.
