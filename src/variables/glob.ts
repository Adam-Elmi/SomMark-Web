// @ts-nocheck
// Runs inside QuickJS. All references (fileHandler, getMetadata, getHeadings,
// __pagesDir, pathHandler) are evaluator/variable globals — not Node imports.
export default async function glob(pattern) {
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
