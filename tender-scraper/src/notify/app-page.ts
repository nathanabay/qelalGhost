// The Telegram Mini App (WebApp) served at /ghost/alerts/app/. A self-contained
// vanilla-JS SPA: search / browse / alerts / saved / settings. Styled to match
// the Qellal site's "Signal" design system (ink is the only interactive colour —
// never blue; red/amber mean deadline TIME only; Space Grotesk / Hanken Grotesk
// / IBM Plex Mono). Light-only, like the site. Every API call carries the signed
// initData in the X-Telegram-Init-Data header — the server validates it.

export function renderMiniApp(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>Qellal Tenders</title>
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Hanken+Grotesk:wght@400;500;600;700&family=Space+Grotesk:wght@500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
<style>
:root{
  --ink:#17140D; --ink-h:#2A2519; --paper:#F4F1EA; --hairline:#ECE7DB; --border:#D8D2C4; --muted:#6B6459; --surface:#fff;
  --signal:#E8462F; --signal-100:#F7DDD6; --caution:#C8801D; --caution-100:#F0E3CB; --ok:#1A7A3C; --ok-100:#DCEFE1;
  --fh:"Space Grotesk"; --fb:"Hanken Grotesk"; --fm:"IBM Plex Mono";
  --sc:0 1px 2px rgba(23,20,13,.05),0 1px 3px rgba(23,20,13,.07);
  --sl:0 4px 12px rgba(23,20,13,.10),0 2px 4px rgba(23,20,13,.06);
}
*{box-sizing:border-box}
html{color-scheme:light}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--fb),system-ui,Arial,sans-serif;font-size:15px;line-height:1.45;-webkit-font-smoothing:antialiased;-webkit-tap-highlight-color:transparent;overscroll-behavior-y:contain}
.wrap{max-width:640px;margin:0 auto;padding:0 14px calc(28px + env(safe-area-inset-bottom))}
.wrap.hasmain{padding-bottom:calc(96px + env(safe-area-inset-bottom))}
header{position:sticky;top:0;background:var(--paper);padding:14px 0 6px;z-index:5}
h1{font-family:var(--fh);font-size:1.25rem;margin:0 0 2px;font-weight:700;letter-spacing:-.02em}
h2{font-family:var(--fh);letter-spacing:-.02em}
.sub{color:var(--muted);font-size:.8rem;margin:0}
.tabs{display:flex;gap:6px;overflow-x:auto;padding:12px 0 4px;scrollbar-width:none}
.tabs::-webkit-scrollbar{display:none}
.tab{flex:0 0 auto;padding:8px 14px;border-radius:999px;background:var(--hairline);color:var(--muted);border:1px solid transparent;font:inherit;font-weight:600;font-size:.83rem;cursor:pointer}
.tab.on{background:var(--ink);color:var(--paper)}
input,select{font:inherit;width:100%;min-height:44px;padding:11px 12px;border:1px solid var(--border);background:var(--surface);color:var(--ink);border-radius:10px;outline:none}
input:focus,select:focus{border-color:var(--ink)}
.filters{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin:10px 0}
.filters .full{grid-column:1/3}
.card{background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:14px;margin:10px 0;box-shadow:var(--sc);cursor:pointer;border-width:1px;width:100%;text-align:left;color:inherit;font:inherit;display:block}
.card:active{box-shadow:var(--sl)}
.card-top{display:flex;justify-content:space-between;gap:10px;align-items:flex-start}
.card-title{font-family:var(--fh);font-weight:600;font-size:.98rem;line-height:1.3;color:var(--ink);min-width:0;word-break:break-word}
.card-sub{margin-top:6px;font-size:.85rem;color:var(--muted)}
.card-dl{margin-top:8px;font-size:.78rem;color:var(--muted)}
.mono{font-family:var(--fm)}
.badge{flex:0 0 auto;border-radius:999px;padding:3px 10px;font-size:.72rem;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}
.b-urgent{background:var(--signal-100);color:var(--signal)}
.b-warn{background:var(--caution-100);color:var(--caution)}
.b-ink{background:var(--hairline);color:var(--ink)}
.tag{display:inline-block;font-size:.72rem;padding:3px 9px;border-radius:999px;background:var(--hairline);color:var(--muted);margin:3px 5px 0 0}
.chip{display:inline-block;padding:8px 12px;margin:0 6px 7px 0;border-radius:999px;background:var(--hairline);color:var(--ink);border:1px solid var(--border);font:inherit;font-size:.82rem;font-weight:500;cursor:pointer}
.btn{display:block;width:100%;min-height:44px;padding:12px;border:1px solid var(--ink);border-radius:10px;background:var(--ink);color:#fff;font:inherit;font-weight:600;font-size:.9rem;cursor:pointer;margin:8px 0}
.btn.sec{background:var(--surface);color:var(--ink);border-color:var(--border)}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.muted{color:var(--muted);font-size:.9rem;text-align:center;padding:30px 12px;line-height:1.5}
.detail h2{font-size:1.2rem;margin:8px 0 6px;line-height:1.25}
.detail .dmeta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px}
.detail .dsub{color:var(--muted);font-size:.88rem;margin-bottom:12px}
.seg{display:flex;background:var(--surface);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin:6px 0;padding:3px;gap:3px}
.seg button{flex:1;padding:9px;border:none;background:transparent;color:var(--ink);font:inherit;font-weight:600;font-size:.85rem;border-radius:9px;cursor:pointer;text-transform:capitalize}
.seg button.on{background:var(--ink);color:#fff}
.rowb{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 13px;background:var(--surface);border:1px solid var(--border);border-radius:12px;margin:9px 0}
.mini{padding:7px 11px;border:1px solid var(--border);border-radius:999px;background:var(--surface);color:var(--ink);font:inherit;font-size:.78rem;font-weight:500;cursor:pointer;margin:2px 2px 0 0}
.mini.on{background:var(--ink);color:#fff;border-color:var(--ink)}
.sec-h{font-family:var(--fh);font-weight:600;font-size:.82rem;color:var(--muted);text-transform:uppercase;letter-spacing:.04em;margin:16px 0 6px}
a{color:var(--ink);font-weight:600}
</style></head><body><div class="wrap">
<header>
  <h1>Qellal Tenders</h1>
  <p class="sub" id="hello">Ethiopian government &amp; NGO tenders</p>
  <div class="tabs" id="tabs">
    <button class="tab on" data-t="browse">Browse</button>
    <button class="tab" data-t="alerts">Alerts</button>
    <button class="tab" data-t="saved">Saved</button>
    <button class="tab" data-t="settings">Settings</button>
  </div>
</header>
<main id="view"></main>
</div>
<script>
const tg = window.Telegram && window.Telegram.WebApp;
try{ tg && tg.ready(); tg && tg.expand(); }catch(e){}
// Stop Telegram's swipe-to-close gesture from hijacking the page scroll once
// the user has scrolled down (Bot API 7.7+); harmless no-op on older clients.
try{ tg.disableVerticalSwipes(); }catch(e){}
try{ tg.setBackgroundColor('#F4F1EA'); tg.setHeaderColor('#17140D'); }catch(e){}
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

let STATE = { tab:'browse', init:null, lastSearch:{}, curCat:'' };
const view = document.getElementById('view');
const todayTs = ()=>{ const n=new Date(); return Math.floor(Date.UTC(n.getUTCFullYear(),n.getUTCMonth(),n.getUTCDate())/1000); };
function daysLeftOf(h){ if(!h.deadline) return null; return Math.round((Date.parse(h.deadline)/1000-todayTs())/86400); }
function badge(h){
  const d=daysLeftOf(h); if(d==null) return '';
  const cls = d<=3?'b-urgent':(d<=7?'b-warn':'b-ink');
  const txt = d<0?'Closed':(d===0?'Closes today':d+'d left');
  return '<span class="badge '+cls+'">'+txt+'</span>';
}
function subOf(h){ const p=[]; if(h.publishing_entity)p.push(h.publishing_entity); if(h.region)p.push(h.region); return p.join(' · ')||'Ethiopia'; }
function fmtDate(s){ if(!s) return ''; const d=new Date(s+'T00:00:00'); if(isNaN(d.getTime())) return s; return d.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}); }
function cardHTML(h){
  return '<button class="card" onclick="openTender(\\''+esc(h.id)+'\\')">'
    +'<div class="card-top"><div class="card-title">'+esc((h.title||'').slice(0,140))+'</div>'+badge(h)+'</div>'
    +'<div class="card-sub">'+esc(subOf(h))+'</div>'
    +(h.deadline?'<div class="card-dl">Deadline <span class="mono">'+esc(fmtDate(h.deadline))+'</span></div>':'')
    +'</button>';
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
  if(STATE.tab==='browse') return renderBrowse();
  if(STATE.tab==='alerts') return renderAlerts();
  if(STATE.tab==='saved') return renderSaved();
  if(STATE.tab==='settings') return renderSettings();
}

