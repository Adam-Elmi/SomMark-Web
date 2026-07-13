import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { resolveSmarkFile, scanPages } from "../src/pages";
import { auditSEO } from "../src/seo";
import { getMetadata, getHeadings, glob } from "../src/variables/index";
import fs from "node:fs/promises";
import path from "node:path";

describe("SomMark Web Plugin Unit Tests", () => {
  const testDir = path.resolve(__dirname, "temp-test-pages");

  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(path.join(testDir, "index.smark"), "root page");
    await fs.writeFile(path.join(testDir, "about.smark"), "about page");
    await fs.mkdir(path.join(testDir, "posts"), { recursive: true });
    await fs.writeFile(path.join(testDir, "posts", "index.smark"), "posts index");
    await fs.writeFile(path.join(testDir, "posts", "hello.smark"), "nested page");
    await fs.mkdir(path.join(testDir, "posts", "archive"), { recursive: true });
    await fs.writeFile(path.join(testDir, "posts", "archive", "_layout.smark"), "layout");
  });

  afterAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe("resolveSmarkFile", () => {
    it("should resolve the root path to index.smark", () => {
      const result = resolveSmarkFile("/", testDir);
      expect(result).not.toBeNull();
      expect(result!).toContain("index.smark");
    });

    it("should resolve /about to about.smark", () => {
      const result = resolveSmarkFile("/about", testDir);
      expect(result).not.toBeNull();
      expect(result!).toContain("about.smark");
    });

    it("should resolve nested paths like /posts/hello", () => {
      const result = resolveSmarkFile("/posts/hello", testDir);
      expect(result).not.toBeNull();
      expect(result!).toContain("posts/hello.smark");
    });

    it("should return null for non-existent paths", () => {
      const result = resolveSmarkFile("/non-existent-path-abc", testDir);
      expect(result).toBeNull();
    });
  });

  describe("scanPages", () => {
    it("should find all .smark files and return URL + filePath", async () => {
      const results = await scanPages(testDir);
      const urls = results.map((r) => r.url).sort();
      expect(urls).toContain("/");
      expect(urls).toContain("/about");
      expect(urls).toContain("/posts/hello");
    });

    it("nested index.smark should produce clean URL without trailing slash", async () => {
      const results = await scanPages(testDir);
      const urls = results.map((r) => r.url);
      // posts/index.smark → /posts, not /posts/ or /posts/index
      expect(urls).toContain("/posts");
      expect(urls).not.toContain("/posts/");
      expect(urls).not.toContain("/posts/index");
    });

    it("should exclude _layout.smark files", async () => {
      const results = await scanPages(testDir);
      const hasLayout = results.some((r) => r.filePath.includes("_layout.smark"));
      expect(hasLayout).toBe(false);
    });

    it("should return empty array for non-existent directory", async () => {
      const results = await scanPages("/non-existent-dir-xyz-abc");
      expect(results.length).toBe(0);
    });

    it("each result should have url and filePath", async () => {
      const results = await scanPages(testDir);
      for (const r of results) {
        expect(typeof r.url).toBe("string");
        expect(r.url.startsWith("/")).toBe(true);
        expect(typeof r.filePath).toBe("string");
        expect(r.filePath.endsWith(".smark")).toBe(true);
      }
    });
  });

  describe("variables exports", () => {
    it("getMetadata is exported as a function", () => {
      expect(typeof getMetadata).toBe("function");
    });

    it("getHeadings is exported as a function", () => {
      expect(typeof getHeadings).toBe("function");
    });

    it("glob is exported as a function", () => {
      expect(typeof glob).toBe("function");
    });

    it("getMetadata is an async function (returns a promise when called without QuickJS globals)", () => {
      // These functions run inside QuickJS — calling them in Node fails with ReferenceError.
      // We verify the function shape: async (declared as async function) means its toString
      // includes "async function" and its prototype is AsyncFunction.
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
      expect(getMetadata).toBeInstanceOf(AsyncFunction);
      expect(getHeadings).toBeInstanceOf(AsyncFunction);
      expect(glob).toBeInstanceOf(AsyncFunction);
    });
  });

  describe("auditSEO", () => {
    it("should flag missing title, description, and canonical link", () => {
      const html = "<html><body><h1>Hello</h1></body></html>";
      const warnings = auditSEO(html);

      expect(warnings).toContain("Missing <title> tag");
      expect(warnings).toContain("Missing <meta name=\"description\"> tag");
      expect(warnings).toContain("Missing <link rel=\"canonical\"> tag");
    });

    it("should flag empty title and description", () => {
      const html = `
        <html>
          <head>
            <title>   </title>
            <meta name="description" content="   " />
            <link rel="canonical" href="https://example.com" />
          </head>
          <body></body>
        </html>
      `;
      const warnings = auditSEO(html);

      expect(warnings).toContain("<title> tag is empty");
      expect(warnings).toContain("<meta name=\"description\"> content is empty");
      expect(warnings).not.toContain("Missing <link rel=\"canonical\"> tag");
    });

    it("should flag images without alt attributes", () => {
      const html = `
        <html>
          <head>
            <title>My Title</title>
            <meta name="description" content="My description" />
            <link rel="canonical" href="https://example.com" />
          </head>
          <body>
            <img src="/logo.png" />
            <img class="avatar" />
          </body>
        </html>
      `;
      const warnings = auditSEO(html);

      expect(warnings).toContain('Image missing alt attribute: src="/logo.png"');
      expect(warnings).toContain('Image missing alt attribute: image #2');
    });

    it("should produce zero warnings for valid SEO content", () => {
      const html = `
        <!DOCTYPE html>
        <html>
          <head>
            <title>My Website</title>
            <meta name="description" content="Welcome to my website description." />
            <link rel="canonical" href="https://sommark.dev" />
          </head>
          <body>
            <img src="/logo.png" alt="SomMark Web Logo" />
          </body>
        </html>
      `;
      const warnings = auditSEO(html);
      expect(warnings.length).toBe(0);
    });
  });
});
