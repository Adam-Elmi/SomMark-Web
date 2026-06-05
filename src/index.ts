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

  const htmlCache = new Map<string, string>();
  const jsCache = new Map<string, string>();
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

  const pkgInit = `\nstatic \${\n  globalThis.PKG = {\n    import: (packageName) => {\n      return new Proxy({}, {\n        get: (target, prop) => {\n          if (prop === "then") return undefined;\n          return async (...args) => {\n            return await __hostImportCall(packageName, prop, args);\n          };\n        }\n      });\n    }\n  };\n}\$\n`;

  const compileSmark = async (smarkFile: string, generateRuntimeOutput: boolean) => {
    const cache = generateRuntimeOutput ? jsCache : htmlCache;
    if (cache.has(smarkFile)) {
      return cache.get(smarkFile)!;
    }
    if (!smarkConfig) {
      smarkConfig = await findAndLoadConfig(projectRoot);
    }

    let entryContent = await readFile(smarkFile, "utf-8");
    const entryPath = smarkFile;

    const entryLines = entryContent.split("\n");
    let insertIndex = 0;
    for (let i = 0; i < entryLines.length; i++) {
      const trimmed = entryLines[i].trim();
      if (trimmed.startsWith("[import") || trimmed === "") {
        insertIndex = i + 1;
      } else {
        break;
      }
    }
    entryLines.splice(insertIndex, 0, pkgInit);
    entryContent = entryLines.join("\n");

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

    const placeholders = {
      ...smarkConfig.placeholders,
      ...options.placeholders,
      pagePath: smarkFile,
      page: smarkFile
    };

    const compiler = new SomMark({
      src: entryContent,
      format: "html",
      filename: entryPath,
      mapperFile: mapper,
      placeholders,
      variables: {
        __hostImportCall: hostImportCall
      },
      customProps: options.customProps || smarkConfig.customProps || ["content"],
      fallbackTarget: options.fallbackTarget !== undefined ? options.fallbackTarget : smarkConfig.fallbackTarget,
      outputValidator: options.outputValidator !== undefined ? options.outputValidator : smarkConfig.outputValidator,
      importAliases: { ...smarkConfig.importAliases, ...options.importAliases },
      security: { ...smarkConfig.security, ...options.security },
      showSpinner: options.showSpinner !== undefined ? options.showSpinner : smarkConfig.showSpinner,
      removeComments: options.removeComments !== undefined ? options.removeComments : smarkConfig.removeComments,
      generateRuntimeOutput,
      hideRuntimeOutput: !generateRuntimeOutput
    });

    const originalRandomBytes = crypto.randomBytes;
    let randomCounter = 0;
    crypto.randomBytes = function (size: number): Buffer {
      randomCounter++;
      const buf = Buffer.alloc(size);
      for (let i = 0; i < size; i++) {
        buf[i] = (randomCounter + i) % 256;
      }
      return buf;
    } as any;

    let result: string;
    try {
      result = await compiler.transpile();
    } finally {
      crypto.randomBytes = originalRandomBytes;
    }

    cache.set(smarkFile, result);
    return result;
  };

  const getTranspiledHtml = (smarkFile: string) => compileSmark(smarkFile, false);
  const getTranspiledJs = (smarkFile: string) => compileSmark(smarkFile, true);

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
        }
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
        const js = await getTranspiledJs(absoluteSmarkPath);
        return {
          code: js,
          map: { mappings: "" }
        };
      }
      if (cleanId.endsWith(".html")) {
        const pathname = "/" + path.relative(projectRoot, cleanId);
        const smarkFile = resolveSmarkFile(pathname, pagesDir);
        if (smarkFile) {
          return await getTranspiledHtml(smarkFile);
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
            const errorMessage = err.stack || err.message || String(err);
            console.error(`${pc.red("[SomMark Error]")} ${pc.white(pathname)}:`, errorMessage);
            
            // Wrap error in a basic HTML structure to keep the HMR client alive
            const errorHtml = `
              <!DOCTYPE html>
              <html>
                <head><title>SomMark Error</title></head>
                <body style="background: #1a1a1a; color: #ff5555; padding: 2rem; font-family: monospace; line-height: 1.5;">
                  <h1 style="color: #ff5555; border-bottom: 2px solid #ff5555; padding-bottom: 0.5rem;">SomMark Transpilation Error</h1>
                  <pre style="background: #000; padding: 1.5rem; border-radius: 8px; overflow: auto; border: 1px solid #333;">${errorMessage}</pre>
                  <p style="color: #888; margin-top: 2rem;"><strong>HMR is still active.</strong> Fix the syntax in your editor and the page will reload automatically.</p>
                </body>
              </html>
            `;
            
            const transformed = await server.transformIndexHtml(pathname, errorHtml);
            res.statusCode = 500;
            res.setHeader("Content-Type", "text/html");
            res.end(transformed);
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
        return html;
      }
    },

    async handleHotUpdate({ file, server }) {
      if (file.endsWith("smark.config.js")) {
        console.log(`${pc.cyan("[SomMark]")} ${pc.dim("Config updated. Reloading configurations...")}`);
        smarkConfig = await findAndLoadConfig(projectRoot);
        htmlCache.clear();
        jsCache.clear();
        server.ws.send({ type: "full-reload" });
      } else if (file.endsWith(".smark")) {
        htmlCache.clear();
        jsCache.clear();
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
