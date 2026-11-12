CI jobs: 20; local runs: 10. Failed loads: CI 0, local 0.

### Screens

#### First contentful paint, ms

| Regime | Size | Median of job medians (range over screens) | Between jobs: typical / worst screen | Inside a job: typical / worst | Local between runs: typical / worst | Local inside a run: typical / worst | Planted 100 ms clear of every clean job (smallest gap) | Class |
|---|---|---|---|---|---|---|---|---|
| clean | phone | 144 (142–144) | 41.7% / 42.3% (search-year) | 8.2% / 240.0% (releases) | 11.8% / 17.6% (search-year) | 8.8% / 161.1% (series) | yes, 16.0 ms (downloads); local yes, 76.0 ms | no threshold |
| clean | desktop | 144 (142–144) | 41.7% / 44.4% (settings) | 7.5% / 56.7% (releases) | 11.8% / 17.6% (browse) | 5.9% / 73.7% (torrent) | yes, 16.0 ms (downloads); local yes, 76.0 ms | no threshold |
| cpu4x | phone | 338 (336–344) | 53.6% / 57.0% (search) | 9.0% / 181.8% (series) | 8.6% / 16.7% (downloads) | 8.5% / 60.0% (releases) | n/a | no threshold |
| cpu4x | desktop | 340 (336–346) | 50.9% / 53.8% (series) | 7.0% / 38.8% (search) | 5.6% / 13.9% (downloads) | 8.5% / 59.5% (series) | n/a | no threshold |
| planted | phone | 204 (202–206) | 19.8% / 23.5% (search) | 4.3% / 68.2% (downloads) | 15.9% / 25.6% (releases) | 15.9% / 31.0% (title) | n/a | only a wide threshold |
| planted | desktop | 206 (204–208) | 17.6% / 21.4% (search) | 5.7% / 70.2% (search-year) | 14.0% / 18.2% (releases) | 13.8% / 28.9% (torrent) | n/a | only a wide threshold |

#### Largest contentful paint, ms

| Regime | Size | Median of job medians (range over screens) | Between jobs: typical / worst screen | Inside a job: typical / worst | Local between runs: typical / worst | Local inside a run: typical / worst | Planted 100 ms clear of every clean job (smallest gap) | Class |
|---|---|---|---|---|---|---|---|---|
| clean | phone | 224 (202–246) | 40.4% / 45.5% (releases) | 9.3% / 141.2% (releases) | 16.0% / 22.7% (torrent) | 17.4% / 114.8% (series) | **no** (downloads, torrent, browse, search, search-year, title, series, releases, settings), -32.0 ms (releases); local yes, 64.0 ms | no threshold |
| clean | desktop | 246 (216–300) | 42.3% / 52.1% (torrent) | 8.0% / 76.2% (releases) | 19.2% / 49.1% (torrent) | 11.5% / 43.6% (torrent) | **no** (downloads, torrent, browse, search, search-year, title, series, releases, settings), -64.0 ms (torrent); local yes, 32.0 ms | no threshold |
| cpu4x | phone | 636 (542–742) | 53.3% / 57.9% (browse) | 11.3% / 87.2% (search-year) | 8.4% / 11.9% (search) | 8.5% / 37.5% (releases) | n/a | no threshold |
| cpu4x | desktop | 720 (562–914) | 52.3% / 54.3% (releases) | 7.5% / 36.9% (settings) | 7.9% / 11.3% (series) | 8.3% / 48.0% (series) | n/a | no threshold |
| planted | phone | 288 (264–304) | 26.0% / 30.3% (releases) | 7.5% / 91.0% (browse) | 6.8% / 17.4% (downloads) | 6.5% / 21.7% (downloads) | n/a | no threshold |
| planted | desktop | 312 (274–360) | 28.6% / 38.2% (torrent) | 6.5% / 45.7% (search-year) | 9.6% / 18.4% (search-year) | 6.1% / 32.7% (torrent) | n/a | no threshold |

#### Loaded content shows, ms from navigation start

