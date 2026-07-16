import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

/**
 * Load .env / .env.local into process.env (does not override existing env).
 */
export function loadEnvFiles(rootDir) {
  const files = [".env.local", ".env"];
  for (const name of files) {
    const filePath = path.join(rootDir, name);
    if (!fs.existsSync(filePath)) continue;
    const text = fs.readFileSync(filePath, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      if (process.env[key] == null || process.env[key] === "") {
        process.env[key] = value;
      }
    }
  }
}

export function projectRootFrom(metaUrl) {
  return path.join(path.dirname(fileURLToPath(metaUrl)), "..");
}
