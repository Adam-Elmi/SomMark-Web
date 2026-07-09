import path from "node:path";
import { existsSync } from "node:fs";
import pc from "picocolors";

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single data item returned by a dynamic data function. */
export interface DynamicItem {
  /** URL segment: becomes /{folder}/{slug} */
  slug: string;
  /** Optional: path to a custom .smark layout file (relative to project root). Falls back to _layout.smark. */
  _layout?: string;
  /** Everything else is available as __props in the template. */
  [key: string]: any;
}

/** Map of top-level folder name → async data function. */
export type DynamicConfig = Record<string, () => Promise<DynamicItem[]>>;

export interface HeadingEntry {
  level: number;
  text: string;
  id: string;
}

/** A fully resolved dynamic page entry. */
export interface DynamicRouteEntry {
  slug: string;
  folder: string;
  layoutFile: string;   // absolute path to the .smark layout to compile
  props: Record<string, any>;
  url: string;          // e.g. /posts/hello-sommark
  headings?: HeadingEntry[]; // populated after first compile
}

// ── Core ──────────────────────────────────────────────────────────────────────

/**
 * Build the full dynamic route map from the `dynamic` config option.
 * Returns a Map keyed by html path (e.g. "posts/hello-sommark.html") → DynamicRouteEntry.
 */
export async function buildDynamicRouteMap(
  dynamic: DynamicConfig,
  pagesDir: string,
  projectRoot: string
): Promise<Map<string, DynamicRouteEntry>> {
  const map = new Map<string, DynamicRouteEntry>();

  for (const [folder, dataFn] of Object.entries(dynamic)) {
    const folderPath   = path.join(pagesDir, folder);
    const defaultLayout = path.join(folderPath, "_layout.smark");

    if (!existsSync(folderPath)) {
      console.warn(pc.yellow(`[SomMark] dynamic.${folder}: folder not found in pages dir`));
      continue;
    }
    if (!existsSync(defaultLayout)) {
      console.warn(pc.yellow(`[SomMark] dynamic.${folder}: missing _layout.smark in pages/${folder}/`));
      continue;
    }

    let items: DynamicItem[];
    try {
      items = await dataFn();
    } catch (e: any) {
      console.warn(pc.yellow(`[SomMark] dynamic.${folder}: data function threw — ${e.message}`));
      continue;
    }

    for (const item of items) {
      const { slug, _layout, ...props } = item;

      if (!slug || typeof slug !== "string") {
        console.warn(pc.yellow(`[SomMark] dynamic.${folder}: item missing "slug" field, skipping`));
        continue;
      }

      let layoutFile = defaultLayout;
      if (_layout) {
        const custom = path.resolve(projectRoot, _layout);
        if (existsSync(custom)) {
          layoutFile = custom;
        } else {
          console.warn(pc.yellow(`[SomMark] dynamic.${folder}["${slug}"]: _layout "${_layout}" not found, using default`));
        }
      }

      const url     = `/${folder}/${slug}`;
      const htmlKey = `${folder}/${slug}.html`;
      map.set(htmlKey, { slug, folder, layoutFile, props, url });
    }
  }

  return map;
}

/**
 * Match an incoming dev-server pathname against registered dynamic folders.
 * Returns the entry if found, null otherwise.
 */
export function matchDynamicRequest(
  pathname: string,
  routeMap: Map<string, DynamicRouteEntry>
): DynamicRouteEntry | null {
  // pathname is like /posts/hello-sommark
  const clean   = pathname.replace(/^\//, "");          // posts/hello-sommark
  const htmlKey = clean.replace(/\/$/, "") + ".html";   // posts/hello-sommark.html
  return routeMap.get(htmlKey) ?? null;
}

/**
 * Returns true for _layout.smark — reserved template, not a page.
 */
export function isLayoutFile(filePath: string): boolean {
  return path.basename(filePath) === "_layout.smark";
}

// ── Heading extraction ────────────────────────────────────────────────────────

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
}

/**
 * Extract headings from compiled HTML output.
 * Skips headings inside <nav> elements (TOC wrappers) to keep extraction stable across passes.
 * Strips nested tags so <h2><code>Title</code></h2> yields "Title".
 */
export function extractHeadings(html: string): HeadingEntry[] {
  // Strip <nav>...</nav> blocks so TOC labels don't contaminate the heading list
  const stripped = html.replace(/<nav[^>]*>[\s\S]*?<\/nav>/gi, "");
  const re = /<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi;
  const results: HeadingEntry[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const level = parseInt((m[1] ?? "h1").charAt(1));
    const text  = (m[2] ?? "").replace(/<[^>]+>/g, "").trim();
    if (text) results.push({ level, text, id: slugify(text) });
  }
  return results;
}
