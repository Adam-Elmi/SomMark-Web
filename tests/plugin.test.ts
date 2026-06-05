import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import { resolveSmarkFile, auditSEO } from "../src/index";
import fs from "node:fs/promises";
import path from "node:path";

describe("SomMark Web Plugin Unit Tests", () => {
  const testDir = path.resolve(__dirname, "temp-test-pages");

  beforeAll(async () => {
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(path.join(testDir, "index.smark"), "root page");
    await fs.writeFile(path.join(testDir, "about.smark"), "about page");
    await fs.mkdir(path.join(testDir, "posts"), { recursive: true });
    await fs.writeFile(path.join(testDir, "posts", "hello.smark"), "nested page");
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
