// @ts-nocheck
import type { DynamicConfig, HeadingEntry } from "./dynamic.js";

export interface SomMarkPluginOptions {
  /** The directory containing your .smark pages. Defaults to "src/pages" */
  pagesDir?: string;
  /** Custom fallback target strategy for styling properties. Defaults to "style" */
  fallbackTarget?: true | "style" | false;
  /** A custom validation function run before transpilation finishes */
  outputValidator?: (result: string) => void | Promise<void>;
  /** Custom import aliases for virtual path resolution */
  importAliases?: Record<string, string>;
  /** Whitelisted attributes custom properties */
  customProps?: string[];
  /** Flag to strip comments from transpiled output. Defaults to true */
  removeComments?: boolean;
  /** Toggles CLI build spinner feedback */
  showSpinner?: boolean;
  /** Custom mapper file */
  mapperFile?: any;
  /** Security constraints for the sandbox */
  security?: {
    allowRaw?: boolean;
    maxDepth?: number;
    timeout?: number;
    sanitize?: ((html: string) => string) | null;
    allowFetch?: boolean;
    allowHttp?: boolean;
    allowedOrigins?: string[];
    allowedExtensions?: string[];
  };
  /**
   * Dynamic route folders. Each key is a top-level folder name under pages/.
   * The value is an async function returning an array of data items.
   * Each item must have a `slug` string. Everything else becomes `__props`.
   */
  dynamic?: DynamicConfig;
  /** The production URL of the site, used for canonical URLs, sitemaps, etc. */
  siteUrl?: string;
  /** Toggles automatic generation of sitemap.xml. Defaults to true */
  sitemap?: boolean;
  /** Toggles automatic generation of robots.txt. Defaults to true */
  robots?: boolean;
  /** Toggles build-time SEO auditing. Defaults to true */
  seoAudit?: boolean;
  /**
   * Inline JS injected as a blocking script at the very start of <head> on every page.
   * Use for theme init, FOUC prevention, or any script that must run before rendering.
   */
  themeScript?: string;
  /**
   * Generate an RSS/Atom feed at /feed.xml.
   * Requires `siteUrl` to be set.
   */
  rss?: {
    title: string;
    description: string;
    items: () => Promise<{
      title: string;
      url: string;
      description?: string;
      date?: string;
      author?: string;
    }[]>;
  };
}

export type RouteData = {
  slug?: string;
  url?: string;
  props?: Record<string, unknown>;
  headings?: HeadingEntry[];
};
