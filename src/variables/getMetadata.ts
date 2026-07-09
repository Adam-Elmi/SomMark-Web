// @ts-nocheck
// Runs inside QuickJS — fileHandler and Smark are evaluator globals, not Node imports.
export default async function getMetadata(filePath) {
  const SM = Smark;
  const src = await fileHandler.read(filePath);
  const nodes = SM.parser(src);
  const metadata = nodes.find((n) => n.type === "Block" && (n.id === "Metadata" || n.id === "metadata"));
  const meta = {};
  if (metadata && metadata.props) {
    for (const key of Object.keys(metadata.props)) {
      if (!isNaN(Number(key))) continue;
      let val = metadata.props[key];
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
      meta[key] = val;
    }
  }
  return meta;
}
