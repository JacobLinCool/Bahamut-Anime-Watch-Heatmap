/**
 * Real api.gamer.com.tw/anime/v1/video.php responses, fetched with credentials
 * omitted in 2026-10 and trimmed: descriptive text, presentation-only fields and
 * most of each playback group are removed. Each keeps the exact shape that the
 * first parser version rejected.
 */
const RESPONSES = {
  dateOnlyDownTime: {
    data: {
      video: {
        videoSn: 30725,
        animeSn: 113114,
        duration: 24,
        rating: 3,
        type: 0,
        cover: "",
        upTime: "2025/08/20 12:00",
        downTime: "2026/10/31",
        title: "旋風管家！ [1]"
      },
      anime: {
        animeSn: 113114,
        title: "旋風管家！ [1]",
        totalEpisode: 52,
        seasonStart: "2007/04/01",
        seasonEnd: "0000/00/00",
        favorite: false,
        popular: 31208,
        episodeIndex: 0,
        episodes: {
          "0": [
            { episode: 1, videoSn: 30725, state: 1, cover: "" },
            { episode: 2, videoSn: 30726, state: 0, cover: "" },
            { episode: 3, videoSn: 30727, state: 0, cover: "" }
          ]
        },
        cover: "https://p2.bahamut.com.tw/B/ACG/c/89/0000017589.JPG",
        tags: ["喜劇", "戀愛"],
        director: "川口敬一郎",
        publisher: "Ani-One",
        maker: "SynergySP",
        score: 4.6,
        reviewCount: 1746,
        star: 0,
        userReviewId: 0
      }
    }
  },
  prologueEpisode: {
    data: {
      video: {
        videoSn: 45534,
        animeSn: 113894,
        duration: 24,
        rating: 3,
        type: 0,
        cover: "https://p2.bahamut.com.tw/B/2KU/46/5fcd835ef5096d8be48b79e0c01vuuy5.JPG",
        upTime: "2025/09/25 23:56",
        downTime: "",
        title: "永遠的黃昏 [0]"
      },
      anime: {
        animeSn: 113894,
        title: "永遠的黃昏 [0]",
        totalEpisode: 13,
        seasonStart: "2025/09/25",
        seasonEnd: "2026/01/02",
        favorite: false,
        popular: 82639,
        episodeIndex: 0,
        episodes: {
          "0": [
            {
              episode: 0,
              videoSn: 45534,
              state: 1,
              cover: "https://p2.bahamut.com.tw/B/2KU/46/5fcd835ef5096d8be48b79e0c01vuuy5.JPG"
            },
            {
              episode: 1,
              videoSn: 45535,
              state: 0,
              cover: "https://p2.bahamut.com.tw/B/2KU/47/146c1c7bfa78a007da929eedd71vykb5.JPG"
            },
            {
              episode: 2,
              videoSn: 45536,
              state: 0,
              cover: "https://p2.bahamut.com.tw/B/2KU/56/ed628f3f681aa9d6dcb14255db1w19s5.JPG"
            }
          ]
        },
        cover: "https://p2.bahamut.com.tw/B/ACG/c/29/0000146029.JPG",
        tags: ["動作", "科幻", "戀愛"],
        director: "津田尚克",
        publisher: "回歸線娛樂",
        maker: "P.A.WORKS",
        score: 4,
        reviewCount: 3671,
        star: 0,
        userReviewId: 0
      }
    }
  },
  fractionalRequestedEpisode: {
    data: {
      video: {
        videoSn: 48439,
        animeSn: 114036,
        duration: 23,
        rating: 3,
        type: 0,
        cover: "https://p2.bahamut.com.tw/B/2KU/57/a24b52379e202984775cb642761y5l15.JPG",
        upTime: "2026/04/05 16:30",
        downTime: "",
        title: "杖與劍的魔劍譚 Season 2 [12.5]"
      },
      anime: {
        animeSn: 114036,
        title: "杖與劍的魔劍譚 Season 2 [12.5]",
        totalEpisode: 13,
        seasonStart: "2026/04/05",
        seasonEnd: "2026/07/06",
        favorite: false,
        popular: 138021,
        episodeIndex: 0,
        episodes: {
          "0": [
            {
              episode: 12.5,
              videoSn: 48439,
              state: 1,
              cover: "https://p2.bahamut.com.tw/B/2KU/57/a24b52379e202984775cb642761y5l15.JPG"
            },
            {
              episode: 13,
              videoSn: 48440,
              state: 0,
              cover: "https://p2.bahamut.com.tw/B/2KU/78/4676a204325ba2e40389dd94b31y6zm5.JPG"
            },
            {
              episode: 14,
              videoSn: 48441,
              state: 0,
              cover: "https://p2.bahamut.com.tw/B/2KU/66/b44c3bf65052d309a0f08907de1ybau5.JPG"
            }
          ]
        },
        cover: "https://p2.bahamut.com.tw/B/ACG/c/66/0000141666.JPG",
        tags: ["動作", "冒險", "奇幻", "魔法", "血腥暴力"],
        director: "吉原達矢、中野英明",
        publisher: "木棉花",
        maker: "BN Pictures、Actas",
        score: 4.8,
        reviewCount: 9796,
        star: 0,
        userReviewId: 0
      }
    }
  },
  fractionalSiblingEpisode: {
    data: {
      video: {
        videoSn: 43990,
        animeSn: 113826,
        duration: 24,
        rating: 2,
        type: 0,
        cover: "https://p2.bahamut.com.tw/B/2KU/94/d5f5fcc513faa06158adcc1d801uw925.JPG",
        upTime: "2025/07/12 00:30",
        downTime: "",
        title: "Silent Witch 沉默魔女的祕密 [2]"
      },
      anime: {
        animeSn: 113826,
        title: "Silent Witch 沉默魔女的祕密 [2]",
        totalEpisode: 14,
        seasonStart: "2025/07/05",
        seasonEnd: "2025/10/11",
        favorite: false,
        popular: 404597,
        episodeIndex: 1,
        episodes: {
          "0": [
            {
              episode: 1,
              videoSn: 43989,
              state: 0,
              cover: "https://p2.bahamut.com.tw/B/2KU/63/68212e6f2bdc2b6f50ab7af1691utlr5.JPG"
            },
            {
              episode: 2,
              videoSn: 43990,
              state: 1,
              cover: "https://p2.bahamut.com.tw/B/2KU/94/d5f5fcc513faa06158adcc1d801uw925.JPG"
            },
            {
              episode: 9,
              videoSn: 44760,
              state: 0,
              cover: "https://p2.bahamut.com.tw/B/2KU/29/33657513e37d561f966fe03cb11vit55.JPG"
            },
            {
              episode: 9.5,
              videoSn: 44916,
              state: 0,
              cover: "https://p2.bahamut.com.tw/B/2KU/95/26d3fa15aa92e1a7df7693f81e1vly35.JPG"
            },
            {
              episode: 10,
              videoSn: 45299,
              state: 0,
              cover: "https://p2.bahamut.com.tw/B/2KU/69/1df821d79c971f5599b25a974f1vnmh5.JPG"
            }
          ]
        },
        cover: "https://p2.bahamut.com.tw/B/ACG/c/67/0000140667.JPG",
        tags: ["冒險", "奇幻", "魔法", "校園"],
        director: "金崎貴臣、岩本保雄",
        publisher: "曼迪",
        maker: "Studio五組",
        score: 4.9,
        reviewCount: 23885,
        star: 0,
        userReviewId: 0
      }
    }
  },
  unavailable: {
    error: {
      code: 0,
      message: "目前無此動畫或動畫授權已到期！",
      status: "",
      details: []
    }
  }
} as const;

export type RealApiResponseName = keyof typeof RESPONSES;

export const realApiResponse = (name: RealApiResponseName): Record<string, unknown> =>
  structuredClone(RESPONSES[name]) as unknown as Record<string, unknown>;