// ── members-only gate ──
function renderLink(){
  const url=(STATE.init&&STATE.init.linkUrl)||'https://tenders.qelal.et/my-alerts/';
  view.innerHTML='<div style="text-align:center;padding:46px 18px">'
    +'<div style="font-size:46px">🔒</div>'
    +'<h2 style="margin:14px 0 6px">Link your Qellal account</h2>'
    +'<p class="muted" style="padding:0 6px">This app is for signed-in Qellal members. Open your alerts page, sign in, and tap “Link Telegram”. Then reopen this app.</p>'
    +'<button class="btn" onclick="openLink(\\''+esc(url)+'\\')">Open my alerts page</button>'
    +'</div>';
}

// ── browse (search + filters + quick views, merged) ──
function renderBrowse(){
  const i=STATE.init, cats=(i&&i.categories||[]), regs=(i&&i.regions||[]);
  view.innerHTML =
    '<input id="q" placeholder="Search tenders… e.g. electrical" value="'+esc(STATE.lastSearch.q||'')+'">'
    +'<div class="filters">'
      +'<select id="cat"><option value="">All sectors</option>'+cats.map(c=>'<option '+(STATE.lastSearch.catName===c.value?'selected':'')+' value="'+esc(c.value)+'">'+esc(c.value)+' ('+c.count+')</option>').join('')+'</select>'
      +'<select id="reg"><option value="">All regions</option>'+regs.map(c=>'<option '+(STATE.lastSearch.region===c.value?'selected':'')+' value="'+esc(c.value)+'">'+esc(c.value)+' ('+c.count+')</option>').join('')+'</select>'
      +'<select id="dl" class="full"><option value="">Any deadline</option><option value="7">Closing within 7 days</option><option value="14">Within 14 days</option><option value="30">Within 30 days</option></select>'
      +'<select id="quickSel" class="full"><option value="">Quick view…</option><option value="closing">📅 Closing this week</option><option value="today">⏰ Closing today</option><option value="latest">🆕 Latest tenders</option></select>'
    +'</div>'
    +'<div id="results"><p class="muted">Loading tenders…</p></div>';
  const run=()=>{ const qk=document.getElementById('quickSel'); if(qk) qk.value=''; doSearch(); };
  document.getElementById('q').addEventListener('input', debounce(run,350));
  ['cat','reg','dl'].forEach(id=>document.getElementById(id).addEventListener('change', run));
  document.getElementById('quickSel').addEventListener('change', e=>{ const v=e.target.value; if(v){ clearFilters(); browse(v); } });
  // Land with tenders already loaded: restore the last search, or show latest.
  if(STATE.lastSearch.q||STATE.lastSearch.catName||STATE.lastSearch.region||STATE.lastSearch.deadline) doSearch();
  else browse('latest');
}
function clearFilters(){ ['q','cat','reg','dl'].forEach(id=>{ const e=document.getElementById(id); if(e) e.value=''; }); STATE.lastSearch={}; hideMain(); }
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

