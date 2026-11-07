import { parseArgs } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { GetYouTubeTranscript, GetYouTubeTranscriptError } from '@tubeagentkit/getyoutubetranscript';

import { clearApiKey, configPath, resolveApiKey, saveApiKey } from './config.mjs';

const HELP = `gyt: YouTube transcripts from your terminal (https://getyoutubetranscript.com)

Usage:
  gyt login                        Save your API key (or set GYT_API_KEY)
  gyt logout                       Remove the saved key
  gyt transcript <url|id>          Print a video's transcript
      --lang <code>                Caption language (default en)
      --timestamps                 One [m:ss] line per caption
      --json                       Print the full API response as JSON
  gyt search <query>               Search YouTube videos
      --type video|channel         What to search for (default video)
      --limit <n>                  Max results
      --json
  gyt channel <@handle|url|id>     List a channel's latest videos
      --limit <n>                  Max videos to print (default 20)
      --json
  gyt credits                      Show your remaining credits
  gyt help

An API key is free (100 credits on sign-up): https://getyoutubetranscript.com/developers
`;

function stamp(seconds) {
    const total = Math.floor(seconds);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = String(total % 60).padStart(2, '0');
    return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

async function readKeyFromStdin(io) {
    if (!io.stdin.isTTY) {
        let text = '';
        for await (const chunk of io.stdin) text += chunk;
        return text.trim();
    }
    const rl = createInterface({ input: io.stdin, output: io.stderr });
    try {
        return (await rl.question('API key (sk_live_...): ')).trim();
    } finally {
        rl.close();
    }
}

async function client(io) {
    const apiKey = await resolveApiKey(io.env);
    if (!apiKey) throw new UsageError('No API key. Run `gyt login` or set GYT_API_KEY. Get a free key: https://getyoutubetranscript.com/developers');
    return new GetYouTubeTranscript({ apiKey, ...(io.env.GYT_API_BASE ? { baseUrl: io.env.GYT_API_BASE } : {}) });
}

class UsageError extends Error {}

const COMMANDS = {
    async login(_args, io) {
        const apiKey = await readKeyFromStdin(io);
        if (!/^sk_/.test(apiKey)) throw new UsageError('That does not look like an API key (they start with sk_).');
        const api = new GetYouTubeTranscript({ apiKey, ...(io.env.GYT_API_BASE ? { baseUrl: io.env.GYT_API_BASE } : {}) });
        const credits = await api.getCredits(); // free endpoint: proves the key works before saving it
        const file = await saveApiKey(apiKey, io.env);
        io.stdout.write(`Saved to ${file}. ${credits.plan_credits_left + credits.topup_credits_left} credits left.\n`);
    },

    async logout(_args, io) {
        await clearApiKey(io.env);
        io.stdout.write(`Removed ${configPath(io.env)}.\n`);
    },

    async transcript(args, io) {
        const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { lang: { type: 'string' }, timestamps: { type: 'boolean' }, json: { type: 'boolean' } } });
        if (positionals.length !== 1) throw new UsageError('Usage: gyt transcript <youtube url or video id>');
        const data = await (await client(io)).getTranscript({ v: positionals[0], language: values.lang, timestamps: values.timestamps });
        if (values.json) return io.stdout.write(JSON.stringify(data, null, 2) + '\n');
        if (values.timestamps && data.segments) {
            io.stdout.write(data.segments.map((segment) => `[${stamp(segment.start)}] ${segment.text}`).join('\n') + '\n');
        } else {
            io.stdout.write(`${data.transcript}\n`);
        }
    },

    async search(args, io) {
        const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { type: { type: 'string' }, limit: { type: 'string' }, json: { type: 'boolean' } } });
        if (positionals.length === 0) throw new UsageError('Usage: gyt search <query>');
        if (values.type && !['video', 'channel'].includes(values.type)) throw new UsageError('--type must be video or channel.');
        const limit = values.limit === undefined ? undefined : Number(values.limit);
        if (limit !== undefined && (!Number.isInteger(limit) || limit < 1)) throw new UsageError('--limit must be a positive whole number.');
        const data = await (await client(io)).search({ q: positionals.join(' '), type: values.type, limit });
        if (values.json) return io.stdout.write(JSON.stringify(data, null, 2) + '\n');
        for (const video of data.video_results ?? []) io.stdout.write(`${video.videoId}\t${video.title}\n`);
        for (const channel of data.channel_results ?? []) io.stdout.write(`${channel.channelId}\t${channel.title}\n`);
    },

    async channel(args, io) {
        const { values, positionals } = parseArgs({ args, allowPositionals: true, options: { limit: { type: 'string' }, json: { type: 'boolean' } } });
        if (positionals.length !== 1) throw new UsageError('Usage: gyt channel <@handle, channel url or id>');
        const limit = values.limit === undefined ? 20 : Number(values.limit);
        if (!Number.isInteger(limit) || limit < 1) throw new UsageError('--limit must be a positive whole number.');
        const data = await (await client(io)).listChannelVideos({ channel: positionals[0] });
        const videos = data.videos.slice(0, limit);
        if (values.json) return io.stdout.write(JSON.stringify({ ...data, videos }, null, 2) + '\n');
        for (const video of videos) io.stdout.write(`${video.id}\t${video.title}\n`);
    },

    async credits(_args, io) {
        const data = await (await client(io)).getCredits();
        io.stdout.write(`plan: ${data.plan}\nplan credits left: ${data.plan_credits_left}\ntop-up credits left: ${data.topup_credits_left}\n`);
    },
};

/** Returns the process exit code. `io` is injectable so tests run it in-process. */
export async function run(argv, io = { env: process.env, stdin: process.stdin, stdout: process.stdout, stderr: process.stderr }) {
    const [command, ...rest] = argv;
    if (!command || command === 'help' || command === '--help' || command === '-h') {
        io.stdout.write(HELP);
        return 0;
    }
    const handler = COMMANDS[command];
    if (!handler) {
        io.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
        return 2;
    }
    try {
        await handler(rest, io);
        return 0;
    } catch (error) {
        if (error instanceof UsageError) {
            io.stderr.write(`${error.message}\n`);
            return 2;
        }
        if (error instanceof GetYouTubeTranscriptError) {
            io.stderr.write(`Error ${error.statusCode} ${error.code}: ${error.message}\n`);
            return 1;
        }
        if (error?.code === 'ERR_PARSE_ARGS_UNKNOWN_OPTION') {
            io.stderr.write(`${error.message}\n`);
            return 2;
        }
        io.stderr.write(`Failed: ${error instanceof Error ? error.message : String(error)}\n`);
        return 1;
    }
}
