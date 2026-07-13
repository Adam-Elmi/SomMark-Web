// @ts-nocheck
// Runs inside QuickJS. All references (fileHandler, getMetadata, getHeadings,
// __pagesDir, __smarkGlobCache) are evaluator/variable globals — not Node imports.
// IMPORTANT: helpers must be defined INSIDE the exported function — module-level
// variables are stripped when SomMark stringifies the function body for QuickJS.

export default async function glob(pattern) {
  // Fast path: use pre-computed Node.js data — no file I/O in QuickJS.
  if (typeof __smarkGlobCache !== "undefined" && __smarkGlobCache) {
    const allEntries = JSON.parse(__smarkGlobCache);
    const starIdx = pattern.indexOf("*");
    const prefix = starIdx === -1 ? pattern : pattern.slice(0, pattern.lastIndexOf("/", starIdx) + 1);
    const suffix = starIdx === -1 ? "" : pattern.slice(pattern.lastIndexOf("*") + 1);
    return allEntries.filter(entry =>
      starIdx === -1
        ? entry.filePath === pattern
        : entry.filePath.startsWith(prefix) && entry.filePath.endsWith(suffix)
    );
  }

  // Fallback (no cache available): read and parse each file.
  const paths = await fileHandler.glob(pattern);
  const pagesPrefix = __pagesDir + "/";

  return Promise.all(paths.map(async (filePath) => {
    const [metadata, headings, stat] = await Promise.all([
      getMetadata(filePath),
      getHeadings(filePath),
      fileHandler.stat(filePath),
    ]);

    let url = filePath.replace(/\\/g, "/");
    if (url.startsWith(pagesPrefix)) url = url.slice(pagesPrefix.length);
    url = url.replace(/\.smark$/, "").replace(/\/index$/, "").replace(/^index$/, "");
    const slug = url || "index";
    url = "/" + url;

    const firstH1 = headings.find((h) => h.level === 1);
    const title = metadata.title || firstH1?.text || slug;
    const lastUpdate = stat ? new Date(stat.mtime).toISOString() : "";

    return { url, filePath, metadata, headings, title, lastUpdate };
  }));
}
