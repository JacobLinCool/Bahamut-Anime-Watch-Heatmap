import assert from "node:assert/strict";
import { test } from "vitest";
import { realApiResponse } from "./fixtures/metadata-api";
import {
  MetadataSchemaError,
  MetadataUnavailableError,
  cloneMetadataBundle,
  parseMetadataResponse,
  parseTaipeiDateKey,
  parseTaipeiDateTime
} from "./metadata-schema";

const apiValue = (videoSn = 49054): Record<string, unknown> => ({
  data: {
    video: {
      videoSn,
      animeSn: 114010,
      duration: 23,
      type: 0,
      cover: "https://p2.bahamut.com.tw/episode.JPG",
      upTime: "2026/05/21 01:00",
      downTime: "",
      favorite: true
    },
    anime: {
      animeSn: 114010,
      title: "API 作品標題 [9]",
      totalEpisode: 13,
      seasonStart: "2026/04/02",
      seasonEnd: "2026/07/02",
      episodeIndex: 8,
      episodes: {
        "0": [
          { episode: 8, videoSn: 49053, state: 0, cover: "" },
          { episode: 9, videoSn, state: 1, cover: "https://p2.bahamut.com.tw/ref.JPG" }
        ]
      },
      cover: "https://p2.bahamut.com.tw/anime.JPG",
      tags: ["校園", "喜劇"],
      director: "梅木葵",
      publisher: "Ani-One",
      maker: "Drive",
      score: 4.8,
      reviewCount: 5224,
      popular: 28221,
      favorite: false,
      star: 0,
      userReviewId: 0,
      contentHtml: "<script>not collected</script>"
    },
    relatedAnime: [{ animeSn: 1 }]
  }
});

test("parseMetadataResponse returns one strict episode plus one normalized anime bundle", () => {
  const fetchedAt = new Date("2026-07-14T00:00:00.000Z");
  const bundle = parseMetadataResponse(apiValue(), 49054, fetchedAt);

  assert.deepEqual(bundle.episode, {
    videoSn: 49054,
    animeSn: 114010,
    groupKey: "0",
    episodeIndex: 8,
    episodeNumber: 9,
    availableFrom: new Date("2026-05-20T17:00:00.000Z"),
    availableUntil: null,
    durationMinutes: 23,
    coverUrl: "https://p2.bahamut.com.tw/episode.JPG",
    videoType: 0,
    fetchedAt
  });
  assert.deepEqual(bundle.anime, {
    animeSn: 114010,
    apiTitle: "API 作品標題 [9]",
    totalEpisode: 13,
    seasonStartDateKey: "2026-04-02",
    seasonEndDateKey: "2026-07-02",
    coverUrl: "https://p2.bahamut.com.tw/anime.JPG",
    tags: ["校園", "喜劇"],
    maker: "Drive",
    director: "梅木葵",
    publisher: "Ani-One",
    episodeRefs: [
      { videoSn: 49053, episodeNumber: 8, groupKey: "0", coverUrl: null },
      {
        videoSn: 49054,
        episodeNumber: 9,
        groupKey: "0",
        coverUrl: "https://p2.bahamut.com.tw/ref.JPG"
      }
    ],
    platformSnapshot: {
      score: 4.8,
      reviewCount: 5224,
      popular: 28221,
      observedAt: fetchedAt
    },
    fetchedAt
  });
  assert.notEqual(bundle.episode.fetchedAt, fetchedAt);
  assert.notEqual(bundle.anime.fetchedAt, fetchedAt);
  assert.notEqual(bundle.anime.platformSnapshot.observedAt, fetchedAt);
  assert.equal("relatedAnime" in bundle.anime, false);
  assert.equal("favorite" in bundle.anime, false);
});

