import { describe, expect, it } from 'vitest'
import { episodeCoverage, parseRelease, releaseCoverage, seasonCoverage } from './parseRelease'

describe('parseRelease', () => {
  it.each([
    [
      'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR10.HEVC.TrueHD.Atmos.7.1-GRPA',
      { resolution: '2160p', source: 'REMUX', codec: 'HEVC', hdr: ['DV', 'HDR'], audio: [], subs: false },
    ],
    [
      'Дюна: Часть вторая / Dune: Part Two (2024) UHD BDRemux 2160p | HDR | Dolby Vision | D, P, A | Rus, Eng',
      { resolution: '2160p', source: 'REMUX', hdr: ['DV', 'HDR'], audio: ['dub', 'mvo', 'avo1', 'orig'] },
    ],
    [
      'Dune.Part.Two.2024.2160p.WEB-DL.DDP5.1.Atmos.DV.HDR10+.H.265-GRPB',
      { resolution: '2160p', source: 'WEB-DL', codec: 'HEVC', hdr: ['DV', 'HDR10+'] },
    ],
    ['Дюна 2 / Dune: Part Two (2024) WEB-DL 1080p | Дубляж', { resolution: '1080p', source: 'WEB-DL', audio: ['dub'] }],
    [
      'Дюна: Часть вторая (2024) BDRip 1080p | Дубляж, Многоголосый | AVC',
      { resolution: '1080p', source: 'BDRip', codec: 'AVC', audio: ['dub', 'mvo'] },
    ],
    ['Dune.Part.Two.2024.1080p.BluRay.x264.DTS-HD.MA.7.1-GRPF', { resolution: '1080p', source: 'BluRay', codec: 'AVC' }],
    ['Дюна: Часть вторая (2024) WEB-DLRip 720p | Двухголосый', { resolution: '720p', source: 'WEBRip', audio: ['avo2'] }],
    [
      'Флорист / The Florist / 2026 / ДБ, ПМ, АП, СТ / Blu-Ray Remux (1080p)',
      { resolution: '1080p', source: 'REMUX', audio: ['dub', 'mvo', 'avo1'], subs: true },
    ],
    ['Arrival (2016) DVDRip | AVO', { resolution: 'SD', source: 'DVD', audio: ['avo1'] }],
    [
      'Дюна: Часть вторая / Dune: Part Two (2024) UHD BDRip-HEVC 1080p | HDR | D, P',
      { resolution: '1080p', source: 'BDRip', codec: 'HEVC', hdr: ['HDR'] },
    ],
    ['Dune.Part.Two.2024.UHD.BluRay.HEVC-GROUP', { resolution: '2160p', source: 'BluRay', codec: 'HEVC' }],
    ['Дюна: Часть вторая (2024) HDRip | Многоголосый', { source: 'HDRip', audio: ['mvo'] }],
    ['Dune.Part.Two.2024.720p.HDRip.x264', { resolution: '720p', source: 'HDRip', codec: 'AVC' }],
    ['Dune.Part.Two.2024.HDTVRip.XviD', { source: 'HDTV' }],
  ])('reads %s', (title, expected) => {
    expect(parseRelease(title)).toMatchObject(expected)
  })

  // Each studio parseRelease knows records multi-voice voice-overs, so its name alone stands for that kind.
  it.each(['LostFilm', 'NewStudio', 'Кубик в Кубе', 'HDRezka Studio', 'Jaskier', 'Amedia'])('reads %s as a multi-voice voice-over', (studio) => {
    expect(parseRelease(`Сёгун / Shōgun [S01] (2024) WEB-DL 1080p | ${studio}, Original`).audio).toEqual(['mvo', 'orig'])
  })

  it.each([
    'Dune.Part.Two.2024.CAMRip.x264-GRPA',
    'Дюна: Часть вторая (2024) CAM-Rip | Звук с CAMRip',
    'Dune Part Two 2024 HDCAM 720p',
    'Dune.Part.Two.2024.TS.x264-GRPA',
    'Дюна: Часть вторая (2024) TSRip 720p | Многоголосый',
    'Dune.Part.Two.2024.HDTS.1080p',
    'Dune Part Two 2024 TeleSync',
    'Дюна: Часть вторая (2024) TeleSynch',
    'Dune.Part.Two.2024.TC.XviD',
    'Dune Part Two 2024 HDTC 720p',
    'Dune Part Two 2024 TeleCine 720p',
    'Dune.Part.Two.2024.HDCAMRip.x264',
    'Dune Part Two 2024 HD-CAM 720p',
    'Дюна: Часть вторая (2024) TCRip',
    // A capital .TS at the end is a source; a file's extension is written in lowercase, and only
    // at the end: some scene names are all lowercase.
    'Dune.Part.Two.2024.TS',
    'dune.part.two.2024.ts.x264-grpa',
  ])('reads %s as a theater rip', (title) => {
    expect(parseRelease(title).source).toBe('CAM')
  })

  it.each([
    // A film's own name, not a camera in the cinema.
    ['Cam (2018) 1080p', undefined],
    ['Cam.2018.1080p.WEB-DL.x264-GRPA', 'WEB-DL'],
    // Only the audio was recorded in the cinema; the picture is what the name says.
    ['Дюна: Часть вторая (2024) WEB-DL 1080p | Звук с TS', 'WEB-DL'],
    ['Дюна: Часть вторая (2024) 1080p | Звук с TS', undefined],
    ['Дюна: Часть вторая (2024) 1080p | Дубляж, звук из TS', undefined],
    ['Дюна: Часть вторая (2024) 1080p | Звук c TS', undefined], // a Latin c
    ['Дюна: Часть вторая (2024) 1080p | Звук: TS', undefined],
    ['Дюна: Часть вторая (2024) 1080p | Звук TS', undefined],
    ['Dune.Part.Two.2024.1080p.TS.Audio', undefined],
    ['Дюна: Часть вторая (2024) 1080p | TS звук', undefined],
    // A transport stream, the container broadcasts come in, and a file's .ts extension.
    ['Concert 2024 1080i MPEG-TS', undefined],
    ['Concert 2024 1080i MPEG2 TS', undefined],
    ['Concert 2024 1080i MPEG-2 TS', undefined],
    ['Dune.Part.Two.2024.1080p.ts', undefined],
    // A theater rip named for another reason: the real source beside it wins.
    ['Дюна: Часть вторая (2024) WEB-DL 1080p | Обновлено: TS заменён на WEB-DL', 'WEB-DL'],
  ])("doesn't take %s for a theater rip", (title, source) => {
    expect(parseRelease(title).source).toBe(source)
  })

  it("doesn't take stray capital letters for voice-over credits", () => {
    expect(parseRelease('Dune A Part D 2021 1080p').audio).toEqual([])
    expect(parseRelease('Movie (2020) 1080p | HDR | Rus').audio).toEqual([])
  })

  it.each([
    ['Во все тяжкие / Breaking Bad / Сезон: 1-5 / Серии: 1-62 из 62 (2008-2013) BDRip 1080p | LostFilm', [1, 2, 3, 4, 5], 'S01–S05'],
    ['Breaking.Bad.S01-S05.COMPLETE.1080p.BluRay.x264-GRPC', [1, 2, 3, 4, 5], 'S01–S05'],
    ['Во все тяжкие (2008-2013) WEB-DLRip 720p | Сезоны 1-5 | Двухголосый', [1, 2, 3, 4, 5], 'S01–S05'],
    ['Breaking.Bad.S03.1080p.BluRay.x265.10bit.AAC.5.1-GRPG', [3], 'S03'],
    ['Во все тяжкие / Сезон 5 / Серии 1-16 (2012-2013) BDRip 1080p | Многоголосый', [5], 'S05'],
    ['Andor.S02E04.1080p.DSNP.WEB-DL', [2], 'S02'],
    ['Дюна (2021) BDRip 1080p', [], undefined],
  ])('reads the seasons of %s', (title, seasons, coverage) => {
    const info = parseRelease(title)
    expect(info.seasons).toEqual(seasons)
    expect(seasonCoverage(info)).toBe(coverage)
  })

  it('marks complete series and lists gaps', () => {
    expect(parseRelease('Shogun Complete Series 1080p').complete).toBe(true)
    expect(seasonCoverage({ seasons: [1, 3] })).toBe('S01, S03')
  })
})