async function browse(mode){
  haptic();
  let p={}, title='Latest tenders';
  if(mode==='closing'){ p={deadline:'7',sort:'open_rank:asc,deadline_ts:asc'}; title='Closing this week'; }
  else if(mode==='today'){ p={deadline:'1',sort:'deadline_ts:asc'}; title='Closing today'; }
  else p={sort:'published_ts:desc'};
  const res=await api('/api/search?'+qs(p));
  const el=document.getElementById('results'); if(el) el.innerHTML='<p class="sec-h">'+title+'</p>'+listHTML(res.hits,'Nothing here right now.');
}
async function browseCat(name){
  haptic();
  const res=await api('/api/search?'+qs({catName:name,sort:'open_rank:asc,deadline_ts:asc'}));
  document.getElementById('results').innerHTML='<p class="sec-h">'+esc(name)+'</p>'+listHTML(res.hits,'Nothing here right now.');
}

// ── tender detail ──
async function openTender(id){
  haptic();
  const res=await api('/api/tender?id='+encodeURIComponent(id));
  const h=res.tender; if(!h){ toast('Tender not found.'); return; }
  const saved=(STATE.init&&STATE.init.saved||[]).some(s=>s.tender_id===h.id);
  STATE.curCat=(h.categories&&h.categories[0])||'';
  view.innerHTML='<div class="detail"><h2>'+esc(h.title)+'</h2>'
    +'<div class="dmeta">'+badge(h)+(h.deadline?'<span class="sub">Deadline <span class="mono" style="color:var(--ink);font-weight:600">'+esc(fmtDate(h.deadline))+'</span></span>':'')+'</div>'
    +'<div class="dsub">'+esc(subOf(h))+'</div>'
    +(h.categories&&h.categories.length?'<div style="margin-bottom:8px">'+h.categories.map(c=>'<span class="tag">'+esc(c)+'</span>').join('')+'</div>':'')
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
  document.getElementById('results').innerHTML='<p class="sec-h">Similar · '+esc(cat)+'</p>'+listHTML(res.hits,'No similar tenders.');
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
    return '<div class="rowb" style="display:block"><div class="card-title" style="font-size:.95rem">'+esc(al.label)+'</div>'
      +'<div class="card-sub">'+(snoozed?'Snoozed until '+new Date(al.snoozed_until).toLocaleDateString():'Active')+'</div>'
      +'<div style="margin-top:9px">'
        +'<button class="mini '+(ch.telegram!==false?'on':'')+'" onclick="toggleCh('+al.id+',\\'telegram\\')">📨 Telegram</button>'
        +'<button class="mini '+(ch.email!==false?'on':'')+'" onclick="toggleCh('+al.id+',\\'email\\')">📧 Email</button>'
        +'<button class="mini" onclick="snooze('+al.id+','+(snoozed?0:7)+')">'+(snoozed?'🔔 Unsnooze':'😴 Snooze 7d')+'</button>'
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
  view.innerHTML=s.map(t=>'<div class="rowb"><div style="min-width:0"><div class="card-title" style="font-size:.9rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">'+esc(t.title||t.tender_id)+'</div><div class="card-dl">'+(t.deadline?'Deadline <span class="mono">'+esc(fmtDate(t.deadline))+'</span>':'')+'</div></div><div style="flex:0 0 auto;white-space:nowrap"><button class="mini" onclick="openLink(\\''+esc(t.url||'')+'\\')">Open</button><button class="mini" onclick="unsave(\\''+esc(t.tender_id)+'\\')">🗑</button></div></div>').join('');
}
async function unsave(id){ haptic(); await api('/api/save?id='+encodeURIComponent(id),{method:'DELETE'}); await loadInit(); renderSaved(); }

