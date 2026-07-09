# Changelog

All changes to **SomMark Web** are recorded here.

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
