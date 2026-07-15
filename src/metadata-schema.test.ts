import assert from "node:assert/strict";
import { test } from "vitest";
import {
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