// ── settings ──
function renderSettings(){
  const i=STATE.init||{};
  const freq=i.digest_freq||'instant';
  const paused=i.paused_until && Date.parse(i.paused_until)>Date.now();
  view.innerHTML=
    '<p class="sec-h">Delivery</p>'
    +'<div class="seg">'+['instant','daily','weekly'].map(f=>'<button class="'+(freq===f?'on':'')+'" onclick="setFreq(\\''+f+'\\')">'+f+'</button>').join('')+'</div>'
    +'<p class="sec-h">Notifications</p>'
    +'<div class="rowb"><div>'+(paused?'Paused until '+new Date(i.paused_until).toLocaleDateString():'Active')+'</div>'
      +(paused?'<button class="mini on" onclick="setPause(0)">Resume</button>':'<button class="mini" onclick="setPause(7)">Pause 7 days</button>')+'</div>'
    +'<p class="sec-h">Language</p>'
    +'<div class="seg">'+[['en','English'],['am','አማርኛ']].map(([k,lbl])=>'<button class="'+((i.lang||'en')===k?'on':'')+'" onclick="setLang(\\''+k+'\\')">'+lbl+'</button>').join('')+'</div>'
    +'<p class="sec-h">Account</p>'
    +'<div class="rowb"><div>'+(i.linked?('Linked'+(i.email?' · '+esc(i.email):'')):'Not linked')+'</div></div>';
}
async function setFreq(f){ haptic(); await api('/api/prefs',{method:'POST',body:{freq:f}}); await loadInit(); renderSettings(); }
async function setPause(days){ haptic(); await api('/api/prefs',{method:'POST',body:{pause_days:days}}); await loadInit(); renderSettings(); }
async function setLang(l){ haptic(); await api('/api/prefs',{method:'POST',body:{lang:l}}); await loadInit(); renderSettings(); }

// ── MainButton / BackButton helpers (themed to ink) ──
let _mainCb=null;
const wrapEl=document.querySelector('.wrap');
function showMain(text,cb){ if(wrapEl) wrapEl.classList.add('hasmain'); try{ tg.MainButton.setParams({text,color:'#17140D',text_color:'#ffffff'}); tg.MainButton.show(); if(_mainCb) tg.MainButton.offClick(_mainCb); _mainCb=cb; tg.MainButton.onClick(cb); }catch(e){} }
function hideMain(){ if(wrapEl) wrapEl.classList.remove('hasmain'); try{ if(_mainCb) tg.MainButton.offClick(_mainCb); _mainCb=null; tg.MainButton.hide(); }catch(e){} }
let _backCb=null;
function showBack(cb){ try{ tg.BackButton.show(); if(_backCb) tg.BackButton.offClick(_backCb); _backCb=cb; tg.BackButton.onClick(cb); }catch(e){} }
function hideBack(){ try{ if(_backCb) tg.BackButton.offClick(_backCb); _backCb=null; tg.BackButton.hide(); }catch(e){} }

function toast(m){ try{ tg.showPopup({message:m}); }catch(e){ try{ tg.showAlert(m); }catch(e2){} } }

async function loadInit(){ STATE.init=await api('/api/init'); const u=STATE.init.user; const el=document.getElementById('hello'); if(el) el.textContent = (u&&u.name?u.name+' · ':'')+'Ethiopian tenders'; }

(async function(){
  try{ await loadInit(); render(); }
  catch(e){ if(String(e.message)!=='401') view.innerHTML='<p class="muted">Something went wrong loading your data.</p>'; }
})();
</script></body></html>`;
}
