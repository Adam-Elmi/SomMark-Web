// @ts-nocheck
import { Plugin, ViteDevServer } from "vite";
import SomMark, { HTML, transpile } from "sommark";
import path from "node:path";
import { readdir, readFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import ora from "ora";
import pc from "picocolors";

/**
 * Options for the SomMark Web Vite plugin.
 */
export interface SomMarkPluginOptions {
  /** The directory containing your .smark pages. Defaults to "src/pages" */
  pagesDir?: string;
  /** The path to your layout shell template. Defaults to "index.smark" */
  shellPath?: string;
}

/**
 * A Vite plugin that provides high-performance Static Site Generation 
 * powered by the SomMark engine.
 */
export default function sommarkPlugin(options: SomMarkPluginOptions = {}): Plugin {
  const pagesDir = path.resolve(options.pagesDir || "src/pages");
  const shellPath = path.resolve(options.shellPath || "index.smark");
  let projectRoot = process.cwd();

  const printLogo = () => {
    console.log(pc.cyan(`\n  SomMark Web`));
    console.log(pc.dim(`  v1.0.0 • Vite Plugin\n`));
  };

  const getTranspiledHtml = async (smarkFile: string) => {
    const shellContent = await readFile(shellPath, "utf-8");
    const mapper = HTML.clone();
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

    return await transpile({
      src: shellContent,
      format: "html",
      filename: shellPath,
      mapperFile: mapper,
      placeholders: {
        pagePath: smarkFile,
        page: smarkFile
      },
      customProps: ["content"]
    });
  };

  return {
    name: "sommark-web",
    enforce: "pre",

    async config(config, { command }) {
      if (command === "build") printLogo();

      const spinner = ora(pc.dim("Scanning SomMark pages...")).start();
      const routes = await scanPages(pagesDir);
      spinner.succeed(pc.green(`Found ${routes.length} pages`));

      const input: Record<string, string> = {};

      for (const route of routes) {
        const htmlPath = route.url === "/" ? "index.html" : route.url.slice(1) + ".html";
        input[route.url === "/" ? "index" : route.url.slice(1).replace(/\//g, "-")] = htmlPath;
      }

      return {
        build: {
          rollupOptions: {
            input
          }
        }
      };
    },

    configResolved(config) {
      projectRoot = config.root;
    },

    resolveId(id) {
      const cleanId = id.split("?")[0];
      if (cleanId.endsWith(".html")) {
        const pathname = cleanId.startsWith("/") ? cleanId : "/" + cleanId;
        const smarkFile = resolveSmarkFile(pathname, pagesDir);
        if (smarkFile) {
          return path.join(process.cwd(), cleanId);
        }
      }
      return null;
    },

    async load(id) {
      if (id.endsWith(".html")) {
        const pathname = "/" + path.relative(process.cwd(), id);
        const smarkFile = resolveSmarkFile(pathname, pagesDir);
        if (smarkFile) {
          return await getTranspiledHtml(smarkFile);
        }
      }
      return null;
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
          // If it looks like a page request but wasn't found
          console.warn(`${pc.yellow("[SomMark Warning]")} Page not found: ${pc.dim(pathname)}`);
        }
        next();
      });
    },

    handleHotUpdate({ file, server }) {
      if (file.endsWith(".smark") || file === shellPath) {
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
