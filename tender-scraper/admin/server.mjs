// Qellal scraper — staff control panel.
//
// A tiny, dependency-free operator dashboard (Node built-in http only). Runs on
// the VPS bound to 127.0.0.1; reach it via an SSH tunnel:
//   ssh -L 3838:localhost:3838 root@qelal.et   → http://localhost:3838
//
// Shows tender/Meili counts + insights (by sector, by company), tails unit
// logs, and triggers the scraper / Meili re-index as transient systemd units.

import http from "node:http";
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const PORT = 3838;
const SCRAPER_DIR = "/opt/tender-scraper";
const GHOST_ENV = "/opt/ghost/.env";

function loadEnv(path) {
  const env = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
      if (m) env[m[1]] = m[2];
    }
  } catch { /* ignore */ }
  return env;
}
const senv = loadEnv(`${SCRAPER_DIR}/.env`);
const genv = loadEnv(GHOST_ENV);

// ── helpers ──────────────────────────────────────────────
async function mysql(sql) {
  const { stdout } = await run(
    "docker",
    ["exec", "-e", `MYSQL_PWD=${genv.MYSQL_ROOT_PASSWORD}`, "ghost-db", "mysql", "-uroot", "-N", "-B", "ghost", "-e", sql],
    { maxBuffer: 8 * 1024 * 1024 },
  );
  return stdout.trim();
}
function rows(out) {
  return out ? out.split("\n").map((l) => l.split("\t")) : [];
}
async function unitInfo(unit) {
  try {
    const { stdout } = await run("systemctl", ["show", unit, "-p", "ActiveState,SubState,ExecMainStartTimestamp,Result"]);
    const o = {};
    for (const l of stdout.trim().split("\n")) { const i = l.indexOf("="); o[l.slice(0, i)] = l.slice(i + 1); }
    return o;
  } catch { return {}; }
}
async function meiliDocs() {
  try {
    const r = await fetch(`${senv.MEILI_HOST}/indexes/${senv.MEILI_INDEX || "ghost_tenders"}/stats`, {
      headers: { Authorization: `Bearer ${senv.MEILI_MASTER_KEY}` },
    });
    const j = await r.json();
    return j.numberOfDocuments ?? "?";
  } catch { return "?"; }
}
function startUnit(name, cmd) {
  // Fire-and-forget transient unit; --collect cleans it up when done.
  return run("systemd-run", ["--unit", name, "--collect", "bash", "-lc", cmd]);
}

// Proxy one Meilisearch admin call using the master key. The key is kept
// server-side; the browser only ever calls the gated /api/meili endpoint, so it
// never sees the master key. MEILI_HOST is hardcoded from env, so the path can't
// be redirected to another host.
async function meiliProxy(method, path, body) {
  const r = await fetch(`${senv.MEILI_HOST}${path}`, {
    method,
    headers: { Authorization: `Bearer ${senv.MEILI_MASTER_KEY}`, "Content-Type": "application/json" },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const text = await r.text();
  let json;
  try { json = text ? JSON.parse(text) : {}; } catch { json = { raw: text }; }
  return { status: r.status, json };
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = "";
    req.on("data", (c) => { d += c; if (d.length > 5e6) { reject(new Error("body too large")); req.destroy(); } });
    req.on("end", () => resolve(d));
    req.on("error", reject);
  });
}

// ── API ──────────────────────────────────────────────────
async function apiStatus() {
  const [tenders, tags, entities, scrape, reindex, migrate, docs] = await Promise.all([
    mysql("select count(*) from posts where slug like 'tender-%';"),
    mysql("select count(*) from tags;"),
    mysql("select count(*) from tags where slug like 'entity-%';"),
    unitInfo("tender-scrape"),
    unitInfo("tender-reindex"),
    unitInfo("tender-migrate"),
    meiliDocs(),
  ]);
  return {
    tenders: Number(tenders) || 0,
    tags: Number(tags) || 0,
    entities: Number(entities) || 0,
    meiliDocs: docs,
    units: { scrape, reindex, migrate },
  };
}
async function apiInsights() {
  const [sector, company, timeline, openc] = await Promise.all([
    mysql(`select t.name, count(*) c from tags t join posts_tags pt on pt.tag_id=t.id
           where t.slug not like 'entity-%' and t.slug not in ('2merkato','english','amharic')
           group by t.id order by c desc limit 15;`),
    mysql(`select t.name, count(*) c from tags t join posts_tags pt on pt.tag_id=t.id
           where t.slug like 'entity-%' group by t.id order by c desc limit 15;`),
    mysql(`select date_format(published_at,'%Y-%m') m, count(*) c from posts
           where slug like 'tender-%' group by m order by m desc limit 12;`),
    mysql("select count(*) from posts where slug like 'tender-%';"),
  ]);
  return {
    bySector: rows(sector).map(([name, c]) => ({ name, count: Number(c) })),
    byCompany: rows(company).map(([name, c]) => ({ name, count: Number(c) })),
    timeline: rows(timeline).map(([m, c]) => ({ month: m, count: Number(c) })).reverse(),
    total: Number(openc) || 0,
  };
}
async function apiLogs(unit) {
  const safe = /^tender-(scrape|reindex|migrate)$/.test(unit) ? unit : "tender-scrape";
  try {
    const { stdout } = await run("journalctl", ["-u", safe, "--no-pager", "-n", "80", "-o", "cat"]);
    return stdout;
  } catch (e) { return String(e); }
}

