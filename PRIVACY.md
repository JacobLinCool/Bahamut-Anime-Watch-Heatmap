# Privacy Policy

Last updated: 2026-11-20

Bahamut Anime Watch Recap (formerly Bahamut Anime Watch Heatmap) is a browser extension that visualizes and analyzes watch history on Bahamut Anime (`ani.gamer.com.tw`).

## Data Access

The extension's page integration runs only on `https://ani.gamer.com.tw/*`. On Bahamut Anime watch history pages, it reads information already present in the page, including episode links, watch dates, watch times, anime titles, and episode labels. This data is used locally to render the heatmap, calculate selected-period summaries and rankings, and build personal recap presentations.

The extension stores the selected day-boundary preference (`24H` or `30H`) in the extension's `chrome.storage.local`. It does not write this preference into Bahamut Anime's site storage.

So that a revisit can show the heatmap at once, the extension also keeps a local copy of the watch history it has read, in one `chrome.storage.local` record (`ani-gamer-heatmap:history:v1`):

- Each watched episode's numeric ID, watch time, how precisely the page stated that time (to the minute or only to the hour), anime title, and episode label, limited to the last 400 days.
- When the page was last read, when it was last read in full, and whether that read was complete.
- A SHA-256 hash of the Bahamut account ID, used only to tell accounts apart. The ID is read locally from the site's `BAHAID` cookie, validated the same way Bahamut's own page script does, and never stored, exported, or sent anywhere. Because account IDs are public, the hash does not hide which account the saved history belongs to from someone who can read this browser profile's extension storage and knows or guesses the ID. The saved history is used only when the hash matches the account that is currently logged in; for any other account it is ignored and replaced after that account's history is read. Without a logged-in account, nothing is saved, and a page whose logged-in account changes after it loads is neither read nor saved.

The saved history is refreshed whenever the extension reads the watch history page. It is not refreshed when the logged-in account changed after the page loaded, or when another tab already saved a newer read. It is never sent anywhere. Clearing the metadata cache does not remove it; uninstalling the extension does.

To avoid repeatedly requesting the same metadata, the extension also stores strictly validated episode and anime records in `chrome.storage.local`:

- Episode records: episode and anime numeric IDs, the exact API playback-group key, episode index and number, official availability start and end, duration, cover URL, video type, and retrieval time.
- Anime records: anime numeric ID and title, total episode count, declared season start and end, cover URL, tags, maker, director, publisher, episode index references, the platform score/review-count/popularity snapshot, and retrieval time.
- Unavailable records: the numeric episode ID, when the unavailable response was first and last observed, and how many refetches confirmed it again. An unavailable result is reused for one day, four times longer after each confirmation up to seven days, varied by a fixed ±20% per episode so records do not all expire together (at most 8.4 days).
- Invalid-response records: the numeric episode ID, the observation time, the parser version, and the validation message for a response that identified the requested episode but failed validation. They are reused for at most 24 hours, and never after the extension's parsing rules change. Network errors, HTTP errors (including rate limiting), empty or placeholder responses, and responses for another episode are never cached.

Watch dates and watch times are not written to the metadata cache. Validated episode and anime records remain in the user's browser until the cache is cleared or the extension is uninstalled; changing platform values retain their retrieval timestamp. Cached metadata can be removed with **Clear metadata cache** in the analysis header, by clearing the extension's data, or by uninstalling the extension. The in-extension action removes only metadata cache records and then retrieves needed metadata again; it does not remove watch history, the saved history copy, or the day-boundary preference.

The analysis header also offers a user-initiated debug download. The generated JSON stays on the user's device and contains the currently loaded watch records, normalized episode and anime metadata, collection progress and parse issues, history loading diagnostics (source, page counts, and timings), metadata error classifications, raw extension metadata-cache entries (including unavailable and invalid-response records), cache policy values, and the metadata rate-limit coordination state. It does not contain cookies, the account ID or its hash, login credentials, account-oriented API fields, or page HTML. The extension does not upload this file; the user decides whether to share it.

While the browser session is open, `chrome.storage.session` stores a random cache epoch, up to ten recent request-start timestamps, and a diagnostics log of up to 2,000 recent request-start timestamps. The epoch prevents requests from an older cache generation from writing after a clear, the ten timestamps preserve the extension-wide rolling rate limit if the Manifest V3 service worker restarts, and the log lets a debug download report how many requests a collection made. None of these records contains watch history, titles, or episode metadata.

## Data Collection and Sharing

The extension first sends the numeric episode ID (`videoSn`) from each watched episode link to Bahamut's official API at `https://api.gamer.com.tw/anime/v1/video.php`. A successful watched response identifies the exact playback group containing that episode. The extension progressively requests other episode IDs only inside playback groups that have been observed this way; groups the user has not started are not expanded. This lets it verify which watched and unwatched episodes were actually pending without guessing. Requests use `credentials: "omit"`, are globally de-duplicated, and their starts across all extension tabs are limited to ten in every rolling one-second window. The extension does not send watch times, anime titles, calculated analysis, or page content with these requests.

The API response may contain account-oriented fields such as `favorite`, `star`, or `userReviewId`. The extension does not read, use, or store those fields. Cover images used in the analysis and recap are loaded directly from the HTTPS URLs returned by Bahamut's API with a `no-referrer` policy.

The extension does not send watch history or analysis to the developer, advertising services, or analytics services. It does not sell or share user data, and the developer does not operate a remote database for extension data. As with any directly loaded image, the host serving a displayed cover receives the ordinary network connection and request headers, but the request contains no page referrer, watch history, or calculated analysis.

## Remote Code

The extension does not load or execute remote JavaScript, WebAssembly, or other remotely hosted executable code. All extension code is included in the packaged extension.

## Permissions

The extension needs access to `https://ani.gamer.com.tw/*` so its content script can read the watch history page (including the `BAHAID` cookie used only to scope the saved history) and insert the isolated heatmap and analysis UI. It needs access to `https://api.gamer.com.tw/*` so the service worker can request official episode and anime metadata inside the extension-wide rate limiter.

The `storage` permission is used only for the local preference, the saved watch history, the validated metadata cache, the unavailable and invalid-response records, and the transient coordination records described above.

## Contact

For privacy questions, contact JacobLinCool at `jacoblincool@gmail.com`.