| Regime | Size | Median of job medians (range over screens) | Between jobs: typical / worst screen | Inside a job: typical / worst | Local between runs: typical / worst | Local inside a run: typical / worst | Planted 100 ms clear of every clean job (smallest gap) | Class |
|---|---|---|---|---|---|---|---|---|
| clean | phone | 194 (166–239) | 41.7% / 44.7% (downloads) | 9.7% / 177.9% (releases) | 9.9% / 30.6% (title) | 25.0% / 133.1% (series) | **no** (downloads, torrent, browse, search-year, title, releases), -25.0 ms (downloads); local yes, 60.9 ms | no threshold |
| clean | desktop | 221 (171–261) | 42.2% / 49.4% (downloads) | 8.9% / 83.8% (releases) | 19.9% / 26.7% (search-year) | 17.4% / 37.6% (browse) | **no** (downloads, torrent, browse, search, search-year, title, series, releases), -51.6 ms (downloads); local yes, 59.4 ms | no threshold |
| cpu4x | phone | 520 (417–685) | 52.1% / 55.6% (browse) | 9.8% / 80.2% (title) | 9.6% / 15.5% (downloads) | 9.5% / 45.0% (releases) | n/a | no threshold |
| cpu4x | desktop | 593 (424–801) | 51.1% / 54.6% (series) | 7.5% / 44.9% (torrent) | 8.2% / 14.7% (series) | 9.1% / 50.9% (series) | n/a | no threshold |
| planted | phone | 255 (230–295) | 24.9% / 26.7% (search) | 6.7% / 110.6% (browse) | 10.1% / 11.4% (browse) | 10.9% / 18.0% (browse) | n/a | only a wide threshold |
| planted | desktop | 279 (231–323) | 28.1% / 30.6% (releases) | 6.9% / 56.9% (series) | 4.4% / 13.0% (search) | 3.3% / 21.8% (search-year) | n/a | no threshold |

#### Total blocking time, ms (long tasks from navigation start)

| Regime | Size | Median of job medians (range over screens) | Between jobs: typical / worst screen | Inside a job: typical / worst | Local between runs: typical / worst | Local inside a run: typical / worst | Planted 100 ms clear of every clean job (smallest gap) | Class |
|---|---|---|---|---|---|---|---|---|
| clean | phone | 0.0 (0.0–0.0) | 0.0% / 0.0% (downloads) | 0.0% / ∞ (downloads) | 0.0% / 0.0% (downloads) | 0.0% / 0.0% (downloads) | yes, 50.0 ms (downloads); local yes, 50.0 ms | a threshold is workable |
| clean | desktop | 0.0 (0.0–0.0) | 0.0% / 0.0% (downloads) | 0.0% / ∞ (title) | 0.0% / 0.0% (downloads) | 0.0% / 0.0% (downloads) | yes, 50.0 ms (downloads); local yes, 50.0 ms | a threshold is workable |
| cpu4x | phone | 132 (109–236) | 98.0% / 113.2% (downloads) | 15.9% / 260.7% (search-year) | 60.0% / 66.7% (downloads) | 55.6% / 212.5% (downloads) | n/a | no threshold |
| cpu4x | desktop | 144 (122–258) | 106.8% / 117.1% (settings) | 15.5% / 130.1% (search) | 50.0% / 66.7% (downloads) | 57.8% / 177.8% (downloads) | n/a | no threshold |
| planted | phone | 50.0 (50.0–50.0) | 0.0% / 0.0% (downloads) | 0.0% / 106.0% (torrent) | 0.0% / 0.0% (downloads) | 0.0% / 0.0% (downloads) | n/a | a threshold is workable |
| planted | desktop | 50.0 (50.0–50.0) | 0.0% / 0.0% (downloads) | 0.0% / 126.0% (title) | 0.0% / 0.0% (downloads) | 0.0% / 0.0% (downloads) | n/a | a threshold is workable |

#### CDP ScriptDuration, ms

| Regime | Size | Median of job medians (range over screens) | Between jobs: typical / worst screen | Inside a job: typical / worst | Local between runs: typical / worst | Local inside a run: typical / worst | Planted 100 ms clear of every clean job (smallest gap) | Class |
|---|---|---|---|---|---|---|---|---|
| clean | phone | 90.0 (73.5–112) | 46.5% / 52.3% (downloads) | 7.7% / 46.5% (settings) | 9.8% / 14.4% (downloads) | 7.5% / 19.6% (search) | yes, 47.5 ms (downloads); local yes, 96.2 ms | no threshold |
| clean | desktop | 109 (87.3–150) | 44.5% / 61.3% (downloads) | 7.8% / 26.8% (downloads) | 8.4% / 11.8% (torrent) | 7.6% / 27.0% (search-year) | yes, 27.5 ms (downloads); local yes, 94.8 ms | no threshold |
| cpu4x | phone | 366 (306–493) | 58.6% / 63.2% (settings) | 8.2% / 32.7% (settings) | 8.8% / 11.9% (search) | 9.3% / 26.9% (search-year) | n/a | no threshold |
| cpu4x | desktop | 433 (354–586) | 57.6% / 61.2% (settings) | 8.1% / 41.4% (search) | 7.5% / 11.2% (settings) | 9.7% / 48.1% (series) | n/a | no threshold |
| planted | phone | 188 (171–212) | 21.5% / 25.3% (releases) | 3.1% / 18.5% (series) | 1.5% / 1.8% (search-year) | 1.7% / 7.2% (downloads) | n/a | only a wide threshold |
| planted | desktop | 206 (185–246) | 23.6% / 28.4% (releases) | 3.8% / 12.9% (title) | 1.6% / 2.9% (releases) | 1.5% / 8.9% (torrent) | n/a | only a wide threshold |

