// @ts-nocheck
export function buildErrorHtml(err: any, pathname: string, src: string = ""): string {
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

export const default404Html = `<!DOCTYPE html>
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
    .wrap { text-align: center; max-width: 420px; }
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
    .label { font-size: 1.1rem; font-weight: 600; color: #cbd5e1; margin-bottom: 0.5rem; letter-spacing: 0.02em; }
    .desc { font-size: 0.9rem; color: var(--muted); margin-bottom: 2.5rem; line-height: 1.6; }
    .btn {
      display: inline-flex; align-items: center; gap: 0.4rem;
      background: var(--accent); color: #fff; text-decoration: none;
      padding: 0.65rem 1.5rem; border-radius: 8px;
      font-size: 0.9rem; font-weight: 600;
      transition: opacity 0.15s, transform 0.15s;
      box-shadow: 0 0 24px var(--accent-glow);
    }
    .btn:hover { opacity: 0.85; transform: translateY(-1px); }
    .btn:active { transform: translateY(0); }
    .divider { width: 40px; height: 2px; background: var(--border); margin: 2rem auto; border-radius: 2px; }
    .hint { font-size: 0.78rem; color: var(--muted); }
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
