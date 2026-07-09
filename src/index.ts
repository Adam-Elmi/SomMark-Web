// @ts-nocheck
import { transformWithEsbuild } from "vite";
import { build as esbuildBuild } from "esbuild";
import type { Plugin, ViteDevServer, PreviewServer } from "vite";
import SomMark, { HTML, transpile, findAndLoadConfig, parseSync } from "sommark";
import { getMetadata, getHeadings, glob as smarkGlob } from "./variables/index.js";
import {
  buildDynamicRouteMap,
  matchDynamicRequest,
  isLayoutFile,
  extractHeadings,
  type DynamicConfig,
  type DynamicRouteEntry,
  type HeadingEntry,
} from "./dynamic.js";
import path from "node:path";
import { readdir, readFile, stat } from "node:fs/promises";
import fs from "node:fs";
import { existsSync, statSync } from "node:fs";
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
  fallbackTarget?: true | "style" | false;
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
  /**
   * Dynamic route folders. Each key is a top-level folder name under pages/.
   * The value is an async function returning an array of data items.
   * Each item must have a `slug` string. Everything else becomes `__props`.
   */
  dynamic?: DynamicConfig;
  /** The production URL of the site, used for canonical URLs, sitemaps, etc. */
  siteUrl?: string;
  /** Toggles automatic generation of sitemap.xml. Defaults to true */
  sitemap?: boolean;
  /** Toggles automatic generation of robots.txt. Defaults to true */
  robots?: boolean;
  /** Toggles build-time SEO auditing. Defaults to true */
  seoAudit?: boolean;
  /**
   * Generate an RSS/Atom feed at /feed.xml.
   * Requires `siteUrl` to be set.
   */
  rss?: {
    /** Feed title */
    title: string;
    /** Feed description */
    description: string;
    /** Returns the list of feed items */
    items: () => Promise<{
      title: string;
      url: string;
      description?: string;
      date?: string;
      author?: string;
    }[]>;
  };
}

/**
 * A Vite plugin that provides high-performance Static Site Generation
 * powered by the SomMark engine.
 */