#### CDP LayoutDuration, ms

| Regime | Size | Median of job medians (range over screens) | Between jobs: typical / worst screen | Inside a job: typical / worst | Local between runs: typical / worst | Local inside a run: typical / worst | Planted 100 ms clear of every clean job (smallest gap) | Class |
|---|---|---|---|---|---|---|---|---|
| clean | phone | 11.9 (10.2–12.7) | 44.5% / 52.5% (downloads) | 9.1% / 139.1% (torrent) | 19.9% / 27.4% (torrent) | 16.3% / 58.1% (series) | **no** (downloads, torrent, browse, search, search-year, title, series, releases, settings), -6.4 ms (downloads); local no, -1.3 ms | no threshold |
| clean | desktop | 14.0 (11.8–19.1) | 44.6% / 47.5% (settings) | 9.2% / 122.2% (browse) | 15.1% / 22.2% (search-year) | 12.7% / 83.0% (search-year) | **no** (downloads, torrent, browse, search, search-year, title, series, releases, settings), -8.5 ms (releases); local no, -2.1 ms | no threshold |
| cpu4x | phone | 38.7 (33.4–43.8) | 51.0% / 54.3% (browse) | 13.6% / 83.7% (series) | 11.4% / 16.0% (downloads) | 12.2% / 57.3% (releases) | n/a | no threshold |
| cpu4x | desktop | 48.1 (38.8–65.1) | 50.7% / 54.8% (settings) | 11.2% / 44.6% (series) | 9.1% / 14.2% (series) | 10.7% / 84.6% (series) | n/a | no threshold |
| planted | phone | 11.8 (10.3–12.8) | 43.3% / 49.6% (search) | 9.4% / 114.9% (releases) | 17.8% / 34.0% (series) | 18.4% / 64.8% (series) | n/a | no threshold |
| planted | desktop | 13.7 (11.6–18.9) | 42.1% / 48.0% (browse) | 8.0% / 141.7% (search-year) | 18.1% / 43.0% (series) | 15.9% / 268.4% (releases) | n/a | no threshold |

#### CDP RecalcStyleDuration, ms

| Regime | Size | Median of job medians (range over screens) | Between jobs: typical / worst screen | Inside a job: typical / worst | Local between runs: typical / worst | Local inside a run: typical / worst | Planted 100 ms clear of every clean job (smallest gap) | Class |
|---|---|---|---|---|---|---|---|---|
| clean | phone | 5.7 (5.1–7.8) | 58.5% / 78.2% (search) | 27.4% / 138.5% (torrent) | 17.7% / 34.2% (torrent) | 20.7% / 157.3% (browse) | **no** (downloads, torrent, browse, search, search-year, title, series, releases, settings), -5.1 ms (settings); local no, -0.9 ms | no threshold |
| clean | desktop | 7.2 (6.7–11.7) | 51.2% / 56.9% (search-year) | 28.1% / 98.7% (browse) | 21.1% / 32.7% (search-year) | 14.3% / 152.1% (settings) | **no** (downloads, torrent, browse, search, search-year, title, series, releases, settings), -6.6 ms (torrent); local no, -1.1 ms | no threshold |
| cpu4x | phone | 21.6 (19.7–28.8) | 53.3% / 56.8% (releases) | 19.5% / 73.7% (downloads) | 17.1% / 23.4% (browse) | 23.5% / 152.2% (releases) | n/a | no threshold |
| cpu4x | desktop | 27.6 (23.4–47.1) | 53.4% / 62.2% (search) | 19.7% / 55.4% (search) | 19.8% / 24.8% (search) | 19.9% / 63.7% (series) | n/a | no threshold |
| planted | phone | 5.2 (4.5–7.2) | 42.2% / 51.2% (settings) | 13.8% / 64.2% (torrent) | 21.7% / 35.5% (search) | 26.5% / 158.7% (releases) | n/a | no threshold |
| planted | desktop | 6.6 (5.8–11.4) | 48.7% / 54.8% (torrent) | 14.4% / 55.5% (series) | 12.2% / 28.4% (search-year) | 14.0% / 59.4% (title) | n/a | no threshold |

