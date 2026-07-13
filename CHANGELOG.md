# Changelog

All changes to **SomMark Web** are recorded here.

## [3.1.0] - 2026-07-13

### Added

- **`themeScript(preset, options?)`** — Exported helper that generates a small blocking script to set a theme attribute on `<html>` before the first paint, eliminating flash of unstyled content (FOUC). Pass the result to the `themeScript` plugin option.

  ```ts
  import sommarkWeb, { themeScript } from "sommark-web";

  sommarkWeb({
    themeScript: themeScript("dark-mode"),
    // options: storageKey, attribute, default
  })
  ```

  The script reads `localStorage` and the system color-scheme preference, then sets `data-theme="light"` or `data-theme="dark"` on `<html>` synchronously — before any CSS is parsed.

### Fixed

- **`[script]` and `[link]` blocks produced broken HTML** — Inline script content was HTML-escaped (making the JavaScript invalid) and external scripts received an empty `src=""`. Same issue affected `[link]` tags. The incorrect mapper overrides have been removed.

- **`getData()` and `getPages()` crashed with `ReferenceError`** — Bridge functions referenced closure variables that did not exist inside the QuickJS sandbox. They now correctly reference the variables passed into the sandbox.

- **Live reload did not pick up changes in imported files** — Editing a `.js`, `.json`, or other file imported by a `.smark` page did not trigger a browser reload. The dev server now watches all project files and reloads on any change.

- **Build silently dropped a page when two route URLs produced the same key** — Routes like `/a/b` and `/a-b` both mapped to the Rollup entry key `a-b`, causing one page to be silently overwritten. The separator is now `__` to avoid collisions.

- **Build crashed when two pages had identical CSS** — Both pages generated the same MD5 hash filename, causing Rollup to throw `"Cannot emit asset with the same filename"`. The page's own path is now included in the filename.

- **Page CSS was missing when the site was deployed to a subdirectory** — The CSS `<link>` href was hardcoded with a `/` prefix and did not respect Vite's `base` config option. It now uses the configured base path.

- **Dev server dropped CSS from `[style]` blocks** — The dev server middleware called only `getTranspiledHtml` and never injected the CSS extracted from `[style]` blocks. Pages that relied on inline styles were completely unstyled in dev mode.

- **Dev server hung when a dynamic page had a compile error on first visit** — The headings pre-pass ran outside the error handler. A compile error caused an unhandled rejection with no response sent to the browser. The compile step is now inside the error handler.

- **All dynamic routes returned 404 after saving `smark.config.js`** — The config reload cleared the dynamic route table but never rebuilt it. Dynamic routes now rebuild automatically after a config reload.

- **`404.smark` compile errors were not shown** — When `404.smark` had a compile error, the catch block logged it but sent no response, handing the request to Vite's default handler. The SomMark error overlay is now shown instead.

- **Heading changes on dynamic pages did not appear after live reload** — The cached heading list was never cleared on `.smark` file changes. Headings are now reset alongside the page cache on every reload.

- **`__headings` was always empty in `runtime` blocks on dynamic pages** — The JavaScript for a dynamic page was compiled using a cache key that excluded the heading data, while the HTML was compiled with it. Both now use the same key.

- **Vite internal requests were caught by SomMark's 404 handler** — Paths like `/__vite_ping`, `/@fs/`, and `/@id/` have no file extension, so they fell into the 404 branch. All paths starting with `/@` or `/__` are now passed through to Vite's own handlers.

### Changed

- **Plugin source split into focused modules** — `src/index.ts` (previously 1 275 lines) has been split into `compiler.ts`, `types.ts`, `pages.ts`, `seo.ts`, `theme.ts`, and `error-html.ts`. Public API is unchanged.

---

## [3.0.0] - 2026-07-09

### Added

- **Dynamic routing** — Generate pages from data at build time. Define a `dynamic` option in the plugin config: each key is a folder under `src/pages/`, the value is an async function that returns an array of objects. Each object must have a `slug` string; everything else becomes `__props` inside the layout file.

  ```js
  // vite.config.ts
  sommarkWeb({
    dynamic: {
      posts: {
        data: async () => [
          { slug: "hello", title: "Hello World" },
          { slug: "about", title: "About Me" },
        ]
      }
    }
  })
  ```

  ```
  src/pages/posts/_layout.smark  →  /posts/hello, /posts/about
  ```

