# Bahamut Anime Watch Heatmap

Browser extension for `ani.gamer.com.tw` that turns the available year of watch history into a heatmap, explainable behavior analysis, and a presentation-style personal recap.

## Features

- Hover a heatmap day to see watched titles, episode labels, and watch times.
- Switch watched days between calendar days (`24H`) and a late-night-friendly 6 a.m. boundary (`30H`). Official release dates always use natural Asia/Taipei calendar boundaries.
- Open **分析** to choose either the watch-time axis or official-release-time axis, then explore the past 30 days, past 365 days, recent calendar months, recent seasons, or calendar years.
- See actual release-season distribution, viewing rhythm, known episode-length totals, longest episodes, release-to-watch delay, behavior preference, tags, makers, directors, publishers, and a comparison with the platform popularity snapshot captured when metadata was retrieved.
- Play the same analysis pipeline as a full-screen recap for a rolling range, month, season, or year. A calendar-year release recap is assembled from winter, spring, summer, and autumn without double-counting a series across seasons.
- Use the analysis header to clear only the extension's metadata cache and retrieve it again. Watch history and the day-boundary preference are not deleted.
- Download a local debug JSON from the analysis header. It contains analysis-ready watch and metadata rows plus cache, unavailable-response, progress, and rate-limit diagnostics; it never includes cookies or login credentials.

Both the heatmap and the full-screen analysis UI live in Shadow DOM. Their styles do not leak into Bahamut Anime, and hostile page CSS cannot restyle the extension UI.

## Metadata and Analysis Rules

Release times and catalog facts come from Bahamut's first-party episode metadata API. The response is normalized into one cached episode record and one cached anime record instead of repeating the complete anime payload for every episode.

Watched episode IDs are resolved first. Each successful watched response identifies its exact `anime.episodes` playback group; only references inside those observed groups enter the lower-priority discovery queue. Unstarted groups from the same anime index are not fetched. Every observed group expands to a fixed point, is globally de-duplicated, and still goes through the same extension-wide ten-request rolling limit. These started-group timelines are used only where logically required, such as proving which episodes were genuinely pending at a decision moment.

- Each episode's `upTime` is the primary fact used to assign winter, spring, summer, or autumn. `seasonStart` and `seasonEnd` are only series-level boundary and consistency evidence; they never override episode release dates.
- `duration` is the length of the episode, not proof of time spent playing it. It is summed once per selected watch record for content-length totals and rankings. A value is called a total only when duration coverage for the selected events is 100%; otherwise the UI shows the known subtotal and does not extrapolate from an assumed episode length.
- Release footprints describe only the selected episodes that the user actually watched. They are not presented as the complete airing structure of a series.
- A playback group can become a pending choice only after its first observed watch. Episodes must be released strictly after that start and still be available at the decision moment; earlier episodes are never retroactively labeled backlog. Multiple API playback groups remain isolated because their semantics are not guessed, and same-series continuation within 60 minutes is excluded as a new preference decision.
- Platform score, review count, and popularity are labeled with their retrieval time. They are current snapshots, not historical values from when the user watched an episode, and popularity ranks are only within the metadata-covered comparison set.
- Missing, malformed, or internally inconsistent facts—including a release time later than the recorded watch—are excluded instead of guessed. Each ranking and recap chapter uses the facts available to that result, so a missing record does not hide unrelated insights.

One extension service worker owns metadata fetching for all open tabs. Combined request starts are limited to ten in every rolling one-second window, and the grants are stored in session storage so restarting the Manifest V3 worker does not reset the active budget. Requests use `credentials: "omit"`; account-oriented response fields such as `favorite`, `star`, and `userReviewId` are not used or stored.

Privacy policy: [PRIVACY.md](./PRIVACY.md)

![Heatmap screenshot](assets/screenshot.png)

## Development

```sh
pnpm install
pnpm test
pnpm typecheck
pnpm build
```

## Package for Publishing

```sh
pnpm package
```

The publishable browser extension zip is written to `release/`.
Upload that zip in the Chrome Web Store Developer Dashboard.

Chrome Web Store listing assets are in `assets/store-listing/chrome/`:

- `small-promo-440x280.png`
- `marquee-1400x560.png`
- `screenshot-1280x800.png`

Run `pnpm assets:store` to regenerate the extension icons and crop the store listing images from `assets/screenshot.png`.

## Load Locally

1. Run `pnpm build`.
2. Open Chrome or Edge extension settings.
3. Enable developer mode.
4. Load the generated `dist/` directory as an unpacked extension.
5. Visit the [Bahamut Anime watch history page](https://ani.gamer.com.tw/viewList.php) while logged in.