#### CDP TaskDuration, ms

| Regime | Size | Median of job medians (range over screens) | Between jobs: typical / worst screen | Inside a job: typical / worst | Local between runs: typical / worst | Local inside a run: typical / worst | Planted 100 ms clear of every clean job (smallest gap) | Class |
|---|---|---|---|---|---|---|---|---|
| clean | phone | 173 (155–199) | 44.6% / 47.5% (downloads) | 9.4% / 117.5% (browse) | 11.6% / 17.5% (torrent) | 11.8% / 23.4% (downloads) | yes, 6.5 ms (downloads); local yes, 90.3 ms | no threshold |
| clean | desktop | 212 (167–264) | 44.4% / 56.1% (downloads) | 8.2% / 132.3% (title) | 12.5% / 17.0% (search-year) | 9.2% / 33.5% (search-year) | **no** (downloads, torrent, series, releases), -27.7 ms (downloads); local yes, 86.3 ms | no threshold |
| cpu4x | phone | 671 (607–780) | 55.1% / 61.3% (browse) | 10.0% / 86.2% (search-year) | 10.4% / 15.1% (downloads) | 8.9% / 35.9% (releases) | n/a | no threshold |
| cpu4x | desktop | 802 (661–1013) | 53.8% / 54.9% (settings) | 7.7% / 46.0% (torrent) | 8.8% / 13.2% (settings) | 8.7% / 49.6% (series) | n/a | no threshold |
| planted | phone | 269 (245–293) | 28.4% / 30.5% (settings) | 4.7% / 112.9% (torrent) | 3.2% / 4.6% (series) | 3.5% / 11.7% (downloads) | n/a | no threshold |
| planted | desktop | 302 (262–357) | 29.7% / 32.4% (releases) | 5.0% / 43.7% (series) | 4.2% / 6.7% (settings) | 4.0% / 20.6% (releases) | n/a | no threshold |

### Moves

#### Input to next paint, ms

| Regime | Size | Median of job medians (range over screens) | Between jobs: typical / worst screen | Inside a job: typical / worst | Local between runs: typical / worst | Local inside a run: typical / worst | Planted 100 ms clear of every clean job (smallest gap) | Class |
|---|---|---|---|---|---|---|---|---|
| clean | phone | 19.0 (9.3–19.7) | 8.1% / 67.7% (query) | 9.6% / 131.2% (query) | 11.3% / 86.7% (query) | 17.5% / 134.7% (query) | yes, 88.2 ms (tab); local yes, 85.6 ms | no threshold |
| clean | desktop | 21.2 (11.2–23.6) | 24.6% / 40.4% (query) | 4.1% / 90.0% (query) | 15.3% / 58.1% (query) | 20.7% / 102.3% (query) | yes, 86.0 ms (tab); local yes, 70.6 ms | no threshold |
| cpu4x | phone | 33.9 (19.0–36.1) | 45.6% / 56.8% (query) | 21.4% / 141.0% (query) | 12.4% / 28.0% (query) | 11.6% / 75.2% (query) | n/a | no threshold |
| cpu4x | desktop | 39.3 (18.9–40.7) | 46.7% / 48.6% (tab) | 16.9% / 100.0% (row) | 10.4% / 44.7% (query) | 14.5% / 81.1% (query) | n/a | no threshold |
| planted | phone | 111 (108–112) | 3.8% / 5.0% (tab) | 0.8% / 8.1% (query) | 2.5% / 2.7% (row) | 2.4% / 7.2% (tab) | n/a | a threshold is workable |
| planted | desktop | 115 (110–118) | 5.1% / 6.2% (tab) | 1.1% / 6.3% (tab) | 0.6% / 3.5% (row) | 1.5% / 7.1% (tab) | n/a | a threshold is workable |

### Layout shift

Exact is judged on CI and locally apart: the two platforms render fonts differently, so their numbers aren't expected to match each other.