- **`getPages()`** — Returns every page (static and dynamic) as an array. Each entry includes `url`, `filePath`, `metadata`, `headings`, `title`, `slug`, and `isDynamic`. Available in all `.smark` files inside `static ${ }$` blocks.

  ```js
  static ${
    const pages = await getPages();
    // [{ url: "/about", title: "About", metadata: {...}, isDynamic: false }, ...]
  }$
  ```

- **`getMetadata(filePath)`** — Reads the `[Metadata]` block of any `.smark` file and returns its props as a plain object.

  ```js
  static ${
    const meta = await getMetadata("src/pages/about.smark");
    // { title: "About", description: "...", published: true }
  }$
  ```

- **`getHeadings(filePath)`** — Returns all headings in a `.smark` file as `{ level, text, id }[]`.

  ```js
  static ${
    const headings = await getHeadings("src/pages/about.smark");
    // [{ level: 1, text: "About", id: "about" }, ...]
  }$
  ```

- **`glob(pattern)`** — Scans files matching a glob pattern and returns one entry per file with `url`, `filePath`, `metadata`, `headings`, `title`, and `lastUpdate`.

  ```js
  static ${
    const posts = await glob("src/pages/posts/*.smark");
    // [{ url: "/posts/hello", title: "Hello", metadata: {...}, headings: [...], lastUpdate: "2026-07-09T..." }]
  }$
  ```

- **`getData(folder)`** — Inside a dynamic layout file, returns the full data array for that route folder. Useful for building index pages.

  ```js
  static ${
    const posts = getData("posts");
    // [{ slug: "hello", title: "Hello World" }, ...]
  }$
  ```

- **`sommark-web/variables`** — `getMetadata`, `getHeadings`, and `glob` are now exported from `sommark-web/variables` so you can pass them as `variables` in `smark.config.js`.

  ```js
  // smark.config.js
  import { getMetadata, getHeadings, glob } from "sommark-web/variables";

  export default {
    variables: { getMetadata, getHeadings, glob }
  }
  ```

- **Built-in variables** — Available in every `.smark` file inside `static ${ }$` blocks:

  | Variable | Type | Description |
  |---|---|---|
  | `__currentFile` | `string` | File path of the current page |
  | `__currentUrl` | `string` | URL of the current page |
  | `__pagesDir` | `string` | Pages directory path |
  | `__siteUrl` | `string` | Production site URL from config |
  | `__isDev` | `boolean` | `true` during dev server |
  | `__slug` | `string` | Current slug (dynamic pages only) |
  | `__props` | `object` | Data for the current slug (dynamic pages only) |
  | `__headings` | `array` | Pre-extracted headings (dynamic pages only) |

- **RSS feed** — Set the `rss` option to generate `/feed.xml` on build. Requires `siteUrl` to be set.

### Changed

- **`[Frontmatter]` renamed to `[Metadata]`** — `[metadata]` (lowercase) is also accepted. The block must be self-closing.

  ```
  [Metadata = title: "My Page", published: true !]
  ```

- **`getFrontmatter` renamed to `getMetadata`**.

### Removed

- **`PKG.import()`** — Pass npm-computed data as `variables` in `smark.config.js` instead.

---

## [2.1.3] - 2026-06-14

- Updated SomMark dependency to `4.5.1`

## [2.1.2] - 2026-06-13

- Updated SomMark dependency to `4.5.1`

## [2.1.1] - 2026-06-13

### Fixed

- **`data-sommark-id` mismatch** — Runtime scripts couldn't find their elements because two separate compilations produced different IDs. Fixed using `dualOutput: true`.
- **Server crash on compile error** — A `.smark` syntax error crashed the dev server instead of showing an error. Now shows a styled error page.

## [2.1.0]

- Updated SomMark dependency package

## [2.0.0] - 2026-06-05

### Added

- **SEO tools** — Generates `sitemap.xml` and `robots.txt` on build. Audits pages for missing titles, descriptions, canonical links, and image alt tags.
- **Vite preview support** — Clean URLs and custom 404 pages work correctly during `vite preview`.
- **Custom & default 404 pages** — Supports `404.smark`; falls back to a built-in styled 404 page if none exists.
- **Layouts & components** — Import and reuse layouts with `[import = Name: "path"]` and `[slot]`.
- **Flexible config (`smark.config.js`)** — Path aliases, global placeholders, comment stripping.
