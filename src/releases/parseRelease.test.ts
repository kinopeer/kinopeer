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
  // Prowlarr's definitions for some indexers spell two of them in Latin letters: "Kubik", "kurazh".
  it.each(['LostFilm', 'NewStudio', 'Кубик в Кубе', 'Kubik', 'kurazh', 'HDRezka Studio', 'Jaskier', 'Amedia'])(
    'reads %s as a multi-voice voice-over',
    (studio) => {
      expect(parseRelease(`Сёгун / Shōgun [S01] (2024) WEB-DL 1080p | ${studio}, Original`).audio).toEqual(['mvo', 'orig'])
    },
  )

  // Release names as Prowlarr hands them over, one group per naming style. Prowlarr's definitions rewrite
  // what some indexers show (the notes on each group), so these are the shapes Kinopeer gets, not the sites'.
  describe('reads the naming styles of indexers', () => {
    const none = { hdr: [], audio: [], subs: false }

    // Scene names: dots between words, the group after the last hyphen.
    it.each([
      ['Dune.Part.Two.2024.1080p.WEBRip.x264.AAC5.1-GRPA', { ...none, resolution: '1080p', source: 'WEBRip', codec: 'AVC' }],
      ['Dune.Part.Two.2024.1080p.AMZN.WEB-DL.DDP5.1.H.264-GRPA', { ...none, resolution: '1080p', source: 'WEB-DL', codec: 'AVC' }],
      ['Dune.Part.Two.2024.1080p.BluRay.REMUX.AVC.DTS-HD.MA.7.1-GRPA', { ...none, resolution: '1080p', source: 'REMUX', codec: 'AVC' }],
      [
        'Dune.Part.Two.2024.HYBRID.2160p.UHD.BluRay.DV.HDR10Plus.TrueHD.7.1.Atmos.x265-GRPA',
        { ...none, resolution: '2160p', source: 'BluRay', codec: 'HEVC', hdr: ['DV', 'HDR10+'] },
      ],
      ['The Bear S03E01 1080p WEB h264-GRPB', { ...none, resolution: '1080p', source: 'WEB-DL', codec: 'AVC' }],
    ])('scene name %s', (title, expected) => {
      expect(parseRelease(title)).toEqual(expect.objectContaining(expected))
    })

    // Names some definitions rebuild from a page address, every hyphen turned into a space, or all but the last.
    it.each([
      ['Dune Part Two 2024 1080p WEB-DL DDP5 1 Atmos H 264-GRPA', { ...none, resolution: '1080p', source: 'WEB-DL', codec: 'AVC' }],
      ['Dune Part Two 2024 1080p WEB DL DDP5 1 Atmos H 264 GRPA', { ...none, resolution: '1080p', source: 'WEB-DL', codec: 'AVC' }],
      [
        'Dune Part Two 2024 2160p UHD BluRay REMUX DV HDR10 HEVC TrueHD Atmos 7 1-GRPA',
        { ...none, resolution: '2160p', source: 'REMUX', codec: 'HEVC', hdr: ['DV', 'HDR'] },
      ],
    ])('spaced name %s', (title, expected) => {
      expect(parseRelease(title)).toEqual(expect.objectContaining(expected))
    })

    // Names a definition builds from an indexer's API fields: title (year), quality, WEBRip or BRRip, extras, codec, group.
    it.each([
      ['Dune Part Two (2024) 2160p WEBRip 5.1 10Bit x265 -GRPY', { ...none, resolution: '2160p', source: 'WEBRip', codec: 'HEVC' }],
      ['Dune Part Two (2024) 1080p BRRip x264 -GRPY', { ...none, resolution: '1080p', source: 'BDRip', codec: 'AVC' }],
    ])('built name %s', (title, expected) => {
      expect(parseRelease(title)).toEqual(expect.objectContaining(expected))
    })

    it.each([
      'Dune Part Two 2024 1080p WEBRip x264 AAC ESub',
      'Dune Part Two 2024 1080p WEBRip x264 AAC ESubs',
      'Dune Part Two 2024 1080p BluRay x265 10bit Multiple Subtitle',
      'Dune Part Two 2024 1080p BluRay x265 Subtitles',
    ])('reads the subtitles of %s', (title) => {
      expect(parseRelease(title).subs).toBe(true)
    })

    // Russian names after Prowlarr's rewrites: "| от GRPA" and "| Studio" at the end become "-GRPA" and "-Studio",
    // a WEB-DLRip or an HDTVRip becomes WEB-DL or HDTV.
    it.each([
      [
        'Дюна: Часть вторая / Dune: Part Two (2024) WEB-DL 1080p | D, P, A-Лицензия',
        { ...none, resolution: '1080p', source: 'WEB-DL', audio: ['dub', 'mvo', 'avo1'] },
      ],
      ['Дюна: Часть вторая / Dune: Part Two (2024) WEB-DL 1080p-GRPA', { ...none, resolution: '1080p', source: 'WEB-DL' }],
      ['Сёгун / Shōgun (2024) WEB-DL 1080p-LostFilm', { ...none, resolution: '1080p', source: 'WEB-DL', audio: ['mvo'] }],
      ['Сёгун / Shōgun S1 (2024) WEB-DL 1080p-NewStudio', { ...none, resolution: '1080p', source: 'WEB-DL', audio: ['mvo'] }],
      ['Дюна / Dune (2021) HDTV 720p', { ...none, resolution: '720p', source: 'HDTV' }],
    ])('rewritten name with a credits block %s', (title, expected) => {
      expect(parseRelease(title)).toEqual(expect.objectContaining(expected))
    })

    // Russian names after Prowlarr's other rewrites: " / " dropped, the short voice-over codes in English
    // (ДБ DUB, ПМ MVO, ПД DVO, АП AVO, ЛО VO, СТ Sub), WEB-DL as WEBDL, "Blu-Ray Disc" as BR-DISK.
    it.each([
      [
        'Дюна: Часть вторая Dune: Part Two 2024 DUB, MVO, AVO, Sub WEBDL 1080p',
        { ...none, resolution: '1080p', source: 'WEB-DL', audio: ['dub', 'mvo', 'avo1'], subs: true },
      ],
      ['Дюна: Часть вторая Dune: Part Two 2024 DVO BDRip 1080p', { ...none, resolution: '1080p', source: 'BDRip', audio: ['avo2'] }],
      ['Дюна: Часть вторая Dune: Part Two 2024 VO WEBDL 720p', { ...none, resolution: '720p', source: 'WEB-DL', audio: ['avo1'] }],
      // "VO" is read only in capitals, as Prowlarr writes it: "Vo" in a title is a name.
      ['Vo.Nguyen.Giap.2019.1080p.WEB-DL', { ...none, resolution: '1080p', source: 'WEB-DL' }],
      [
        'Дюна: Часть вторая Dune: Part Two 2024 MVO (Kubik) BR-DISK 1080p',
        { ...none, resolution: '1080p', source: 'BluRay', audio: ['mvo'] },
      ],
    ])('rewritten name with voice-over codes %s', (title, expected) => {
      expect(parseRelease(title)).toEqual(expect.objectContaining(expected))
    })

    // Russian names with the details in brackets and the voice-overs after them, joined by "+". Prowlarr cuts
    // the director in parentheses, and for some indexers also "MVO (Studio)", "VO (Name)" and "Sub …", so those
    // voice-overs and subtitles can't be read.
    it.each([
      [
        'Дюна: Часть вторая / Dune: Part Two [2024, США, Канада, фантастика, WEB-DL 1080p] Dub + AVO + Original Eng',
        { ...none, resolution: '1080p', source: 'WEB-DL', audio: ['dub', 'avo1', 'orig'] },
      ],
      [
        'Дюна: Часть вторая / Dune: Part Two [2024, США, фантастика, BDRemux 1080p] Dub + Original Eng',
        { ...none, resolution: '1080p', source: 'REMUX', audio: ['dub', 'orig'] },
      ],
    ])('bracketed name %s', (title, expected) => {
      expect(parseRelease(title)).toEqual(expect.objectContaining(expected))
    })

    // The same names with the options some definitions offer: Cyrillic stripped, " RUS" or " - RUSSIAN" appended.
    it.each([
      [
        'Dune: Part Two [2024, WEB-DL 2160p, HDR10, Dolby Vision] Dub + Original Eng',
        { ...none, resolution: '2160p', source: 'WEB-DL', hdr: ['DV', 'HDR'], audio: ['dub', 'orig'] },
      ],
      ['Dune: Part Two 2024 DUB, MVO WEBDL 1080p - RUSSIAN', { ...none, resolution: '1080p', source: 'WEB-DL', audio: ['dub', 'mvo'] }],
      ['Dune: Part Two (2024) WEB-DL 1080p | D, P-Лицензия RUS', { ...none, resolution: '1080p', source: 'WEB-DL', audio: ['dub', 'mvo'] }],
    ])('name with options %s', (title, expected) => {
      expect(parseRelease(title)).toEqual(expect.objectContaining(expected))
    })
  })

  // Some definitions rebuild a name from a page address with every hyphen turned into a space (the spaced
  // names above), so each spelling reads the same that way too: «HD CAM», «CAM Rip», «MPEG 2 TS».
  const spaced = (title: string) => title.replaceAll('-', ' ')

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
    // «Звук:» here starts the voice-over list, and only TS can be an audio note.
    'Дюна (2024) CAMRip Звук: CAMRip',
    'Дюна (2024) TS Звук: Дубляж',
    'Дюна (2024) TS звук с TS',
    'Дюна (2024) TS звук из TS',
    'Дюна (2024) CAMRip Звук CAMRip',
  ])('reads %s as a theater rip, also with spaces for its hyphens', (title) => {
    expect(parseRelease(title).source).toBe('CAM')
    expect(parseRelease(spaced(title)).source).toBe('CAM')
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
    ['Дюна: Часть вторая (2024) 1080p | TS звук стерео', undefined],
    // A transport stream, the container broadcasts come in, and a file's .ts extension.
    ['Concert 2024 1080i MPEG-TS', undefined],
    ['Concert 2024 1080i MPEG2 TS', undefined],
    ['Concert 2024 1080i MPEG-2 TS', undefined],
    ['Concert 2024 1080i MPEG-2-TS', undefined],
    ['Dune.Part.Two.2024.1080p.ts', undefined],
    // A theater rip named for another reason: the real source beside it wins.
    ['Дюна: Часть вторая (2024) WEB-DL 1080p | Обновлено: TS заменён на WEB-DL', 'WEB-DL'],
  ])("doesn't take %s for a theater rip, also with spaces for its hyphens", (title, source) => {
    expect(parseRelease(title).source).toBe(source)
    expect(parseRelease(spaced(title)).source).toBe(source)
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
    // An episode range within one season isn't a range of seasons (#330).
    ['Severance.S02E01-05.1080p.ATVP.WEB-DL', [2], 'S02'],
    ['Severance.S02E01-E05.1080p.ATVP.WEB-DL', [2], 'S02'],
    // Prowlarr rewrites Russian seasons and episodes into these shapes before Kinopeer sees them.
    ['Сёгун / Shōgun [S01E01-10 of 10] (2024) WEB-DL 1080p', [1], 'S01'],
    ['Сёгун / Shōgun / S1E1-10 of 10 [2024, WEB-DL 1080p] Original', [1], 'S01'],
    ['Во все тяжкие / Breaking Bad / S1-5E1-62 of 62 (2008-2013) BDRip 1080p', [1, 2, 3, 4, 5], 'S01–S05'],
    // Some definitions move "(1 сезон: 1-10 серии)" between the titles as " - S1E1-10 - ".
    ['Сёгун - S1E1-10 - Shōgun 2024 MVO (kurazh) WEBDL 1080p', [1], 'S01'],
    ['Медведь - S1-3E1-28 - The Bear 2022-2024 MVO WEBDL 1080p', [1, 2, 3], 'S01–S03'],
    // A pack's range that repeats the season at its end, and a season and episode apart.
    ['Severance.S02E01-S02E05.1080p.ATVP.WEB-DL', [2], 'S02'],
    ['Severance.S02.E01-05.1080p.ATVP.WEB-DL', [2], 'S02'],
    // A range from one season's episode to another's spans the seasons between.
    ['The.Bear.S01E01-S03E05.1080p.WEB-DL', [1, 2, 3], 'S01–S03'],
    ['The Bear S01E01 - S03E10 1080p WEB-DL', [1, 2, 3], 'S01–S03'],
    // The worded forms, in English and Russian, with and without spaces around the range's dash.
    ['Grey’s Anatomy Season 12 1080p WEB-DL', [12], 'S12'],
    ['Grey’s Anatomy Seasons 1-10 1080p WEBRip', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'S01–S10'],
    ['Медведь / The Bear (Сезоны 1 – 3) WEB-DL 1080p', [1, 2, 3], 'S01–S03'],
    ['Анатомия страсти (12 сезон) WEB-DL 1080p', [12], 'S12'],
    ['Анатомия страсти (1-10 сезоны) WEB-DL 1080p', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'S01–S10'],
    ['Медведь (1 – 3 сезоны) WEB-DL 1080p', [1, 2, 3], 'S01–S03'],
    ['Медведь (1-3сезоны) WEB-DL 1080p', [1, 2, 3], 'S01–S03'],
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
    // A pack's range that repeats the season at its end, and a season and episode apart.
    ['Severance.S02E01-S02E05.1080p.ATVP.WEB-DL', 'E01–05'],
    ['Severance.S02.E01-05.1080p.ATVP.WEB-DL', 'E01–05'],
    ['Severance S02 E04 1080p WEB-DL', 'E04'],
    // A season at the range's end needs its episode: "S01E01-S03" names no last episode.
    ['Severance.S01E01-S03.1080p', 'E01'],
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
    ['Severance.S02E01-05.1080p.ATVP.WEB-DL', 'S02 E01–05'],
    ['Сёгун / Shōgun [S01E01-10 of 10] (2024) WEB-DL 1080p', 'S01 E01–10'],
    ['Сёгун - S1E1-10 - Shōgun 2024 MVO (kurazh) WEBDL 1080p', 'S01 E01–10'],
    ['Severance.S02E01-S02E05.1080p.ATVP.WEB-DL', 'S02 E01–05'],
    ['Severance.S02.E01-05.1080p.ATVP.WEB-DL', 'S02 E01–05'],
    ['Во все тяжкие / Breaking Bad / Сезон: 1-5 / Серии: 1-62 из 62 (2008-2013) BDRip 1080p', 'S01–S05'],
    ['Dune.Part.Two.2024.2160p.WEB-DL', undefined],
  ])('describes %s', (title, coverage) => {
    expect(releaseCoverage(title)).toBe(coverage)
  })
})
