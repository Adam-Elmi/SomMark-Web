# SomMark Web

**High-performance Static Site Generation for Vite, powered by the SomMark engine.**

SomMark Web allows you to build lightning-fast, block-based static websites using the SomMark syntax. It integrates seamlessly into the Vite ecosystem, providing file-based routing, HMR, and optimized production builds.

## Features

- High-performance: Built on top of Bun and the high-performance SomMark engine.
- File-Based Routing: Automatically maps `.smark` files in your pages directory to URLs.
- Master-Level Injection: Native module system for safe, unescaped content injection.
- Full HMR: Instant feedback in your browser when you edit your `.smark` files.
- Zero-Config Bundling: Automatically handles asset resolution and bundling via Vite.

## Installation

```bash
npm install sommark-web sommark --save-dev
# or
bun add sommark-web sommark --dev
```

## Quick Start

### 1. Configure Vite

Add the plugin to your `vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import sommark from "sommark-web";

export default defineConfig({
  plugins: [
    sommark({
      pagesDir: "src/pages",    // default
      shellPath: "index.smark"  // default
    })
  ]
});
```

### 2. Create your Shell (`index.smark`)

This acts as your global layout template.

```smark
[import = page: p{pagePath}][end]
[DOCTYPE][end]
[html = lang: en]
  [head]
    [meta = charset: utf-8][end]
    [title]My SomMark Site[end]
  [end]
  [body]
    [div = id: root]
      [$use-module = page][end]
    [end]
  [end]
[end]
```

### 3. Add a Page (`src/pages/index.smark`)

```smark
[h1]Hello SomMark![end]
[p]Welcome to your new high-performance static site.[end]
```

### 4. Run Dev Server

```bash
npx vite
```

## Plugin Options

| Option | Type | Default | Description |
| :--- | :--- | :--- | :--- |
| `pagesDir` | `string` | `"src/pages"` | The directory containing your `.smark` pages. |
| `shellPath` | `string` | `"index.smark"` | The path to your main shell/layout template. |

## License

MIT © [SomMark Team]
