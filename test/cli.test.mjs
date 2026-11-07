import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { after, before, test } from 'node:test';

import { run } from '../src/cli.mjs';

let server;
let base;
const seen = [];

before(async () => {
    server = createServer((req, res) => {
        const url = new URL(req.url, 'http://x');
        seen.push({ path: url.pathname, query: Object.fromEntries(url.searchParams), auth: req.headers.authorization });
        const send = (status, body) => {
            res.writeHead(status, { 'content-type': 'application/json' });
            res.end(JSON.stringify(body));
        };
        if (req.headers.authorization !== 'Bearer sk_live_good') return send(401, { success: false, code: 'INVALID_API_KEY', message: 'Bad key' });
        if (url.pathname === '/credits') return send(200, { success: true, data: { plan_credits_left: 90, topup_credits_left: 10, plan: 'free', rate_limit_per_minute: 60 } });
        if (url.pathname === '/transcript') {
            const data = { video_id: 'abc', title: 'T', transcript: 'hello world', cached: false };
            if (url.searchParams.get('timestamps') === 'true') data.segments = [{ start: 3.96, duration: 2, text: 'hello' }, { start: 3725, duration: 2, text: 'late' }];
            return send(200, { success: true, data });
        }
        if (url.pathname === '/search') return send(200, { success: true, data: { video_results: [{ videoId: 'v1', title: 'Video one' }], channel_results: [] } });
        if (url.pathname === '/channel/videos') return send(200, { success: true, data: { videos: [{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }], has_more: false } });
        send(404, { success: false, code: 'NOT_FOUND', message: 'nope' });
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

async function exec(argv, { key = 'sk_live_good', stdin = '' } = {}) {
    const dir = await mkdtemp(join(tmpdir(), 'gyt-test-'));
    const out = [];
    const err = [];
    const env = { GYT_API_BASE: base, GYT_CONFIG_DIR: dir, ...(key ? { GYT_API_KEY: key } : {}) };
    const input = Readable.from([stdin]);
    input.isTTY = false;
    const code = await run(argv, { env, stdin: input, stdout: { write: (t) => out.push(t) }, stderr: { write: (t) => err.push(t) } });
    return { code, out: out.join(''), err: err.join(''), dir };
}

test('help prints usage and exits 0', async () => {
    const r = await exec(['help']);
    assert.equal(r.code, 0);
    assert.match(r.out, /gyt transcript/);
});

test('unknown command exits 2', async () => {
    assert.equal((await exec(['nope'])).code, 2);
});

test('transcript prints the text and sends the bearer key', async () => {
    seen.length = 0;
    const r = await exec(['transcript', 'dQw4w9WgXcQ']);
    assert.equal(r.code, 0);
    assert.equal(r.out, 'hello world\n');
    assert.equal(seen[0].auth, 'Bearer sk_live_good');
});

test('--timestamps prints m:ss and h:mm:ss lines', async () => {
    const r = await exec(['transcript', 'abc', '--timestamps']);
    assert.equal(r.out, '[0:03] hello\n[1:02:05] late\n');
});

test('--json prints the response data', async () => {
    const r = await exec(['transcript', 'abc', '--json']);
    assert.equal(JSON.parse(r.out).transcript, 'hello world');
});

test('search prints id and title', async () => {
    const r = await exec(['search', 'cats', 'and', 'dogs']);
    assert.equal(r.out, 'v1\tVideo one\n');
    assert.equal(seen.at(-1).query.q, 'cats and dogs');
});

test('search rejects a bad --limit without calling the API', async () => {
    seen.length = 0;
    const r = await exec(['search', 'x', '--limit', '0']);
    assert.equal(r.code, 2);
    assert.equal(seen.length, 0);
});

test('channel honours --limit', async () => {
    const r = await exec(['channel', '@x', '--limit', '1']);
    assert.equal(r.out, 'a\tA\n');
});

test('credits shows the balances', async () => {
    const r = await exec(['credits']);
    assert.match(r.out, /plan credits left: 90/);
});

test('a missing key explains how to get one', async () => {
    const r = await exec(['credits'], { key: null });
    assert.equal(r.code, 2);
    assert.match(r.err, /gyt login/);
});

test('an API error shows its status and code, exit 1', async () => {
    const r = await exec(['credits'], { key: 'sk_live_bad' });
    assert.equal(r.code, 1);
    assert.match(r.err, /401 INVALID_API_KEY/);
});

test('login verifies the key, then saves it with owner-only permissions', async () => {
    const r = await exec(['login'], { key: null, stdin: 'sk_live_good\n' });
    assert.equal(r.code, 0);
    const file = join(r.dir, 'config.json');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).apiKey, 'sk_live_good');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
});

test('login refuses a key the API rejects and saves nothing', async () => {
    const r = await exec(['login'], { key: null, stdin: 'sk_live_bad\n' });
    assert.equal(r.code, 1);
    await assert.rejects(stat(join(r.dir, 'config.json')));
});

test('login refuses something that is not a key', async () => {
    const r = await exec(['login'], { key: null, stdin: 'hello\n' });
    assert.equal(r.code, 2);
});
