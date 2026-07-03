import { Redis } from "@upstash/redis";

const SETTINGS_KEY = "kimchi-house:settings";

export const DEFAULT_SETTINGS = {
  preorderOpen: true,
};

function getRedis() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!url || !token) return null;
  return new Redis({ url, token });
}

export async function readSettings() {
  const redis = getRedis();
  if (!redis) return { ...DEFAULT_SETTINGS };
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
    throw new Error(
      "설정 저장소(Redis)가 연결되지 않았습니다. Vercel Marketplace에서 Upstash Redis를 연결해 주세요."
    );
  }
  await redis.set(SETTINGS_KEY, settings);
}
