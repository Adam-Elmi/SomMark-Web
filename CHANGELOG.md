# Changelog

All changes to **SomMark Web** are recorded here.

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

*   **SEO Tools:**
    *   Creates `sitemap.xml` automatically during build (requires `siteUrl` config).
    *   Creates `robots.txt` automatically during build.
    *   Scans pages for missing titles, descriptions, canonical links, and image alt tags. Shows recommendations in the terminal.
*   **Vite Preview Support:**
    *   Allows visiting clean URLs (like `/about` instead of `/about.html`) during `vite preview`.
    *   Serves custom 404 pages with a correct `404` status code during preview.
*   **Custom & Default 404 Pages:**
    *   Supports custom `404.smark` pages during development.
    *   Serves a built-in fallback 404 page (styled in rose, dark, and gray) if the user does not have a custom one.
*   **Layouts & Components:** Import and reuse layouts and components with `[import = Name: "path"]` and `[slot]`.
*   **Fast Development:** Direct Vite compilation with instant hot reloading (HMR) as you type.
*   **NPM & Network Packages:** Import npm packages or URL-based ESM files directly inside pages using `PKG.import()`. Since SomMark does not support importing named modules, this is a workaround to use npm packages in SomMark Web.
*   **Flexible Config (`smark.config.js`):** Customize path aliases, global placeholders, and strip comments automatically.