export default function sommarkPlugin(options: SomMarkPluginOptions = {}): Plugin {
  let projectRoot = process.cwd();
  let pagesDir = path.resolve(projectRoot, options.pagesDir || "src/pages");
  let publicDir = path.resolve(projectRoot, "public");
  let smarkConfig: any = null;
  let minify = true;

  const dualCache = new Map<string, { html: string; css: string; js: string }>();
  const globCache = new Map<string, any>();
  const dynamicRouteMap = new Map<string, DynamicRouteEntry>();
  let compileQueue = Promise.resolve();
  let isBuild = false;
  let outDir = "dist";
  const seoWarningsMap = new Map<string, string[]>();

  // Node.js implementation of glob() — runs in Node.js as a bridge function,
  // so it can safely close over globCache/projectRoot/pagesDir without serialization.
  const headingIds: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
  function getNodeText(body: any): string {
    if (!Array.isArray(body)) return "";
    return body.map((n: any) => (n.type === "Text" ? (n.text || "") : n.body ? getNodeText(n.body) : "")).join("");
  }
  function slugifyText(text: string): string {
    return text.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
  }
  const processGlobResult = async (pattern: string): Promise<any[]> => {
    const pagesDirRel = path.relative(projectRoot, pagesDir).replace(/\\/g, "/") + "/";
    const results: any[] = [];
    // @ts-ignore — fs.promises.glob requires Node.js 22+
    for await (const relPath of fs.promises.glob(pattern, { cwd: projectRoot })) {
      const filePath = relPath.replace(/\\/g, "/");
      const absPath = path.join(projectRoot, filePath);
      if (isLayoutFile(absPath)) continue;
      const src = await readFile(absPath, "utf-8");
      const nodes = parseSync(src);
      const fileStat = await stat(absPath);
      const lastUpdate = new Date(fileStat.mtimeMs).toISOString();
      const fmNode = nodes.find((n: any) => n.type === "Block" && (n.id === "Metadata" || n.id === "metadata"));
      const metadata: Record<string, any> = {};
      if (fmNode && fmNode.props) {
        for (const key of Object.keys(fmNode.props)) {
          if (!isNaN(Number(key))) continue;
          let val = fmNode.props[key];
          if (val && typeof val === "object" && val.type === "StaticLogic" && typeof val.code === "string") {
            try { val = eval(`(${val.code.trim()})`); } catch { val = val.code; }
          } else if (typeof val === "string") {
            if (val === "true") val = true;
            else if (val === "false") val = false;
            else if (val === "null") val = null;
            else if (val.trim() !== "" && !isNaN(Number(val))) val = Number(val);
            else if ((val.startsWith("{") && val.endsWith("}")) || (val.startsWith("[") && val.endsWith("]"))) {
              try { val = JSON.parse(val); } catch {}
            }
          }
          metadata[key] = val;
        }
      }
      const headings: any[] = [];
      const walkNodes = (nodeList: any): void => {
        if (!Array.isArray(nodeList)) return;
        for (const node of nodeList) {
          const level = headingIds[node.id];
          if (level) {
            const text = getNodeText(node.body).trim();
            if (text) headings.push({ level, text, id: slugifyText(text) });
          }
          if (node.body) walkNodes(node.body);
        }
      };
      walkNodes(nodes);
      const firstH1 = headings.find((h: any) => h.level === 1);
      let url = filePath;
      if (url.startsWith(pagesDirRel)) url = url.slice(pagesDirRel.length);
      url = url.replace(/\.smark$/, "").replace(/\/index$/, "").replace(/^index$/, "");
      const slug = url || "index";
      url = "/" + url;
      const title = metadata.title || firstH1?.text || slug;
      results.push({ url, filePath, metadata, headings, title, lastUpdate });
    }
    return results;
  };
  const hostGlob = async (pattern: string): Promise<any[]> => {
    if (globCache.has(pattern)) return globCache.get(pattern);
    const result = await processGlobResult(pattern);
    globCache.set(pattern, result);
    return result;
  };

  const dataCache = new Map<string, any[]>();

  const fetchAllData = async (): Promise<Record<string, any[]>> => {
    const allData: Record<string, any[]> = {};
    for (const [folder, fn] of Object.entries(options.dynamic ?? {})) {
      if (isBuild && dataCache.has(folder)) {
        allData[folder] = dataCache.get(folder)!;
      } else {
        const items = await fn();
        if (isBuild) dataCache.set(folder, items);
        allData[folder] = items;
      }
    }
    return allData;
  };

  const fetchAllPages = async (): Promise<any[]> => {
    const pagesDirRel = path.relative(projectRoot, pagesDir).replace(/\\/g, "/");
    const staticPages = await hostGlob(`${pagesDirRel}/**/*.smark`);
    const dynamicPages = [...dynamicRouteMap.values()].map(d => ({
      url: d.url,
      filePath: path.relative(projectRoot, d.layoutFile).replace(/\\/g, "/"),
      isDynamic: true,
      slug: d.slug,
      folder: d.folder,
      props: d.props,
      metadata: JSON.parse(JSON.stringify(d.props)),
      headings: d.headings ?? [],
      title: (d.props.title as string) || d.slug,
      lastUpdate: "",
    }));
    return [
      ...staticPages.map(p => ({ ...p, isDynamic: false, props: {}, slug: "" })),
      ...dynamicPages,
    ];
  };

  const printLogo = () => {
    console.log(pc.cyan(`\n  SomMark Web`));
    console.log(pc.dim(`  v1.0.0 • Vite Plugin\n`));
  };

  const buildMapper = (smarkFile: string) => {
    const baseMapper = options.mapperFile || smarkConfig.mapperFile || HTML;
    const mapper = baseMapper.clone();
    const fileDir = path.dirname(smarkFile);
    // Files under publicDir are served at the root in production, not under /public/
    const toUrlPath = (abs: string) =>
      "/" + (abs.startsWith(publicDir + path.sep)
        ? path.relative(publicDir, abs)
        : path.relative(projectRoot, abs));
    mapper.register("script", async function (this: any, { props, content }) {
      let src = props.src || props[0];
      if (src && typeof src === "string" && !src.startsWith("http")) {
        const abs = await resolveAssetPath(src, fileDir, projectRoot);
        if (abs) src = toUrlPath(abs);
      }
      return this.tag("script").attributes({ ...props, src }).body(content);
    });
    mapper.register("link", async function (this: any, { props }) {
      let href = props.href || props[0];
      if (href && typeof href === "string" && !href.startsWith("http")) {
        const abs = await resolveAssetPath(href, fileDir, projectRoot);
        if (abs) href = toUrlPath(abs);
      }
      return this.tag("link").attributes({ ...props, href }).selfClose();
    });
    mapper.register(["Metadata", "metadata"], function () { return ""; }, { rules: { is_self_closing: true } });
    return mapper;
  };

  type RouteData = { slug?: string; url?: string; props?: Record<string, unknown>; headings?: HeadingEntry[] };

  const compileSmarkDual = (smarkFile: string, routeData?: RouteData): Promise<{ html: string; css: string; js: string }> => {
    const slug     = routeData?.slug     ?? "";
    const props    = routeData?.props    ?? {};
    const headings = routeData?.headings;
    // headings presence changes output, so encode it in the cache key
    const cacheKey = slug
      ? `${smarkFile}:${slug}${headings ? ":h" : ""}`
      : smarkFile;

    if (dualCache.has(cacheKey)) return Promise.resolve(dualCache.get(cacheKey)!);
    const task = compileQueue.then(async () => {
      if (dualCache.has(cacheKey)) return dualCache.get(cacheKey)!;
      if (!smarkConfig) smarkConfig = await findAndLoadConfig(projectRoot);

      const entryContent = await readFile(smarkFile, "utf-8");
      const placeholders = {
        ...smarkConfig.placeholders,
        ...options.placeholders,
        pagePath: smarkFile,
        page: smarkFile
      };

      const pagesDirRel = path.relative(projectRoot, pagesDir).replace(/\\/g, "/");
      const currentFile = path.relative(projectRoot, smarkFile).replace(/\\/g, "/");
      let currentUrl: string;
      if (routeData?.url) {
        currentUrl = routeData.url;
      } else {
        const currentUrlRel = path.relative(pagesDir, smarkFile).replace(/\\/g, "/");
        currentUrl = "/" + currentUrlRel.replace(/\.smark$/, "");
        if (currentUrl.endsWith("/index")) currentUrl = currentUrl.slice(0, -5) || "/";
      }

      const [html, css, js] = await new SomMark({
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
        webOutputs: true,
        variables: {
          __pagesDir: pagesDirRel,
          __currentFile: currentFile,
          __currentUrl: currentUrl,
          __props: props,
          __slug: slug,
          __headings: headings ?? [],
          __siteUrl: options.siteUrl || smarkConfig.siteUrl || "",
          __isDev: !isBuild,
          ...smarkConfig.variables,
          ...options.variables,
          glob: smarkGlob,
          getMetadata,
          getHeadings,
          __smarkData: await fetchAllData(),
          __smarkPages: await fetchAllPages(),
          getData: (folder: string) => (__smarkData[folder] || []),
          getPages: () => __smarkPages,
        },
      }).transpile() as unknown as [string, string, string];

      dualCache.set(cacheKey, { html, css, js });
      return { html, css, js };
    });
    // Always keep compileQueue resolved so a failed compilation doesn't permanently
    // block future compilations (a rejected promise swallows all chained .then callbacks).
    compileQueue = task.catch(() => {});
    return task;
  };

  const getTranspiledHtml = async (smarkFile: string, rd?: RouteData) => (await compileSmarkDual(smarkFile, rd)).html;
  const getTranspiledCss  = async (smarkFile: string, rd?: RouteData) => (await compileSmarkDual(smarkFile, rd)).css;
  const getTranspiledJs   = async (smarkFile: string, rd?: RouteData) => (await compileSmarkDual(smarkFile, rd)).js;

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

      // Build dynamic route map from `dynamic` config option
      dynamicRouteMap.clear();
      if (options.dynamic) {
        const built = await buildDynamicRouteMap(options.dynamic, pagesDir, projectRoot);
        for (const [key, entry] of built) dynamicRouteMap.set(key, entry);
      }

      spinner.succeed(pc.green(`Found ${routes.length} static + ${dynamicRouteMap.size} dynamic pages`));

      const input: Record<string, string> = {};

      for (const route of routes) {
        const htmlPath = route.url === "/" ? "index.html" : route.url.slice(1) + ".html";
        input[route.url === "/" ? "index" : route.url.slice(1).replace(/\//g, "-")] = htmlPath;
      }
      for (const [htmlPath, dyn] of dynamicRouteMap.entries()) {
        const key = dyn.url === "/" ? "index" : dyn.url.slice(1).replace(/\//g, "-");
        input[key] = htmlPath;
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
      publicDir = path.resolve(config.publicDir ?? path.join(projectRoot, "public"));
      minify = config.build?.minify !== false;
      isBuild = config.command === "build";
      outDir = path.resolve(projectRoot, config.build?.outDir || "dist");
    },

    resolveId(id, importer) {
      // In dev, resolve relative imports from virtual runtime modules
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
        // Dynamic route runtime: keyed by expanded URL (e.g. posts/hello-world)
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
        // Dynamic route HTML
        const relHtml = (pathname.startsWith("/") ? pathname.slice(1) : pathname);
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

        // Static route
        const smarkFile = resolveSmarkFile(pathname, pagesDir);
        if (smarkFile) {
          try {
            let html = await getTranspiledHtml(smarkFile);
            const css = await getTranspiledCss(smarkFile);
            if (css) {
              if (isBuild) {
                const hash = crypto.createHash("md5").update(css).digest("hex").slice(0, 8);
                const assetPath = `assets/smark-page-${hash}.css`;
                this.emitFile({ type: "asset", fileName: assetPath, source: css });
                html = html.replace("</head>", `  <link rel="stylesheet" href="/${assetPath}">\n</head>`);
              } else {
                html = html.replace("</head>", `  <style>${css}</style>\n</head>`);
              }
            }
            return html;
          } catch (err: any) {
            this.error(`[SomMark] ${err.message ?? err}`);
          }
        }

        // Dynamic route
        const dyn = dynamicRouteMap.get(relHtml);
        if (dyn) {
          try {
            // Pass 1: compile without headings to extract them
            if (!dyn.headings) {
              const firstHtml = await getTranspiledHtml(dyn.layoutFile, { slug: dyn.slug, url: dyn.url, props: dyn.props });
              dyn.headings = extractHeadings(firstHtml);
            }
            // Pass 2: compile with headings — separate cache key (:h suffix)
            const rd: RouteData = { slug: dyn.slug, url: dyn.url, props: dyn.props, headings: dyn.headings };
            let html = await getTranspiledHtml(dyn.layoutFile, rd);
            const css = await getTranspiledCss(dyn.layoutFile, rd);
            if (css) {
              if (isBuild) {
                const hash = crypto.createHash("md5").update(css).digest("hex").slice(0, 8);
                const assetPath = `assets/smark-page-${hash}.css`;
                this.emitFile({ type: "asset", fileName: assetPath, source: css });
                html = html.replace("</head>", `  <link rel="stylesheet" href="/${assetPath}">\n</head>`);
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

      // Static page JS
      for (const route of routes) {
        let clientJs = await getTranspiledJs(route.filePath);
        if (clientJs && clientJs.trim()) {
          const relPath = path.relative(projectRoot, route.filePath).replace(/\\/g, "/");
          clientJs = await bundleJs(clientJs, path.dirname(route.filePath));
          this.emitFile({ type: "asset", fileName: `sommark-runtime/${relPath}.js`, source: clientJs });
        }
      }

      // Dynamic page JS
      for (const [, dyn] of dynamicRouteMap.entries()) {
        let clientJs = await getTranspiledJs(dyn.layoutFile, { slug: dyn.slug, url: dyn.url, props: dyn.props });
        if (clientJs && clientJs.trim()) {
          clientJs = await bundleJs(clientJs, path.dirname(dyn.layoutFile));
          this.emitFile({ type: "asset", fileName: `sommark-runtime/${dyn.url.slice(1)}.js`, source: clientJs });
        }
      }

      // Generate Sitemap & Robots.txt
      const siteUrl = options.siteUrl || smarkConfig?.siteUrl;
      const sitemap = options.sitemap !== undefined ? options.sitemap : (smarkConfig?.sitemap !== false);
      const robots = options.robots !== undefined ? options.robots : (smarkConfig?.robots !== false);

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

      // Generate RSS feed
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
        const dynEntry = !smarkFile ? matchDynamicRequest(pathname, dynamicRouteMap) : null;
        if (dynEntry && !dynEntry.headings) {
          const firstHtml = await getTranspiledHtml(dynEntry.layoutFile, { slug: dynEntry.slug, url: dynEntry.url, props: dynEntry.props });
          dynEntry.headings = extractHeadings(firstHtml);
        }
        const dynRd: RouteData | undefined = dynEntry
          ? { slug: dynEntry.slug, url: dynEntry.url, props: dynEntry.props, headings: dynEntry.headings }
          : undefined;

        if (smarkFile || dynEntry) {
          const label = dynEntry ? "Serving (dynamic):" : "Serving:";
          console.log(`${pc.cyan("[SomMark]")} ${pc.dim(label)} ${pc.white(pathname)}`);
          const activeFile = smarkFile || dynEntry!.layoutFile;
          const rd: RouteData | undefined = dynRd;
          try {
            let html = await getTranspiledHtml(activeFile, rd);
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
          // File exists in public/ — let Vite's static middleware serve it as-is
          next();
          return;
        } else if (pathname.endsWith(".smark") || (pathname !== "/" && !pathname.includes(".") && !pathname.startsWith("/@vite/"))) {
          // Serve custom 404.smark if it exists
          const notFoundPage = path.join(pagesDir, "404.smark");
          if (existsSync(notFoundPage)) {
            console.log(`${pc.cyan("[SomMark]")} ${pc.dim("404:")} ${pc.white(pathname)}`);
            try {
              let html = await getTranspiledHtml(notFoundPage);
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
        let smarkFile = resolveSmarkFile(ctx.path, pagesDir);
        let rd: RouteData | undefined;

        if (!smarkFile) {
          // Check dynamic route map (populated at build time)
          const relHtml = ctx.path.startsWith("/") ? ctx.path.slice(1) : ctx.path;
          const adjHtml = relHtml.replace(/\.html$/, "") + ".html";
          const dyn = dynamicRouteMap.get(adjHtml);
          if (dyn) { smarkFile = dyn.layoutFile; rd = { slug: dyn.slug, url: dyn.url, props: dyn.props }; }
        }

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
          const clientJs = await getTranspiledJs(smarkFile, rd);
          if (clientJs && clientJs.trim()) {
            let virtualUrl: string;
            if (rd?.slug) {
              virtualUrl = `/sommark-runtime/${rd.url!.slice(1)}.js`;
            } else {
              const relPath = path.relative(projectRoot, smarkFile).replace(/\\/g, "/");
              virtualUrl = `/sommark-runtime/${relPath}.js`;
            }
            return {
              html,
              tags: [{ tag: "script", attrs: { type: "module", src: virtualUrl }, injectTo: "body" }]
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
        globCache.clear();
        dynamicRouteMap.clear();
        server.ws.send({ type: "full-reload" });
      } else if (file.endsWith(".smark")) {
        // Clear all cache entries for this file (all param variants share the same smarkFile prefix)
        for (const key of dualCache.keys()) {
          if (key === file || key.startsWith(file + ":")) dualCache.delete(key);
        }
        globCache.clear();
        for (const mod of server.moduleGraph.idToModuleMap.values()) {
          if (mod.id && (mod.id.startsWith("\0sommark-runtime:") || mod.id.startsWith("\0sommark-dynamic-runtime:"))) {
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

// ── Dynamic routing utilities moved to src/dynamic.ts ─────────────────────────

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
      const relativePath = path.relative(baseDir, fullPath).replace(/\\/g, "/");
      if (isLayoutFile(fullPath)) continue; // reserved layout templates, not standalone pages
      let url = "/" + relativePath.replace(/\.smark$/, "");
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
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>404 — Page Not Found</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg: #0a0a0f;
      --surface: #111118;
      --border: #1e1e2e;
      --text: #94a3b8;
      --muted: #334155;
      --accent: #6366f1;
      --accent-glow: rgba(99,102,241,0.15);
    }
    body {
      background: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 2rem;
    }
    .wrap {
      text-align: center;
      max-width: 420px;
    }
    .code {
      font-size: clamp(6rem, 20vw, 9rem);
      font-weight: 900;
      line-height: 1;
      letter-spacing: -4px;
      background: linear-gradient(135deg, #6366f1 0%, #a78bfa 50%, #38bdf8 100%);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      margin-bottom: 1.5rem;
    }
    .label {
      font-size: 1.1rem;
      font-weight: 600;
      color: #cbd5e1;
      margin-bottom: 0.5rem;
      letter-spacing: 0.02em;
    }
    .desc {
      font-size: 0.9rem;
      color: var(--muted);
      margin-bottom: 2.5rem;
      line-height: 1.6;
    }
    .btn {
      display: inline-flex;
      align-items: center;
      gap: 0.4rem;
      background: var(--accent);
      color: #fff;
      text-decoration: none;
      padding: 0.65rem 1.5rem;
      border-radius: 8px;
      font-size: 0.9rem;
      font-weight: 600;
      transition: opacity 0.15s, transform 0.15s;
      box-shadow: 0 0 24px var(--accent-glow);
    }
    .btn:hover { opacity: 0.85; transform: translateY(-1px); }
    .btn:active { transform: translateY(0); }
    .divider {
      width: 40px;
      height: 2px;
      background: var(--border);
      margin: 2rem auto;
      border-radius: 2px;
    }
    .hint {
      font-size: 0.78rem;
      color: var(--muted);
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="code">404</div>
    <div class="label">Page not found</div>
    <p class="desc">The page you're looking for doesn't exist or has been moved.</p>
    <a class="btn" href="/">&#8592; Go home</a>
    <div class="divider"></div>
    <p class="hint">If you typed the URL manually, double-check for typos.</p>
  </div>
</body>
</html>
`;
