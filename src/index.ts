// @ts-nocheck
import { build as esbuildBuild } from "esbuild";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";
import { findAndLoadConfig } from "sommark";
import {
  buildDynamicRouteMap,
  matchDynamicRequest,
  extractHeadings,
  type DynamicRouteEntry,
} from "./dynamic.js";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import crypto from "node:crypto";
import ora from "ora";
import pc from "picocolors";

import type { SomMarkPluginOptions, RouteData } from "./types.js";
import { createCompiler } from "./compiler.js";
import { auditSEO } from "./seo.js";
import { resolveSmarkFile, scanPages } from "./pages.js";
import { buildErrorHtml, default404Html } from "./error-html.js";

export { themeScript } from "./theme.js";
export type { SomMarkPluginOptions } from "./types.js";

export default function sommarkPlugin(options: SomMarkPluginOptions = {}): Plugin {
  let projectRoot = process.cwd();
  let pagesDir = path.resolve(projectRoot, options.pagesDir || "src/pages");
  let publicDir = path.resolve(projectRoot, "public");
  let smarkConfig: any = null;
  let minify = true;
  let isBuild = false;
  let outDir = "dist";
  let base = "/";

  const dualCache = new Map<string, { html: string; css: string; js: string }>();
  const globCache = new Map<string, any>();
  const dataCache = new Map<string, any[]>();
  const dynamicRouteMap = new Map<string, DynamicRouteEntry>();
  const seoWarningsMap = new Map<string, string[]>();

  // Mutable context object shared with the compiler — mutations (compileQueue,
  // smarkConfig) are visible here because objects are passed by reference.
  const ctx = {
    get options() { return options; },
    get smarkConfig() { return smarkConfig; },
    set smarkConfig(v) { smarkConfig = v; },
    get isBuild() { return isBuild; },
    get projectRoot() { return projectRoot; },
    get pagesDir() { return pagesDir; },
    dualCache,
    globCache,
    dataCache,
    dynamicRouteMap,
    compileQueue: Promise.resolve() as Promise<void>,
  };

  const { getTranspiledHtml, getTranspiledCss, getTranspiledJs } = createCompiler(ctx);

  const printLogo = () => {
    console.log(pc.cyan(`\n  SomMark Web`));
    console.log(pc.dim(`  v1.0.0 • Vite Plugin\n`));
  };

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

      dynamicRouteMap.clear();
      if (options.dynamic) {
        const built = await buildDynamicRouteMap(options.dynamic, pagesDir, projectRoot);
        for (const [key, entry] of built) dynamicRouteMap.set(key, entry);
      }

      spinner.succeed(pc.green(`Found ${routes.length} static + ${dynamicRouteMap.size} dynamic pages`));

      const input: Record<string, string> = {};
      for (const route of routes) {
        const htmlPath = route.url === "/" ? "index.html" : route.url.slice(1) + ".html";
        input[route.url === "/" ? "index" : route.url.slice(1).replace(/\//g, "__")] = htmlPath;
      }
      for (const [htmlPath, dyn] of dynamicRouteMap.entries()) {
        const key = dyn.url === "/" ? "index" : dyn.url.slice(1).replace(/\//g, "__");
        input[key] = htmlPath;
      }

      const external = command === "build" ? [/^\/sommark-runtime\//] : [];

      return { build: { rollupOptions: { input, external } } };
    },

    configResolved(config) {
      projectRoot = config.root;
      pagesDir = path.resolve(projectRoot, options.pagesDir || "src/pages");
      publicDir = path.resolve(config.publicDir ?? path.join(projectRoot, "public"));
      minify = config.build?.minify !== false;
      isBuild = config.command === "build";
      outDir = path.resolve(projectRoot, config.build?.outDir || "dist");
      base = config.base?.endsWith("/") ? config.base : (config.base || "/") + "/";
    },

    resolveId(id, importer) {
      if (importer && id.startsWith(".")) {
        if (importer.startsWith("\0sommark-runtime:")) {
          const smarkFile = importer.slice("\0sommark-runtime:".length);
          return path.resolve(path.dirname(smarkFile), id);
        }
        if (importer.startsWith("\0sommark-dynamic-runtime:")) {
          const runtimePath = importer.slice("\0sommark-dynamic-runtime:".length);
          const dyn = dynamicRouteMap.get(runtimePath + ".html");
          if (dyn) return path.resolve(path.dirname(dyn.layoutFile), id);
        }
      }
      const cleanId = id.split("?")[0];
      if (cleanId.startsWith("/sommark-runtime/")) {
        const runtimePath = cleanId.slice("/sommark-runtime/".length).replace(/\.js$/, "");
        if (dynamicRouteMap.has(runtimePath + ".html")) {
          return `\0sommark-dynamic-runtime:${runtimePath}`;
        }
        const absoluteSmarkPath = path.resolve(projectRoot, runtimePath);
        return `\0sommark-runtime:${absoluteSmarkPath}`;
      }
      if (cleanId.endsWith(".html")) {
        const pathname = cleanId.startsWith("/") ? cleanId : "/" + cleanId;
        const smarkFile = resolveSmarkFile(pathname, pagesDir);
        if (smarkFile) return path.join(projectRoot, cleanId);
        const relHtml = pathname.startsWith("/") ? pathname.slice(1) : pathname;
        if (dynamicRouteMap.has(relHtml)) return path.join(projectRoot, cleanId);
      }
      return null;
    },

    async load(id) {
      const cleanId = id.split("?")[0];

      if (cleanId.startsWith("\0sommark-dynamic-runtime:")) {
        const runtimePath = cleanId.slice("\0sommark-dynamic-runtime:".length);
        const dyn = dynamicRouteMap.get(runtimePath + ".html");
        if (dyn) {
          try {
            const js = await getTranspiledJs(dyn.layoutFile, { slug: dyn.slug, url: dyn.url, props: dyn.props });
            return { code: js, map: { mappings: "" } };
          } catch (err: any) {
            this.error(`[SomMark] ${err.message ?? err}`);
          }
        }
      }

      if (cleanId.startsWith("\0sommark-runtime:")) {
        const absoluteSmarkPath = cleanId.slice("\0sommark-runtime:".length);
        try {
          const js = await getTranspiledJs(absoluteSmarkPath);
          return { code: js, map: { mappings: "" } };
        } catch (err: any) {
          this.error(`[SomMark] ${err.message ?? err}`);
        }
      }

      if (cleanId.endsWith(".html")) {
        const relHtml = path.relative(projectRoot, cleanId).replace(/\\/g, "/");
        const pathname = "/" + relHtml;

        const smarkFile = resolveSmarkFile(pathname, pagesDir);
        if (smarkFile) {
          try {
            let html = await getTranspiledHtml(smarkFile);
            const css = await getTranspiledCss(smarkFile);
            if (css) {
              if (isBuild) {
                const pageSlug = path.relative(pagesDir, smarkFile).replace(/\.smark$/, "").replace(/[/\\]/g, "-");
                const hash = crypto.createHash("md5").update(css).digest("hex").slice(0, 8);
                const assetPath = `assets/smark-${pageSlug}-${hash}.css`;
                this.emitFile({ type: "asset", fileName: assetPath, source: css });
                html = html.replace("</head>", `  <link rel="stylesheet" href="${base}${assetPath}">\n</head>`);
              } else {
                html = html.replace("</head>", `  <style>${css}</style>\n</head>`);
              }
            }
            return html;
          } catch (err: any) {
            this.error(`[SomMark] ${err.message ?? err}`);
          }
        }

        const dyn = dynamicRouteMap.get(relHtml);
        if (dyn) {
          try {
            if (!dyn.headings) {
              const firstHtml = await getTranspiledHtml(dyn.layoutFile, { slug: dyn.slug, url: dyn.url, props: dyn.props });
              dyn.headings = extractHeadings(firstHtml);
            }
            const rd: RouteData = { slug: dyn.slug, url: dyn.url, props: dyn.props, headings: dyn.headings };
            let html = await getTranspiledHtml(dyn.layoutFile, rd);
            const css = await getTranspiledCss(dyn.layoutFile, rd);
            if (css) {
              if (isBuild) {
                const pageSlug = dyn.url.slice(1).replace(/\//g, "-") || "index";
                const hash = crypto.createHash("md5").update(css).digest("hex").slice(0, 8);
                const assetPath = `assets/smark-${pageSlug}-${hash}.css`;
                this.emitFile({ type: "asset", fileName: assetPath, source: css });
                html = html.replace("</head>", `  <link rel="stylesheet" href="${base}${assetPath}">\n</head>`);
              } else {
                html = html.replace("</head>", `  <style>${css}</style>\n</head>`);
              }
            }
            return html;
          } catch (err: any) {
            this.error(`[SomMark] ${err.message ?? err}`);
          }
        }
      }
      return null;
    },

    async generateBundle(outputOptions, bundle) {
      const routes = await scanPages(pagesDir);

      const bundleJs = async (code: string, resolveDir: string): Promise<string> => {
        const result = await esbuildBuild({
          stdin: { contents: code, resolveDir, loader: "js" },
          bundle: true,
          write: false,
          format: "esm",
          minify,
          platform: "browser",
        });
        return result.outputFiles[0].text;
      };

      for (const route of routes) {
        let clientJs = await getTranspiledJs(route.filePath);
        if (clientJs && clientJs.trim()) {
          const relPath = path.relative(projectRoot, route.filePath).replace(/\\/g, "/");
          clientJs = await bundleJs(clientJs, path.dirname(route.filePath));
          this.emitFile({ type: "asset", fileName: `sommark-runtime/${relPath}.js`, source: clientJs });
        }
      }

      for (const [, dyn] of dynamicRouteMap.entries()) {
        let clientJs = await getTranspiledJs(dyn.layoutFile, { slug: dyn.slug, url: dyn.url, props: dyn.props });
        if (clientJs && clientJs.trim()) {
          clientJs = await bundleJs(clientJs, path.dirname(dyn.layoutFile));
          this.emitFile({ type: "asset", fileName: `sommark-runtime/${dyn.url.slice(1)}.js`, source: clientJs });
        }
      }

      const siteUrl = options.siteUrl || smarkConfig?.siteUrl;
      const sitemap = options.sitemap !== undefined ? options.sitemap : (smarkConfig?.sitemap !== false);
      const robots  = options.robots  !== undefined ? options.robots  : (smarkConfig?.robots  !== false);

      const allRoutes = [
        ...routes,
        ...[...dynamicRouteMap.values()].map(d => ({ url: d.url, filePath: d.smarkFile })),
      ];

      if (siteUrl) {
        const cleanSiteUrl = siteUrl.endsWith("/") ? siteUrl.slice(0, -1) : siteUrl;

        if (sitemap) {
          const xmlUrls = allRoutes
            .filter(r => r.url !== "/404")
            .map(r => {
              const loc = cleanSiteUrl + r.url;
              const lastmod = new Date().toISOString().split("T")[0];
              return `  <url>\n    <loc>${loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`;
            })
            .join("\n");
          const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${xmlUrls}\n</urlset>\n`;
          this.emitFile({ type: "asset", fileName: "sitemap.xml", source: sitemapXml });
        }

        if (robots) {
          const robotsTxt = `User-agent: *\nAllow: /\n\nSitemap: ${cleanSiteUrl}/sitemap.xml\n`;
          this.emitFile({ type: "asset", fileName: "robots.txt", source: robotsTxt });
        }
      } else if (sitemap || robots) {
        console.log(pc.yellow(`\n⚠️  [SomMark SEO Warning] "siteUrl" is not defined. Skipping sitemap.xml and robots.txt generation.`));
      }

      if (options.rss) {
        if (!siteUrl) {
          console.log(pc.yellow(`\n⚠️  [SomMark] rss: "siteUrl" is not defined. Skipping feed.xml generation.`));
        } else {
          const cleanSiteUrl = (siteUrl as string).endsWith("/") ? (siteUrl as string).slice(0, -1) : (siteUrl as string);
          try {
            const feedItems = await options.rss.items();
            const now = new Date().toUTCString();
            const itemsXml = feedItems.map(item => {
              const fullUrl = item.url.startsWith("http") ? item.url : cleanSiteUrl + item.url;
              const pubDate = item.date ? new Date(item.date).toUTCString() : now;
              const desc = item.description ? `<description><![CDATA[${item.description}]]></description>` : "";
              const author = item.author ? `<author>${item.author}</author>` : "";
              return `  <item>\n    <title><![CDATA[${item.title}]]></title>\n    <link>${fullUrl}</link>\n    <guid>${fullUrl}</guid>\n    ${desc}\n    ${author}\n    <pubDate>${pubDate}</pubDate>\n  </item>`;
            }).join("\n");
            const feedXml = `<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0">\n<channel>\n  <title><![CDATA[${options.rss.title}]]></title>\n  <link>${cleanSiteUrl}</link>\n  <description><![CDATA[${options.rss.description}]]></description>\n  <lastBuildDate>${now}</lastBuildDate>\n${itemsXml}\n</channel>\n</rss>\n`;
            this.emitFile({ type: "asset", fileName: "feed.xml", source: feedXml });
          } catch (e: any) {
            console.log(pc.yellow(`\n⚠️  [SomMark] rss: items() threw — ${e.message}`));
          }
        }
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
                .catch(() => res.end(default404Html));
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
        const dynEntry = !smarkFile ? matchDynamicRequest(pathname, dynamicRouteMap) : null;
        const dynRd: RouteData | undefined = dynEntry
          ? { slug: dynEntry.slug, url: dynEntry.url, props: dynEntry.props, headings: dynEntry.headings }
          : undefined;

        if (smarkFile || dynEntry) {
          const label = dynEntry ? "Serving (dynamic):" : "Serving:";
          console.log(`${pc.cyan("[SomMark]")} ${pc.dim(label)} ${pc.white(pathname)}`);
          const activeFile = smarkFile || dynEntry!.layoutFile;
          const rd: RouteData | undefined = dynRd;
          try {
            if (dynEntry && !dynEntry.headings) {
              const firstHtml = await getTranspiledHtml(dynEntry.layoutFile, { slug: dynEntry.slug, url: dynEntry.url, props: dynEntry.props });
              dynEntry.headings = extractHeadings(firstHtml);
              rd!.headings = dynEntry.headings;
            }
            let html = await getTranspiledHtml(activeFile, rd);
            const css = await getTranspiledCss(activeFile, rd);
            if (css) {
              html = html.replace("</head>", `  <style>${css}</style>\n</head>`);
            }
            const transformed = await server.transformIndexHtml(pathname, html);
            res.statusCode = 200;
            res.setHeader("Content-Type", "text/html");
            res.end(transformed);
            return;
          } catch (err: any) {
            console.error(`${pc.red("[SomMark Error]")} ${pc.white(pathname)}:`, err.message || err);
            const src = await readFile(activeFile, "utf-8").catch(() => "");
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
        } else if (pathname.endsWith(".smark") && existsSync(path.join(publicDir, pathname))) {
          next();
          return;
        } else if (pathname.endsWith(".smark") || (pathname !== "/" && !pathname.includes(".") && !pathname.startsWith("/@") && !pathname.startsWith("/__"))) {
          const notFoundPage = path.join(pagesDir, "404.smark");
          if (existsSync(notFoundPage)) {
            console.log(`${pc.cyan("[SomMark]")} ${pc.dim("404:")} ${pc.white(pathname)}`);
            try {
              let html = await getTranspiledHtml(notFoundPage);
              const css404 = await getTranspiledCss(notFoundPage);
              if (css404) {
                html = html.replace("</head>", `  <style>${css404}</style>\n</head>`);
              }
              const transformed = await server.transformIndexHtml(pathname, html);
              res.statusCode = 404;
              res.setHeader("Content-Type", "text/html");
              res.end(transformed);
              return;
            } catch (err: any) {
              console.error(`${pc.red("[SomMark Error]")} Failed to render 404 page:`, err.message);
              const src = await readFile(notFoundPage, "utf-8").catch(() => "");
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
        let smarkFile = resolveSmarkFile(ctx.path, pagesDir);
        let rd: RouteData | undefined;

        if (!smarkFile) {
          const relHtml = ctx.path.startsWith("/") ? ctx.path.slice(1) : ctx.path;
          const adjHtml = relHtml.replace(/\.html$/, "") + ".html";
          const dyn = dynamicRouteMap.get(adjHtml);
          if (dyn) { smarkFile = dyn.layoutFile; rd = { slug: dyn.slug, url: dyn.url, props: dyn.props, headings: dyn.headings }; }
        }

        if (!smarkFile) return html;

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

        const tags: any[] = [];

        if (options.themeScript) {
          tags.push({ tag: "script", children: options.themeScript, injectTo: "head-prepend" });
        }

        try {
          const clientJs = await getTranspiledJs(smarkFile, rd);
          if (clientJs && clientJs.trim()) {
            let virtualUrl: string;
            if (rd?.slug) {
              virtualUrl = `/sommark-runtime/${rd.url!.slice(1)}.js`;
            } else {
              const relPath = path.relative(projectRoot, smarkFile).replace(/\\/g, "/");
              virtualUrl = `/sommark-runtime/${relPath}.js`;
            }
            tags.push({ tag: "script", attrs: { type: "module", src: virtualUrl }, injectTo: "body" });
          }
        } catch {
          // JS compilation failed; error already shown by configureServer
        }
        return tags.length ? { html, tags } : html;
      }
    },

    async handleHotUpdate({ file, server }) {
      if (file.endsWith("smark.config.js")) {
        console.log(`${pc.cyan("[SomMark]")} ${pc.dim("Config updated. Reloading configurations...")}`);
        smarkConfig = await findAndLoadConfig(projectRoot);
        dualCache.clear();
        globCache.clear();
        dynamicRouteMap.clear();
        if (options.dynamic) {
          const rebuilt = await buildDynamicRouteMap(options.dynamic, pagesDir, projectRoot);
          for (const [key, entry] of rebuilt) dynamicRouteMap.set(key, entry);
        }
        server.ws.send({ type: "full-reload" });
      } else if (file.endsWith(".smark")) {
        dualCache.clear();
        globCache.clear();
        for (const entry of dynamicRouteMap.values()) entry.headings = undefined;
        for (const mod of server.moduleGraph.idToModuleMap.values()) {
          if (mod.id && (mod.id.startsWith("\0sommark-runtime:") || mod.id.startsWith("\0sommark-dynamic-runtime:"))) {
            server.moduleGraph.invalidateModule(mod);
          }
        }
        server.ws.send({ type: "full-reload" });
      } else if (file.startsWith(projectRoot) && !file.includes("node_modules")) {
        dualCache.clear();
        globCache.clear();
        server.ws.send({ type: "full-reload" });
      }
    },
  };
}
