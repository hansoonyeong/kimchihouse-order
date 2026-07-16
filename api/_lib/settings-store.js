import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { Redis } from "@upstash/redis";

const SETTINGS_KEY = "kimchi-house:settings";
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOCAL_SETTINGS_FILE = path.join(__dirname, "../../data/settings.json");

export const DEFAULT_SETTINGS = {
  preorderOpen: true,
};

function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

function ensureLocalFile() {
  const dir = path.dirname(LOCAL_SETTINGS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  if (!fs.existsSync(LOCAL_SETTINGS_FILE)) {
    fs.writeFileSync(LOCAL_SETTINGS_FILE, JSON.stringify(DEFAULT_SETTINGS, null, 2) + "\n", "utf8");
  }
}

function readLocalSettings() {
  ensureLocalFile();
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(fs.readFileSync(LOCAL_SETTINGS_FILE, "utf8")) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function writeLocalSettings(settings) {
  ensureLocalFile();
  fs.writeFileSync(LOCAL_SETTINGS_FILE, JSON.stringify(settings, null, 2) + "\n", "utf8");
}

export async function readSettings() {
  const redis = getRedis();
  if (!redis) {
    if (process.env.VERCEL) return { ...DEFAULT_SETTINGS };
    return readLocalSettings();
  }
  try {
    const settings = await redis.get(SETTINGS_KEY);
    if (!settings || typeof settings !== "object") return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...settings };
  } catch (err) {
    console.error("Redis settings read error:", err);
    return { ...DEFAULT_SETTINGS };
  }
}

export async function writeSettings(settings) {
  const redis = getRedis();
  if (!redis) {
    if (process.env.VERCEL) {
      throw new Error(
        "설정 저장소(Redis)가 연결되지 않았습니다. Vercel Marketplace에서 Upstash Redis를 연결해 주세요."
      );
    }
    writeLocalSettings(settings);
    return;
  }
  await redis.set(SETTINGS_KEY, settings);
}
