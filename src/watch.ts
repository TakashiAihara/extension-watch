import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { diff, split } from "./diff";
import { readAll, type Snapshot } from "./profile";

// ntfy's default message-size-limit is 4096 bytes and servers without attachments reject longer
// bodies with 400; the rest is room for the "(1/2) " prefix.
const MAX_BYTES = 4080;
const SEND_TIMEOUT_MS = 10000;

type Env = { [k: string]: string | undefined };

export function paths(env: Env = process.env, platform = process.platform) {
  const home = env.HOME ?? env.USERPROFILE ?? homedir();
  if (platform === "win32") {
    const local = env.LOCALAPPDATA ?? join(home, "AppData", "Local");
    return {
      config: join(env.APPDATA ?? join(home, "AppData", "Roaming"), "extension-watch", "config.json"),
      state: join(local, "extension-watch", "state.json"),
      chrome: join(local, "Google", "Chrome", "User Data"),
    };
  }
  return {
    config: join(env.XDG_CONFIG_HOME ?? join(home, ".config"), "extension-watch", "config.json"),
    state: join(env.XDG_STATE_HOME ?? join(home, ".local", "state"), "extension-watch", "state.json"),
    chrome:
      platform === "darwin"
        ? join(home, "Library", "Application Support", "Google", "Chrome")
        : join(home, ".config", "google-chrome"),
  };
}

type Config = { ntfyUrl: string; ntfyToken?: string; chromeUserDataDir?: string };

async function send(config: Config, message: string) {
  const { ntfyUrl, ntfyToken } = config;
  const headers: { [k: string]: string } = ntfyToken ? { Authorization: `Bearer ${ntfyToken.trim()}` } : {};
  const url = new URL(ntfyUrl);
  url.searchParams.set("title", "extension-watch");
  const parts = split(message, MAX_BYTES);
  // A failed part fails the whole extension, so parts sent before it are sent again next run.
  for (const [i, part] of parts.entries()) {
    const body = parts.length > 1 ? `(${i + 1}/${parts.length}) ${part}` : part;
    const res = await fetch(url, { method: "POST", body, headers, signal: AbortSignal.timeout(SEND_TIMEOUT_MS) });
    if (!res.ok) throw new Error(`ntfy ${res.status}`);
  }
}

function writeAtomic(path: string, data: string) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(`${path}.tmp`, data);
  renameSync(`${path}.tmp`, path);
}

// Returns the process exit code: 0 when everything was read and sent, 1 otherwise.
export async function run(env: Env = process.env, platform = process.platform): Promise<number> {
  const p = paths(env, platform);
  let config: Config;
  try {
    config = JSON.parse(readFileSync(p.config, "utf8"));
    if (!config.ntfyUrl) throw new Error("ntfyUrl is not set");
    // A token with characters a header cannot hold would be quoted in fetch's error message.
    if (config.ntfyToken !== undefined && !/^[\x21-\x7e]+$/.test(config.ntfyToken.trim())) {
      throw new Error("ntfyToken has characters a header cannot hold");
    }
  } catch (err) {
    console.error(`extension-watch: cannot read ${p.config}: ${(err as Error).message}`);
    return 1;
  }

  let next: Snapshot;
  try {
    next = readAll(config.chromeUserDataDir ?? p.chrome);
    if (!Object.keys(next).length) throw new Error("no extension records found");
  } catch (err) {
    const message = `cannot read Chrome extensions: ${(err as Error).message}`;
    console.error(`extension-watch: ${message}`);
    await send(config, message).catch((e) => console.error(`extension-watch: ${e.message}`));
    return 1;
  }

  // First run: take a baseline instead of reporting every existing extension as new.
  if (!existsSync(p.state)) {
    writeAtomic(p.state, JSON.stringify(next));
    return 0;
  }
  let prev: Snapshot;
  try {
    prev = JSON.parse(readFileSync(p.state, "utf8"));
  } catch (err) {
    const message = `cannot read ${p.state}: ${(err as Error).message}`;
    console.error(`extension-watch: ${message}`);
    await send(config, message).catch((e) => console.error(`extension-watch: ${e.message}`));
    return 1;
  }

  // A failed extension keeps its old record, so the same change is sent on the next run.
  const saved = { ...next };
  let failed = false;
  for (const { key, message } of diff(prev, next)) {
    try {
      await send(config, message);
    } catch (err) {
      console.error(`extension-watch: ${(err as Error).message}`);
      failed = true;
      if (prev[key]) saved[key] = prev[key];
      else delete saved[key];
    }
  }
  writeAtomic(p.state, JSON.stringify(saved));
  return failed ? 1 : 0;
}