test("parseMetadataResponse converts only explicit empty string fields to null", () => {
  const value = apiValue() as {
    data: { video: Record<string, unknown>; anime: Record<string, unknown> };
  };
  value.data.video.cover = "";
  value.data.video.downTime = "2026/07/02 01:00";
  value.data.anime.seasonStart = "";
  value.data.anime.seasonEnd = "";
  value.data.anime.cover = "";
  value.data.anime.maker = "";
  value.data.anime.director = "";
  value.data.anime.publisher = "";

  const bundle = parseMetadataResponse(value, 49054);
  assert.equal(bundle.episode.coverUrl, null);
  assert.equal(bundle.episode.availableUntil?.toISOString(), "2026-07-01T17:00:00.000Z");
  assert.equal(bundle.anime.seasonStartDateKey, null);
  assert.equal(bundle.anime.seasonEndDateKey, null);
  assert.equal(bundle.anime.coverUrl, null);
  assert.equal(bundle.anime.maker, null);
  assert.equal(bundle.anime.director, null);
  assert.equal(bundle.anime.publisher, null);

  value.data.anime.maker = "   ";
  assert.throws(() => parseMetadataResponse(value, 49054), /不可只有空白/);
});

test("real payloads with series sentinels, special episode numbers, and date-only downTime parse", () => {
  const fetchedAt = new Date("2026-10-16T00:00:00.000Z");

  const hayate = parseMetadataResponse(realApiResponse("dateOnlyDownTime"), 30725, fetchedAt);
  assert.equal(hayate.anime.seasonStartDateKey, "2007-04-01");
  assert.equal(hayate.anime.seasonEndDateKey, null);
  assert.equal(hayate.episode.availableFrom.toISOString(), "2025-08-20T04:00:00.000Z");
  // Asia/Taipei 00:00 of 2026/10/31: a lower bound for the end of availability.
  assert.equal(hayate.episode.availableUntil?.toISOString(), "2026-10-30T16:00:00.000Z");
  assert.equal(hayate.episode.coverUrl, null);

  const prologue = parseMetadataResponse(realApiResponse("prologueEpisode"), 45534, fetchedAt);
  assert.equal(prologue.episode.episodeNumber, 0);
  assert.deepEqual(prologue.anime.episodeRefs.map((reference) => reference.episodeNumber), [0, 1, 2]);

  const halfFirst = parseMetadataResponse(realApiResponse("fractionalRequestedEpisode"), 48439, fetchedAt);
  assert.equal(halfFirst.episode.episodeNumber, 12.5);
  assert.deepEqual(halfFirst.anime.episodeRefs.map((reference) => reference.episodeNumber), [12.5, 13, 14]);

  const sibling = parseMetadataResponse(realApiResponse("fractionalSiblingEpisode"), 43990, fetchedAt);
  assert.equal(sibling.episode.episodeNumber, 2);
  assert.deepEqual(sibling.anime.episodeRefs.map((reference) => reference.episodeNumber), [1, 2, 9, 9.5, 10]);
  assert.equal("favorite" in sibling.anime, false);

  assert.throws(
    () => parseMetadataResponse(realApiResponse("unavailable"), 11441, fetchedAt),
    (error) => error instanceof MetadataUnavailableError && error.videoSn === 11441
  );
});

test("only the exact series-date sentinel maps to null", () => {
  const withSeason = (seasonStart: string, seasonEnd: string): Record<string, unknown> => {
    const value = apiValue() as { data: { anime: Record<string, unknown> } };
    value.data.anime.seasonStart = seasonStart;
    value.data.anime.seasonEnd = seasonEnd;
    return value;
  };
  const sentinel = parseMetadataResponse(withSeason("0000/00/00", "0000/00/00"), 49054);
  assert.equal(sentinel.anime.seasonStartDateKey, null);
  assert.equal(sentinel.anime.seasonEndDateKey, null);
  for (const raw of ["0000/00/01", "0000/0/00", " 0000/00/00", "0000-00-00", "2026/02/30"]) {
    assert.throws(() => parseMetadataResponse(withSeason("2026/04/02", raw), 49054), MetadataSchemaError, raw);
  }
});

