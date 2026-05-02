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

SomMark Web is a **lightweight web framework** and high-performance **Static Site Generation (SSG)** bridge for Vite. It is powered by the **SomMark Engine**, an extensible markup language designed to be the **structural foundation** of your content. 

Rather than just a "template engine," it acts as a **Universal Source Language** that transpiles your structural intent into clean, optimized HTML.

## Key Features

- **Module System**: Build reusable components with a strict **Declare-then-Inject** pattern.
- **Auto-Routing**: Just add a file to `src/pages` and it becomes a web page automatically.
- **Fast Development**: See your changes instantly as you type.
- **Small & Fast**: The final website is very small and loads quickly.
- **Standard CSS**: Works with any CSS or even Tailwind.

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

#### 3. Create your Layout (`index.smark`)

```ini
[import = page: p{page}][end]
[html = lang: "en"]
  [head]
    [title]My Website[end]
    [link = rel: "stylesheet", href: "/src/style.css"][end]
  [end]
  [body]
    [main]
      [$use-module = page][end]
    [end]
  [end]
[end]
```

## Why use it?

If you are tired of complex frameworks and want to focus on **content and structure**, SomMark Web is for you. It combines the power of a modern build tool with the simplicity of a block-based language.

## License

MIT © [Adam Elmi Eid](https://github.com/Adam-Elmi)
