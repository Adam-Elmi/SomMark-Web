<p align="center">
  <img src="assets/logo.png" width="180" alt="SomMark Web Logo">
</p>

<h1 align="center">SomMark Web</h1>

<p align="center">
  <img src="https://img.shields.io/npm/v/sommark-web?color=F80753&label=npm" alt="npm version">
  <img src="https://img.shields.io/badge/license-MIT-blue?color=green" alt="license">
  <a href="https://github.com/Adam-Elmi/SomMark"><img src="https://img.shields.io/badge/powered%20by-SomMark-646cff" alt="powered by sommark"></a>
</p>

<p align="center">
  <strong>Static site generation powered by the SomMark engine.</strong>
</p>

---

## What is SomMark Web?

SomMark Web is a lightweight web framework and high-performance Static Site Generation (SSG) using Vite and the SomMark engine. It is powered by the SomMark Engine, a template language designed to be the structural foundation of your content.

## Features

- **Auto-routing** — Every `.smark` file in `src/pages` is a page.
- **Dynamic routing** — Data-driven pages generated per slug from any async data source.
- **Module system** — Reusable layouts and components with `[import]` and `[slot]`.
- **Built-in api(s)** — `getPages()`, `getMetadata()`, `getHeadings()`, `glob()`, `getData()`, and more available in every file.
- **SEO automation** — Generates `sitemap.xml`, `robots.txt`, and audits pages on build.
- **HMR** — Changes reflect instantly in the browser during development.
- **Zero runtime weight** — Compiles to plain HTML. No framework JS shipped to the browser unless you add it.

## Quick Start 

Installs a ready-to-use project template so you can start a SomMark Web site immediately.

```bash
npx create-sommark-web@latest
```

## Use as a Plugin

Already have a Vite project? Install SomMark Web as a plugin and drop it into your existing setup.

```bash
npm install sommark-web
```

```typescript
// vite.config.ts
import { defineConfig } from "vite";
import sommarkWeb from "sommark-web";

export default defineConfig({
  plugins: [sommarkWeb()]
});
```

## License

MIT © [Adam Elmi Eid](https://github.com/Adam-Elmi)
