# gyt: YouTube transcripts from your terminal

Command line for the [GetYouTubeTranscript](https://getyoutubetranscript.com) API: get a YouTube video's transcript, search YouTube, list a channel's videos. Built on the official [Node.js SDK](https://github.com/tubeagentkit/youtube-transcript-api-node).

```bash
npm install -g @tubeagentkit/cli
gyt login            # paste your API key (100 credits on sign-up: https://getyoutubetranscript.com/developers)
gyt transcript https://www.youtube.com/watch?v=dQw4w9WgXcQ
```

Needs Node 18 or newer.

## Commands

| Command | What it does |
| --- | --- |
| `gyt login` | Checks your API key against the API (a free call), then saves it to `~/.config/gyt/config.json` with owner-only permissions. Reads the key from stdin when piped. |
| `gyt logout` | Deletes the saved key. |
| `gyt transcript <url or id>` | Prints the transcript. `--timestamps` prints one `[m:ss]` line per caption, `--lang es` picks a language, `--json` prints the full response. |
| `gyt search <query>` | Lists matching videos as `id<TAB>title`. `--type channel`, `--limit 5`, `--json`. |
| `gyt channel <@handle, url or id>` | Lists a channel's latest videos. `--limit 20` (default), `--json`. |
| `gyt credits` | Shows your plan and remaining credits (free call). |

## Use in scripts

The key comes from `GYT_API_KEY` (or `YOUTUBE_TRANSCRIPT_API_KEY`) first, so CI never needs a saved file:

```bash
GYT_API_KEY=sk_live_... gyt transcript dQw4w9WgXcQ --json | jq -r .transcript
```

Output goes to stdout and errors to stderr. Exit codes: `0` success, `1` API or network error, `2` wrong usage (bad option, missing key).

## Credits

A transcript costs 1 credit, with or without timestamps. A search page or a channel video page costs 1 credit. Failed requests are not charged. See the [API docs](https://getyoutubetranscript.com/docs) for every endpoint's cost.

## License

MIT.
