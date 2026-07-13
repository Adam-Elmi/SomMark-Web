// @ts-nocheck
import SomMark, { HTML, findAndLoadConfig, parseSync, transpileProps } from "sommark";
import { getMetadata, getHeadings, glob as smarkGlob } from "./variables/index.js";
import { isLayoutFile } from "./dynamic.js";
import path from "node:path";
import { readFile, stat } from "node:fs/promises";
import fs from "node:fs";
import type { SomMarkPluginOptions, RouteData } from "./types.js";
import type { DynamicRouteEntry } from "./dynamic.js";

export interface CompilerContext {
  options: SomMarkPluginOptions;
  smarkConfig: any;
  isBuild: boolean;
  projectRoot: string;
  pagesDir: string;
  dualCache: Map<string, { html: string; css: string; js: string }>;
  globCache: Map<string, any>;
  dataCache: Map<string, any[]>;
  dynamicRouteMap: Map<string, DynamicRouteEntry>;
  compileQueue: Promise<void>;
}

export function createCompiler(ctx: CompilerContext) {
  const headingIds: Record<string, number> = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };

  function getNodeText(body: any): string {
    if (!Array.isArray(body)) return "";
    return body.map((n: any) => (n.type === "Text" ? (n.text || "") : n.body ? getNodeText(n.body) : "")).join("");
  }

  function slugifyText(text: string): string {
    return text.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
  }

  const processGlobResult = async (pattern: string): Promise<any[]> => {
    const pagesDirRel = path.relative(ctx.projectRoot, ctx.pagesDir).replace(/\\/g, "/") + "/";
    const results: any[] = [];
    // @ts-ignore — fs.promises.glob requires Node.js 22+
    for await (const relPath of fs.promises.glob(pattern, { cwd: ctx.projectRoot })) {
      const filePath = relPath.replace(/\\/g, "/");
      const absPath = path.join(ctx.projectRoot, filePath);
      if (isLayoutFile(absPath)) continue;
      const src = await readFile(absPath, "utf-8");
      const nodes = parseSync(src);
      const fileStat = await stat(absPath);
      const lastUpdate = new Date(fileStat.mtimeMs).toISOString();
      const metaNode = nodes.find((n: any) => n.type === "Block" && (n.id === "Metadata" || n.id === "metadata"));
      const metadata: Record<string, any> = metaNode ? await transpileProps(metaNode.props) : {};
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
    if (ctx.globCache.has(pattern)) return ctx.globCache.get(pattern);
    const result = await processGlobResult(pattern);
    ctx.globCache.set(pattern, result);
    return result;
  };

  const fetchAllData = async (): Promise<Record<string, any[]>> => {
    const allData: Record<string, any[]> = {};
    for (const [folder, fn] of Object.entries(ctx.options.dynamic ?? {})) {
      if (ctx.isBuild && ctx.dataCache.has(folder)) {
        allData[folder] = ctx.dataCache.get(folder)!;
      } else {
        const items = await fn();
        if (ctx.isBuild) ctx.dataCache.set(folder, items);
        allData[folder] = items;
      }
    }
    return allData;
  };

  const fetchAllPages = async (): Promise<any[]> => {
    const pagesDirRel = path.relative(ctx.projectRoot, ctx.pagesDir).replace(/\\/g, "/");
    const staticPages = await hostGlob(`${pagesDirRel}/**/*.smark`);
    const dynamicPages = [...ctx.dynamicRouteMap.values()].map(d => ({
      url: d.url,
      filePath: path.relative(ctx.projectRoot, d.layoutFile).replace(/\\/g, "/"),
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

  const buildMapper = (_smarkFile: string) => {
    const baseMapper = ctx.options.mapperFile || ctx.smarkConfig.mapperFile || HTML;
    const mapper = baseMapper.clone();
    mapper.register(["Metadata", "metadata"], function () { return ""; }, { rules: { is_self_closing: true } });
    return mapper;
  };

  const compileSmarkDual = (smarkFile: string, routeData?: RouteData): Promise<{ html: string; css: string; js: string }> => {
    const slug     = routeData?.slug     ?? "";
    const props    = routeData?.props    ?? {};
    const headings = routeData?.headings;
    const cacheKey = slug
      ? `${smarkFile}:${slug}${headings ? ":h" : ""}`
      : smarkFile;

    if (ctx.dualCache.has(cacheKey)) return Promise.resolve(ctx.dualCache.get(cacheKey)!);

    const task = ctx.compileQueue.then(async () => {
      if (ctx.dualCache.has(cacheKey)) return ctx.dualCache.get(cacheKey)!;
      if (!ctx.smarkConfig) ctx.smarkConfig = await findAndLoadConfig(ctx.projectRoot);

      const entryContent = await readFile(smarkFile, "utf-8");
      const placeholders = {
        ...ctx.smarkConfig.placeholders,
        ...ctx.options.placeholders,
        pagePath: smarkFile,
        page: smarkFile,
      };

      const pagesDirRel = path.relative(ctx.projectRoot, ctx.pagesDir).replace(/\\/g, "/");
      const currentFile = path.relative(ctx.projectRoot, smarkFile).replace(/\\/g, "/");
      let currentUrl: string;
      if (routeData?.url) {
        currentUrl = routeData.url;
      } else {
        const currentUrlRel = path.relative(ctx.pagesDir, smarkFile).replace(/\\/g, "/");
        currentUrl = "/" + currentUrlRel.replace(/\.smark$/, "");
        if (currentUrl.endsWith("/index")) currentUrl = currentUrl.slice(0, -6) || "/";
      }

      const smarkData = await fetchAllData();
      const smarkPages = await fetchAllPages();

      const [html, css, js] = await new SomMark({
        src: entryContent,
        format: "html",
        filename: smarkFile,
        placeholders,
        mapperFile: buildMapper(smarkFile),
        customProps: ctx.options.customProps || ctx.smarkConfig.customProps || ["content"],
        fallbackTarget: ctx.options.fallbackTarget !== undefined ? ctx.options.fallbackTarget : ctx.smarkConfig.fallbackTarget,
        outputValidator: ctx.options.outputValidator !== undefined ? ctx.options.outputValidator : ctx.smarkConfig.outputValidator,
        importAliases: { ...ctx.smarkConfig.importAliases, ...ctx.options.importAliases },
        security: { ...ctx.smarkConfig.security, ...ctx.options.security },
        showSpinner: ctx.options.showSpinner !== undefined ? ctx.options.showSpinner : ctx.smarkConfig.showSpinner,
        removeComments: ctx.options.removeComments !== undefined ? ctx.options.removeComments : ctx.smarkConfig.removeComments,
        webOutputs: true,
        variables: {
          __pagesDir: pagesDirRel,
          __currentFile: currentFile,
          __currentUrl: currentUrl,
          __props: props,
          __slug: slug,
          __headings: headings ?? [],
          __siteUrl: ctx.options.siteUrl || ctx.smarkConfig.siteUrl || "",
          __isDev: !ctx.isBuild,
          ...ctx.smarkConfig.variables,
          ...ctx.options.variables,
          glob: smarkGlob,
          getMetadata,
          getHeadings,
          __smarkData: smarkData,
          __smarkPages: smarkPages,
          // SomMark stringifies bridge functions and runs them inside QuickJS.
          // These bodies must reference __smarkData/__smarkPages by their QuickJS
          // variable names — not the local Node.js closure variables (which get
          // minified and are unknown inside QuickJS).
          getData: (folder: string) => (__smarkData[folder] || []),
          getPages: () => __smarkPages,
        },
      }).transpile() as unknown as [string, string, string];

      ctx.dualCache.set(cacheKey, { html, css, js });
      return { html, css, js };
    });

    // Always keep compileQueue resolved so a failed compilation doesn't permanently
    // block future compilations (a rejected promise swallows all chained .then callbacks).
    ctx.compileQueue = task.catch(() => {});
    return task;
  };

  const getTranspiledHtml = async (smarkFile: string, rd?: RouteData) => (await compileSmarkDual(smarkFile, rd)).html;
  const getTranspiledCss  = async (smarkFile: string, rd?: RouteData) => (await compileSmarkDual(smarkFile, rd)).css;
  const getTranspiledJs   = async (smarkFile: string, rd?: RouteData) => (await compileSmarkDual(smarkFile, rd)).js;

  return { compileSmarkDual, getTranspiledHtml, getTranspiledCss, getTranspiledJs, buildMapper, fetchAllData, fetchAllPages };
}