| Screen | Size | Regime | CI: distinct values (runs) | Exact on CI | Local: distinct values (runs) | Exact locally |
|---|---|---|---|---|---|---|
| downloads | phone | clean | 0.003045 (90), 0.002862 (5), 0.003041 (4), 0.002963 (1) | **no** | 0.002813 (38), 0.000000 (12) | **no** |
| downloads | phone | cpu4x | 0.003045 (100) | yes | 0.002813 (50) | yes |
| downloads | phone | planted | 0.003045 (100) | yes | 0.002768 (18), 0.000111 (18), 0.002813 (13), 0.000076 (1) | **no** |
| downloads | desktop | clean | 0.010278 (100) | yes | 0.009992 (29), 0.009923 (11), 0.010060 (9), 0.009945 (1) | **no** |
| downloads | desktop | cpu4x | 0.010278 (100) | yes | 0.010060 (50) | yes |
| downloads | desktop | planted | 0.010278 (99), 0.010251 (1) | **no** | 0.009945 (34), 0.009923 (7), 0.009992 (4), 0.010060 (4), 0.009739 (1) | **no** |
| torrent | phone | clean | 0.261609 (64), 0.276861 (31), 0.276857 (2), 0.261528 (1), 0.261427 (1), 0.276678 (1) | **no** | 0.137699 (32), 0.260237 (11), 0.001190 (7) | **no** |
| torrent | phone | cpu4x | 0.261609 (100) | yes | 0.261427 (49), 0.276678 (1) | **no** |
| torrent | phone | planted | 0.261609 (74), 0.276861 (24), 0.261606 (1), 0.261528 (1) | **no** | 0.001190 (43), 0.260237 (5), 0.272362 (1), 0.276678 (1) | **no** |
| torrent | desktop | clean | 0.023631 (48), 0.025096 (29), 0.010278 (9), 0.024966 (4), 0.023817 (3), 0.025316 (2), 0.025152 (2), 0.023630 (1), 0.010465 (1), 0.010251 (1) | **no** | 0.025097 (17), 0.024371 (7), 0.024302 (5), 0.024611 (4), 0.024878 (4), 0.023412 (3), 0.024659 (2), 0.023344 (2), 0.023275 (2), 0.024632 (1), 0.024748 (1), 0.023160 (1), 0.024679 (1) | **no** |
| torrent | desktop | cpu4x | 0.023817 (46), 0.010465 (40), 0.010278 (10), 0.025316 (4) | **no** | 0.025097 (40), 0.023599 (7), 0.010247 (1), 0.024934 (1), 0.010060 (1) | **no** |
| torrent | desktop | planted | 0.023631 (51), 0.025096 (18), 0.010278 (17), 0.025152 (8), 0.024966 (4), 0.010251 (1), 0.025316 (1) | **no** | 0.024982 (23), 0.024878 (7), 0.025097 (7), 0.023297 (4), 0.023412 (3), 0.024762 (2), 0.023091 (1), 0.024645 (1), 0.023160 (1), 0.024632 (1) | **no** |
| browse | phone | clean | 0.000183 (96), 0.000179 (2), 0.000101 (1), 0.000000 (1) | **no** | 0.000000 (50) | yes |
| browse | phone | cpu4x | 0.000183 (100) | yes | 0.000000 (50) | yes |
| browse | phone | planted | 0.000183 (99), 0.000179 (1) | **no** | 0.000000 (50) | yes |
| browse | desktop | clean | 0.001609 (98), 0.001582 (1), 0.001597 (1) | **no** | 0.001582 (41), 0.000000 (9) | **no** |
| browse | desktop | cpu4x | 0.001609 (100) | yes | 0.001582 (50) | yes |
| browse | desktop | planted | 0.001609 (98), 0.001582 (2) | **no** | 0.001602 (37), 0.001582 (11), 0.000001 (2) | **no** |
| search | phone | clean | 0.000183 (96), 0.000179 (2), 0.000101 (1), 0.000000 (1) | **no** | 0.000000 (50) | yes |
| search | phone | cpu4x | 0.000183 (100) | yes | 0.000000 (50) | yes |
| search | phone | planted | 0.000183 (100) | yes | 0.000043 (35), 0.000000 (15) | **no** |
| search | desktop | clean | 0.001609 (98), 0.001582 (2) | **no** | 0.001582 (38), 0.000000 (11), 0.001771 (1) | **no** |
| search | desktop | cpu4x | 0.001609 (100) | yes | 0.001582 (50) | yes |
| search | desktop | planted | 0.001609 (98), 0.001608 (1), 0.001597 (1) | **no** | 0.001771 (31), 0.001582 (17), 0.000008 (2) | **no** |
| search-year | phone | clean | 0.000183 (98), 0.000000 (2) | **no** | 0.000000 (49), 0.000043 (1) | **no** |
| search-year | phone | cpu4x | 0.000183 (99), 0.000179 (1) | **no** | 0.000000 (50) | yes |
| search-year | phone | planted | 0.000183 (100) | yes | 0.000043 (32), 0.000000 (18) | **no** |
| search-year | desktop | clean | 0.001609 (98), 0.001608 (2) | **no** | 0.001582 (36), 0.000000 (12), 0.001771 (2) | **no** |
| search-year | desktop | cpu4x | 0.001609 (100) | yes | 0.001582 (50) | yes |
| search-year | desktop | planted | 0.001609 (100) | yes | 0.001771 (26), 0.001582 (18), 0.000008 (5), 0.001588 (1) | **no** |
| title | phone | clean | 0.000183 (100) | yes | 0.000000 (50) | yes |
| title | phone | cpu4x | 0.000183 (98), 0.000179 (2) | **no** | 0.000000 (50) | yes |
| title | phone | planted | 0.000183 (98), 0.000000 (2) | **no** | 0.000318 (22), 0.000000 (19), 0.000118 (8), 0.000240 (1) | **no** |
| title | desktop | clean | 0.010947 (87), 0.023031 (12), 0.010946 (1) | **no** | 0.009338 (31), 0.023004 (19) | **no** |
| title | desktop | cpu4x | 0.010947 (100) | yes | 0.010920 (49), 0.023004 (1) | **no** |
| title | desktop | planted | 0.010947 (83), 0.023031 (16), 0.010920 (1) | **no** | 0.009353 (24), 0.023004 (15), 0.023299 (8), 0.009338 (3) | **no** |
| series | phone | clean | 0.000183 (98), 0.000000 (1), 0.000179 (1) | **no** | 0.000000 (49), 0.000229 (1) | **no** |
| series | phone | cpu4x | 0.000183 (99), 0.000248 (1) | **no** | 0.000000 (50) | yes |
| series | phone | planted | 0.000183 (98), 0.000000 (1), 0.000179 (1) | **no** | 0.000000 (18), 0.000229 (17), 0.000057 (14), 0.000179 (1) | **no** |
| series | desktop | clean | 0.010947 (87), 0.023031 (12), 0.023004 (1) | **no** | 0.009338 (26), 0.023004 (23), 0.000000 (1) | **no** |
| series | desktop | cpu4x | 0.010947 (100) | yes | 0.010920 (50) | yes |
| series | desktop | planted | 0.010947 (87), 0.023031 (10), 0.023019 (1), 0.023004 (1), 0.010920 (1) | **no** | 0.009353 (24), 0.023004 (13), 0.023299 (10), 0.010940 (2), 0.009338 (1) | **no** |
| releases | phone | clean | 0.067120 (71), 0.064705 (25), 0.064523 (3), 0.067117 (1) | **no** | 0.000000 (29), 0.066938 (13), 0.064079 (7), 0.127019 (1) | **no** |
| releases | phone | cpu4x | 0.064705 (100) | yes | 0.064523 (26), 0.066938 (24) | **no** |
| releases | phone | planted | 0.067120 (62), 0.064705 (37), 0.064702 (1) | **no** | 0.066938 (22), 0.064079 (11), 0.134505 (10), 0.127019 (7) | **no** |
| releases | desktop | clean | 0.038959 (100) | yes | 0.038932 (20), 0.037350 (20), 0.000000 (10) | **no** |
| releases | desktop | cpu4x | 0.038959 (100) | yes | 0.038932 (50) | yes |
| releases | desktop | planted | 0.038959 (98), 0.038932 (2) | **no** | 0.037352 (28), 0.038952 (10), 0.038932 (10), 0.037350 (2) | **no** |
| settings | phone | clean | 0.000183 (99), 0.000000 (1) | **no** | 0.000000 (50) | yes |
| settings | phone | cpu4x | 0.000183 (99), 0.000000 (1) | **no** | 0.000000 (50) | yes |
| settings | phone | planted | 0.000183 (97), 0.000179 (2), 0.000000 (1) | **no** | 0.000000 (50) | yes |
| settings | desktop | clean | 0.001644 (73), 0.001621 (25), 0.001594 (1), 0.001616 (1) | **no** | 0.001616 (50) | yes |
| settings | desktop | cpu4x | 0.001644 (96), 0.001621 (4) | **no** | 0.001616 (45), 0.001594 (5) | **no** |
| settings | desktop | planted | 0.001644 (81), 0.001621 (17), 0.001643 (1), 0.001609 (1) | **no** | 0.001637 (30), 0.001616 (20) | **no** |

