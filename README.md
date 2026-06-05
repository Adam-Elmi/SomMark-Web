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
  <strong>The structural foundation for your modern web content.</strong>
</p>

---

## What is SomMark Web?

SomMark Web is a **lightweight web framework** and high-performance **Static Site Generation (SSG)** using Vite and the SomMark engine. It is powered by the **SomMark Engine**, an extensible markup language designed to be the **structural foundation** of your content.

## Key Features

- **Module System**: Build reusable layouts and components.
- **Auto-Routing**: Add a `.smark` file to `src/pages` and it becomes a web page automatically.
- **Fast Development**: See your changes instantly as you type with instant hot reloading (HMR).
- **Vite Preview Support**: Access clean URLs (like `/about`) and custom `404.html` fallbacks during preview.
- **SEO Automation**: Automatic generation of `sitemap.xml` and `robots.txt` plus built-in SEO auditor checks.
- **Small & Fast**: No runtime bundle weight, compiling directly to clean, minimal HTML.

## Quick Start

### The Recommended Way

The fastest way to start a new SomMark Web project is using the official CLI. This will set up a **complete, ready-to-use project template** for you:

```bash
npx create-sommark-web@latest
```

Follow the prompts to get your site running instantly.

---

### Manual Installation

If you prefer to set things up yourself:

#### 1. Install

```bash
npm install sommark-web
```

OR

```bash
bun add sommark-web
```


#### 2. Add to Vite

Add the plugin to your `vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import sommarkWeb from "sommark-web";

export default defineConfig({
  plugins: [
    sommarkWeb()
  ]
});
```

### Quick Example

#### 1. Create your Layout (`src/layouts/Layout.smark`)
This is optional, if you don't create a layout, the page will be rendered without a layout. But it is useful to avoid code repetition.
```ini
[DOCTYPE !]
[html = lang: "en"]
  [head]
    [title]v{title}[end]
    [link = rel: "stylesheet", href: "/src/style.css" !]
  [end]
  [body]
    [main]
      [slot !]
    [end]
  [end]
[end]
```

#### 2. Create your Page (`src/pages/index.smark`)

```ini
[import = Layout: "../layouts/Layout.smark" !]

[Layout = title: "My Website"]
  [h1]Welcome to SomMark Web![end]
  [p]This content is injected directly into the layout slot.[end]
[end]
```

## Why use it?

If you are tired of complex frameworks and want to focus on **content and structure**, SomMark Web is for you. It combines the power of a modern build tool with the simplicity of a block-based language.

## License

MIT © [Adam Elmi Eid](https://github.com/Adam-Elmi)
