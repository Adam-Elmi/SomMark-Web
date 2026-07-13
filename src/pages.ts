// @ts-nocheck
import path from "node:path";
import { readdir } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { isLayoutFile } from "./dynamic.js";

/**
 * Maps a URL pathname to a corresponding .smark file in the pages directory.
 */
export function resolveSmarkFile(pathname: string, pagesDir: string): string | null {
  let normalized = pathname.replace(/^\//, "").replace(/\/index\.html$/, "").replace(/\.html$/, "");
  if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  if (normalized === "") normalized = "index";

  const candidates = [
    path.join(pagesDir, normalized + ".smark"),
    path.join(pagesDir, normalized, "index.smark"),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate) && statSync(candidate).isFile()) {
      return candidate;
    }
  }

  return null;
}

/**
 * Scans a directory recursively for all .smark files and returns their route mapping.
 */
export async function scanPages(dir: string, baseDir: string = dir): Promise<{ url: string; filePath: string }[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const results: { url: string; filePath: string }[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await scanPages(fullPath, baseDir)));
    } else if (entry.name.endsWith(".smark")) {
      if (isLayoutFile(fullPath)) continue;
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      let url = "/" + relativePath.replace(/\.smark$/, "");
      if (url.endsWith("/index")) url = url.slice(0, -6) || "/";
      results.push({ url, filePath: fullPath });
    }
  }

  return results;
}