Exact on CI: 19 of 54 screen, size and regime combinations; locally: 20 of 54.

### The jobs

| Job | CPU | Image | Clean `loaded`, median over screens and sizes of job median ÷ median of job medians | Clean `task` likewise |
|---|---|---|---:|---:|
| 43278582177-2-1 | AMD EPYC 9V74 80-Core Processor (4) | 20261101.186.1 | 0.797 | 0.781 |
| 43278582177-2-10 | INTEL(R) XEON(R) PLATINUM 8573C (4) | 20261101.186.1 | 1.039 | 1.033 |
| 43278582177-2-2 | AMD EPYC 7763 64-Core Processor (4) | 20261101.186.1 | 1.045 | 1.044 |
| 43278582177-2-3 | AMD EPYC 9V45 96-Core Processor (4) | 20261101.186.1 | 0.658 | 0.631 |
| 43278582177-2-4 | AMD EPYC 9V74 80-Core Processor (4) | 20261111.196.1 | 0.826 | 0.832 |
| 43278582177-2-5 | INTEL(R) XEON(R) PLATINUM 8573C (4) | 20261101.186.1 | 1.011 | 1.010 |
| 43278582177-2-6 | AMD EPYC 7763 64-Core Processor (4) | 20261111.196.1 | 1.042 | 1.039 |
| 43278582177-2-7 | AMD EPYC 7763 64-Core Processor (4) | 20261101.186.1 | 1.012 | 1.008 |
| 43278582177-2-8 | AMD EPYC 9V45 96-Core Processor (4) | 20261101.186.1 | 0.758 | 0.761 |
| 43278582177-2-9 | AMD EPYC 9V74 80-Core Processor (4) | 20261101.186.1 | 0.830 | 0.830 |
| 43278582177-3-1 | Intel(R) Xeon(R) 6973P-C (4) | 20261101.186.1 | 0.859 | 0.853 |
| 43278582177-3-10 | AMD EPYC 9V74 80-Core Processor (4) | 20261101.186.1 | 0.818 | 0.807 |
| 43278582177-3-2 | AMD EPYC 9V74 80-Core Processor (4) | 20261101.186.1 | 1.064 | 1.051 |
| 43278582177-3-3 | AMD EPYC 7763 64-Core Processor (4) | 20261101.186.1 | 1.023 | 1.013 |
| 43278582177-3-4 | Intel(R) Xeon(R) Platinum 8370C CPU @ 2.80GHz (4) | 20261101.186.1 | 0.999 | 1.011 |
| 43278582177-3-5 | AMD EPYC 9V45 96-Core Processor (4) | 20261101.186.1 | 0.783 | 0.784 |
| 43278582177-3-6 | AMD EPYC 7763 64-Core Processor (4) | 20261101.186.1 | 1.063 | 1.060 |
| 43278582177-3-7 | AMD EPYC 7763 64-Core Processor (4) | 20261101.186.1 | 1.038 | 1.027 |
| 43278582177-3-8 | AMD EPYC 9V74 80-Core Processor (4) | 20261101.186.1 | 0.833 | 0.825 |
| 43278582177-3-9 | AMD EPYC 7763 64-Core Processor (4) | 20261101.186.1 | 1.033 | 1.043 |