test("episode numbers accept any finite non-negative number and nothing else", () => {
  const withEpisode = (episode: unknown): Record<string, unknown> => {
    const value = apiValue() as {
      data: { anime: { episodes: Record<string, Array<Record<string, unknown>>> } };
    };
    const target = value.data.anime.episodes["0"]?.[1];
    if (target) target.episode = episode;
    return value;
  };
  for (const episode of [0, 9.5, 12.5, 1_000]) {
    assert.equal(parseMetadataResponse(withEpisode(episode), 49054).episode.episodeNumber, episode);
  }
  for (const episode of [-1, -0.5, Number.POSITIVE_INFINITY, Number.NaN, "9", null]) {
    assert.throws(() => parseMetadataResponse(withEpisode(episode), 49054), /非負有限數字/, String(episode));
  }
});

test("a date-only downTime is the Taipei start of that day, bounded by the release", () => {
  const withAvailability = (upTime: string, downTime: string): Record<string, unknown> => {
    const value = apiValue() as { data: { video: Record<string, unknown> } };
    value.data.video.upTime = upTime;
    value.data.video.downTime = downTime;
    return value;
  };
  assert.equal(
    parseMetadataResponse(withAvailability("2026/05/21 01:00", "2026/07/02"), 49054)
      .episode.availableUntil?.toISOString(),
    "2026-07-01T16:00:00.000Z"
  );
  // The end lies on the release day, so the release instant is the tighter certain bound.
  assert.equal(
    parseMetadataResponse(withAvailability("2026/05/21 01:00", "2026/05/21"), 49054)
      .episode.availableUntil?.toISOString(),
    "2026-05-20T17:00:00.000Z"
  );
  assert.throws(
    () => parseMetadataResponse(withAvailability("2026/05/21 01:00", "2026/05/20"), 49054),
    /不可早於/
  );
  for (const raw of ["2026/02/30", "2026/7/02", "2026/07/02 ", "2026-07-02", "2026/07/02 1:00"]) {
    assert.throws(() => parseMetadataResponse(withAvailability("2026/05/21 01:00", raw), 49054), raw);
  }
});

test("only field failures of an identified payload are schema errors that may be cached", () => {
  const wrongData = apiValue() as { data: { video: Record<string, unknown> } };
  wrongData.data.video.duration = -1;
  assert.throws(() => parseMetadataResponse(wrongData, 49054), MetadataSchemaError);
  const identified = (mutate: (data: { video: Record<string, unknown>; anime: Record<string, unknown> }) => void) => {
    const value = apiValue() as { data: { video: Record<string, unknown>; anime: Record<string, unknown> } };
    mutate(value.data);
    return value;
  };
  for (const envelope of [
    { error: { message: "請求過於頻繁" } },
    { data: {}, error: { message: "unknown" } },
    {},
    // Placeholders a maintenance page or partial outage may return.
    { data: null },
    { data: [] },
    { data: {} },
    { data: { video: {}, anime: {} } },
    apiValue(49055),
    identified((data) => { data.anime.animeSn = 999; }),
    identified((data) => { delete data.video.videoSn; })
  ]) {
    assert.throws(
      () => parseMetadataResponse(envelope, 49054),
      (error) => error instanceof Error && !(error instanceof MetadataSchemaError)
    );
  }
});

test("parseMetadataResponse enforces request, anime, and episode-ref identity", () => {
  const wrongVideo = apiValue(49055);
  assert.throws(() => parseMetadataResponse(wrongVideo, 49054), /videoSn 與請求不一致/);

  const wrongAnime = apiValue() as { data: { anime: Record<string, unknown> } };
  wrongAnime.data.anime.animeSn = 999;
  assert.throws(() => parseMetadataResponse(wrongAnime, 49054), /animeSn 不一致/);

  const duplicate = apiValue() as {
    data: { anime: { episodes: Record<string, unknown[]> } };
  };
  duplicate.data.anime.episodes["1"] = [
    { episode: 1, videoSn: 49054, cover: "https://p2.bahamut.com.tw/duplicate.JPG" }
  ];
  assert.throws(() => parseMetadataResponse(duplicate, 49054), /重複 videoSn/);

  const missing = apiValue() as {
    data: { anime: { episodes: Record<string, Array<Record<string, unknown>>> } };
  };
  missing.data.anime.episodes["0"] = missing.data.anime.episodes["0"]?.filter(
    (entry) => entry.videoSn !== 49054
  ) ?? [];
  assert.throws(() => parseMetadataResponse(missing, 49054), /恰有一筆符合/);

  const blankGroup = apiValue() as {
    data: { anime: { episodes: Record<string, unknown> } };
  };
  blankGroup.data.anime.episodes["   "] = blankGroup.data.anime.episodes["0"];
  delete blankGroup.data.anime.episodes["0"];
  assert.throws(() => parseMetadataResponse(blankGroup, 49054), /group key 長度無效/);
});

