// The staff settings page (served at /alerts/admin/) + the Ghost-admin sidebar
// injector that adds the "Alerts" nav link. Ghost-admin look (Inter, white cards).

export function renderAdminPage(): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Qellal · Alerts</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>
:root{--bg:#fff;--card:#fff;--border:#e1e2e6;--soft:#eef0f2;--text:#15171a;--muted:#7c8b9a;--hover:#f7f8f9;--primary:#15171a;--on:#fff;--ok:#15a336;--okbg:#eafaed}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font-family:Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;font-size:14px;line-height:1.5}
.wrap{max-width:900px;margin:0 auto;padding:2rem 2.5rem}
h1{font-size:1.9rem;font-weight:700;letter-spacing:-.021em;margin:0 0 .2rem}
.sub{color:var(--muted);margin:0 0 1.5rem;font-size:.9rem}
.card{background:var(--card);border:1px solid var(--border);border-radius:8px;padding:1.25rem 1.35rem;margin-bottom:1rem;box-shadow:0 1px 2px rgba(0,0,0,.03)}
.card h2{font-size:1rem;font-weight:600;margin:0 0 1rem}
.field{display:grid;grid-template-columns:230px 1fr;gap:.75rem;align-items:center;margin:.5rem 0}
.field label{color:var(--muted);font-size:.85rem}
input{font:inherit;border:1px solid var(--border);border-radius:5px;padding:.45rem .6rem;background:#fff;color:var(--text);width:100%}
button{font:inherit;font-weight:500;border:1px solid var(--border);background:#fff;color:var(--text);border-radius:5px;padding:.5rem .95rem;cursor:pointer}
button:hover{background:var(--hover)}button.primary{background:var(--primary);color:var(--on);border-color:var(--primary)}
.row{display:flex;gap:.6rem;flex-wrap:wrap;align-items:center;margin-top:1rem}
.pill{font-size:.72rem;padding:.15rem .5rem;border-radius:4px;background:var(--hover);color:var(--muted);border:1px solid var(--border)}
.pill.ok{background:var(--okbg);color:var(--ok);border-color:#c3ecc9}
code{background:var(--soft);padding:.15rem .4rem;border-radius:4px;font-size:.82rem;word-break:break-all}
table{width:100%;border-collapse:collapse;font-size:.85rem}td{padding:.35rem 0;border-bottom:1px solid var(--soft)}td.n{text-align:right;color:var(--muted)}
.stat{display:inline-block;margin-right:1.5rem}.stat b{font-size:1.4rem;font-variant-numeric:tabular-nums}
.hint{color:var(--muted);font-size:.78rem;margin:.2rem 0 0}
</style></head><body><div class="wrap">
<h1>Qellal · Alerts</h1>
<p class="sub">Telegram + email tender alerts · operator settings</p>
<div id="insights" class="card"><h2>Overview</h2><div id="ins">…</div></div>
<form id="form"></form>
<div class="card"><h2>Webhooks</h2>
  <p class="hint">Paste this into Ghost → Settings → Integrations → your Custom Integration → Add webhook, event <b>Post published</b>:</p>
  <p><code id="ghostHook">…</code></p>
  <div class="row">
    <button type="button" id="tgReg" class="primary">Register Telegram webhook</button>
    <button type="button" id="tgTest">Send test Telegram…</button>
    <button type="button" id="emTest">Send test email…</button>
    <span id="msg" class="pill"></span>
  </div>
</div>
<div class="card"><h2>Broadcast</h2>
  <p class="hint">Send a one-off message to every Telegram-linked subscriber (HTML allowed).</p>
  <textarea id="bc" rows="3" style="width:100%;font:inherit;border:1px solid var(--border);border-radius:5px;padding:.5rem"></textarea>
  <div class="row"><button type="button" id="bcSend" class="primary">Send broadcast</button><span id="bcMsg" class="pill"></span></div>
</div>
<div class="card"><h2>Bot usage</h2><div id="events" class="hint">…</div></div>
<div class="card"><h2>Feedback</h2><div id="feedback" class="hint">…</div></div>
</div>
<script>
var GROUPS=[["Telegram",["telegram_bot_token","telegram_bot_username","telegram_webhook_secret","channel_telegram_enabled"]],
["Email (SMTP)",["smtp_host","smtp_port","smtp_user","smtp_pass","smtp_from","smtp_secure","channel_email_enabled"]],
["Ghost webhook",["ghost_webhook_secret"]],
["Delivery policy",["default_digest_mode","digest_hour","reminder_days","quiet_start","quiet_end","daily_cap","include_closed","global_pause","dry_run"]],
["Matching / Meilisearch",["meili_host","meili_search_key"]]];
var META={},MASK={};
function h(s){return String(s==null?"":s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/"/g,"&quot;")}
async function load(){
  var d=await (await fetch("api/settings")).json();
  META=d.keys.reduce(function(a,k){a[k.key]=k;return a},{});
  d.keys.forEach(function(k){MASK[k.key]=k.secret});
  document.getElementById("ghostHook").textContent=d.webhookUrls.ghost;
  var f=document.getElementById("form");f.innerHTML="";
  GROUPS.forEach(function(g){
    var card=document.createElement("div");card.className="card";card.innerHTML="<h2>"+g[0]+"</h2>";
    g[1].forEach(function(key){
      var m=META[key]; if(!m) return;
      var row=document.createElement("div");row.className="field";
      var val=d.settings[key]||"";
      row.innerHTML='<label for="'+key+'">'+h(m.label)+'</label><input id="'+key+'" name="'+key+'" '+(m.secret?'type="password" placeholder="'+h(val||"not set")+'"':'value="'+h(val)+'"')+'>';
      card.appendChild(row);
    });
    f.appendChild(card);
  });
  var save=document.createElement("div");save.className="row";
  save.innerHTML='<button type="button" class="primary" id="save">Save settings</button><span id="savemsg" class="pill"></span>';
  f.appendChild(save);
  document.getElementById("save").onclick=saveAll;
  insights();
}
async function saveAll(){
  var s={};document.querySelectorAll("#form input").forEach(function(i){ if(i.value) s[i.name]=i.value; });
  var r=await (await fetch("api/settings",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({settings:s})})).json();
  document.getElementById("savemsg").textContent=r.ok?"saved":"error";document.getElementById("savemsg").className="pill ok";
  setTimeout(load,600);
}
async function insights(){
  try{var i=await (await fetch("api/insights")).json();
  document.getElementById("ins").innerHTML=
   '<span class="stat"><b>'+i.subscribers+'</b><br>subscribers</span>'+
   '<span class="stat"><b>'+i.telegramLinked+'</b><br>telegram linked</span>'+
   '<span class="stat"><b>'+i.alerts+'</b><br>alerts</span>'+
   '<span class="stat"><b>'+(i.savedTenders||0)+'</b><br>saved</span>'+
   '<span class="stat"><b>'+i.sendsToday+'</b><br>sends today</span>'+
   '<span class="stat"><b>'+i.sends7d+'</b><br>sends (7d)</span>';
  document.getElementById("events").innerHTML=(i.events||[]).map(function(e){return h(e.name)+': <b>'+e.count+'</b>'}).join(' · ')||'No bot activity yet.';
  }catch(e){}
}
async function loadFeedback(){try{var d=await (await fetch("api/feedback")).json();document.getElementById("feedback").innerHTML=(d.feedback||[]).map(function(f){return '<div style="border-bottom:1px solid var(--soft);padding:.3rem 0">'+h(f.text)+' <span style="color:var(--muted)">· '+h(f.created_at)+'</span></div>'}).join('')||'No feedback yet.';}catch(e){}}
function msg(t,ok){var m=document.getElementById("msg");m.textContent=t;m.className="pill"+(ok?" ok":"")}
document.getElementById("tgReg").onclick=async function(){msg("registering…");var r=await (await fetch("api/telegram/register",{method:"POST"})).json();msg(r.ok?("webhook set ("+(r.username||"")+")"):("error: "+(r.error||"")),r.ok)};
document.getElementById("tgTest").onclick=async function(){var c=prompt("Telegram chat id to test:");if(!c)return;msg("sending…");var r=await (await fetch("api/test-telegram",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({chat_id:c})})).json();msg(r.ok?"sent":("error: "+(r.error||"")),r.ok)};
document.getElementById("emTest").onclick=async function(){var to=prompt("Email address to test:");if(!to)return;msg("sending…");var r=await (await fetch("api/test-email",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({to:to})})).json();msg(r.ok?"sent":("error: "+(r.error||"")),r.ok)};
document.getElementById("bcSend").onclick=async function(){var t=document.getElementById("bc").value.trim();if(!t)return;var m=document.getElementById("bcMsg");m.textContent="sending…";var r=await (await fetch("api/broadcast",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({text:t})})).json();m.textContent=r.ok?("sent "+r.sent+"/"+r.total):("error: "+(r.error||""));m.className="pill ok"};
load();loadFeedback();
</script></body></html>`;
}

// Injected into Ghost admin's index.html (via inject-nav.sh). Adds an "Alerts"
// sidebar link that opens /alerts/admin/ in an iframe over .gh-main. Mirrors the
// Scraper panel injector so both coexist.
export const ADMIN_SIDEBAR_JS = `(function () {
  var NAV = "gh-alerts-nav", FRAME = "gh-alerts-frame", SRC = "/ghost/alerts/admin/", HASH = "#/alerts", shown = false;
  function host() { return document.querySelector(".gh-main") || document.querySelector("main") || document.body; }
  function build() { var h = host(); if (h !== document.body && getComputedStyle(h).position === "static") h.style.position = "relative"; var f = document.createElement("iframe"); f.id = FRAME; f.title = "Alerts"; f.src = SRC; f.style.cssText = "position:absolute;inset:0;width:100%;height:100%;border:0;background:#fff;z-index:5000"; h.appendChild(f); return f; }
  function hideSibs(h) { var k = h.children; for (var i = 0; i < k.length; i++) { var c = k[i]; if (c.id !== FRAME && c.style.display !== "none") { c.setAttribute("data-alrhide", "1"); c.style.display = "none"; } } }
  function restoreSibs(h) { var x = h.querySelectorAll("[data-alrhide]"); for (var i = 0; i < x.length; i++) { x[i].style.display = ""; x[i].removeAttribute("data-alrhide"); } }
  function show() { shown = true; var h = host(); var f = document.getElementById(FRAME); if (!f || !f.isConnected) f = build(); hideSibs(h); f.style.display = "block"; }
  function hide() { shown = false; var h = host(); var f = document.getElementById(FRAME); if (f && f.parentNode) f.parentNode.removeChild(f); restoreSibs(h); }
  function addLink() {
    if (!document.getElementById(NAV)) {
      var ref = document.querySelector('a[href="#/tags/"]') || document.querySelector('a[href="#/members/"]') || document.querySelector('a[href="#/pages/"]');
      if (ref) { var item = ref.closest("li") || ref.parentNode; if (item && item.parentNode) {
        var clone = item.cloneNode(true), a = clone.querySelector("a") || clone; a.id = NAV; a.setAttribute("href", HASH); a.removeAttribute("target");
        var spans = a.querySelectorAll("span"), lab = null; for (var i = spans.length - 1; i >= 0; i--) { if ((spans[i].textContent || "").trim()) { lab = spans[i]; break; } }
        if (lab) lab.textContent = "Alerts"; else a.textContent = "Alerts";
        a.addEventListener("click", function (e) { e.preventDefault(); e.stopPropagation(); if (location.hash !== HASH) location.hash = HASH.slice(1); else show(); });
        item.parentNode.appendChild(clone);
      } }
    }
    if (shown) { var h3 = host(); var fr = document.getElementById(FRAME); if (!fr || !fr.isConnected) { fr = build(); fr.style.display = "block"; } hideSibs(h3); }
    if (location.hash === HASH && !shown) show();
  }
  document.addEventListener("click", function (e) { var t = e.target.closest ? e.target.closest("a") : null; if (t && t.id !== NAV && /#\\//.test(t.getAttribute("href") || "")) hide(); }, true);
  window.addEventListener("hashchange", function () { if (location.hash === HASH) { if (!shown) show(); } else if (shown) hide(); });
  setInterval(addLink, 1000);
  if (document.readyState !== "loading") addLink(); else document.addEventListener("DOMContentLoaded", addLink);
})();`;
