import { chmod, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

/** Where `gyt login` keeps the key: the XDG config dir, or ~/.config. Overridable for tests. */
export function configPath(env = process.env) {
    const base = env.GYT_CONFIG_DIR || join(env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'gyt');
    return join(base, 'config.json');
}

/** The key from the environment first (so CI never needs a file), then the saved one. */
export async function resolveApiKey(env = process.env) {
    const fromEnv = env.GYT_API_KEY || env.YOUTUBE_TRANSCRIPT_API_KEY;
    if (fromEnv) return fromEnv.trim();
    try {
        const saved = JSON.parse(await readFile(configPath(env), 'utf8'));
        return typeof saved.apiKey === 'string' ? saved.apiKey : null;
    } catch {
        return null;
    }
}

export async function saveApiKey(apiKey, env = process.env) {
    const file = configPath(env);
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    await writeFile(file, JSON.stringify({ apiKey }) + '\n', { mode: 0o600 });
    await chmod(file, 0o600);
    return file;
}

export async function clearApiKey(env = process.env) {
    await rm(configPath(env), { force: true });
}
