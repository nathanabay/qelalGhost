// The Telegram Mini App (WebApp) served at /ghost/alerts/app/. A self-contained
// vanilla-JS SPA: search / browse / alerts / saved / settings, themed to the
// user's Telegram theme. Every API call carries the signed initData in the
// X-Telegram-Init-Data header — the server validates it (see initdata.ts) and
// no cookie/login is involved.

export function renderMiniApp(): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Qellal Tenders</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<style>
:root{
  --bg:var(--tg-theme-bg-color,#fff); --text:var(--tg-theme-text-color,#15171a);
  --hint:var(--tg-theme-hint-color,#7c8b9a); --link:var(--tg-theme-link-color,#2a7bde);
  --btn:var(--tg-theme-button-color,#2a7bde); --btn-text:var(--tg-theme-button-text-color,#fff);
  --sec:var(--tg-theme-secondary-bg-color,#f4f4f5); --hdr:var(--tg-theme-header-bg-color,var(--bg));
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:15px;line-height:1.45;-webkit-tap-highlight-color:transparent}
.wrap{max-width:640px;margin:0 auto;padding:0 14px 90px}
header{position:sticky;top:0;background:var(--bg);padding:12px 0 6px;z-index:5}
h1{font-size:1.15rem;margin:0 0 2px;font-weight:700}
.sub{color:var(--hint);font-size:.8rem;margin:0}
.tabs{display:flex;gap:6px;overflow-x:auto;padding:10px 0 4px;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tab{flex:0 0 auto;padding:7px 13px;border-radius:20px;background:var(--sec);color:var(--text);border:none;font:inherit;font-size:.85rem;cursor:pointer}
.tab.on{background:var(--btn);color:var(--btn-text)}
input,select{font:inherit;width:100%;padding:10px 12px;border:1px solid var(--sec);background:var(--sec);color:var(--text);border-radius:10px;outline:none}
.filters{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:8px 0}
.filters .full{grid-column:1/3}
.card{background:var(--sec);border-radius:12px;padding:12px 13px;margin:8px 0;cursor:pointer;border:none;width:100%;text-align:left;color:inherit;font:inherit;display:block}
.card .t{font-weight:600;font-size:.95rem}
.card .m{color:var(--hint);font-size:.8rem;margin-top:3px}
.tag{display:inline-block;font-size:.72rem;padding:2px 7px;border-radius:6px;background:var(--bg);color:var(--hint);margin:2px 4px 0 0}
.chip{display:inline-block;padding:7px 11px;margin:0 6px 6px 0;border-radius:16px;background:var(--sec);color:var(--text);border:none;font:inherit;font-size:.82rem;cursor:pointer}
.btn{display:block;width:100%;padding:12px;border:none;border-radius:10px;background:var(--btn);color:var(--btn-text);font:inherit;font-weight:600;cursor:pointer;margin:6px 0}
.btn.sec{background:var(--sec);color:var(--text)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.muted{color:var(--hint);font-size:.85rem;text-align:center;padding:26px 10px}
.detail h2{font-size:1.15rem;margin:6px 0 4px}
.detail .m{color:var(--hint);font-size:.85rem;margin-bottom:12px}
.seg{display:flex;background:var(--sec);border-radius:10px;overflow:hidden;margin:6px 0}
.seg button{flex:1;padding:10px;border:none;background:transparent;color:var(--text);font:inherit;cursor:pointer}
.seg button.on{background:var(--btn);color:var(--btn-text)}
.rowb{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:11px 12px;background:var(--sec);border-radius:10px;margin:8px 0}
.mini{padding:6px 10px;border:none;border-radius:8px;background:var(--bg);color:var(--text);font:inherit;font-size:.8rem;cursor:pointer}
.mini.on{background:var(--btn);color:var(--btn-text)}
a{color:var(--link)}
</style></head><body><div class="wrap">
<header>
  <h1>Qellal Tenders</h1>
  <p class="sub" id="hello">Ethiopian tenders · alerts</p>
  <div class="tabs" id="tabs">
    <button class="tab on" data-t="search">🔍 Search</button>
    <button class="tab" data-t="browse">🧭 Browse</button>
    <button class="tab" data-t="alerts">🔔 Alerts</button>
    <button class="tab" data-t="saved">💾 Saved</button>
    <button class="tab" data-t="settings">⚙️ Settings</button>
  </div>
</header>
<main id="view"></main>
</div>
<script>
const tg = window.Telegram && window.Telegram.WebApp;
try{ tg && tg.ready(); tg && tg.expand(); }catch(e){}
const BASE = location.pathname.replace(/\\/+$/,'');
const INIT = (tg && tg.initData) || "";
const haptic = (t)=>{ try{ tg.HapticFeedback.impactOccurred(t||'light'); }catch(e){} };
const esc = (s)=>String(s==null?'':s).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const qs = (o)=>Object.entries(o).filter(([,v])=>v!=null&&v!=='').map(([k,v])=>k+'='+encodeURIComponent(v)).join('&');

async function api(path, opts){
  opts = opts||{};
  const r = await fetch(BASE+path, {
    method: opts.method||'GET',
    headers: Object.assign({'X-Telegram-Init-Data': INIT}, opts.body?{'Content-Type':'application/json'}:{}),
    body: opts.body?JSON.stringify(opts.body):undefined,
  });
  if(r.status===401){ view.innerHTML='<p class="muted">Couldn\\'t verify your Telegram session. Open this from inside Telegram.</p>'; throw new Error('401'); }
  return r.json();
}

let STATE = { tab:'search', init:null, lastSearch:{} };
const view = document.getElementById('view');
const todayTs = ()=>{ const n=new Date(); return Math.floor(Date.UTC(n.getUTCFullYear(),n.getUTCMonth(),n.getUTCDate())/1000); };
function metaOf(h){
  const p=[];
  if(h.deadline){ const d=Math.round((Date.parse(h.deadline)/1000-todayTs())/86400); p.push(d<0?'closed':d===0?'closes today':d+'d left'); }
  if(h.publishing_entity) p.push(h.publishing_entity);
  if(h.region) p.push(h.region);
  return p.join(' · ');
}
function cardHTML(h){
  return '<button class="card" onclick="openTender(\\''+esc(h.id)+'\\')"><div class="t">'+esc((h.title||'').slice(0,120))+'</div><div class="m">'+esc(metaOf(h))+'</div></button>';
}
function listHTML(hits, empty){
  if(!hits||!hits.length) return '<p class="muted">'+esc(empty||'Nothing found.')+'</p>';
  return hits.map(cardHTML).join('');
}

// ── tabs ──
document.getElementById('tabs').addEventListener('click', e=>{
  const b=e.target.closest('.tab'); if(!b) return;
  haptic();
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('on', x===b));
  STATE.tab=b.dataset.t; render();
});

function render(){
  hideBack(); hideMain();
  const tabsEl=document.getElementById('tabs');
  if(STATE.init && STATE.init.linked===false){ if(tabsEl) tabsEl.style.display='none'; return renderLink(); }
  if(tabsEl) tabsEl.style.display='';
  if(STATE.tab==='search') return renderSearch();
  if(STATE.tab==='browse') return renderBrowse();
  if(STATE.tab==='alerts') return renderAlerts();
  if(STATE.tab==='saved') return renderSaved();
  if(STATE.tab==='settings') return renderSettings();
}

// ── members-only gate ──
function renderLink(){
  const url=(STATE.init&&STATE.init.linkUrl)||'https://tenders.qelal.et/my-alerts/';
  view.innerHTML='<div style="text-align:center;padding:44px 18px">'
    +'<div style="font-size:46px">🔒</div>'
    +'<h2 style="margin:14px 0 6px">Link your Qellal account</h2>'
    +'<p class="muted" style="padding:0 6px">This app is for signed-in Qellal members. Open your alerts page, sign in, and tap “Link Telegram”. Then reopen this app.</p>'
    +'<button class="btn" onclick="openLink(\\''+esc(url)+'\\')">🔗 Open my alerts page</button>'
    +'</div>';
}

// ── search ──
function renderSearch(){
  const i=STATE.init, cats=(i&&i.categories||[]), regs=(i&&i.regions||[]);
  view.innerHTML =
    '<input id="q" placeholder="Search tenders… e.g. electrical" value="'+esc(STATE.lastSearch.q||'')+'">'
    +'<div class="filters">'
      +'<select id="cat"><option value="">All sectors</option>'+cats.map(c=>'<option '+(STATE.lastSearch.catName===c.value?'selected':'')+' value="'+esc(c.value)+'">'+esc(c.value)+' ('+c.count+')</option>').join('')+'</select>'
      +'<select id="reg"><option value="">All regions</option>'+regs.map(c=>'<option '+(STATE.lastSearch.region===c.value?'selected':'')+' value="'+esc(c.value)+'">'+esc(c.value)+' ('+c.count+')</option>').join('')+'</select>'
      +'<select id="dl" class="full"><option value="">Any deadline</option><option value="7">Closing within 7 days</option><option value="14">Within 14 days</option><option value="30">Within 30 days</option></select>'
    +'</div>'
    +'<div id="results"><p class="muted">Type a keyword or pick a filter.</p></div>';
  const run=()=>doSearch();
  document.getElementById('q').addEventListener('input', debounce(run,350));
  ['cat','reg','dl'].forEach(id=>document.getElementById(id).addEventListener('change', run));
  if(STATE.lastSearch.q||STATE.lastSearch.catName||STATE.lastSearch.region) run();
}
let _t; function debounce(fn,ms){ return (...a)=>{ clearTimeout(_t); _t=setTimeout(()=>fn(...a),ms); }; }
async function doSearch(){
  const q=val('q'), catName=val('cat'), region=val('reg'), deadline=val('dl');
  STATE.lastSearch={q,catName,region,deadline};
  const res=await api('/api/search?'+qs({q,catName,region,deadline}));
  document.getElementById('results').innerHTML=listHTML(res.hits,'No tenders matched.');
  if((q||catName||region)){ showMain('🔔 Alert me for this search', createAlertFromSearch); } else hideMain();
}
function val(id){ const e=document.getElementById(id); return e?e.value.trim():''; }

async function createAlertFromSearch(){
  const s=STATE.lastSearch;
  const label = s.q ? '"'+s.q+'"' : (s.catName || s.region || 'All tenders');
  await api('/api/alert',{method:'POST',body:{label, criteria:{q:s.q||undefined,catName:s.catName||undefined,region:s.region||undefined,deadline:s.deadline||undefined}, channels:{email:true,telegram:true}}});
  haptic('medium'); toast('Alert saved — new matches arrive in this chat.');
  await loadInit();
}

// ── browse ──
function renderBrowse(){
  const cats=(STATE.init&&STATE.init.categories||[]).slice(0,24);
  view.innerHTML =
    '<div class="grid2">'
      +'<button class="btn sec" onclick="browse(\\'closing\\')">📅 Closing this week</button>'
      +'<button class="btn sec" onclick="browse(\\'today\\')">⏰ Closing today</button>'
      +'<button class="btn sec" onclick="browse(\\'latest\\')" style="grid-column:1/3">🆕 Latest tenders</button>'
    +'</div>'
    +'<p class="sub" style="margin:14px 0 6px">By sector</p>'
    +'<div id="chips">'+cats.map(c=>'<button class="chip" data-cat="'+esc(c.value)+'">'+esc(c.value)+' ('+c.count+')</button>').join('')+'</div>'
    +'<div id="results"></div>';
  document.getElementById('chips').addEventListener('click', e=>{ const b=e.target.closest('.chip'); if(b) browseCat(b.dataset.cat); });
}
async function browse(mode){
  haptic();
  let p={}; if(mode==='closing') p={deadline:'7',sort:'open_rank:asc,deadline_ts:asc'};
  else if(mode==='today') p={deadline:'1',sort:'deadline_ts:asc'};
  else p={sort:'published_ts:desc'};
  const res=await api('/api/search?'+qs(p));
  document.getElementById('results').innerHTML='<p class="sub" style="margin:14px 0 4px">Results</p>'+listHTML(res.hits,'Nothing here right now.');
}
async function browseCat(name){
  haptic();
  const res=await api('/api/search?'+qs({catName:name,sort:'open_rank:asc,deadline_ts:asc'}));
  document.getElementById('results').innerHTML='<p class="sub" style="margin:14px 0 4px">'+esc(name)+'</p>'+listHTML(res.hits,'Nothing here right now.');
}

// ── tender detail ──
async function openTender(id){
  haptic();
  const res=await api('/api/tender?id='+encodeURIComponent(id));
  const h=res.tender; if(!h){ toast('Tender not found.'); return; }
  const saved=(STATE.init&&STATE.init.saved||[]).some(s=>s.tender_id===h.id);
  STATE.curCat=(h.categories&&h.categories[0])||'';
  view.innerHTML='<div class="detail"><h2>'+esc(h.title)+'</h2><div class="m">'+esc(metaOf(h))+'</div>'
    +(h.categories&&h.categories.length?'<div>'+h.categories.map(c=>'<span class="tag">'+esc(c)+'</span>').join('')+'</div>':'')
    +'<button class="btn" onclick="openLink(\\''+esc(h.url)+'\\')">🌐 Open tender</button>'
    +'<div class="grid2">'
      +'<button class="btn sec" id="saveBtn" onclick="toggleSave(\\''+esc(h.id)+'\\')">'+(saved?'✅ Saved':'💾 Save')+'</button>'
      +(h.deadline?'<button class="btn sec" onclick="openLink(\\''+esc(BASEURL()+'/ics/'+encodeURIComponent(h.id))+'\\')">📅 Calendar</button>':'<button class="btn sec" onclick="shareTender(\\''+esc(h.url)+'\\')">🔗 Share</button>')
    +'</div>'
    +(h.deadline?'<button class="btn sec" onclick="shareTender(\\''+esc(h.url)+'\\')">🔗 Share</button>':'')
    +'<button class="btn sec" onclick="similar()">🔍 Similar tenders</button>'
    +'</div><div id="results"></div>';
  showBack(()=>{ hideBack(); render(); });
}
function BASEURL(){ return location.origin+BASE.replace(/\\/app$/,''); }
async function toggleSave(id){
  haptic('medium');
  const saved=(STATE.init&&STATE.init.saved||[]).some(s=>s.tender_id===id);
  if(saved){ await api('/api/save?id='+encodeURIComponent(id),{method:'DELETE'}); }
  else{ const res=await api('/api/tender?id='+encodeURIComponent(id)); const h=res.tender; await api('/api/save',{method:'POST',body:{tender:{tender_id:h.id,url:h.url,title:h.title,deadline:h.deadline}}}); }
  await loadInit();
  const b=document.getElementById('saveBtn'); if(b) b.textContent = saved?'💾 Save':'✅ Saved';
}
async function similar(){
  const cat=STATE.curCat;
  if(!cat){ toast('No similar tenders.'); return; }
  const res=await api('/api/search?'+qs({catName:cat,sort:'open_rank:asc,deadline_ts:asc'}));
  document.getElementById('results').innerHTML='<p class="sub" style="margin:14px 0 4px">Similar · '+esc(cat)+'</p>'+listHTML(res.hits,'No similar tenders.');
}
function openLink(u){ try{ tg.openLink(u); }catch(e){ window.open(u,'_blank'); } }
function shareTender(u){ openLink('https://t.me/share/url?url='+encodeURIComponent(u)); }

// ── alerts ──
function renderAlerts(){
  const a=(STATE.init&&STATE.init.alerts)||[];
  if(!a.length){ view.innerHTML='<p class="muted">No alerts yet.<br>Search or pick a sector, then tap “Alert me”.</p>'; return; }
  view.innerHTML=a.map(al=>{
    const snoozed=al.snoozed_until && Date.parse(al.snoozed_until)>Date.now();
    const ch=al.channels||{};
    return '<div class="card" style="cursor:default"><div class="t">'+esc(al.label)+'</div>'
      +'<div class="m">'+(snoozed?'Snoozed until '+new Date(al.snoozed_until).toLocaleDateString():'Active')+'</div>'
      +'<div style="margin-top:8px">'
        +'<button class="mini '+(ch.telegram!==false?'on':'')+'" onclick="toggleCh('+al.id+',\\'telegram\\')">📨 Telegram</button> '
        +'<button class="mini '+(ch.email!==false?'on':'')+'" onclick="toggleCh('+al.id+',\\'email\\')">📧 Email</button> '
        +'<button class="mini" onclick="snooze('+al.id+','+(snoozed?0:7)+')">'+(snoozed?'🔔 Unsnooze':'😴 Snooze 7d')+'</button> '
        +'<button class="mini" onclick="delAlert('+al.id+')">🗑 Delete</button>'
      +'</div></div>';
  }).join('');
}
async function toggleCh(id,which){
  haptic();
  const al=(STATE.init.alerts||[]).find(x=>x.id===id); if(!al) return;
  const ch=Object.assign({email:true,telegram:true}, al.channels||{});
  ch[which]=ch[which]===false?true:false;
  await api('/api/alert/channels',{method:'POST',body:{id,channels:ch}});
  await loadInit(); renderAlerts();
}
async function snooze(id,days){ haptic(); await api('/api/alert/snooze',{method:'POST',body:{id,days}}); await loadInit(); renderAlerts(); }
async function delAlert(id){ haptic('medium'); await api('/api/alert?id='+id,{method:'DELETE'}); await loadInit(); renderAlerts(); }

// ── saved ──
function renderSaved(){
  const s=(STATE.init&&STATE.init.saved)||[];
  if(!s.length){ view.innerHTML='<p class="muted">No bookmarks yet.<br>Open any tender and tap 💾 Save.</p>'; return; }
  view.innerHTML=s.map(t=>'<div class="rowb"><div style="min-width:0"><div class="t" style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(t.title||t.tender_id)+'</div><div class="m" style="color:var(--hint);font-size:.78rem">'+(t.deadline?'Deadline '+esc(t.deadline):'')+'</div></div><div style="flex:0 0 auto"><button class="mini" onclick="openLink(\\''+esc(t.url||'')+'\\')">Open</button> <button class="mini" onclick="unsave(\\''+esc(t.tender_id)+'\\')">🗑</button></div></div>').join('');
}
async function unsave(id){ haptic(); await api('/api/save?id='+encodeURIComponent(id),{method:'DELETE'}); await loadInit(); renderSaved(); }

// ── settings ──
function renderSettings(){
  const i=STATE.init||{};
  const freq=i.digest_freq||'instant';
  const paused=i.paused_until && Date.parse(i.paused_until)>Date.now();
  view.innerHTML=
    '<p class="sub" style="margin:10px 0 4px">Delivery</p>'
    +'<div class="seg">'+['instant','daily','weekly'].map(f=>'<button class="'+(freq===f?'on':'')+'" onclick="setFreq(\\''+f+'\\')">'+f+'</button>').join('')+'</div>'
    +'<p class="sub" style="margin:16px 0 4px">Notifications</p>'
    +'<div class="rowb"><div>'+(paused?'Paused until '+new Date(i.paused_until).toLocaleDateString():'Active')+'</div>'
      +(paused?'<button class="mini on" onclick="setPause(0)">Resume</button>':'<button class="mini" onclick="setPause(7)">Pause 7 days</button>')+'</div>'
    +'<p class="sub" style="margin:16px 0 4px">Language</p>'
    +'<div class="seg">'+[['en','English'],['am','አማርኛ']].map(([k,lbl])=>'<button class="'+((i.lang||'en')===k?'on':'')+'" onclick="setLang(\\''+k+'\\')">'+lbl+'</button>').join('')+'</div>'
    +'<p class="sub" style="margin:18px 0 4px">Account</p>'
    +'<div class="rowb"><div>'+(i.linked?('Linked'+(i.email?' · '+esc(i.email):'')):'Not linked to a Ghost account')+'</div></div>'
    +(i.linked?'':'<p class="sub" style="font-size:.78rem;margin-top:6px">Link at tenders.qelal.et/my-alerts to also get email alerts.</p>');
}
async function setFreq(f){ haptic(); await api('/api/prefs',{method:'POST',body:{freq:f}}); await loadInit(); renderSettings(); }
async function setPause(days){ haptic(); await api('/api/prefs',{method:'POST',body:{pause_days:days}}); await loadInit(); renderSettings(); }
async function setLang(l){ haptic(); await api('/api/prefs',{method:'POST',body:{lang:l}}); await loadInit(); renderSettings(); }

// ── MainButton / BackButton helpers ──
let _mainCb=null;
function showMain(text,cb){ try{ tg.MainButton.setText(text); tg.MainButton.show(); if(_mainCb) tg.MainButton.offClick(_mainCb); _mainCb=cb; tg.MainButton.onClick(cb); }catch(e){} }
function hideMain(){ try{ if(_mainCb) tg.MainButton.offClick(_mainCb); _mainCb=null; tg.MainButton.hide(); }catch(e){} }
let _backCb=null;
function showBack(cb){ try{ tg.BackButton.show(); if(_backCb) tg.BackButton.offClick(_backCb); _backCb=cb; tg.BackButton.onClick(cb); }catch(e){} }
function hideBack(){ try{ if(_backCb) tg.BackButton.offClick(_backCb); _backCb=null; tg.BackButton.hide(); }catch(e){} }

function toast(m){ try{ tg.showPopup({message:m}); }catch(e){ try{ tg.showAlert(m); }catch(e2){} } }

async function loadInit(){ STATE.init=await api('/api/init'); const u=STATE.init.user; document.getElementById('hello').textContent = (u&&u.name?u.name+' · ':'')+'Ethiopian tenders'; }

(async function(){
  try{ await loadInit(); render(); }
  catch(e){ if(String(e.message)!=='401') view.innerHTML='<p class="muted">Something went wrong loading your data.</p>'; }
})();
</script></body></html>`;
}