test("parseMetadataResponse rejects malformed selected facts instead of guessing", () => {
  const cases: Array<[string, (value: ReturnType<typeof apiValue>) => void]> = [
    ["episodes array", (value) => {
      (value.data as { anime: Record<string, unknown> }).anime.episodes = [];
    }],
    ["invalid release", (value) => {
      (value.data as { video: Record<string, unknown> }).video.upTime = "2026/02/30 01:00";
    }],
    ["insecure cover", (value) => {
      (value.data as { video: Record<string, unknown> }).video.cover = "http://example.com/x.jpg";
    }],
    ["invalid duration", (value) => {
      (value.data as { video: Record<string, unknown> }).video.duration = -1;
    }],
    ["invalid score", (value) => {
      (value.data as { anime: Record<string, unknown> }).anime.score = 6;
    }],
    ["availability interval", (value) => {
      (value.data as { video: Record<string, unknown> }).video.downTime = "2026/05/20 01:00";
    }],
    ["season interval", (value) => {
      const anime = (value.data as { anime: Record<string, unknown> }).anime;
      anime.seasonStart = "2026/07/02";
      anime.seasonEnd = "2026/04/02";
    }]
  ];

  for (const [label, mutate] of cases) {
    const value = apiValue();
    mutate(value);
    assert.throws(() => parseMetadataResponse(value, 49054), label);
  }
});

test("parseMetadataResponse reports only the exact known unavailable response", () => {
  assert.throws(
    () => parseMetadataResponse({
      error: { code: 0, message: "目前無此動畫或動畫授權已到期！", details: [] }
    }, 20219),
    (error) => error instanceof MetadataUnavailableError && error.videoSn === 20219
  );
  assert.throws(
    () => parseMetadataResponse({ error: { message: "unknown" } }, 20219),
    /未識別/
  );
  assert.throws(
    () => parseMetadataResponse({ data: {}, error: { message: "unknown" } }, 20219),
    /恰有/
  );
});

test("Taipei parsers are calendar-valid and timezone-stable", () => {
  assert.equal(parseTaipeiDateTime("2024/02/29 23:59").toISOString(), "2024-02-29T15:59:00.000Z");
  assert.equal(parseTaipeiDateKey("2026/07/14"), "2026-07-14");
  for (const raw of ["2026/2/01 00:00", "2026/02/30 00:00", "2026/04/01 24:00"]) {
    assert.throws(() => parseTaipeiDateTime(raw), raw);
  }
  for (const raw of ["2026/2/01", "2026/02/30", "2026-02-01"]) {
    assert.throws(() => parseTaipeiDateKey(raw), raw);
  }
});

test("cloneMetadataBundle deeply isolates dates and arrays", () => {
  const source = parseMetadataResponse(apiValue(), 49054);
  const clone = cloneMetadataBundle(source);
  assert.deepEqual(clone, source);
  assert.notEqual(clone.episode, source.episode);
  assert.notEqual(clone.episode.availableFrom, source.episode.availableFrom);
  assert.notEqual(clone.anime, source.anime);
  assert.notEqual(clone.anime.tags, source.anime.tags);
  assert.notEqual(clone.anime.episodeRefs, source.anime.episodeRefs);
  assert.notEqual(clone.anime.platformSnapshot.observedAt, source.anime.platformSnapshot.observedAt);
});
