import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { diff, split } from "./diff";
import { readAll, type Snapshot } from "./profile";

// ntfy's default message-size-limit is 4096 bytes and servers without attachments reject longer
// bodies with 400; the rest is room for the "(1/2) " prefix.
const MAX_BYTES = 4080;
const SEND_TIMEOUT_MS = 10000;

type Env = { [k: string]: string | undefined };
type Config = { ntfyUrl: string; ntfyToken?: string; chromeUserDataDir?: string };
type Paths = ReturnType<typeof paths>;

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

async function send(config: Config, message: string) {
  const url = new URL(config.ntfyUrl);
  url.searchParams.set("title", "extension-watch");
  const headers: { [k: string]: string } = config.ntfyToken ? { Authorization: `Bearer ${config.ntfyToken.trim()}` } : {};
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

const errorFile = (p: Paths) => join(dirname(p.state), "last-error.txt");

// A lasting error (wrong path, corrupt state) would otherwise be sent every run; send it once
// and again only when the text changes or after a clean run.
async function reportError(config: Config, p: Paths, message: string) {
  console.error(`extension-watch: ${message}`);
  try {
    if (existsSync(errorFile(p)) && readFileSync(errorFile(p), "utf8") === message) return;
    await send(config, message);
    writeAtomic(errorFile(p), message);
  } catch (err) {
    console.error(`extension-watch: ${(err as Error).message}`);
  }
}

function readState(path: string): Snapshot {
  try {
    const state = JSON.parse(readFileSync(path, "utf8"));
    const ok =
      state && typeof state === "object" && !Array.isArray(state) &&
      Object.values(state).every((r: any) => r && Array.isArray(r.permissions) && Array.isArray(r.disableReasons));
    if (!ok) throw new Error("unexpected shape");
    return state;
  } catch (err) {
    throw new Error(`cannot read ${path}: ${(err as Error).message}`);
  }
}

// Returns the read errors to report and whether any message failed to send.
async function check(config: Config, p: Paths): Promise<{ errors: string[]; sendFailed: boolean }> {
  let read: ReturnType<typeof readAll>;
  try {
    read = readAll(config.chromeUserDataDir ?? p.chrome);
  } catch (err) {
    throw new Error(`cannot read Chrome extensions: ${(err as Error).message}`);
  }
  const next = read.snapshot;
  const errors = read.failed.map((f) => `cannot read Chrome profile ${f.profile}: ${f.message}`);

  // First run: take a baseline instead of reporting every existing extension as new.
  if (!existsSync(p.state)) {
    writeAtomic(p.state, JSON.stringify(next));
    return { errors, sendFailed: false };
  }
  const prev = readState(p.state);

  // A profile that could not be read keeps its old records instead of reading as all removed.
  const failedProfiles = new Set(read.failed.map((f) => f.profile));
  for (const [key, r] of Object.entries(prev)) if (failedProfiles.has(r.profile)) next[key] = r;

  // A failed extension keeps its old record, so the same change is sent on the next run.
  const saved = { ...next };
  let sendFailed = false;
  for (const { key, message } of diff(prev, next)) {
    try {
      await send(config, message);
    } catch (err) {
      console.error(`extension-watch: ${(err as Error).message}`);
      sendFailed = true;
      if (prev[key]) saved[key] = prev[key];
      else delete saved[key];
    }
  }
  writeAtomic(p.state, JSON.stringify(saved));
  return { errors, sendFailed };
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

  try {
    const { errors, sendFailed } = await check(config, p);
    if (errors.length) {
      await reportError(config, p, errors.join("\n"));
      return 1;
    }
    rmSync(errorFile(p), { force: true });
    return sendFailed ? 1 : 0;
  } catch (err) {
    await reportError(config, p, (err as Error).message);
    return 1;
  }
}
