import { describe, it, expect } from "vitest";
import path from "node:path";
import { resolveSmarkFile, scanPages, resolveAssetPath } from "../src/index";

describe("SomMark Vite Plugin Helpers", () => {
  const fixturesDir = path.resolve(__dirname, "fixtures");
  const pagesDir = path.join(fixturesDir, "pages");
  const projectRoot = fixturesDir;

  describe("resolveSmarkFile", () => {
    it("should resolve the root path to index.smark", () => {
      const result = resolveSmarkFile("/", pagesDir);
      expect(result).toContain("pages/index.smark");
    });

    it("should resolve /about to about.smark", () => {
      const result = resolveSmarkFile("/about", pagesDir);
      expect(result).toContain("pages/about.smark");
    });

    it("should resolve nested paths like /blog/date/may/today", () => {
      const result = resolveSmarkFile("/blog/date/may/today", pagesDir);
      expect(result).toContain("pages/blog/date/may/today.smark");
    });

    it("should return null for non-existent pages", () => {
      const result = resolveSmarkFile("/ghost-page", pagesDir);
      expect(result).toBeNull();
    });
  });

  describe("resolveAssetPath", async () => {
    it("should find assets in the project root", async () => {
      const result = await resolveAssetPath("/m.js", pagesDir, projectRoot);
      expect(result).toContain("m.js");
    });

    it("should find assets in the src directory", async () => {
      const result = await resolveAssetPath("/log.js", pagesDir, projectRoot);
      expect(result).toContain("fixtures/src/log.js");
    });

    it("should find assets relative to the current file", async () => {
      // Assuming we are in fixtures/pages/
      const result = await resolveAssetPath("../src/style.css", pagesDir, projectRoot);
      expect(result).toContain("fixtures/src/style.css");
    });
  });

  describe("scanPages", async () => {
    it("should find all .smark files in the pages directory", async () => {
      const routes = await scanPages(pagesDir);
      const urls = routes.map(r => r.url);
      
      expect(urls).toContain("/");
      expect(urls).toContain("/about");
      expect(urls).toContain("/blog/date/may/today");
      expect(routes.length).toBeGreaterThanOrEqual(3);
    });
  });
});
