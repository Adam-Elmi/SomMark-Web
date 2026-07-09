// @ts-nocheck
// Runs inside QuickJS — fileHandler and Smark are evaluator globals, not Node imports.
export default async function getHeadings(filePath) {
  const SM = Smark;
  const src = await fileHandler.read(filePath);
  const nodes = SM.parser(src);
  const headingIds = { h1: 1, h2: 2, h3: 3, h4: 4, h5: 5, h6: 6 };
  function getText(body) {
    if (!Array.isArray(body)) return "";
    return body.map((n) => {
      if (n.type === "Text") return n.text || "";
      if (n.body) return getText(n.body);
      return "";
    }).join("");
  }
  function slugify(text) {
    return text.toLowerCase().trim().replace(/\s+/g, "-").replace(/[^\w-]/g, "");
  }
  const headings = [];
  function walk(nodeList) {
    if (!Array.isArray(nodeList)) return;
    for (const node of nodeList) {
      const level = headingIds[node.id];
      if (level) {
        const text = getText(node.body).trim();
        if (text) headings.push({ level, text, id: slugify(text) });
      }
      if (node.body) walk(node.body);
    }
  }
  walk(nodes);
  return headings;
}