describe('episodeCoverage', () => {
  it.each([
    ['Severance.S02E01-E05.1080p.ATVP.WEB-DL', 'E01–05'],
    ['Severance.S02E01-05.1080p', 'E01–05'],
    ['Andor.S02E04.1080p.DSNP.WEB-DL', 'E04'],
    ['Во все тяжкие / Сезон 5 / Серии 1-16 (2012-2013) BDRip 1080p', 'E01–16'],
    ['Разделение / Сезон: 2 / Серии: 1-5 из 10 (2025) WEB-DL 1080p', 'E01–05'],
    ['Severance.S01.1080p.ATVP.WEB-DL', undefined],
    ['Дюна (2021) BDRip 1080p', undefined],
  ])('reads the episodes of %s', (title, coverage) => {
    expect(episodeCoverage(title)).toBe(coverage)
  })
})

describe('releaseCoverage', () => {
  it.each([
    ['Severance.S02E01-E05.1080p.ATVP.WEB-DL', 'S02 E01–05'],
    ['Severance.S01.1080p.ATVP.WEB-DL', 'S01'],
    ['Во все тяжкие / Breaking Bad / Сезон: 1-5 / Серии: 1-62 из 62 (2008-2013) BDRip 1080p', 'S01–S05'],
    ['Dune.Part.Two.2024.2160p.WEB-DL', undefined],
  ])('describes %s', (title, coverage) => {
    expect(releaseCoverage(title)).toBe(coverage)
  })
})