// ── auth: reuse the Ghost admin login ────────────────────
// The panel is served under /ghost/scraper/, so the browser sends Ghost's
// `ghost-admin-api-session` cookie (path=/ghost). We validate it against Ghost's
// own API, so only signed-in Ghost staff can reach the panel — no separate login.
const sessCache = new Map(); // cookie -> { user, exp }
async function ghostUser(req) {
  const cookie = req.headers.cookie || "";
  if (!/ghost-admin-api-session=/.test(cookie)) return null;
  const hit = sessCache.get(cookie);
  if (hit && hit.exp > Date.now()) return hit.user;
  let user = null;
  try {
    const r = await fetch(`${senv.GHOST_ADMIN_API_URL}/ghost/api/admin/users/me/?fields=id,name,email`, {
      headers: { Cookie: cookie, "Accept-Version": "v5.0" },
    });
    if (r.ok) { const b = await r.json(); user = (b.users && b.users[0]) || null; }
  } catch { /* treat as unauthenticated */ }
  sessCache.set(cookie, { user, exp: Date.now() + (user ? 60000 : 10000) });
  return user;
}

// ── HTTP ─────────────────────────────────────────────────
function send(res, code, body, type = "application/json") {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(typeof body === "string" ? body : JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    // sidebar.js is injected into Ghost admin's index.html to add a nav link.
    // It's harmless (adds a link, no data), so it's served without the gate —
    // the link target /ghost/scraper/ is still session-gated below.
    if (url.pathname === "/sidebar.js") {
      // no-store so Cloudflare (which caches .js by extension) doesn't pin an
      // old copy — the injector must always reflect the deployed panel.
      res.writeHead(200, { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "no-store" });
      return res.end(SIDEBAR_JS);
    }
    // Gate everything else behind a valid Ghost admin session.
    const user = await ghostUser(req);
    if (!user) {
      if (url.pathname === "/") { res.writeHead(302, { Location: "/ghost/" }); return res.end(); }
      return send(res, 401, { error: "Sign in to Ghost admin first" });
    }
    if (url.pathname === "/") return send(res, 200, HTML, "text/html; charset=utf-8");
    if (url.pathname === "/api/status") return send(res, 200, await apiStatus());
    if (url.pathname === "/api/insights") return send(res, 200, await apiInsights());
    if (url.pathname === "/api/logs") return send(res, 200, await apiLogs(url.searchParams.get("unit") || "tender-scrape"), "text/plain");
    if (url.pathname === "/api/scrape" && req.method === "POST") {
      const pages = Number(url.searchParams.get("pages")) || 100;
      await startUnit("tender-scrape", `cd ${SCRAPER_DIR} && set -a; . ./.env; set +a; SINK=ghost node_modules/.bin/tsx src/main.ts 2merkato ${pages}`);
      return send(res, 200, { started: true, unit: "tender-scrape" });
    }
    if (url.pathname === "/api/reindex" && req.method === "POST") {
      await startUnit("tender-reindex", `cd ${SCRAPER_DIR} && set -a; . ./.env; set +a; node_modules/.bin/tsx src/meili-index.ts`);
      return send(res, 200, { started: true, unit: "tender-reindex" });
    }
    // Meilisearch admin: single-page app + a generic (staff-gated) master-key proxy.
    if (url.pathname === "/meili" || url.pathname === "/meili/") {
      return send(res, 200, MEILI_HTML, "text/html; charset=utf-8");
    }
    if (url.pathname === "/api/meili" && req.method === "POST") {
      const raw = await readBody(req);
      let p;
      try { p = JSON.parse(raw || "{}"); } catch { return send(res, 400, { error: "bad json" }); }
      const method = String(p.method || "GET").toUpperCase();
      const path = String(p.path || "");
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method)) return send(res, 400, { error: "bad method" });
      // Only relative Meili API paths; no host override, no traversal.
      if (!/^\/[\w/\-?=&.,%*]+$/.test(path) || path.includes("..")) return send(res, 400, { error: "bad path" });
      return send(res, 200, await meiliProxy(method, path, p.body));
    }
    send(res, 404, { error: "not found" });
  } catch (e) {
    send(res, 500, { error: String(e && e.message || e) });
  }
});
// Bind on all interfaces so Caddy (docker bridge, 172.19.0.1) can reach it;
// ufw keeps :3838 off the public internet, and Caddy fronts it with basic-auth.
server.listen(PORT, "0.0.0.0", () => console.log(`scraper-admin on 0.0.0.0:${PORT}`));

const HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Qellal · Scraper control</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
/* Ghost-admin look: Inter, white cards, neutral greys, dark primary button. */
:root{--bg:#fff;--card:#fff;--border:#e1e2e6;--border-soft:#eef0f2;--text:#15171a;--muted:#7c8b9a;--hover:#f7f8f9;--primary:#15171a;--on-primary:#fff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:1100px;margin:0 auto;padding:2rem 2.5rem}
h1{font-size:1.9rem;font-weight:700;letter-spacing:-.021em;margin:0 0 .2rem}
.sub{color:var(--muted);margin:0 0 1.75rem;font-size:.9rem}
.grid{display:grid;gap:1rem;grid-template-columns:repeat(4,1fr)}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:1.25rem 1.35rem;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.stat .v{font-size:2rem;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.stat .l{color:var(--muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;font-weight:600;margin-top:.3rem}
.row{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin:1.5rem 0}
button{font:inherit;font-weight:500;border:1px solid var(--border);background:#fff;color:var(--text);border-radius:5px;padding:.5rem .95rem;cursor:pointer;transition:background .15s,border-color .15s}
button:hover{background:var(--hover)}
button.primary{background:var(--primary);color:var(--on-primary);border-color:var(--primary)}
button.primary:hover{background:#000}
button:disabled{opacity:.5;cursor:wait}
select{font:inherit;border:1px solid var(--border);border-radius:5px;padding:.35rem .55rem;background:#fff;color:var(--text)}
.section{margin-top:1.5rem}
.section h2,.card h2{font-size:1rem;font-weight:600;margin:0 0 .9rem}
.two{display:grid;gap:1.25rem;grid-template-columns:1fr 1fr}
table{width:100%;border-collapse:collapse;font-size:.9rem}
td{padding:.5rem 0;border-bottom:1px solid var(--border-soft)}
tr:last-child td{border-bottom:0}
td.n{text-align:right;font-variant-numeric:tabular-nums;color:var(--muted);font-weight:500}
pre{background:#f7f8f9;color:#3a4249;border:1px solid var(--border);padding:1rem;border-radius:6px;overflow:auto;max-height:320px;font-size:.8rem;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace}
.pill{font-size:.7rem;padding:.15rem .5rem;border-radius:4px;background:var(--hover);color:var(--muted);border:1px solid var(--border)}
.pill.active,.pill.ok{background:#eafaed;color:#15a336;border-color:#c3ecc9}
@media(max-width:900px){.grid{grid-template-columns:repeat(2,1fr)}.two{grid-template-columns:1fr}.wrap{padding:1.5rem}}
</style></head><body><div class="wrap">
<h1>Qellal · Scraper control</h1>
<p class="sub">tenders.qelal.et · operator dashboard</p>
<div class="grid" id="stats"></div>
<div class="row">
  <button class="primary" id="scrapeBtn">▶ Run scrape (100 pages)</button>
  <button id="reindexBtn">⟳ Re-index Meilisearch</button>
  <button id="refreshBtn">↻ Refresh</button>
  <span id="msg" class="pill"></span>
</div>
<div class="section two">
  <div class="card"><h2>Tenders by sector</h2><table id="sector"></table></div>
  <div class="card"><h2>Top buyers (companies)</h2><table id="company"></table></div>
</div>
<div class="section card"><h2>Logs
  <select id="logUnit"><option>tender-scrape</option><option>tender-reindex</option><option>tender-migrate</option></select>
</h2><pre id="logs">—</pre></div>
</div>
<script>
const $=s=>document.querySelector(s);
function pill(u){if(!u||!u.ActiveState)return '<span class="pill">idle</span>';
 const s=u.ActiveState;const cls=s==='active'?'active':(u.Result==='success'?'ok':'');
 const t=u.ExecMainStartTimestamp?(' · '+u.ExecMainStartTimestamp.replace(/^[A-Za-z]{3} /,'')):'';
 return '<span class="pill '+cls+'">'+s+t+'</span>';}
async function status(){const s=await (await fetch('api/status')).json();
 $('#stats').innerHTML=[['tenders',s.tenders.toLocaleString()],['tags',s.tags.toLocaleString()],['companies',s.entities.toLocaleString()],['meili docs',s.meiliDocs.toLocaleString?s.meiliDocs.toLocaleString():s.meiliDocs]]
  .map(([l,v])=>'<div class="card stat"><div class="v">'+v+'</div><div class="l">'+l+'</div></div>').join('');
 window._u=s.units;}
async function insights(){const i=await (await fetch('api/insights')).json();
 const t=(rows)=>rows.map(r=>'<tr><td>'+r.name+'</td><td class="n">'+r.count.toLocaleString()+'</td></tr>').join('');
 $('#sector').innerHTML=t(i.bySector);$('#company').innerHTML=t(i.byCompany);}
async function logs(){$('#logs').textContent=await (await fetch('api/logs?unit='+$('#logUnit').value)).text();}
async function refresh(){await Promise.all([status(),insights(),logs()]);}
async function trigger(path,btn){btn.disabled=true;$('#msg').textContent='starting…';
 try{const r=await (await fetch(path,{method:'POST'})).json();$('#msg').textContent=r.started?('started '+r.unit):'error';}
 catch(e){$('#msg').textContent='error';} setTimeout(()=>{btn.disabled=false;refresh();},2500);}
$('#scrapeBtn').onclick=e=>trigger('api/scrape',e.target);
$('#reindexBtn').onclick=e=>trigger('api/reindex',e.target);
$('#refreshBtn').onclick=refresh;$('#logUnit').onchange=logs;
refresh();setInterval(status,8000);
</script></body></html>`;

// Meilisearch admin SPA — index/document/settings/task/key management + a live
// search preview. All Meili calls go through /api/meili (master key, server-side).
const MEILI_HTML = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Qellal · Meilisearch</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#fff;--card:#fff;--border:#e1e2e6;--border-soft:#eef0f2;--text:#15171a;--muted:#7c8b9a;--hover:#f7f8f9;--primary:#15171a;--on-primary:#fff}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5;-webkit-font-smoothing:antialiased}
.wrap{max-width:1100px;margin:0 auto;padding:2rem 2.5rem}
h1{font-size:1.9rem;font-weight:700;letter-spacing:-.021em;margin:0 0 .2rem}
.sub{color:var(--muted);margin:0 0 1.25rem;font-size:.9rem}
.muted{color:var(--muted)}
.tabs{display:flex;gap:.25rem;border-bottom:1px solid var(--border);margin-bottom:1.25rem;flex-wrap:wrap}
.tab{border:0;background:none;border-bottom:2px solid transparent;border-radius:0;padding:.55rem .8rem;color:var(--muted);font-weight:500;cursor:pointer}
.tab:hover{color:var(--text)}
.tab.active{color:var(--text);border-bottom-color:var(--primary);font-weight:600}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:1.25rem 1.35rem;box-shadow:0 1px 2px rgba(0,0,0,.03);margin-bottom:1rem}
.card h2{font-size:1rem;font-weight:600;margin:0 0 .9rem}
.row{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin:.4rem 0}
button{font:inherit;font-weight:500;border:1px solid var(--border);background:#fff;color:var(--text);border-radius:5px;padding:.5rem .95rem;cursor:pointer;transition:background .15s,border-color .15s}
button:hover{background:var(--hover)}
button.primary{background:var(--primary);color:var(--on-primary);border-color:var(--primary)}
button.primary:hover{background:#000}
button.danger{color:#d33;border-color:#f0c9c9}
button.danger:hover{background:#fdecec}
button:disabled{opacity:.5;cursor:wait}
input,select,textarea{font:inherit;border:1px solid var(--border);border-radius:5px;padding:.45rem .6rem;background:#fff;color:var(--text)}
input,textarea{width:100%}
textarea{font-family:ui-monospace,Menlo,monospace;font-size:.8rem;min-height:220px;resize:vertical;white-space:pre}
label{display:block;font-size:.72rem;text-transform:uppercase;letter-spacing:.04em;font-weight:600;color:var(--muted);margin:.6rem 0 .25rem}
.field{flex:1;min-width:150px}
table{width:100%;border-collapse:collapse;font-size:.88rem}
th{text-align:left;font-size:.7rem;text-transform:uppercase;letter-spacing:.04em;color:var(--muted);font-weight:600;padding:.4rem .5rem;border-bottom:1px solid var(--border)}
td{padding:.5rem;border-bottom:1px solid var(--border-soft);vertical-align:top}
td.n,th.n{text-align:right;font-variant-numeric:tabular-nums}
pre{background:#f7f8f9;color:#3a4249;border:1px solid var(--border);padding:.8rem;border-radius:6px;overflow:auto;max-height:340px;font-size:.78rem;white-space:pre-wrap;font-family:ui-monospace,Menlo,monospace}
.pill{font-size:.7rem;padding:.15rem .5rem;border-radius:4px;background:var(--hover);color:var(--muted);border:1px solid var(--border);display:inline-block}
.pill.active{background:#eef4ff;color:#2f6feb;border-color:#cfe0ff}
.pill.ok{background:#eafaed;color:#15a336;border-color:#c3ecc9}
.pill.err{background:#fdecec;color:#d33;border-color:#f5c2c2}
.idxbar{display:flex;gap:.6rem;align-items:center;margin-bottom:1rem}
.hit{border:1px solid var(--border-soft);border-radius:6px;padding:.6rem .75rem;margin-bottom:.6rem}
.hit-h{margin-bottom:.4rem}
.grid2{display:grid;gap:1rem;grid-template-columns:1fr 1fr}
code{font-family:ui-monospace,Menlo,monospace;font-size:.82em;background:var(--hover);padding:.05rem .3rem;border-radius:3px;cursor:pointer}
@media(max-width:900px){.wrap{padding:1.5rem}.grid2{grid-template-columns:1fr}}
</style></head><body><div class="wrap">
<h1>Qellal · Meilisearch</h1>
<p class="sub">index management · document ops · settings · tasks · API keys · live search</p>
<div class="tabs" id="tabs">
  <button class="tab active" data-tab="indexes">Indexes</button>
  <button class="tab" data-tab="search">Search preview</button>
  <button class="tab" data-tab="docs">Documents</button>
  <button class="tab" data-tab="settings">Settings</button>
  <button class="tab" data-tab="tasks">Tasks</button>
  <button class="tab" data-tab="keys">API keys</button>
</div>
<div class="idxbar" id="idxbar">
  <label style="margin:0">Index</label>
  <select id="idxSel"></select>
  <span class="muted" id="idxStat"></span>
  <span class="pill" id="msg" style="margin-left:auto"></span>
</div>
<section data-panel="indexes">
  <div class="card"><h2>Indexes</h2><table id="idxTable"></table></div>
  <div class="card"><h2>Create index</h2><div class="row">
    <div class="field"><label>UID</label><input id="ciUid" placeholder="my_index"></div>
    <div class="field"><label>Primary key (optional)</label><input id="ciPk" placeholder="id"></div>
    <button class="primary" id="ciBtn" style="align-self:flex-end">Create</button>
  </div></div>
</section>
<section data-panel="search" hidden>
  <div class="card">
    <div class="row">
      <input id="q" placeholder="Search…" style="flex:2">
      <input id="sLimit" type="number" value="20" style="width:80px" title="limit">
      <label style="margin:0;display:flex;gap:.3rem;align-items:center;text-transform:none;letter-spacing:0;font-weight:500;color:var(--text)"><input id="sScore" type="checkbox" checked style="width:auto"> ranking score</label>
    </div>
    <div class="row">
      <input id="sFilter" placeholder="filter e.g. region = &quot;Addis Ababa&quot;" style="flex:1">
      <input id="sSort" placeholder="sort e.g. published_at:desc" style="flex:1">
    </div>
    <p class="muted" id="sMeta"></p>
    <div id="sHits"></div>
  </div>
</section>
<section data-panel="docs" hidden>
  <div class="grid2">
    <div class="card"><h2>Browse documents</h2>
      <div class="row"><button id="dLoad">Load</button><input id="dOffset" type="number" value="0" style="width:90px" title="offset"><input id="dLimit" type="number" value="20" style="width:80px" title="limit"><span class="muted" id="dMeta"></span></div>
      <pre id="dOut">—</pre>
    </div>
    <div class="card"><h2>Add / update documents</h2>
      <p class="muted">Paste a JSON array of documents. Matching primary keys are updated.</p>
      <textarea id="dJson" placeholder="[ { &quot;id&quot;: 1, &quot;title&quot;: &quot;…&quot; } ]"></textarea>
      <div class="row"><button class="primary" id="dAdd">Submit</button></div>
      <h2 style="margin-top:1rem">Delete</h2>
      <div class="row"><input id="dDelId" placeholder="document id" style="flex:1"><button class="danger" id="dDelOne">Delete by id</button></div>
      <div class="row"><button class="danger" id="dDelAll">Delete ALL documents</button></div>
    </div>
  </div>
</section>
<section data-panel="settings" hidden>
  <div class="card"><h2>Index settings</h2>
    <p class="muted">Full settings JSON — searchable / filterable / sortable attributes, ranking rules, synonyms, stop words, typo tolerance. Edit and save.</p>
    <textarea id="setJson" style="min-height:420px"></textarea>
    <div class="row"><button id="setLoad">Reload</button><button class="primary" id="setSave">Save settings</button><button class="danger" id="setReset">Reset to defaults</button></div>
  </div>
</section>
<section data-panel="tasks" hidden>
  <div class="card"><h2>Tasks <button class="danger" id="tkCancel" style="float:right;margin-left:.4rem">Cancel pending</button><button id="tkRefresh" style="float:right">↻ Refresh</button></h2><table id="tkTable"></table></div>
</section>
<section data-panel="keys" hidden>
  <div class="card"><h2>API keys</h2><table id="kyTable"></table></div>
  <div class="card"><h2>Create key</h2>
    <div class="row">
      <div class="field"><label>Name</label><input id="kyName" placeholder="Search key"></div>
      <div class="field"><label>Description</label><input id="kyDesc" placeholder="Public search-only key"></div>
    </div>
    <div class="row">
      <div class="field"><label>Actions (comma, or *)</label><input id="kyActions" placeholder="search"></div>
      <div class="field"><label>Indexes (comma, or *)</label><input id="kyIndexes" placeholder="ghost_tenders"></div>
      <div class="field"><label>Expires at (optional)</label><input id="kyExp" type="datetime-local"></div>
      <button class="primary" id="kyBtn" style="align-self:flex-end">Create key</button>
    </div>
  </div>
</section>
<script>
(function(){
var $=function(s,r){return (r||document).querySelector(s)};
var $$=function(s,r){return Array.prototype.slice.call((r||document).querySelectorAll(s))};
var enc=encodeURIComponent;
var esc=function(s){return String(s==null?'':s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')};
var API='/ghost/scraper/api/meili';
var tab='indexes';
function flash(t,ok){var el=$('#msg');el.textContent=t||'';el.className='pill '+(ok===false?'err':(ok?'ok':''));}
function err(e){flash((e&&e.message)||String(e),false);}
function m(method,path,body){
  return fetch(API,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method:method,path:path,body:body===undefined?null:body})})
    .then(function(r){return r.json();})
    .then(function(j){if(!j||j.status===undefined){throw new Error('bad response');} if(j.status>=400){throw new Error((j.json&&(j.json.message||j.json.code))||('HTTP '+j.status));} return j.json;});
}
function idx(){return $('#idxSel').value;}
function setTab(t){
  tab=t;
  $$('.tab').forEach(function(b){b.classList.toggle('active',b.getAttribute('data-tab')===t);});
  $$('section[data-panel]').forEach(function(s){s.hidden=s.getAttribute('data-panel')!==t;});
  if(t==='indexes')loadIndexes();else if(t==='search')doSearch();else if(t==='docs')loadDocs();
  else if(t==='settings')loadSettings();else if(t==='tasks')loadTasks();else if(t==='keys')loadKeys();
}
$$('.tab').forEach(function(b){b.onclick=function(){setTab(b.getAttribute('data-tab'));};});
function fillSelector(list){
  var sel=$('#idxSel');var cur=sel.value;
  sel.innerHTML=list.map(function(x){return '<option>'+esc(x.uid)+'</option>';}).join('');
  if(cur&&list.some(function(x){return x.uid===cur}))sel.value=cur;
}
$('#idxSel').onchange=function(){updateIdxStat();if(tab==='search')doSearch();else if(tab==='docs')loadDocs();else if(tab==='settings')loadSettings();};
function updateIdxStat(){
  var u=idx();if(!u){$('#idxStat').textContent='';return;}
  m('GET','/indexes/'+enc(u)+'/stats').then(function(s){$('#idxStat').textContent=(s.numberOfDocuments!=null?s.numberOfDocuments.toLocaleString()+' docs':'')+(s.isIndexing?' · indexing':'');}).catch(function(){});
}
function loadIndexes(){
  return m('GET','/indexes?limit=200').then(function(r){
    var list=r.results||[];fillSelector(list);updateIdxStat();
    return Promise.all(list.map(function(x){return m('GET','/indexes/'+enc(x.uid)+'/stats').then(function(s){return{x:x,s:s};}).catch(function(){return{x:x,s:{}};});}));
  }).then(function(ps){
    $('#idxTable').innerHTML='<tr><th>UID</th><th>Primary key</th><th class="n">Documents</th><th>Status</th><th></th></tr>'+
      (ps.length?ps.map(function(p){return '<tr><td><b>'+esc(p.x.uid)+'</b></td><td>'+esc(p.x.primaryKey||'—')+'</td><td class="n">'+(p.s.numberOfDocuments!=null?p.s.numberOfDocuments.toLocaleString():'?')+'</td><td>'+(p.s.isIndexing?'<span class="pill active">indexing</span>':'<span class="pill">idle</span>')+'</td><td class="n"><button class="danger" data-delidx="'+esc(p.x.uid)+'">Delete</button></td></tr>';}).join(''):'<tr><td colspan="5" class="muted">No indexes.</td></tr>');
    $$('#idxTable [data-delidx]').forEach(function(b){b.onclick=function(){
      var u=b.getAttribute('data-delidx');if(!confirm('Delete index "'+u+'" and all its documents?'))return;
      m('DELETE','/indexes/'+enc(u)).then(function(){flash('delete queued',true);setTimeout(loadIndexes,700);}).catch(err);
    };});
  }).catch(err);
}
$('#ciBtn').onclick=function(){
  var uid=$('#ciUid').value.trim();if(!uid){flash('uid required',false);return;}
  var pk=$('#ciPk').value.trim();
  m('POST','/indexes',{uid:uid,primaryKey:pk||undefined}).then(function(){flash('create queued',true);$('#ciUid').value='';$('#ciPk').value='';setTimeout(loadIndexes,700);}).catch(err);
};
var sT;
function doSearch(){
  var u=idx();if(!u){$('#sHits').innerHTML='<p class="muted">No index selected.</p>';return;}
  var body={q:$('#q').value,limit:Number($('#sLimit').value)||20,showRankingScore:$('#sScore').checked};
  var f=$('#sFilter').value.trim();if(f)body.filter=f;
  var s=$('#sSort').value.trim();if(s)body.sort=s.split(',').map(function(x){return x.trim();});
  m('POST','/indexes/'+enc(u)+'/search',body).then(function(r){
    $('#sMeta').textContent=(r.estimatedTotalHits!=null?r.estimatedTotalHits+' est. hits · ':'')+r.processingTimeMs+' ms';
    var hits=r.hits||[];
    $('#sHits').innerHTML=hits.length?hits.map(function(h){
      var sc=h._rankingScore!=null?'<span class="pill ok">score '+Number(h._rankingScore).toFixed(4)+'</span> ':'';
      var c=JSON.parse(JSON.stringify(h));delete c._rankingScore;delete c._formatted;
      return '<div class="hit"><div class="hit-h">'+sc+'</div><pre>'+esc(JSON.stringify(c,null,2))+'</pre></div>';
    }).join(''):'<p class="muted">No results.</p>';
  }).catch(err);
}
['q','sFilter','sSort'].forEach(function(id){$('#'+id).oninput=function(){clearTimeout(sT);sT=setTimeout(doSearch,250);};});
['sLimit','sScore'].forEach(function(id){$('#'+id).onchange=doSearch;});
function loadDocs(){
  var u=idx();if(!u){$('#dOut').textContent='No index selected.';return;}
  var off=Number($('#dOffset').value)||0,lim=Number($('#dLimit').value)||20;
  m('GET','/indexes/'+enc(u)+'/documents?limit='+lim+'&offset='+off).then(function(r){
    $('#dMeta').textContent=(r.total!=null?r.total.toLocaleString()+' total':'');
    $('#dOut').textContent=JSON.stringify(r.results||r,null,2);
  }).catch(err);
}
$('#dLoad').onclick=loadDocs;
$('#dAdd').onclick=function(){
  var u=idx();if(!u)return;var arr;
  try{arr=JSON.parse($('#dJson').value);}catch(e){flash('invalid JSON',false);return;}
  m('POST','/indexes/'+enc(u)+'/documents',arr).then(function(){flash('add queued',true);setTimeout(loadDocs,700);}).catch(err);
};
$('#dDelOne').onclick=function(){
  var u=idx();if(!u)return;var id=$('#dDelId').value.trim();if(!id)return;
  m('DELETE','/indexes/'+enc(u)+'/documents/'+enc(id)).then(function(){flash('delete queued',true);setTimeout(loadDocs,700);}).catch(err);
};
$('#dDelAll').onclick=function(){
  var u=idx();if(!u)return;if(!confirm('Delete ALL documents in "'+u+'"?'))return;
  m('DELETE','/indexes/'+enc(u)+'/documents').then(function(){flash('delete-all queued',true);setTimeout(loadDocs,700);}).catch(err);
};
function loadSettings(){
  var u=idx();if(!u){$('#setJson').value='';return;}
  m('GET','/indexes/'+enc(u)+'/settings').then(function(s){$('#setJson').value=JSON.stringify(s,null,2);flash('loaded',true);}).catch(err);
}
$('#setLoad').onclick=loadSettings;
$('#setSave').onclick=function(){
  var u=idx();if(!u)return;var obj;
  try{obj=JSON.parse($('#setJson').value);}catch(e){flash('invalid JSON',false);return;}
  m('PATCH','/indexes/'+enc(u)+'/settings',obj).then(function(){flash('settings update queued',true);}).catch(err);
};
$('#setReset').onclick=function(){
  var u=idx();if(!u)return;if(!confirm('Reset all settings for "'+u+'" to defaults?'))return;
  m('DELETE','/indexes/'+enc(u)+'/settings').then(function(){flash('reset queued',true);setTimeout(loadSettings,700);}).catch(err);
};
function loadTasks(){
  m('GET','/tasks?limit=30').then(function(r){
    var ts=r.results||[];
    $('#tkTable').innerHTML='<tr><th>UID</th><th>Type</th><th>Status</th><th>Index</th><th class="n">Duration</th><th>Enqueued</th></tr>'+
      ts.map(function(t){
        var cls=t.status==='succeeded'?'ok':((t.status==='failed'||t.status==='canceled')?'err':'active');
        var dur=t.duration?String(t.duration).replace('PT','').replace('S','s'):'—';
        return '<tr><td>'+t.uid+'</td><td>'+esc(t.type)+'</td><td><span class="pill '+cls+'">'+esc(t.status)+'</span></td><td>'+esc(t.indexUid||'—')+'</td><td class="n">'+esc(dur)+'</td><td class="muted">'+esc(String(t.enqueuedAt||'').replace('T',' ').slice(0,19))+'</td></tr>';
      }).join('');
  }).catch(err);
}
$('#tkRefresh').onclick=loadTasks;
$('#tkCancel').onclick=function(){
  if(!confirm('Cancel all enqueued/processing tasks?'))return;
  m('POST','/tasks/cancel?statuses=enqueued,processing').then(function(){flash('cancel queued',true);setTimeout(loadTasks,700);}).catch(err);
};
function loadKeys(){
  m('GET','/keys?limit=100').then(function(r){
    var ks=r.results||[];
    $('#kyTable').innerHTML='<tr><th>Name</th><th>Key</th><th>Actions</th><th>Indexes</th><th>Expires</th><th></th></tr>'+
      ks.map(function(k){
        var key=k.key||'';var masked=key?esc(key.slice(0,6))+'…'+esc(key.slice(-4)):'—';
        var prot=(k.name==='Default Search API Key'||k.name==='Default Admin API Key');
        var del=prot?'':'<button class="danger" data-delkey="'+esc(k.uid||k.key)+'">Delete</button>';
        return '<tr><td><b>'+esc(k.name||'—')+'</b><div class="muted">'+esc(k.description||'')+'</div></td><td><code data-key="'+esc(key)+'" title="click to reveal">'+masked+'</code></td><td>'+esc((k.actions||[]).join(', '))+'</td><td>'+esc((k.indexes||[]).join(', '))+'</td><td class="muted">'+esc(k.expiresAt?String(k.expiresAt).slice(0,10):'never')+'</td><td class="n">'+del+'</td></tr>';
      }).join('');
    $$('#kyTable [data-key]').forEach(function(c){c.onclick=function(){var k=c.getAttribute('data-key');if(k)c.textContent=k;};});
    $$('#kyTable [data-delkey]').forEach(function(b){b.onclick=function(){
      var u=b.getAttribute('data-delkey');if(!confirm('Delete this API key?'))return;
      m('DELETE','/keys/'+enc(u)).then(function(){flash('key deleted',true);setTimeout(loadKeys,400);}).catch(err);
    };});
  }).catch(err);
}
function splitList(v){v=(v||'').trim();if(v==='*'||v==='')return['*'];return v.split(',').map(function(x){return x.trim();}).filter(Boolean);}
$('#kyBtn').onclick=function(){
  var body={name:$('#kyName').value.trim()||undefined,description:$('#kyDesc').value.trim()||undefined,actions:splitList($('#kyActions').value),indexes:splitList($('#kyIndexes').value),expiresAt:null};
  var e=$('#kyExp').value;if(e)body.expiresAt=new Date(e).toISOString();
  m('POST','/keys',body).then(function(){flash('key created',true);$('#kyName').value='';$('#kyDesc').value='';$('#kyActions').value='';$('#kyIndexes').value='';$('#kyExp').value='';loadKeys();}).catch(err);
};
loadIndexes();
})();
</script>
</body></html>`;

// Injected into Ghost admin's index.html; adds a "Scraper" link to the sidebar
// by cloning a built-in nav item (keeps Ghost's styling). Re-applies because
// Ember reconciles the nav on route changes.
const SIDEBAR_JS = `(function () {
  // Two overlay panels, each a sidebar link + an iframe that fills Ghost's
  // content area. Only one is shown at a time; the URL hash is the source of
  // truth so links are deep-linkable and back/forward work.
  var PANELS = [
    { nav: "gh-scraper-nav", frame: "gh-scraper-frame", label: "Scraper", hash: "#/scraper", src: "/ghost/scraper/" },
    { nav: "gh-meili-nav", frame: "gh-meili-frame", label: "Meilisearch", hash: "#/meili", src: "/ghost/scraper/meili/" }
  ];
  var current = null;
  // Overlay the iframe ABSOLUTELY inside Ghost's main content area — fixed
  // positioning is unreliable here (a transformed ancestor breaks it).
  function host() { return document.querySelector(".gh-main") || document.querySelector("main") || document.body; }
  function hideSibs(h) { var k = h.children; for (var i = 0; i < k.length; i++) { var c = k[i]; if (!(c.getAttribute && c.getAttribute("data-scr-frame")) && c.style.display !== "none") { c.setAttribute("data-scrhide", "1"); c.style.display = "none"; } } }
  function restoreSibs(h) { var x = h.querySelectorAll("[data-scrhide]"); for (var i = 0; i < x.length; i++) { x[i].style.display = ""; x[i].removeAttribute("data-scrhide"); } }
  function build(p) {
    var h = host();
    if (h !== document.body && getComputedStyle(h).position === "static") h.style.position = "relative";
    var f = document.createElement("iframe");
    f.id = p.frame; f.setAttribute("data-scr-frame", "1"); f.title = p.label; f.src = p.src;
    f.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff;z-index:5000";
    h.appendChild(f);
    return f;
  }
  function removeFrames(except) { for (var i = 0; i < PANELS.length; i++) { if (PANELS[i] !== except) { var f = document.getElementById(PANELS[i].frame); if (f && f.parentNode) f.parentNode.removeChild(f); } } }
  function active() { for (var i = 0; i < PANELS.length; i++) { var a = document.getElementById(PANELS[i].nav); if (a) a.style.fontWeight = (current && current.nav === PANELS[i].nav) ? "600" : ""; } }
  function show(p) { current = p; var h = host(); removeFrames(p); var f = document.getElementById(p.frame); if (!f || !f.isConnected) f = build(p); hideSibs(h); f.style.display = "block"; active(); }
  function hide() { current = null; var h = host(); removeFrames(null); restoreSibs(h); active(); }
  function panelByHash() { for (var i = 0; i < PANELS.length; i++) { if (location.hash === PANELS[i].hash) return PANELS[i]; } return null; }
  function addLink(p, ref) {
    if (document.getElementById(p.nav)) return;
    var item = ref.closest("li") || ref.parentNode;
    if (!item || !item.parentNode) return;
    var clone = item.cloneNode(true), a = clone.querySelector("a") || clone;
    a.id = p.nav; a.setAttribute("href", p.hash); a.removeAttribute("target");
    var spans = a.querySelectorAll("span"), lab = null;
    for (var i = spans.length - 1; i >= 0; i--) { if ((spans[i].textContent || "").trim()) { lab = spans[i]; break; } }
    if (lab) lab.textContent = p.label; else a.textContent = p.label;
    a.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (location.hash !== p.hash) location.hash = p.hash.slice(1); else show(p); });
    item.parentNode.appendChild(clone);
  }
  function tick() {
    var ref = document.querySelector('a[href="#/tags/"]') || document.querySelector('a[href="#/members/"]')
           || document.querySelector('a[href="#/pages/"]') || document.querySelector('a[href="#/tags"]');
    if (ref) { for (var i = 0; i < PANELS.length; i++) addLink(PANELS[i], ref); }
    var want = panelByHash();
    if (want) {
      if (!current || current.hash !== want.hash) show(want);
      else { var h = host(); var f = document.getElementById(want.frame); if (!f || !f.isConnected) { f = build(want); f.style.display = "block"; } hideSibs(h); }
    } else if (current) hide();
  }
  // Clicking any real Ghost nav link closes the overlay and returns to the admin.
  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("a") : null;
    if (!t) return;
    for (var i = 0; i < PANELS.length; i++) { if (t.id === PANELS[i].nav) return; }
    if (/#\\//.test(t.getAttribute("href") || "")) hide();
  }, true);
  window.addEventListener("hashchange", function () {
    var want = panelByHash();
    if (want) { if (!current || current.hash !== want.hash) show(want); }
    else if (current) hide();
  });
  setInterval(tick, 1000);
  if (document.readyState !== "loading") tick(); else document.addEventListener("DOMContentLoaded", tick);
})();`;
