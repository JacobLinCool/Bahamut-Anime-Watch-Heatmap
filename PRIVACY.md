# Privacy Policy

Last updated: 2026-07-14

Bahamut Anime Watch Heatmap is a browser extension that visualizes and analyzes watch history on Bahamut Anime (`ani.gamer.com.tw`).

## Data Access

The extension's page integration runs only on `https://ani.gamer.com.tw/*`. On Bahamut Anime watch history pages, it reads information already present in the page, including episode links, watch dates, watch times, anime titles, and episode labels. This data is used locally to render the heatmap, calculate selected-period summaries and rankings, and build personal recap presentations.

The extension stores the selected day-boundary preference (`24H` or `30H`) in the extension's `chrome.storage.local`. It does not write this preference into Bahamut Anime's site storage.

To avoid repeatedly requesting the same metadata, the extension also stores strictly validated episode and anime records in `chrome.storage.local`:

- Episode records: episode and anime numeric IDs, the exact API playback-group key, episode index and number, official availability start and end, duration, cover URL, video type, and retrieval time.
- Anime records: anime numeric ID and title, total episode count, declared season start and end, cover URL, tags, maker, director, publisher, episode index references, the platform score/review-count/popularity snapshot, and retrieval time.
- Temporarily unavailable records: the numeric episode ID and the time the unavailable response was observed. An unavailable result is reused for no more than one hour.

Watch dates and watch times are not written to the metadata cache. Validated episode and anime records remain in the user's browser until the cache is cleared or the extension is uninstalled; changing platform values retain their retrieval timestamp. Cached metadata can be removed with **Clear metadata cache** in the analysis header, by clearing the extension's data, or by uninstalling the extension. The in-extension action removes only metadata cache records and then retrieves needed metadata again; it does not remove watch history or the day-boundary preference.

The analysis header also offers a user-initiated debug download. The generated JSON stays on the user's device and contains the currently loaded watch records, normalized episode and anime metadata, collection progress and parse issues, metadata error classifications, raw extension metadata-cache entries (including temporary unavailable records), and the metadata rate-limit coordination state. It does not contain cookies, login credentials, account-oriented API fields, or page HTML. The extension does not upload this file; the user decides whether to share it.

While the browser session is open, `chrome.storage.session` stores a random cache epoch and up to ten recent request-start timestamps. The epoch prevents requests from an older cache generation from writing after a clear, and the timestamps preserve the extension-wide rolling rate limit if the Manifest V3 service worker restarts. Neither record contains watch history, titles, or episode metadata.

## Data Collection and Sharing

The extension first sends the numeric episode ID (`videoSn`) from each watched episode link to Bahamut's official API at `https://api.gamer.com.tw/anime/v1/video.php`. A successful watched response identifies the exact playback group containing that episode. The extension progressively requests other episode IDs only inside playback groups that have been observed this way; groups the user has not started are not expanded. This lets it verify which watched and unwatched episodes were actually pending without guessing. Requests use `credentials: "omit"`, are globally de-duplicated, and their starts across all extension tabs are limited to ten in every rolling one-second window. The extension does not send watch times, anime titles, calculated analysis, or page content with these requests.

The API response may contain account-oriented fields such as `favorite`, `star`, or `userReviewId`. The extension does not read, use, or store those fields. Cover images used in the analysis and recap are loaded directly from the HTTPS URLs returned by Bahamut's API with a `no-referrer` policy.

The extension does not send watch history or analysis to the developer, advertising services, or analytics services. It does not sell or share user data, and the developer does not operate a remote database for extension data. As with any directly loaded image, the host serving a displayed cover receives the ordinary network connection and request headers, but the request contains no page referrer, watch history, or calculated analysis.

## Remote Code

The extension does not load or execute remote JavaScript, WebAssembly, or other remotely hosted executable code. All extension code is included in the packaged extension.

## Permissions

The extension needs access to `https://ani.gamer.com.tw/*` so its content script can read the watch history page and insert the isolated heatmap and analysis UI. It needs access to `https://api.gamer.com.tw/*` so the service worker can request official episode and anime metadata inside the extension-wide rate limiter.

The `storage` permission is used only for the local preference, validated metadata cache, unavailable-response records, and transient coordination records described above.

## Contact

For privacy questions, contact JacobLinCool at `jacoblincool@gmail.com`.