### Between jobs on the same CPU model

Clean regime (moves: clean too), the worst screen's spread between the job medians of jobs on one CPU model; models with three jobs or more. All jobs, for comparison, in the first column.

| Metric | Size | All 20 jobs | AMD EPYC 7763 (7) | AMD EPYC 9V45 (3) | AMD EPYC 9V74 (6) |
|---|---|---:|---:|---:|---:|
| fcp | phone | 42.3% (search-year) | 8.1% (releases) | 19.2% (downloads) | 37.9% (downloads) |
| fcp | desktop | 44.4% (settings) | 5.4% (downloads) | 15.4% (browse) | 40.7% (settings) |
| lcp | phone | 45.5% (releases) | 11.7% (search-year) | 26.2% (downloads) | 37.1% (downloads) |
| lcp | desktop | 52.1% (torrent) | 14.1% (downloads) | 24.5% (torrent) | 34.1% (settings) |
| loaded | phone | 44.7% (downloads) | 11.7% (releases) | 31.2% (downloads) | 33.5% (settings) |
| loaded | desktop | 49.4% (downloads) | 14.9% (downloads) | 20.7% (settings) | 38.1% (series) |
| tbt | phone | 0.0% (downloads) | 0.0% (downloads) | 0.0% (downloads) | 0.0% (downloads) |
| tbt | desktop | 0.0% (downloads) | 0.0% (downloads) | 0.0% (downloads) | 0.0% (downloads) |
| script | phone | 52.3% (downloads) | 12.6% (downloads) | 19.8% (series) | 37.2% (title) |
| script | desktop | 61.3% (downloads) | 20.8% (downloads) | 22.3% (torrent) | 36.7% (downloads) |
| layout | phone | 52.5% (downloads) | 14.7% (downloads) | 24.1% (downloads) | 36.9% (torrent) |
| layout | desktop | 47.5% (settings) | 15.3% (downloads) | 30.4% (settings) | 39.9% (settings) |
| style | phone | 78.2% (search) | 42.3% (search) | 31.9% (browse) | 36.1% (settings) |
| style | desktop | 56.9% (search-year) | 22.3% (search-year) | 23.0% (search) | 43.6% (search-year) |
| task | phone | 47.5% (downloads) | 10.1% (search-year) | 32.1% (downloads) | 35.9% (search) |
| task | desktop | 56.1% (downloads) | 21.3% (downloads) | 28.9% (search-year) | 37.6% (torrent) |
| nextPaint | phone | 67.7% (query) | 32.6% (query) | 11.7% (query) | 40.7% (query) |
| nextPaint | desktop | 40.4% (query) | 23.9% (query) | 34.3% (query) | 38.3% (query) |

