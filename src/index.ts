// @ts-nocheck
import { transformWithEsbuild } from "vite";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";
import SomMark, { HTML, transpile, findAndLoadConfig } from "sommark";
import path from "node:path";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import crypto from "node:crypto";
import ora from "ora";
import pc from "picocolors";

/**
 * Options for the SomMark Web Vite plugin.
 */
export interface SomMarkPluginOptions {
  /** The directory containing your .smark pages. Defaults to "src/pages" */
  pagesDir?: string;
  /** Custom fallback target strategy for styling properties. Defaults to "style" */
  fallbackTarget?: "style" | "class" | false;
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
  /** The production URL of the site, used for canonical URLs, sitemaps, etc. */
  siteUrl?: string;
  /** Toggles automatic generation of sitemap.xml. Defaults to true */
  sitemap?: boolean;
  /** Toggles automatic generation of robots.txt. Defaults to true */
  robots?: boolean;
  /** Toggles build-time SEO auditing. Defaults to true */
  seoAudit?: boolean;
}

/**
 * A Vite plugin that provides high-performance Static Site Generation
 * powered by the SomMark engine.
 */

export default function sommarkPlugin(options: SomMarkPluginOptions = {}): Plugin {
  let projectRoot = process.cwd();
  let pagesDir = path.resolve(projectRoot, options.pagesDir || "src/pages");
  let smarkConfig: any = null;
  let minify = true;

  const dualCache = new Map<string, { html: string; js: string }>();
  let isBuild = false;
  let outDir = "dist";
  const seoWarningsMap = new Map<string, string[]>();

  const printLogo = () => {
    console.log(pc.cyan(`\n  SomMark Web`));
    console.log(pc.dim(`  v1.0.0 • Vite Plugin\n`));
  };

  const hostImportCall = async (packageName: string, exportName: string, args: any[]) => {
    let resolvedPath = packageName;
    
    if (packageName.startsWith("http://") || packageName.startsWith("https://")) {
      const cacheDir = path.join(projectRoot, "node_modules", ".cache", "sommark-web");
      await mkdir(cacheDir, { recursive: true });
      
      const hash = crypto.createHash("md5").update(packageName).digest("hex");
      resolvedPath = path.join(cacheDir, `network-${hash}.js`);
      
      if (!existsSync(resolvedPath)) {
        if (options.showSpinner !== false) {
          console.log(pc.cyan("[SomMark]") + pc.dim(` Fetching package: ${packageName}`));
        }
        const res = await fetch(packageName);
        if (!res.ok) {
          throw new Error(`Failed to fetch network package from ${packageName}: ${res.statusText}`);
        }
        let code = await res.text();
        
        // Resolve internal esm.sh redirect exports
        const redirectRegex = /from\s+["'](\/[^"']+\.mjs)["']/;
        const match = code.match(redirectRegex);
        if (match) {
          const redirectUrl = "https://esm.sh" + match[1];
          const redirectRes = await fetch(redirectUrl);
          if (!redirectRes.ok) {
            throw new Error(`Failed to fetch redirected network package from ${redirectUrl}: ${redirectRes.statusText}`);
          }
          code = await redirectRes.text();
        }
        
        await writeFile(resolvedPath, code, "utf-8");
      }
    } else if (packageName.startsWith(".") || packageName.startsWith("/")) {
      resolvedPath = path.resolve(projectRoot, packageName);
      const ext = path.extname(resolvedPath);
      if (ext === ".jsx" || ext === ".tsx" || ext === ".ts") {
        const cacheDir = path.join(projectRoot, "node_modules", ".cache", "sommark-web");
        await mkdir(cacheDir, { recursive: true });
        
        const content = await readFile(resolvedPath, "utf-8");
        const hash = crypto.createHash("md5").update(content + resolvedPath).digest("hex");
        const transpiledPath = path.join(cacheDir, `local-${hash}.js`);
        
        if (!existsSync(transpiledPath)) {
          const loader = ext.slice(1) as "jsx" | "tsx" | "ts";
          const minified = await transformWithEsbuild(content, resolvedPath, {
            loader,
            format: "esm"
          });
          await writeFile(transpiledPath, minified.code, "utf-8");
        }
        resolvedPath = transpiledPath;
      }
    } else {
      try {
        const require = createRequire(path.join(projectRoot, "package.json"));
        resolvedPath = require.resolve(packageName);
      } catch (e) {
        resolvedPath = packageName;
      }
    }
    
    const mod = await import(resolvedPath);
    let val = undefined;
    if (mod[exportName] !== undefined) {
      val = mod[exportName];
    } else if (mod.default !== undefined && mod.default !== null && (typeof mod.default === "object" || typeof mod.default === "function")) {
      val = (mod.default as any)[exportName];
    }
      
    if (typeof val === "function") {
      return await val(...args);
    }
    return val;
  };

  const buildMapper = (smarkFile: string) => {
    const baseMapper = options.mapperFile || smarkConfig.mapperFile || HTML;
    const mapper = baseMapper.clone();
    const fileDir = path.dirname(smarkFile);
    mapper.register("script", async function (this: any, { args, content }) {
      let src = args.src || args[0];
      if (src && typeof src === "string" && !src.startsWith("http")) {
        const abs = await resolveAssetPath(src, fileDir, projectRoot);
        if (abs) src = "/" + path.relative(projectRoot, abs);
      }
      return this.tag("script").attributes({ ...args, src }).body(content);
    });
    mapper.register("link", async function (this: any, { args }) {
      let href = args.href || args[0];
      if (href && typeof href === "string" && !href.startsWith("http")) {
        const abs = await resolveAssetPath(href, fileDir, projectRoot);
        if (abs) href = "/" + path.relative(projectRoot, abs);
      }
      return this.tag("link").attributes({ ...args, href }).selfClose();
    });
    return mapper;
  };

  const compileSmarkDual = async (smarkFile: string) => {
    if (dualCache.has(smarkFile)) return dualCache.get(smarkFile)!;
    if (!smarkConfig) smarkConfig = await findAndLoadConfig(projectRoot);

    const entryContent = await readFile(smarkFile, "utf-8");
    const placeholders = {
      ...smarkConfig.placeholders,
      ...options.placeholders,
      pagePath: smarkFile,
      page: smarkFile
    };

    const [html, js] = await new SomMark({
      src: entryContent,
      format: "html",
      filename: smarkFile,
      placeholders,
      mapperFile: buildMapper(smarkFile),
      customProps: options.customProps || smarkConfig.customProps || ["content"],
      fallbackTarget: options.fallbackTarget !== undefined ? options.fallbackTarget : smarkConfig.fallbackTarget,
      outputValidator: options.outputValidator !== undefined ? options.outputValidator : smarkConfig.outputValidator,
      importAliases: { ...smarkConfig.importAliases, ...options.importAliases },
      security: { ...smarkConfig.security, ...options.security },
      showSpinner: options.showSpinner !== undefined ? options.showSpinner : smarkConfig.showSpinner,
      removeComments: options.removeComments !== undefined ? options.removeComments : smarkConfig.removeComments,
      dualOutput: true,
    }).transpile() as unknown as [string, string];

    dualCache.set(smarkFile, { html, js });
    return { html, js };
  };

  const getTranspiledHtml = async (smarkFile: string) => (await compileSmarkDual(smarkFile)).html;
  const getTranspiledJs  = async (smarkFile: string) => (await compileSmarkDual(smarkFile)).js;

  return {
    name: "sommark-web",
    enforce: "pre",

    async config(config, { command }) {
      if (config.root) {
        projectRoot = path.resolve(config.root);
        pagesDir = path.resolve(projectRoot, options.pagesDir || "src/pages");
      }
      if (command === "build") printLogo();

      smarkConfig = await findAndLoadConfig(projectRoot);

      const spinner = ora(pc.dim("Scanning SomMark pages...")).start();
      const routes = await scanPages(pagesDir);
      spinner.succeed(pc.green(`Found ${routes.length} pages`));

      const input: Record<string, string> = {};

      for (const route of routes) {
        const htmlPath = route.url === "/" ? "index.html" : route.url.slice(1) + ".html";
        input[route.url === "/" ? "index" : route.url.slice(1).replace(/\//g, "-")] = htmlPath;
      }

      const external = command === "build" ? [ /^\/sommark-runtime\// ] : [];

      return {
        build: {
          rollupOptions: {
            input,
            external
          }
        },
      };
    },

    configResolved(config) {
      projectRoot = config.root;
      pagesDir = path.resolve(projectRoot, options.pagesDir || "src/pages");
      minify = config.build?.minify !== false;
      isBuild = config.command === "build";
      outDir = path.resolve(projectRoot, config.build?.outDir || "dist");
    },

    resolveId(id) {
      const cleanId = id.split("?")[0];
      if (cleanId.startsWith("/sommark-runtime/")) {
        const relativeSmarkPath = cleanId.slice("/sommark-runtime/".length).replace(/\.js$/, "");
        const absoluteSmarkPath = path.resolve(projectRoot, relativeSmarkPath);
        return `\0sommark-runtime:${absoluteSmarkPath}`;
      }
      if (cleanId.endsWith(".html")) {
        const pathname = cleanId.startsWith("/") ? cleanId : "/" + cleanId;
        const smarkFile = resolveSmarkFile(pathname, pagesDir);
        if (smarkFile) {
          return path.join(projectRoot, cleanId);
        }
      }
      return null;
    },

    async load(id) {
      const cleanId = id.split("?")[0];
      if (cleanId.startsWith("\0sommark-runtime:")) {
        const absoluteSmarkPath = cleanId.slice("\0sommark-runtime:".length);
        try {
          const js = await getTranspiledJs(absoluteSmarkPath);
          return {
            code: js,
            map: { mappings: "" }
          };
        } catch (err: any) {
          this.error(`[SomMark] ${err.message}`);
        }
      }
      if (cleanId.endsWith(".html")) {
        const pathname = "/" + path.relative(projectRoot, cleanId);
        const smarkFile = resolveSmarkFile(pathname, pagesDir);
        if (smarkFile) {
          try {
            return await getTranspiledHtml(smarkFile);
          } catch (err: any) {
            this.error(`[SomMark] ${err.message}`);
          }
        }
      }
      return null;
    },

    async generateBundle(outputOptions, bundle) {
      const routes = await scanPages(pagesDir);
      for (const route of routes) {
        let clientJs = await getTranspiledJs(route.filePath);
        if (clientJs && clientJs.trim()) {
          const relPath = path.relative(projectRoot, route.filePath).replace(/\\/g, "/");
          if (minify) {
            const minified = await transformWithEsbuild(clientJs, `${relPath}.js`, {
              minify: true
            });
            clientJs = minified.code;
          }
          this.emitFile({
            type: "asset",
            fileName: `sommark-runtime/${relPath}.js`,
            source: clientJs
          });
        }
      }

      // Generate Sitemap & Robots.txt
      const siteUrl = options.siteUrl || smarkConfig?.siteUrl;
      const sitemap = options.sitemap !== undefined ? options.sitemap : (smarkConfig?.sitemap !== false);
      const robots = options.robots !== undefined ? options.robots : (smarkConfig?.robots !== false);

      if (siteUrl) {
        const cleanSiteUrl = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;

        if (sitemap) {
          const xmlUrls = routes
            .filter(r => r.url !== "/404")
            .map(r => {
              const loc = cleanSiteUrl + r.url;
              const lastmod = new Date().toISOString().split("T")[0];
              return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
            })
            .join("\n");

          const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${xmlUrls}\n</urlset>\n`;

          this.emitFile({
            type: "asset",
            fileName: "sitemap.xml",
            source: sitemapXml
          });
        }

        if (robots) {
          const robotsTxt = `User-agent: *\nAllow: /\n\nSitemap: ${cleanSiteUrl}/sitemap.xml\n`;
          this.emitFile({
            type: "asset",
            fileName: "robots.txt",
            source: robotsTxt
          });
        }
      } else if (sitemap || robots) {
        console.log(pc.yellow(`\n⚠️  [SomMark SEO Warning] "siteUrl" is not defined. Skipping sitemap.xml and robots.txt generation.`));
      }
    },

    closeBundle() {
      if (isBuild && seoWarningsMap.size > 0) {
        console.log(pc.yellow(`\n⚠️  [SomMark SEO Auditor] Found SEO recommendations:`));
        for (const [page, warnings] of seoWarningsMap.entries()) {
          console.log(pc.cyan(`  ${page}:`));
          for (const warning of warnings) {
            console.log(pc.dim(`    - ${warning}`));
          }
        }
        console.log();
        seoWarningsMap.clear();
      }
    },

    configurePreviewServer(server: PreviewServer) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        const pathname = url.pathname;

        if (pathname !== "/" && !pathname.includes(".")) {
          const cleanPath = pathname.replace(/^\//, "");
          const candidateHtml = path.join(outDir, cleanPath + ".html");
          const candidateIndexHtml = path.join(outDir, cleanPath, "index.html");

          if (existsSync(candidateHtml)) {
            req.url = pathname + ".html" + url.search;
          } else if (existsSync(candidateIndexHtml)) {
            req.url = pathname + "/index.html" + url.search;
          } else {
            const notFoundHtml = path.join(outDir, "404.html");
            res.statusCode = 404;
            res.setHeader("Content-Type", "text/html");
            if (existsSync(notFoundHtml)) {
              readFile(notFoundHtml, "utf-8")
                .then((html) => res.end(html))
                .catch(() => {
                  res.end(default404Html);
                });
            } else {
              res.end(default404Html);
            }
            return;
          }
        }
        next();
      });
    },

    configureServer(server: ViteDevServer) {
      printLogo();
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || "/", `http://${req.headers.host}`);
        const pathname = url.pathname;

        const smarkFile = resolveSmarkFile(pathname, pagesDir);
        if (smarkFile) {
          console.log(`${pc.cyan("[SomMark]")} ${pc.dim("Serving:")} ${pc.white(pathname)}`);
          try {
            const html = await getTranspiledHtml(smarkFile);
            const transformed = await server.transformIndexHtml(pathname, html);
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html");
            res.end(transformed);
            return;
          } catch (err: any) {
            console.error(`${pc.red("[SomMark Error]")} ${pc.white(pathname)}:`, err.message || err);

            const src = await readFile(smarkFile, "utf-8").catch(() => "");
            const errorHtml = buildErrorHtml(err, pathname, src);
            res.statusCode = 500;
            res.setHeader("Content-Type", "text/html");
            try {
              const transformed = await server.transformIndexHtml(pathname, errorHtml);
              res.end(transformed);
            } catch {
              res.end(errorHtml);
            }
            return;
          }
        } else if (pathname.endsWith(".smark") || (pathname !== "/" && !pathname.includes(".") && !pathname.startsWith("/@vite/"))) {
          // Serve custom 404.smark if it exists
          const notFoundPage = path.join(pagesDir, "404.smark");
          if (existsSync(notFoundPage)) {
            console.log(`${pc.cyan("[SomMark]")} ${pc.dim("404:")} ${pc.white(pathname)}`);
            try {
              const html = await getTranspiledHtml(notFoundPage);
              const transformed = await server.transformIndexHtml(pathname, html);
              res.statusCode = 404;
              res.setHeader("Content-Type", "text/html");
              res.end(transformed);
              return;
            } catch (err: any) {
              console.error(`${pc.red("[SomMark Error]")} Failed to render 404 page:`, err.message);
            }
          } else {
            console.warn(`${pc.yellow("[SomMark Warning]")} Page not found: ${pc.dim(pathname)}`);
            res.statusCode = 404;
            res.setHeader("Content-Type", "text/html");
            res.end(default404Html);
            return;
          }
        }
        next();
      });
    },

    transformIndexHtml: {
      order: "pre",
      async handler(html, ctx) {
        if (!ctx || !ctx.path) return html;
        const smarkFile = resolveSmarkFile(ctx.path, pagesDir);
        if (!smarkFile) return html;

        // Run SEO Auditor
        const runSeoAudit = options.seoAudit !== undefined ? options.seoAudit : (smarkConfig?.seoAudit !== false);
        if (runSeoAudit) {
          const pageWarnings = auditSEO(html);
          if (pageWarnings.length > 0) {
            if (isBuild) {
              seoWarningsMap.set(ctx.path, pageWarnings);
            } else {
              console.log(pc.yellow(`\n⚠️  [SomMark SEO Auditor] Recommendations for ${ctx.path}:`));
              for (const warning of pageWarnings) {
                console.log(pc.dim(`    - ${warning}`));
              }
              console.log();
            }
          }
        }
        
        try {
          const clientJs = await getTranspiledJs(smarkFile);
          if (clientJs && clientJs.trim()) {
            const relPath = path.relative(projectRoot, smarkFile).replace(/\\/g, "/");
            const virtualUrl = `/sommark-runtime/${relPath}.js`;
            return {
              html,
              tags: [
                {
                  tag: "script",
                  attrs: { type: "module", src: virtualUrl },
                  injectTo: "body"
                }
              ]
            };
          }
        } catch {
          // JS compilation failed; transpilation error already shown by configureServer
        }
        return html;
      }
    },

    async handleHotUpdate({ file, server }) {
      if (file.endsWith("smark.config.js")) {
        console.log(`${pc.cyan("[SomMark]")} ${pc.dim("Config updated. Reloading configurations...")}`);
        smarkConfig = await findAndLoadConfig(projectRoot);
        dualCache.clear();
        server.ws.send({ type: "full-reload" });
      } else if (file.endsWith(".smark")) {
        dualCache.clear();
        for (const mod of server.moduleGraph.idToModuleMap.values()) {
          if (mod.id && mod.id.startsWith("\0sommark-runtime:")) {
            server.moduleGraph.invalidateModule(mod);
          }
        }
        server.ws.send({ type: "full-reload" });
      }
    }
  };
}

function buildErrorHtml(err: any, pathname: string, src: string = ""): string {
  const esc = (s: string) =>
    String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  const raw = (err.message || String(err)).trim();
  const typeMatch = raw.match(/^\[([^\]]+)\]/);
  const errorKind = typeMatch ? typeMatch[1] : "Error";
  const errorMsg = typeMatch
    ? raw.slice(typeMatch[0].length).replace(/^[\s:]+/, "").trim()
    : raw;

  const frames = (err.stack || "")
    .split("\n")
    .map((l: string) => l.trim())
    .filter((l: string) => l.startsWith("at "))
    .map((l: string) => {
      const inner = l.slice(3).trim();
      const parenOpen = inner.lastIndexOf("(");
      const parenClose = inner.lastIndexOf(")");
      let fn: string, loc: string;
      if (parenOpen !== -1 && parenClose > parenOpen) {
        fn = inner.slice(0, parenOpen).trim();
        loc = inner.slice(parenOpen + 1, parenClose);
      } else {
        fn = "";
        loc = inner;
      }
      let cls = "user";
      if (loc.startsWith("node:")) cls = "node";
      else if (loc.includes("node_modules")) cls = "pkg";
      return { fn, loc, cls };
    })
    .filter(({ cls }) => cls !== "node");

  const framesHtml = frames.map(({ fn, loc, cls }) =>
    `<div class="frame ${cls}"><span class="at">at</span><span class="fn">${esc(fn || "<anonymous>")}</span><span class="sep">(</span><span class="loc">${esc(loc)}</span><span class="sep">)</span></div>`
  ).join("");

  // Try to extract line number from error message: "at line 5" or "line: 5"
  const lineMatch = raw.match(/at line[:\s]+(\d+)/i) || raw.match(/line[:\s]+(\d+)/i);
  const errorLine: number | null = lineMatch ? parseInt(lineMatch[1], 10) : null;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Error — SomMark</title>
<script src="https://cdn.jsdelivr.net/npm/sommark-highlight/dist/sommark-highlight.js"></script>
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
:root{
  --bg:#101012;--panel:#1c1c1f;--panel-header:#1a1a1d;
  --border:#2a2a2e;--border-err:#6b2535;
  --rose-bg:#2a0e15;--rose-border:#6b2535;--rose-text:#f07585;
  --orange:#cc7832;--teal:#5fa89a;
  --muted:#505055;--text:#b0b0b8;--bright:#e0e0e8;--green:#4db87a;
  --mono:"JetBrains Mono","Cascadia Code","Fira Code",Consolas,monospace;
  --sans:system-ui,-apple-system,"Segoe UI",sans-serif;
}
body{
  background:var(--bg);color:var(--text);
  font-family:var(--mono);font-size:13px;line-height:1.5;
  min-height:100vh;display:flex;align-items:center;
  justify-content:center;padding:32px 20px;
}
.panel{
  width:100%;max-width:720px;
  background:var(--panel);
  border:1px solid var(--border);
  border-radius:10px;
  overflow:hidden;
  box-shadow:0 24px 80px rgba(0,0,0,.7),0 0 0 1px rgba(255,255,255,.03);
  display:flex;flex-direction:column;
  max-height:85vh;
}
.header{
  background:var(--panel-header);
  border-bottom:1px solid var(--border);
  padding:0 18px;height:40px;
  display:flex;align-items:center;gap:10px;
  flex-shrink:0;min-width:0;
}
.win-btn{
  width:12px;height:12px;border-radius:50%;
  background:#e05252;border:1px solid rgba(0,0,0,.25);
  flex-shrink:0;
}
.header-title{color:#888;font-size:12px;font-weight:500;margin-left:2px;flex-shrink:0}
.header-path{
  color:var(--muted);font-size:12px;margin-left:4px;
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap;min-width:0;
}
.header-path em{font-style:normal;color:var(--teal)}
.body{overflow-y:auto;padding:24px 26px 28px;flex:1}
.badge{
  display:inline-flex;align-items:center;gap:5px;
  background:var(--rose-bg);border:1px solid var(--rose-border);
  border-radius:4px;padding:2px 9px;
  color:var(--rose-text);font-size:10px;font-weight:700;
  text-transform:uppercase;letter-spacing:1.2px;margin-bottom:14px;
}
.error-block{
  background:var(--rose-bg);
  border:1px solid var(--rose-border);
  border-left:3px solid #c03050;
  border-radius:6px;padding:16px 18px;
  margin-bottom:24px;
}
.error-msg{
  font-family:var(--sans);font-size:15px;font-weight:500;
  color:var(--bright);line-height:1.6;
  white-space:pre-wrap;word-break:break-word;
}
.sec-label{
  font-size:10px;text-transform:uppercase;letter-spacing:1.5px;
  color:var(--muted);margin-bottom:8px;padding-left:1px;
}
.stack{
  background:#141416;border:1px solid var(--border);
  border-radius:6px;overflow:auto;padding:14px 18px;
}
.frame{display:flex;line-height:1.85;white-space:nowrap}
.at{color:#303035;margin-right:8px;flex-shrink:0}
.fn{margin-right:4px}
.sep{color:#2a2a2e}
.frame.user .fn{color:var(--orange)}
.frame.user .loc{color:var(--teal)}
.frame.pkg .fn,.frame.pkg .loc{color:#333}
/* ── Source panel ──────────────────── */
.src-wrap{
  margin-top:20px;
  background:#141416;border:1px solid var(--border);
  border-radius:6px;overflow:auto;max-height:260px;
}
.sl{display:flex;white-space:pre;line-height:1.8;min-width:0}
.sl-err{background:#2a0e15;border-left:2px solid #c03050}
.ln{
  color:#303038;min-width:2.8em;padding:0 10px 0 12px;
  text-align:right;flex-shrink:0;user-select:none;
  border-right:1px solid #1e1e22;
}
/* ── Responsive ────────────────────── */
@media(max-width:600px){
  body{padding:0;align-items:flex-start}
  .panel{max-width:100%;min-height:100vh;max-height:none;border-radius:0;border-left:none;border-right:none;box-shadow:none}
  .body{padding:18px 16px 24px}
  .error-msg{font-size:13px}
  .hint{display:none}
  .footer{gap:8px}
  .src-wrap{max-height:200px;font-size:11px}
  .ln{min-width:2.2em;padding:0 8px 0 8px}
}
.sl-err .ln{color:#6b2535}
.lc{padding:0 16px;flex:1}
/* ── Footer ────────────────────────── */
.footer{
  background:#161618;border-top:1px solid var(--border);
  height:30px;padding:0 18px;flex-shrink:0;
  display:flex;align-items:center;gap:12px;
}
.hmr{display:flex;align-items:center;gap:6px;font-size:11px;color:var(--muted)}
.dot{width:6px;height:6px;border-radius:50%;background:var(--green);animation:pulse 2.4s ease-in-out infinite}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.2}}
.fsep{color:var(--border)}
.hint{font-size:11px;color:#353535}
</style>
</head>
<body>
<div class="panel">
  <div class="header">
    <div class="win-btn"></div>
    <span class="header-title">SomMark — Error</span>
    ${pathname && pathname !== "/" ? `<span class="header-path">• <em>${esc(pathname)}</em></span>` : ""}
  </div>
  <div class="body">
    <div class="badge">${esc(errorKind)}</div>
    <div class="error-block">
      <div class="error-msg">${esc(errorMsg)}</div>
    </div>
    ${framesHtml ? `<div class="sec-label">Stack Trace</div><div class="stack">${framesHtml}</div>` : ""}
    ${src ? `<div class="sec-label" style="margin-top:20px">Source</div><div class="src-wrap" id="src-panel"></div>` : ""}
  </div>
  <div class="footer">
    <div class="hmr"><div class="dot"></div>HMR active</div>
    <span class="fsep">|</span>
    <span class="hint">Fix the file and save — page reloads automatically</span>
  </div>
</div>
<script>
(function(){
  var raw = ${JSON.stringify(src)};
  var errLine = ${errorLine ?? "null"};
  if (!raw || typeof SomMarkHighlight === "undefined") return;
  var lines = raw.split("\\n");
  var pad = String(lines.length).length;
  var highlighted = SomMarkHighlight.staticHighlight(raw).split("\\n");
  var html = highlighted.map(function(lineHtml, i) {
    var n = i + 1;
    var isErr = n === errLine;
    var ln = String(n).padStart(pad, " ");
    return '<div class="sl' + (isErr ? " sl-err" : "") + '">'
      + '<span class="ln">' + ln + '</span>'
      + '<span class="lc">' + lineHtml + '</span>'
      + '</div>';
  }).join("");
  var panel = document.getElementById("src-panel");
  if (panel) {
    panel.innerHTML = html;
    var errEl = panel.querySelector(".sl-err");
    if (errEl) errEl.scrollIntoView({ block: "center" });
  }
})();
</script>
</body>
</html>`;
}

/**
 * Resolves a source path (like /logo.png) to an absolute file path.
 * Searches in project root, src, and public directories.
 */
export async function resolveAssetPath(src: string, fileDir: string, projectRoot: string): Promise<string | null> {
  const candidates: string[] = [];
  if (src.startsWith("/")) {
    const rootPath = src.slice(1);
    candidates.push(path.join(projectRoot, rootPath));
    candidates.push(path.join(projectRoot, "src", rootPath));
    candidates.push(path.join(projectRoot, "public", rootPath));
  } else {
    candidates.push(path.resolve(fileDir, src));
  }

  for (const absPath of candidates) {
    if (existsSync(absPath)) return absPath;
  }
  return null;
}

/**
 * Maps a URL pathname to a corresponding .smark file in the pages directory.
 */
export function resolveSmarkFile(pathname: string, pagesDir: string): string | null {
  let normalized = pathname.replace(/^\//, "").replace(/\/index\.html$/, "").replace(/\.html$/, "");
  if (normalized.endsWith("/")) normalized = normalized.slice(0, -1);
  if (normalized === "") normalized = "index";

  const candidates = [
    path.join(pagesDir, normalized + ".smark"),
    path.join(pagesDir, normalized, "index.smark")
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
export async function scanPages(dir: string, baseDir: string = dir): Promise<{ url: string, filePath: string }[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const results: { url: string, filePath: string }[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...(await scanPages(fullPath, baseDir)));
    } else if (entry.name.endsWith(".smark")) {
      const relativePath = path.relative(baseDir, fullPath);
      let url = "/" + relativePath.replace(/\.smark$/, "").replace(/\\/g, "/");
      if (url.endsWith("/index")) url = url.slice(0, -5) || "/";
      results.push({ url, filePath: fullPath });
    }
  }

  return results;
}

/**
 * Simple zero-dependency SEO auditor for compiled HTML output.
 */
export function auditSEO(html: string): string[] {
  const warnings: string[] = [];

  // 1. Check title tag
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (!titleMatch) {
    warnings.push("Missing <title> tag");
  } else if (!titleMatch[1].trim()) {
    warnings.push("<title> tag is empty");
  }

  // 2. Check meta description
  const metaDescMatch = html.match(/<meta\s+[^>]*name=["']description["'][^>]*content=["']([^"']*)["']/i) ||
                        html.match(/<meta\s+[^>]*content=["']([^"']*)["'][^>]*name=["']description["']/i);
  if (!metaDescMatch) {
    warnings.push("Missing <meta name=\"description\"> tag");
  } else if (!metaDescMatch[1].trim()) {
    warnings.push("<meta name=\"description\"> content is empty");
  }

  // 3. Check canonical tag
  const canonicalMatch = html.match(/<link\s+[^>]*rel=["']canonical["'][^>]*>/i);
  if (!canonicalMatch) {
    warnings.push("Missing <link rel=\"canonical\"> tag");
  }

  // 4. Check image alt tags
  const imgRegex = /<img\s+([^>]+)>/gi;
  let imgMatch;
  let imgIndex = 0;
  while ((imgMatch = imgRegex.exec(html)) !== null) {
    imgIndex++;
    const attrs = imgMatch[1];
    const altMatch = attrs.match(/alt=["']([^"']*)["']/i);
    if (!altMatch) {
      const srcMatch = attrs.match(/src=["']([^"']*)["']/i);
      const identifier = srcMatch ? `src="${srcMatch[1]}"` : `image #${imgIndex}`;
      warnings.push(`Image missing alt attribute: ${identifier}`);
    }
  }

  return warnings;
}

/**
 * Premium default 404 HTML page when custom 404.smark is not provided.
 */
const default404Html = `<!DOCTYPE html>
<html>
  <head>
    <title>404 Not Found</title>
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <style>
      body {
        background: #0f172a;
        color: #94a3b8;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        display: flex;
        align-items: center;
        justify-content: center;
        height: 100vh;
        margin: 0;
        text-align: center;
      }
      .container {
        padding: 2rem;
      }
      h1 {
        font-size: 6rem;
        margin: 0 0 1rem 0;
        color: #f43f5e;
        font-weight: 800;
        line-height: 1;
      }
      p {
        font-size: 1.5rem;
        color: #64748b;
        margin: 0 0 2rem 0;
      }
      a {
        color: #f43f5e;
        text-decoration: none;
        border: 1px solid #f43f5e;
        padding: 0.75rem 1.5rem;
        border-radius: 8px;
        font-weight: 600;
        transition: all 0.2s ease;
      }
      a:hover {
        background: #f43f5e;
        color: #0f172a;
      }
    </style>
  </head>
  <body>
    <div class="container">
      <h1>404</h1>
      <p>Page Not Found</p>
      <a href="/">Go Home</a>
    </div>
  </body>
</html>
`;