### Classes 
| Metric | Regime | phone | desktop | |---|---|---|---|
| fcp | clean | no threshold (42.3%, search-year) | no threshold (44.4%, settings) |
| fcp | cpu4x | no threshold (57.0%, search) | no threshold (53.8%, series) |
| fcp | planted | only a wide threshold (23.5%, search) | only a wide threshold (21.4%, search) |
| lcp | clean | no threshold (45.5%, releases) | no threshold (52.1%, torrent) |
| lcp | cpu4x | no threshold (57.9%, browse) | no threshold (54.3%, releases) |
| lcp | planted | no threshold (30.3%, releases) | no threshold (38.2%, torrent) |
| loaded | clean | no threshold (44.7%, downloads) | no threshold (49.4%, downloads) |
| loaded | cpu4x | no threshold (55.6%, browse) | no threshold (54.6%, series) |
| loaded | planted | only a wide threshold (26.7%, search) | no threshold (30.6%, releases) |
| tbt | clean | a threshold is workable (0.0%, downloads) | a threshold is workable (0.0%, downloads) |
| tbt | cpu4x | no threshold (113.2%, downloads) | no threshold (117.1%, settings) |
| tbt | planted | a threshold is workable (0.0%, downloads) | a threshold is workable (0.0%, downloads) |
| script | clean | no threshold (52.3%, downloads) | no threshold (61.3%, downloads) |
| script | cpu4x | no threshold (63.2%, settings) | no threshold (61.2%, settings) |
| script | planted | only a wide threshold (25.3%, releases) | only a wide threshold (28.4%, releases) |
| layout | clean | no threshold (52.5%, downloads) | no threshold (47.5%, settings) |
| layout | cpu4x | no threshold (54.3%, browse) | no threshold (54.8%, settings) |
| layout | planted | no threshold (49.6%, search) | no threshold (48.0%, browse) |
| style | clean | no threshold (78.2%, search) | no threshold (56.9%, search-year) |
| style | cpu4x | no threshold (56.8%, releases) | no threshold (62.2%, search) |
| style | planted | no threshold (51.2%, settings) | no threshold (54.8%, torrent) |
| task | clean | no threshold (47.5%, downloads) | no threshold (56.1%, downloads) |
| task | cpu4x | no threshold (61.3%, browse) | no threshold (54.9%, settings) |
| task | planted | no threshold (30.5%, settings) | no threshold (32.4%, releases) |
| nextPaint | clean | no threshold (67.7%, query) | no threshold (40.4%, query) |
| nextPaint | cpu4x | no threshold (56.8%, query) | no threshold (48.6%, tab) |
| nextPaint | planted | a threshold is workable (5.0%, tab) | a threshold is workable (6.2%, tab) |
