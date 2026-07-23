/* Qellal theme — progressive enhancement.
 *
 * Tenders carry their deadline in the excerpt ("Deadline YYYY-MM-DD · …") and a
 * "Tender details" list in the body. This script reads that and drives the
 * deadline badges/console, the list sort/group/filter/density toolbar, the
 * saved-shortlist (localStorage), recently-viewed & seen dimming, the urgency
 * meters, the closing-today strip, add-to-calendar/share/print/copy, the mobile
 * deadline bar, URL-persisted filters, keyboard shortcuts, dark toggle, mobile
 * nav, and subscribe feedback. All enhancement — the page reads fine without JS. */
(function () {
  "use strict";

  // ── storage ──────────────────────────────────────────────
  function lsGet(k, def) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : def; } catch (e) { return def; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  var SAVED_KEY = "qellal-saved", RECENT_KEY = "qellal-recent", SEEN_KEY = "qellal-seen", DENSITY_KEY = "qellal-density";

  // ── date helpers ─────────────────────────────────────────
  var DATE_RE = /(\d{4}-\d{2}-\d{2})/;
  var dateFmt;
  try {
    dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  } catch (e) { dateFmt = null; }
  function formatDate(iso) { var d = new Date(iso); if (isNaN(d.getTime())) return iso; return dateFmt ? dateFmt.format(d) : iso; }
  function todayUTC() { var n = new Date(); return Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate()); }
  function dayNum(iso) { var d = new Date(iso); if (isNaN(d.getTime())) return null; return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); }
  function daysLeft(deadline) { if (!deadline) return null; var due = dayNum(deadline); if (due === null) return null; return Math.round((due - todayUTC()) / 86400000); }
  function deadlineFrom(text) { if (!text) return null; var i = text.indexOf("Deadline"); var s = i >= 0 ? text.slice(i) : text; var m = s.match(DATE_RE); return m ? m[1] : null; }
  function urgencyClass(d) { if (d === null) return ""; if (d < 0) return "is-closed"; if (d <= 3) return "is-urgent"; if (d <= 7) return "is-warn"; return ""; }

  // ── saved shortlist (localStorage) ───────────────────────
  function getSaved() { return lsGet(SAVED_KEY, []); }
  function isSaved(url) { return getSaved().some(function (x) { return x.url === url; }); }
  function toggleSaved(item) {
    var list = getSaved();
    var i = -1;
    for (var j = 0; j < list.length; j++) { if (list[j].url === item.url) { i = j; break; } }
    if (i >= 0) list.splice(i, 1); else list.unshift(item);
    lsSet(SAVED_KEY, list);
    syncSaved();
    return i < 0; // true if now saved
  }
  function removeSaved(url) { lsSet(SAVED_KEY, getSaved().filter(function (x) { return x.url !== url; })); syncSaved(); }

  function syncSaved() {
    var list = getSaved();
    var set = {};
    list.forEach(function (x) { set[x.url] = 1; });
    // card save buttons
    var btns = document.querySelectorAll(".card-save");
    for (var i = 0; i < btns.length; i++) btns[i].classList.toggle("is-saved", !!set[btns[i].getAttribute("data-url")]);
    // detail save button
    var dbtn = document.querySelector("[data-save-tender]");
    if (dbtn) {
      var on = !!set[dbtn.getAttribute("data-url")];
      dbtn.setAttribute("aria-pressed", on ? "true" : "false");
      dbtn.textContent = on ? "★ Saved" : "☆ Save tender";
    }
    // header count
    var count = document.querySelector("[data-saved-count]");
    var inline = document.querySelector("[data-saved-count-inline]");
    if (count) { count.textContent = list.length; count.hidden = list.length === 0; }
    if (inline) inline.textContent = list.length ? "(" + list.length + ")" : "";
    // drawer if open
    var drawer = document.querySelector("[data-saved-drawer]");
    if (drawer && drawer.classList.contains("show")) renderDrawer();
  }

  var STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 3 2.6 5.3 5.9.9-4.2 4.1 1 5.8L12 16.9 6.7 19.6l1-5.8L3.5 9.7l5.9-.9L12 3Z"></path></svg>';

  function addCardSave(card) {
    var li = card.parentNode;
    if (!li || li.tagName !== "LI") return;
    if (li.querySelector(".card-save")) return;
    var url = card.getAttribute("href");
    if (!url || url === "#") return;
    card.classList.add("has-save");
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "card-save";
    btn.setAttribute("data-url", url);
    btn.setAttribute("aria-label", "Save tender");
    btn.innerHTML = STAR;
    btn.addEventListener("click", function (e) {
      e.preventDefault(); e.stopPropagation();
      var titleEl = card.querySelector(".tender-card-title");
      toggleSaved({ url: url, title: titleEl ? titleEl.textContent.trim() : url, excerpt: card.getAttribute("data-excerpt") || "", ts: 0 });
    });
    li.appendChild(btn);
  }

  function openDrawer() {
    var d = document.querySelector("[data-saved-drawer]"), o = document.querySelector("[data-saved-overlay]");
    if (!d) return;
    renderDrawer();
    if (o) { o.hidden = false; requestAnimationFrame(function () { o.classList.add("show"); }); }
    d.classList.add("show"); d.setAttribute("aria-hidden", "false");
  }
  function closeDrawer() {
    var d = document.querySelector("[data-saved-drawer]"), o = document.querySelector("[data-saved-overlay]");
    if (d) { d.classList.remove("show"); d.setAttribute("aria-hidden", "true"); }
    if (o) { o.classList.remove("show"); setTimeout(function () { o.hidden = true; }, 220); }
  }
  function renderDrawer() {
    var body = document.querySelector("[data-saved-list]");
    if (!body) return;
    var list = getSaved();
    body.textContent = "";
    if (!list.length) {
      var e = document.createElement("p"); e.className = "saved-empty";
      e.textContent = "No saved tenders yet. Tap the ☆ on any tender to build your shortlist — it stays on this device.";
      body.appendChild(e); return;
    }
    list.forEach(function (x) {
      var d = daysLeft(deadlineFrom(x.excerpt));
      var item = document.createElement("div"); item.className = "saved-item";
      var a = document.createElement("a"); a.href = x.url; a.textContent = x.title; item.appendChild(a);
      var row = document.createElement("div"); row.className = "srow";
      var meta = document.createElement("span"); meta.className = "smeta";
      meta.textContent = d === null ? "No deadline" : d < 0 ? "Closed" : d === 0 ? "Closes today" : d + " days left";
      var rm = document.createElement("button"); rm.type = "button"; rm.className = "saved-remove"; rm.textContent = "Remove";
      rm.addEventListener("click", function () { removeSaved(x.url); });
      row.appendChild(meta); row.appendChild(rm); item.appendChild(row); body.appendChild(item);
    });
  }

  function initSavedChrome() {
    var toggle = document.querySelector("[data-saved-toggle]");
    if (toggle) { toggle.hidden = false; toggle.addEventListener("click", openDrawer); }
    var close = document.querySelector("[data-saved-close]");
    if (close) close.addEventListener("click", closeDrawer);
    var ov = document.querySelector("[data-saved-overlay]");
    if (ov) ov.addEventListener("click", closeDrawer);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDrawer(); });
  }

  // ── recently viewed + seen ───────────────────────────────
  function recordVisit(url, title, excerpt) {
    if (!url) return;
    var seen = lsGet(SEEN_KEY, []);
    if (seen.indexOf(url) < 0) { seen.unshift(url); lsSet(SEEN_KEY, seen.slice(0, 300)); }
    var recent = lsGet(RECENT_KEY, []).filter(function (x) { return x.url !== url; });
    recent.unshift({ url: url, title: title, excerpt: excerpt });
    lsSet(RECENT_KEY, recent.slice(0, 8));
  }
  function applySeen(cards) {
    var seen = lsGet(SEEN_KEY, []); if (!seen.length) return;
    var savedSet = {}; getSaved().forEach(function (x) { savedSet[x.url] = 1; });
    for (var i = 0; i < cards.length; i++) {
      var u = cards[i].getAttribute("href");
      if (seen.indexOf(u) >= 0 && !savedSet[u]) cards[i].classList.add("is-seen");
    }
  }
  function renderRecent() {
    var slot = document.querySelector("[data-recent-slot]");
    if (!slot) return;
    var recent = lsGet(RECENT_KEY, []);
    var here = location.pathname;
    recent = recent.filter(function (x) { return x.url.indexOf(here) < 0 || here === "/"; });
    if (recent.length < 2) return;
    var wrap = document.createElement("div"); wrap.className = "recent-strip";
    var h = document.createElement("h2"); h.textContent = "Recently viewed"; wrap.appendChild(h);
    var row = document.createElement("div"); row.className = "recent-row";
    recent.slice(0, 6).forEach(function (x) {
      var a = document.createElement("a"); a.className = "recent-card"; a.href = x.url; a.textContent = x.title; row.appendChild(a);
    });
    wrap.appendChild(row); slot.appendChild(wrap);
  }

  // ── urgency meter on a card ──────────────────────────────
  function addMeter(card, d) {
    if (card.querySelector(".urgency-meter")) return;
    var pub = card.getAttribute("data-published");
    var dl = deadlineFrom(card.getAttribute("data-excerpt"));
    if (d === null || !dl) return;
    var pubN = pub ? dayNum(pub) : null, dlN = dayNum(dl), tN = todayUTC();
    var frac;
    if (d < 0) frac = 0;
    else if (pubN !== null && dlN > pubN) frac = Math.max(0, Math.min(1, (dlN - tN) / (dlN - pubN)));
    else frac = Math.max(0, Math.min(1, d / 30));
    var m = document.createElement("div");
    m.className = "urgency-meter " + (d < 0 ? "u-closed" : d <= 3 ? "u-urgent" : d <= 7 ? "u-warn" : "");
    var s = document.createElement("span"); s.style.width = (d < 0 ? 100 : Math.round(frac * 100)) + "%";
    m.appendChild(s); card.appendChild(m);
  }

  // ── cards pass: badge + save + meter ─────────────────────
  function renderBadge(el, d) {
    if (d === null) return;
    el.hidden = false; el.classList.remove("is-urgent", "is-warn", "is-closed");
    if (d < 0) { el.textContent = "Closed"; el.classList.add("is-closed"); }
    else if (d === 0) { el.textContent = "Closes today"; el.classList.add("is-urgent"); }
    else { el.textContent = d + "d left"; if (d <= 3) el.classList.add("is-urgent"); else if (d <= 7) el.classList.add("is-warn"); }
  }
  function initCards() {
    var cards = document.querySelectorAll("[data-tender]");
    for (var i = 0; i < cards.length; i++) {
      var d = daysLeft(deadlineFrom(cards[i].getAttribute("data-excerpt")));
      var badge = cards[i].querySelector("[data-deadline-badge]");
      if (badge) renderBadge(badge, d);
      addMeter(cards[i], d);
      addCardSave(cards[i]);
    }
    applySeen(cards);
    syncSaved();
  }

  // ── closing-today alert strip ────────────────────────────
  function initClosingAlert() {
    var slot = document.querySelector("[data-closing-alert]");
    if (!slot) return;
    if (sessionStorage.getItem("qellal-alert-dismissed") === "1") return;
    var cards = document.querySelectorAll("[data-tender]");
    var today = 0, week = 0, firstUrgent = null;
    for (var i = 0; i < cards.length; i++) {
      var d = daysLeft(deadlineFrom(cards[i].getAttribute("data-excerpt")));
      if (d === null || d < 0) continue;
      if (d === 0) today++;
      if (d <= 7) { week++; if (!firstUrgent) firstUrgent = cards[i]; }
    }
    if (!week) return;
    var strip = document.createElement("div"); strip.className = "alert-strip no-print";
    var dot = document.createElement("span"); dot.className = "dot"; dot.setAttribute("aria-hidden", "true"); strip.appendChild(dot);
    var txt = document.createElement("span");
    txt.textContent = (today ? today + (today === 1 ? " tender closes" : " tenders close") + " today · " : "") + week + (week === 1 ? " closing" : " closing") + " within a week.";
    strip.appendChild(txt);
    if (firstUrgent) {
      var a = document.createElement("a"); a.href = "#"; a.textContent = "Jump to them →";
      a.addEventListener("click", function (e) { e.preventDefault(); firstUrgent.scrollIntoView({ behavior: "smooth", block: "center" }); firstUrgent.classList.add("kbd-active"); setTimeout(function () { firstUrgent.classList.remove("kbd-active"); }, 1600); });
      strip.appendChild(a);
    }
    var x = document.createElement("button"); x.type = "button"; x.className = "x"; x.setAttribute("aria-label", "Dismiss"); x.textContent = "✕";
    x.addEventListener("click", function () { strip.remove(); try { sessionStorage.setItem("qellal-alert-dismissed", "1"); } catch (e) {} });
    strip.appendChild(x);
    slot.appendChild(strip);
  }

  // ── list toolbar: sort / group / filter / density / URL ──
  function makeBand(cls, text) {
    var li = document.createElement("li"); li.className = "band" + (cls ? " " + cls : "");
    var span = document.createElement("span"); span.className = "band-label";
    var dot = document.createElement("span"); dot.className = "band-dot";
    span.appendChild(dot); span.appendChild(document.createTextNode(text)); li.appendChild(span); return li;
  }
  function initList() {
    var ul = document.querySelector("[data-tender-list]");
    if (!ul) return;
    var section = ul.closest ? ul.closest("[data-tender-page]") : null;
    var toolbar = document.querySelector("[data-list-toolbar]");
    var lis = [].slice.call(ul.children).filter(function (li) { return li.querySelector && li.querySelector(".tender-card"); });
    var items = lis.map(function (li) {
      var card = li.querySelector(".tender-card");
      var titleEl = card.querySelector(".tender-card-title");
      return { li: li, card: card, d: daysLeft(deadlineFrom(card.getAttribute("data-excerpt"))),
        primary: card.getAttribute("data-primary") || "", name: card.getAttribute("data-primary-name") || "",
        text: ((titleEl ? titleEl.textContent : "") + " " + (card.getAttribute("data-excerpt") || "")).toLowerCase() };
    });
    var original = items.slice();
    if (items.filter(function (x) { return x.d !== null; }).length < 2) return;
    if (toolbar) toolbar.hidden = false;

    var emptyEl = document.createElement("div"); emptyEl.className = "list-empty"; emptyEl.setAttribute("role", "status"); emptyEl.hidden = true;
    var emptyMsg = document.createElement("p"); emptyMsg.className = "list-empty-msg"; emptyMsg.textContent = "No tenders match these filters.";
    var emptyCta = document.createElement("button"); emptyCta.type = "button"; emptyCta.className = "btn btn-primary btn-sm list-empty-cta"; emptyCta.hidden = true;
    emptyCta.addEventListener("click", function () { if (state.q) location.href = "/tenders/?q=" + encodeURIComponent(state.q); });
    emptyEl.appendChild(emptyMsg); emptyEl.appendChild(emptyCta);
    ul.parentNode.insertBefore(emptyEl, ul.nextSibling);

    var state = { view: "grouped", hideClosed: false, cat: "", q: "", density: lsGet(DENSITY_KEY, "cards") };
    var groups = [
      { cls: "b-urgent", label: "Closing this week", test: function (d) { return d !== null && d >= 0 && d <= 7; } },
      { cls: "b-warn", label: "Closing this month", test: function (d) { return d !== null && d > 7 && d <= 30; } },
      { cls: "b-open", label: "Later", test: function (d) { return d !== null && d > 30; } },
      { cls: "", label: "No deadline", test: function (d) { return d === null; } },
      { cls: "", label: "Closed", test: function (d) { return d !== null && d < 0; } }
    ];
    function visible(x) {
      if (state.cat && x.primary !== state.cat) return false;
      if (state.q && x.text.indexOf(state.q) < 0) return false;
      if (state.hideClosed && x.d !== null && x.d < 0) return false;
      return true;
    }
    function applyDensity() { if (section) section.classList.toggle("is-compact", state.density === "compact"); }
    function apply() {
      [].slice.call(ul.querySelectorAll(".band")).forEach(function (b) { b.remove(); });
      var any = false;
      items.forEach(function (x) { var v = visible(x); x.card.classList.toggle("is-hidden", !v); if (v) any = true; });
      if (state.view === "newest") { original.forEach(function (x) { ul.appendChild(x.li); }); }
      else {
        groups.forEach(function (g) {
          var members = items.filter(function (x) { return g.test(x.d); });
          if (!members.length) return;
          if (members.some(visible)) ul.appendChild(makeBand(g.cls, g.label));
          if (g.label !== "No deadline") members.sort(function (a, b) { return a.d - b.d; });
          members.forEach(function (x) { ul.appendChild(x.li); });
        });
      }
      emptyEl.hidden = any;
      if (!any) {
        // The page-local filter only sees this page's cards; when it finds
        // nothing, offer to search ALL tenders (Meili) for the same query.
        var hasQ = !!state.q;
        emptyMsg.textContent = hasQ ? "No tenders on this page match “" + state.q + "”." : "No tenders match these filters.";
        emptyCta.hidden = !(hasQ && window.__openTenderSearch);
        if (!emptyCta.hidden) emptyCta.textContent = "Search all tenders for “" + state.q + "” →";
      }
      writeHash();
    }

    // URL hash <-> state
    function writeHash() {
      var p = [];
      if (state.view !== "grouped") p.push("view=" + state.view);
      if (state.density !== "cards") p.push("density=" + state.density);
      if (state.cat) p.push("cat=" + encodeURIComponent(state.cat));
      if (state.q) p.push("q=" + encodeURIComponent(state.q));
      if (state.hideClosed) p.push("closed=0");
      try { history.replaceState(null, "", location.pathname + location.search + (p.length ? "#" + p.join("&") : "")); } catch (e) {}
    }
    function readHash() {
      var h = location.hash.replace(/^#/, ""); if (!h) return;
      h.split("&").forEach(function (kv) {
        var i = kv.indexOf("="); if (i < 0) return;
        var k = kv.slice(0, i), v = decodeURIComponent(kv.slice(i + 1));
        if (k === "view" && (v === "newest" || v === "grouped")) state.view = v;
        else if (k === "density" && (v === "cards" || v === "compact")) state.density = v;
        else if (k === "cat") state.cat = v;
        else if (k === "q") state.q = v;
        else if (k === "closed" && v === "0") state.hideClosed = true;
      });
    }

    if (toolbar) {
      // On the /tenders channel (browse-wrap + Meili configured), the sort
      // buttons drive a GLOBAL Meili sort instead of a misleading page-local
      // re-order. Elsewhere (tag pages) they keep the client-side page sort.
      var canGlobalSort = !!(document.querySelector("[data-browse-wrap]") && window.QELLAL_SEARCH && window.QELLAL_SEARCH.host);
      var viewBtns = toolbar.querySelectorAll("[data-list-view]");
      [].forEach.call(viewBtns, function (b) {
        b.addEventListener("click", function () {
          if (canGlobalSort) {
            location.href = "/tenders/?sort=" + (b.getAttribute("data-list-view") === "newest" ? "newest" : "deadline");
            return;
          }
          state.view = b.getAttribute("data-list-view");
          [].forEach.call(viewBtns, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); });
          apply();
        });
      });
      var densBtns = toolbar.querySelectorAll("[data-list-density]");
      [].forEach.call(densBtns, function (b) { b.addEventListener("click", function () { state.density = b.getAttribute("data-list-density"); lsSet(DENSITY_KEY, state.density); [].forEach.call(densBtns, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); }); applyDensity(); writeHash(); }); });
      var chk = toolbar.querySelector("[data-hide-closed]");
      if (chk) chk.addEventListener("change", function () { state.hideClosed = chk.checked; apply(); });
      var textInput = toolbar.querySelector("[data-text-filter]");
      if (textInput) {
        textInput.addEventListener("input", function () { state.q = textInput.value.trim().toLowerCase(); apply(); });
        // Enter escalates the page-local filter to a full search across all tenders.
        textInput.addEventListener("keydown", function (e) {
          if (e.key === "Enter") { e.preventDefault(); var q = textInput.value.trim(); if (q) location.href = "/tenders/?q=" + encodeURIComponent(q); }
        });
      }
      var catSel = toolbar.querySelector("[data-cat-filter]"), catField = toolbar.querySelector("[data-cat-field]");
      if (catSel && catField) {
        var allCats = window.QELLAL_CATEGORIES || [];
        if (allCats.length) {
          // Full sector taxonomy → selecting one jumps to that sector's page
          // (server-paginated), so it works even for sectors not on this page.
          var slugToName = {};
          allCats.forEach(function (c) { slugToName[c.slug] = c.name; var o = document.createElement("option"); o.value = c.slug; o.textContent = c.name; catSel.appendChild(o); });
          applyFacetCounts(catSel, slugToName);
          var onTag = location.pathname.match(/^\/tag\/([^\/]+)\/?$/);
          if (onTag) catSel.value = onTag[1];
          catField.hidden = false;
          catSel.addEventListener("change", function () {
            location.href = catSel.value ? "/tag/" + catSel.value + "/" : "/tenders/";
          });
        } else {
          // Fallback (no category data): filter the current page from its cards.
          var cats = {}; items.forEach(function (x) { if (x.primary) cats[x.primary] = x.name || x.primary; });
          var keys = Object.keys(cats).sort(function (a, b) { return cats[a].localeCompare(cats[b]); });
          if (keys.length >= 2) {
            keys.forEach(function (k) { var o = document.createElement("option"); o.value = k; o.textContent = cats[k]; catSel.appendChild(o); });
            catField.hidden = false;
            catSel.addEventListener("change", function () { state.cat = catSel.value; apply(); });
          }
        }
      }

      // hydrate controls from URL
      readHash();
      function press(sel, val, attr) { var b = toolbar.querySelector(sel + '[' + attr + '="' + val + '"]'); if (b) { [].forEach.call(toolbar.querySelectorAll(sel), function (x) { x.setAttribute("aria-pressed", "false"); }); b.setAttribute("aria-pressed", "true"); } }
      press("[data-list-view]", state.view, "data-list-view");
      press("[data-list-density]", state.density, "data-list-density");
      if (chk) chk.checked = state.hideClosed;
      if (textInput && state.q) textInput.value = state.q;
      if (catSel && state.cat) catSel.value = state.cat;
    }

    applyDensity();
    apply();
  }

  // ── detail: countdown, facts, calendar, share, print ─────
  function extractFacts(content) {
    var facts = [], nodes = [];
    if (!content) return { facts: facts, nodes: nodes };
    var heads = content.querySelectorAll("h3"), ul = null;
    for (var i = 0; i < heads.length; i++) {
      if (/tender details/i.test(heads[i].textContent || "")) {
        var prev = heads[i].previousElementSibling;
        if (prev && prev.tagName === "HR") nodes.push(prev);
        nodes.push(heads[i]); ul = heads[i].nextElementSibling; break;
      }
    }
    if (ul && ul.tagName === "UL") {
      nodes.push(ul);
      var items = ul.querySelectorAll("li");
      for (var j = 0; j < items.length; j++) {
        var strong = items[j].querySelector("strong");
        var label = strong ? strong.textContent.replace(/:\s*$/, "") : "";
        var value = items[j].textContent.replace(label, "").replace(/^:\s*/, "").trim();
        if (label) facts.push({ label: label, value: value });
      }
    }
    return { facts: facts, nodes: nodes };
  }
  function stripAttribution(content) {
    if (!content) return;
    var links = content.querySelectorAll("a[href]");
    for (var i = 0; i < links.length; i++) {
      if (/view the original notice/i.test(links[i].textContent || "")) {
        var p = links[i].closest ? links[i].closest("p") : null;
        var node = p || links[i]; if (node.parentNode) node.parentNode.removeChild(node); return;
      }
    }
  }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function icsEscape(s) { return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
  function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "tender"; }
  function buildICS(title, deadline) {
    var s = new Date(deadline); var start = s.getUTCFullYear() + pad(s.getUTCMonth() + 1) + pad(s.getUTCDate());
    var e = new Date(deadline); e.setUTCDate(e.getUTCDate() + 1); var end = e.getUTCFullYear() + pad(e.getUTCMonth() + 1) + pad(e.getUTCDate());
    var now = new Date(); var stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + "T" + pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + "Z";
    return ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Qellal//Tender//EN", "CALSCALE:GREGORIAN", "BEGIN:VEVENT",
      "UID:qellal-" + start + "-" + slugify(title) + "@" + (location.hostname || "qellal"), "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + start, "DTEND;VALUE=DATE:" + end, "SUMMARY:" + icsEscape("Tender deadline — " + title),
      "DESCRIPTION:" + icsEscape("Deadline for: " + title + "\n" + location.href), "URL:" + location.href, "END:VEVENT", "END:VCALENDAR"].join("\r\n");
  }
  function copyText(t, toast) {
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(t).then(function () { if (toast) toast.textContent = "Copied to clipboard"; }).catch(function () { if (toast) toast.textContent = t; });
    else if (toast) toast.textContent = t;
  }

  function buildMobileBar(title, deadline, d) {
    if (d === null) return;
    var bar = document.createElement("div"); bar.className = "mobile-deadline-bar no-print";
    var left = document.createElement("div");
    var big = document.createElement("div"); big.className = "md-count " + urgencyClass(d);
    big.textContent = d < 0 ? "Closed" : d === 0 ? "Closes today" : "Closes in " + d + (d === 1 ? " day" : " days");
    var sub = document.createElement("div"); sub.className = "md-sub"; sub.textContent = d < 0 ? formatDate(deadline) : "closes " + formatDate(deadline);
    left.appendChild(big); left.appendChild(sub);
    var save = document.createElement("button"); save.type = "button"; save.className = "btn btn-invert btn-sm"; save.textContent = isSaved(location.href) ? "★ Saved" : "☆ Save";
    save.addEventListener("click", function () { var now = toggleSaved({ url: location.href, title: title, excerpt: (document.querySelector("[data-tender-detail]") || {}).getAttribute ? document.querySelector("[data-tender-detail]").getAttribute("data-excerpt") : "", ts: 0 }); save.textContent = now ? "★ Saved" : "☆ Save"; });
    bar.appendChild(left); bar.appendChild(save); document.body.appendChild(bar);
    requestAnimationFrame(function () { bar.classList.add("show"); });
  }

  function initDetail() {
    var root = document.querySelector("[data-tender-detail]");
    if (!root) return;
    var content = root.querySelector("[data-tender-content]");
    var deadline = deadlineFrom(root.getAttribute("data-excerpt"));
    var card = root.querySelector("[data-deadline-card]");
    var title = (card && card.getAttribute("data-title")) || (document.querySelector("h1") ? document.querySelector("h1").textContent.trim() : document.title);
    var d = deadline ? daysLeft(deadline) : null;

    if (card && d === null) card.hidden = true;
    if (card && d !== null) {
      var kicker = card.querySelector("[data-deadline-kicker]"), count = card.querySelector("[data-deadline-count]"), sub = card.querySelector("[data-deadline-sub]");
      var closed = d < 0; count.classList.remove("is-urgent", "is-warn", "is-closed");
      if (kicker) kicker.textContent = closed ? "Closed" : d === 0 ? "Closes today" : "Closes in";
      count.textContent = closed ? "—" : String(d);
      if (closed) count.classList.add("is-closed"); else if (d <= 3) count.classList.add("is-urgent"); else if (d <= 7) count.classList.add("is-warn");
      if (sub) sub.textContent = closed ? "Closed " + formatDate(deadline) : d === 0 ? "closes " + formatDate(deadline) : (d === 1 ? "day" : "days") + " · closes " + formatDate(deadline);
    }

    stripAttribution(content);
    var extracted = extractFacts(content);
    var dl = card && card.querySelector("[data-deadline-facts]");
    if (dl && extracted.facts.length) {
      // The publishing entity is also a hidden "entity-*" tag on the post; link
      // the fact to that tag page so a click lists all tenders from the company.
      var entityChip = root.querySelector('.detail-chips a[data-tag^="entity-"]');
      var entityHref = entityChip ? entityChip.getAttribute("href") : null;
      var any = false;
      for (var i = 0; i < extracted.facts.length; i++) {
        var f = extracted.facts[i]; if (/^deadline$/i.test(f.label)) continue;
        var row = document.createElement("div"); row.className = "row";
        var dt = document.createElement("dt"); dt.textContent = f.label;
        var dd = document.createElement("dd");
        if (entityHref && /publishing entity/i.test(f.label)) {
          var a = document.createElement("a");
          a.href = entityHref;
          a.textContent = f.value;
          a.title = "See all tenders from " + f.value;
          dd.appendChild(a);
        } else if (/website/i.test(f.label) && f.value) {
          var w = document.createElement("a");
          w.href = /^https?:\/\//i.test(f.value) ? f.value : "https://" + f.value;
          w.target = "_blank"; w.rel = "noopener nofollow"; w.textContent = f.value;
          dd.appendChild(w);
        } else if (/phone/i.test(f.label) && f.value) {
          var ph = document.createElement("a");
          ph.href = "tel:" + f.value.replace(/[^0-9+]/g, "");
          ph.textContent = f.value;
          dd.appendChild(ph);
        } else {
          dd.textContent = f.value;
        }
        row.appendChild(dt); row.appendChild(dd); dl.appendChild(row); any = true;
      }
      if (any) dl.hidden = false;
      extracted.nodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
    }

    // Documents card: 2merkato sometimes attaches downloadable files as a
    // separate "Documents" list in the body — lift them into their own card.
    var docSlot = root.querySelector("[data-documents-slot]");
    var docBody = root.querySelector("[data-documents-body]");
    if (docSlot && docBody && content) {
      var docHead = null, docList = null, heads2 = content.querySelectorAll("h3");
      for (var h = 0; h < heads2.length; h++) {
        if (/^\s*documents\s*$/i.test(heads2[h].textContent || "")) { docHead = heads2[h]; docList = heads2[h].nextElementSibling; break; }
      }
      if (docHead && docList && docList.tagName === "UL") {
        var links = docList.querySelectorAll("a[href]");
        if (links.length) {
          var dul = document.createElement("ul"); dul.className = "documents-list";
          for (var k = 0; k < links.length; k++) {
            var dli = document.createElement("li");
            var da = document.createElement("a");
            da.href = links[k].getAttribute("href"); da.target = "_blank"; da.rel = "noopener nofollow";
            da.textContent = (links[k].textContent || "Document").trim();
            dli.appendChild(da); dul.appendChild(dli);
          }
          docBody.appendChild(dul); docSlot.hidden = false;
          if (docHead.parentNode) docHead.parentNode.removeChild(docHead);
          if (docList.parentNode) docList.parentNode.removeChild(docList);
        }
      }
    }

    // actions
    var actions = root.querySelector("[data-detail-actions]");
    var toast = root.querySelector("[data-share-toast]");
    if (actions) {
      var cal = actions.querySelector("[data-add-calendar]");
      if (cal) { if (deadline) { cal.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(buildICS(title, deadline)); cal.setAttribute("download", slugify(title) + ".ics"); } else cal.remove(); }
      var share = actions.querySelector("[data-share]");
      if (share) share.addEventListener("click", function () { if (navigator.share) navigator.share({ title: title, url: location.href }).catch(function () {}); else copyText(location.href, toast); });
      var saveBtn = actions.querySelector("[data-save-tender]");
      if (saveBtn) {
        saveBtn.setAttribute("data-url", location.href);
        saveBtn.addEventListener("click", function () { toggleSaved({ url: location.href, title: title, excerpt: root.getAttribute("data-excerpt") || "", ts: 0 }); });
      }
      var copyBtn = actions.querySelector("[data-copy-facts]");
      if (copyBtn) copyBtn.addEventListener("click", function () {
        var lines = [title]; if (deadline) lines.push("Deadline: " + formatDate(deadline) + (d !== null && d >= 0 ? " (" + d + " days left)" : ""));
        extracted.facts.forEach(function (f) { if (!/^deadline$/i.test(f.label)) lines.push(f.label + ": " + f.value); });
        lines.push(location.href); copyText(lines.join("\n"), toast);
      });
      var printBtn = actions.querySelector("[data-print]");
      if (printBtn) printBtn.addEventListener("click", function () { window.print(); });
      actions.hidden = false;
    }

    buildMobileBar(title, deadline, d);
    recordVisit(location.href, title, root.getAttribute("data-excerpt") || "");
    syncSaved();
  }

  // ── keyboard shortcuts ───────────────────────────────────
  function initKeyboard() {
    var active = -1;
    function cards() { return [].slice.call(document.querySelectorAll(".tender-card:not(.is-hidden)")); }
    function focusCard(i) {
      var list = cards(); if (!list.length) return;
      active = Math.max(0, Math.min(list.length - 1, i));
      list.forEach(function (c, k) { c.classList.toggle("kbd-active", k === active); });
      list[active].scrollIntoView({ block: "center", behavior: "smooth" });
    }
    document.addEventListener("keydown", function (e) {
      var t = e.target;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.key === "/") {
        var sp = document.querySelector("[data-sp-input]");
        var tf = document.querySelector("[data-text-filter]");
        if (sp && sp.offsetParent !== null) { e.preventDefault(); sp.focus(); }
        else if (tf && tf.offsetParent !== null) { e.preventDefault(); tf.focus(); }
        else { var s = document.querySelector("[data-tender-search]"); if (s) { e.preventDefault(); s.click(); } }
      } else if (e.key === "j") { e.preventDefault(); focusCard(active + 1); }
      else if (e.key === "k") { e.preventDefault(); focusCard(active - 1); }
      else if (e.key === "Enter" && active >= 0) { var l = cards(); if (l[active]) l[active].click(); }
      else if (e.key === "s" && active >= 0) { var c = cards()[active]; if (c) { var b = c.parentNode.querySelector(".card-save"); if (b) b.click(); } }
    });
  }

  // ── theme toggle / nav / subscribe ───────────────────────
  function initThemeToggle() {
    var root = document.documentElement, btn = document.querySelector("[data-theme-toggle]");
    if (!btn) return;
    var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    function current() { var dt = root.getAttribute("data-theme"); if (dt) return dt; if (root.classList.contains("scheme-dark")) return "dark"; if (root.classList.contains("scheme-auto")) return mq && mq.matches ? "dark" : "light"; return "light"; }
    btn.addEventListener("click", function () { var n = current() === "dark" ? "light" : "dark"; root.setAttribute("data-theme", n); try { localStorage.setItem("qellal-theme", n); } catch (e) {} });
  }
  function initNav() {
    var btn = document.querySelector(".nav-toggle"), nav = document.getElementById("site-nav");
    if (!btn || !nav) return;
    function setOpen(o) { nav.classList.toggle("is-open", o); btn.setAttribute("aria-expanded", o ? "true" : "false"); }
    btn.addEventListener("click", function () { setOpen(!nav.classList.contains("is-open")); });
    nav.addEventListener("click", function (e) { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });
  }
  function initSubscribe() {
    var forms = document.querySelectorAll("[data-members-form]");
    for (var i = 0; i < forms.length; i++) (function (form) {
      var section = form.closest ? form.closest("[data-subscribe]") : null;
      var note = section ? section.querySelector("[data-subscribe-note]") : null;
      form.addEventListener("submit", function () { if (note) { note.textContent = "Check your inbox to confirm your subscription."; note.className = "subscribe-note ok"; } });
    })(forms[i]);
  }

  // ── Meilisearch tender search ────────────────────────────
  function initSearch() {
    var cfg = window.QELLAL_SEARCH || {};
    var openers = document.querySelectorAll("[data-tender-search]");
    var modal = document.querySelector("[data-search-modal]");
    if (!openers.length || !modal) return;
    // Without a configured Meili endpoint, hide the search affordance entirely.
    if (!cfg.host || !cfg.key || !cfg.index) {
      for (var o = 0; o < openers.length; o++) openers[o].hidden = true;
      return;
    }
    var input = modal.querySelector("[data-search-input]");
    var results = modal.querySelector("[data-search-results]");
    var meta = modal.querySelector("[data-search-meta]");
    var overlay = modal.querySelector("[data-search-overlay]");
    var panel = modal.querySelector(".search-panel");
    var allLink = modal.querySelector("[data-search-all]");
    var endpoint = cfg.host.replace(/\/+$/, "") + "/indexes/" + cfg.index + "/search";
    var PAGE = 12;
    // Sentinel highlight tags: Meili does NOT escape surrounding text, so we ask
    // for control-char markers, HTML-escape the whole string, then swap the
    // markers for <mark> — highlighting without an XSS hole on scraped titles.
    var HL_PRE = "\u0001", HL_POST = "\u0002";
    var timer = null, seq = 0, active = -1;
    var curQ = "", offset = 0, total = 0, rendered = 0, loading = false;

    function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function hl(s) { return esc(s).split(HL_PRE).join("<mark>").split(HL_POST).join("</mark>"); }

    function open() {
      modal.hidden = false;
      modal.setAttribute("aria-hidden", "false");
      input.setAttribute("aria-expanded", "true");
      document.body.style.overflow = "hidden";
      setTimeout(function () { input.focus(); input.select(); }, 20);
      if (input.value.trim()) newSearch(input.value); else { results.innerHTML = ""; setMeta(); }
    }
    function close() {
      modal.hidden = true;
      modal.setAttribute("aria-hidden", "true");
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      document.body.style.overflow = "";
    }
    function badge(d) {
      if (d === null) return "";
      if (d < 0) return '<span class="badge is-closed">Closed</span>';
      if (d === 0) return '<span class="badge is-urgent">Closes today</span>';
      var cls = d <= 3 ? "is-urgent" : d <= 7 ? "is-warn" : "";
      return '<span class="badge ' + cls + '">' + d + "d left</span>";
    }
    function setActive(i) {
      var items = results.querySelectorAll(".search-hit");
      if (!items.length) { active = -1; input.removeAttribute("aria-activedescendant"); return; }
      active = i;
      for (var k = 0; k < items.length; k++) {
        var on = k === active;
        items[k].classList.toggle("is-active", on);
        items[k].setAttribute("aria-selected", on ? "true" : "false");
      }
      if (active >= 0) { input.setAttribute("aria-activedescendant", items[active].id); items[active].scrollIntoView({ block: "nearest" }); }
      else input.removeAttribute("aria-activedescendant");
    }
    function hitEl(h, i) {
      var f = h._formatted || {};
      var a = document.createElement("a");
      a.className = "search-hit";
      a.id = "search-hit-" + i;
      a.href = h.url || "#";
      a.setAttribute("role", "option");
      a.setAttribute("aria-selected", "false");
      var d = daysLeft(h.deadline);
      var title = document.createElement("span");
      title.className = "search-hit-title";
      title.innerHTML = hl(f.title || h.title || "Untitled tender");
      var m = document.createElement("span");
      m.className = "search-hit-meta";
      m.innerHTML = hl(f.publishing_entity || h.publishing_entity || "");
      var b = document.createElement("span");
      b.className = "search-hit-badge";
      b.innerHTML = badge(d);
      a.appendChild(title); a.appendChild(m); a.appendChild(b);
      // Only show a description snippet when the match is actually in the body.
      var snip = f.description || "";
      if (snip && snip.indexOf(HL_PRE) >= 0) {
        var sn = document.createElement("span");
        sn.className = "search-hit-snippet";
        sn.innerHTML = "…" + hl(snip) + "…";
        a.appendChild(sn);
      }
      return a;
    }
    function removeMore() { var mb = results.querySelector(".search-more"); if (mb) mb.remove(); }
    function addMore() {
      removeMore();
      if (rendered < total) {
        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "search-more";
        btn.textContent = "Show more (" + (total - rendered).toLocaleString() + " more)";
        btn.addEventListener("click", function () { fetchPage(true); });
        results.appendChild(btn);
      }
    }
    function setMeta() {
      if (meta) meta.textContent = curQ && total ? (total.toLocaleString() + " match" + (total === 1 ? "" : "es")) : "";
      if (allLink) {
        if (curQ && total) { allLink.href = "/tenders/?q=" + encodeURIComponent(curQ); allLink.hidden = false; }
        else allLink.hidden = true;
      }
    }
    function newSearch(q) {
      curQ = q.trim(); offset = 0; rendered = 0; total = 0; active = -1;
      results.innerHTML = "";
      if (!curQ) { setMeta(); return; }
      fetchPage(false);
    }
    function fetchPage(append) {
      if (loading) return;
      loading = true;
      var my = ++seq;
      removeMore();
      fetch(endpoint, {
        method: "POST",
        headers: { Authorization: "Bearer " + cfg.key, "Content-Type": "application/json" },
        body: JSON.stringify({
          q: curQ,
          limit: PAGE,
          offset: offset,
          // Break relevance ties in favour of still-open tenders.
          sort: ["open_rank:asc"],
          attributesToRetrieve: ["id", "url", "title", "publishing_entity", "deadline"],
          attributesToHighlight: ["title", "publishing_entity", "description"],
          attributesToCrop: ["description"],
          cropLength: 24,
          highlightPreTag: HL_PRE,
          highlightPostTag: HL_POST,
        }),
      })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          loading = false;
          if (my !== seq) return; // a newer query superseded this one
          var hits = data.hits || [];
          total = data.estimatedTotalHits != null ? data.estimatedTotalHits : (offset + hits.length);
          if (!append) results.innerHTML = "";
          for (var i = 0; i < hits.length; i++) results.appendChild(hitEl(hits[i], rendered + i));
          rendered += hits.length;
          offset += hits.length;
          if (rendered === 0) {
            results.innerHTML = '<p class="search-empty">No tenders match “' + esc(curQ) + '”.</p>';
          } else {
            addMore();
          }
          setMeta();
        })
        .catch(function () {
          loading = false;
          if (my !== seq) return;
          results.innerHTML = '<p class="search-empty">Search is unavailable right now.</p>';
        });
    }
    function onType() {
      var q = input.value.trim();
      if (timer) clearTimeout(timer);
      if (!q) { curQ = ""; total = 0; rendered = 0; results.innerHTML = ""; setMeta(); return; }
      timer = setTimeout(function () { newSearch(q); }, 180);
    }
    function move(delta) {
      var items = results.querySelectorAll(".search-hit");
      if (!items.length) return;
      var next = active < 0 ? (delta > 0 ? 0 : items.length - 1) : (active + delta + items.length) % items.length;
      setActive(next);
    }

    // Let other widgets (e.g. the list toolbar's empty state) open the global
    // search pre-filled with a query — bridging the page-local filter to Meili.
    window.__openTenderSearch = function (q) { if (typeof q === "string" && q) input.value = q; open(); };

    for (var k = 0; k < openers.length; k++) openers[k].addEventListener("click", open);
    if (overlay) overlay.addEventListener("click", close);
    input.addEventListener("input", onType);
    document.addEventListener("keydown", function (e) {
      if (modal.hidden) return;
      if (e.key === "Escape") { close(); return; }
      if (e.key === "ArrowDown") { e.preventDefault(); move(1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); move(-1); }
      else if (e.key === "Enter") {
        // Enter opens the highlighted result, or the first one if none is.
        var items = results.querySelectorAll(".search-hit");
        if (!items.length) return;
        var idx = active >= 0 ? active : 0;
        if (items[idx]) window.location.href = items[idx].href;
      }
    });
    // Keep keyboard focus inside the dialog while it's open (focus trap).
    document.addEventListener("focusin", function (e) {
      if (modal.hidden) return;
      if (panel && !panel.contains(e.target)) input.focus();
    });
    // Cmd/Ctrl-K global shortcut.
    document.addEventListener("keydown", function (e) {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); open(); }
    });
  }

  // ── category facet counts (shared by browse + search dropdowns) ──────────
  // One Meili query returns the tender count per category; we cache the promise
  // and decorate each dropdown option's label with its "(1,904)" count.
  var _facetCache = {};
  function facetCounts(field) {
    if (_facetCache[field]) return _facetCache[field];
    var cfg = window.QELLAL_SEARCH || {};
    if (!cfg.host || !cfg.key || !cfg.index) { _facetCache[field] = Promise.resolve({}); return _facetCache[field]; }
    var ep = cfg.host.replace(/\/+$/, "") + "/indexes/" + cfg.index + "/search";
    _facetCache[field] = fetch(ep, { method: "POST", headers: { Authorization: "Bearer " + cfg.key, "Content-Type": "application/json" }, body: JSON.stringify({ q: "", limit: 0, facets: [field] }) })
      .then(function (r) { return r.json(); })
      .then(function (d) { return (d.facetDistribution && d.facetDistribution[field]) || {}; })
      .catch(function () { return {}; });
    return _facetCache[field];
  }
  function applyFacetCounts(select, slugToName) {
    if (!select) return;
    facetCounts("categories").then(function (counts) {
      var opts = select.options;
      for (var i = 0; i < opts.length; i++) {
        var slug = opts[i].value; if (!slug) continue;
        var name = slugToName[slug]; if (!name) continue;
        var c = counts[name];
        if (c != null) opts[i].textContent = name + " (" + c.toLocaleString() + ")";
      }
    });
  }
  // Region isn't in the static category list — build its dropdown from the live
  // region facet (biggest first, with counts), then re-apply any URL selection.
  function populateRegions(select, preselect) {
    if (!select) return;
    facetCounts("region").then(function (counts) {
      var entries = Object.keys(counts).map(function (k) { return [k, counts[k]]; }).sort(function (a, b) { return b[1] - a[1]; });
      var total = entries.reduce(function (s, e) { return s + e[1]; }, 0);
      // Region is populated for only a tiny fraction of tenders today, so a
      // dropdown would mislead. Hide it unless coverage is meaningful — it will
      // appear automatically once enough scraped tenders carry a region.
      if (entries.length < 4 || total < 100) {
        var field = select.closest ? select.closest(".toolbar-field") : null;
        if (field) field.style.display = "none";
        return;
      }
      entries.forEach(function (e) { var o = document.createElement("option"); o.value = e[0]; o.textContent = e[0] + " (" + e[1].toLocaleString() + ")"; select.appendChild(o); });
      if (preselect) select.value = preselect;
    });
  }

  // ── full-page tender search (/search/) ───────────────────
  function initSearchPage() {
    var root = document.querySelector("[data-search-page]");
    if (!root) return;
    var cfg = window.QELLAL_SEARCH || {};
    var form = root.querySelector("[data-sp-form]");
    var input = root.querySelector("[data-sp-input]");
    var catSel = root.querySelector("[data-sp-cat]");
    var regionSel = root.querySelector("[data-sp-region]");
    var sortSel = root.querySelector("[data-sp-sort]");
    var deadlineSel = root.querySelector("[data-sp-deadline]");
    var hideClosed = root.querySelector("[data-sp-hideclosed]");
    var resultsUl = root.querySelector("[data-sp-results]");
    var emptyEl = root.querySelector("[data-sp-empty]");
    var moreWrap = root.querySelector("[data-sp-more]");
    var metaEl = root.querySelector("[data-sp-meta]");
    // On the /tenders channel the search shares the page with a browse list:
    // typing switches to search mode, clearing returns to browse.
    var browseWrap = root.querySelector("[data-browse-wrap]");
    var searchWrap = root.querySelector("[data-search-wrap]");
    if (!input || !resultsUl) return;
    if (!cfg.host || !cfg.key || !cfg.index) {
      if (metaEl) metaEl.textContent = "Search is not configured.";
      if (form) form.hidden = true;
      return;
    }
    // With a prominent global search box present, hide the browse toolbar's
    // page-local "Filter this page…" input so there aren't two search fields.
    if (browseWrap) { var _tf = browseWrap.querySelector("[data-text-filter]"); if (_tf) _tf.style.display = "none"; }
    function setMode(searching) {
      if (searchWrap) searchWrap.hidden = !searching;
      if (browseWrap) browseWrap.hidden = searching;
    }
    var endpoint = cfg.host.replace(/\/+$/, "") + "/indexes/" + cfg.index + "/search";
    var PAGE = 20;
    var HL_PRE = "\u0001", HL_POST = "\u0002";
    var seq = 0, offset = 0, total = 0, rendered = 0, loading = false, curQ = "", curRegion = "";

    function esc(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }
    function hl(s) { return esc(s).split(HL_PRE).join("<mark>").split(HL_POST).join("</mark>"); }

    var cats = window.QELLAL_CATEGORIES || [], slugToName = {};
    if (catSel && cats.length) {
      cats.forEach(function (c) { slugToName[c.slug] = c.name; var o = document.createElement("option"); o.value = c.slug; o.textContent = c.name; catSel.appendChild(o); });
      applyFacetCounts(catSel, slugToName);
    }

    function readURL() {
      var p = new URLSearchParams(location.search);
      curQ = p.get("q") || "";
      input.value = curQ;
      if (catSel && p.get("cat")) catSel.value = p.get("cat");
      curRegion = p.get("region") || "";
      if (sortSel && p.get("sort")) sortSel.value = p.get("sort");
      if (deadlineSel && p.get("deadline")) deadlineSel.value = p.get("deadline");
      if (hideClosed && p.get("closed") === "0") hideClosed.checked = true;
    }
    function writeURL() {
      var p = new URLSearchParams();
      if (curQ) p.set("q", curQ);
      if (sortSel && sortSel.value && sortSel.value !== "relevance") p.set("sort", sortSel.value);
      if (catSel && catSel.value) p.set("cat", catSel.value);
      if (curRegion) p.set("region", curRegion);
      if (deadlineSel && deadlineSel.value) p.set("deadline", deadlineSel.value);
      if (hideClosed && hideClosed.checked) p.set("closed", "0");
      var qs = p.toString();
      try { history.replaceState(null, "", location.pathname + (qs ? "?" + qs : "") + (location.hash || "")); } catch (e) {}
    }
    // Sort: "newest" = most recently published; "deadline" = closing soonest
    // (open tenders first, then soonest); default "relevance" keeps open first.
    function sortValue() {
      var s = sortSel ? sortSel.value : "relevance";
      if (s === "newest") return ["published_ts:desc"];
      if (s === "deadline") return ["open_rank:asc", "deadline_ts:asc"];
      return ["open_rank:asc"];
    }
    function buildFilter() {
      var f = [];
      if (catSel && catSel.value && slugToName[catSel.value]) f.push('categories = "' + slugToName[catSel.value].replace(/"/g, '\\"') + '"');
      if (curRegion) f.push('region = "' + curRegion.replace(/"/g, '\\"') + '"');
      if (hideClosed && hideClosed.checked) f.push("open_rank = 0");
      if (deadlineSel && deadlineSel.value) {
        var days = parseInt(deadlineSel.value, 10);
        if (days > 0) { var t0 = Math.floor(todayUTC() / 1000); f.push("deadline_ts >= " + t0); f.push("deadline_ts <= " + (t0 + days * 86400)); }
      }
      return f.length ? f.join(" AND ") : undefined;
    }
    // "Active" = anything beyond the pristine landing: a query, a non-default
    // sort, or any filter. Drives whether we show Meili results or the browse list.
    function active() {
      return !!((curQ) || (sortSel && sortSel.value && sortSel.value !== "relevance") ||
        (catSel && catSel.value) || curRegion || (deadlineSel && deadlineSel.value) || (hideClosed && hideClosed.checked));
    }
    function cardEl(h) {
      var f = h._formatted || {};
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.className = "tender-card"; a.href = h.url || "#"; a.setAttribute("data-tender", "");
      var dl = h.deadline || "";
      a.setAttribute("data-excerpt", dl ? "Deadline " + dl : "");
      var pub = h.published_ts ? new Date(h.published_ts * 1000) : null;
      if (pub) { var ymd = pub.getUTCFullYear() + "-" + pad(pub.getUTCMonth() + 1) + "-" + pad(pub.getUTCDate()); a.setAttribute("data-published", ymd); }
      var top = document.createElement("div"); top.className = "tender-card-top";
      var title = document.createElement("h2"); title.className = "tender-card-title"; title.innerHTML = hl(f.title || h.title || "Untitled tender");
      var badge = document.createElement("span"); badge.className = "badge is-closed"; badge.setAttribute("data-deadline-badge", ""); badge.hidden = true; badge.textContent = "—";
      top.appendChild(title); top.appendChild(badge); a.appendChild(top);
      var parts = [];
      var buyer = f.publishing_entity || h.publishing_entity || "";
      if (buyer) parts.push(hl(buyer));
      var snip = f.description || "";
      if (snip && snip.indexOf(HL_PRE) >= 0) parts.push("…" + hl(snip) + "…");
      if (parts.length) { var mp = document.createElement("p"); mp.className = "tender-card-meta"; mp.innerHTML = parts.join(" — "); a.appendChild(mp); }
      var foot = document.createElement("div"); foot.className = "tender-card-foot";
      var left = document.createElement("span");
      var cat0 = (h.categories && h.categories[0]) || "";
      left.innerHTML = (cat0 ? '<span class="chip">' + esc(cat0) + "</span> " : "") + "Published <span class=\"em\">" + (pub ? esc(formatDate(pub.toISOString())) : "—") + "</span>";
      var right = document.createElement("span"); right.textContent = "Source: 2merkato";
      foot.appendChild(left); foot.appendChild(right); a.appendChild(foot);
      li.appendChild(a);
      var d = daysLeft(h.deadline);
      renderBadge(badge, d);
      addMeter(a, d);
      addCardSave(a);
      return li;
    }
    function renderMeta() {
      if (!metaEl) return;
      if (!active()) { metaEl.textContent = ""; return; }
      var noun = total.toLocaleString() + " tender" + (total === 1 ? "" : "s");
      if (rendered === 0) metaEl.textContent = "No matches.";
      else if (curQ) metaEl.textContent = noun + " match “" + curQ + "”.";
      else metaEl.textContent = noun + ".";
    }
    function renderMore() {
      moreWrap.innerHTML = "";
      if (rendered < total) {
        var b = document.createElement("button"); b.type = "button"; b.className = "btn";
        b.textContent = "Show more (" + (total - rendered).toLocaleString() + " more)";
        b.addEventListener("click", function () { fetchPage(true); });
        moreWrap.appendChild(b);
      }
    }
    function fetchPage(append) {
      if (loading) return; loading = true;
      var my = ++seq;
      var body = {
        q: curQ, limit: PAGE, offset: offset, sort: sortValue(),
        attributesToRetrieve: ["id", "url", "title", "publishing_entity", "categories", "deadline", "published_ts"],
        attributesToHighlight: ["title", "publishing_entity", "description"],
        attributesToCrop: ["description"], cropLength: 30,
        highlightPreTag: HL_PRE, highlightPostTag: HL_POST,
      };
      var filt = buildFilter(); if (filt) body.filter = filt;
      fetch(endpoint, { method: "POST", headers: { Authorization: "Bearer " + cfg.key, "Content-Type": "application/json" }, body: JSON.stringify(body) })
        .then(function (r) { return r.json(); })
        .then(function (data) {
          loading = false; if (my !== seq) return;
          var hits = data.hits || [];
          total = data.estimatedTotalHits != null ? data.estimatedTotalHits : (offset + hits.length);
          if (!append) resultsUl.innerHTML = "";
          for (var i = 0; i < hits.length; i++) resultsUl.appendChild(cardEl(hits[i]));
          rendered += hits.length; offset += hits.length;
          emptyEl.hidden = !(curQ && rendered === 0);
          if (curQ && rendered === 0) emptyEl.textContent = "No tenders match “" + curQ + "”. Try fewer or different words.";
          syncSaved(); renderMeta(); renderMore();
        })
        .catch(function () { loading = false; if (my !== seq) return; if (metaEl) metaEl.textContent = "Search is unavailable right now."; });
    }
    function newSearch() {
      curQ = input.value.trim(); offset = 0; rendered = 0; total = 0;
      resultsUl.innerHTML = ""; moreWrap.innerHTML = ""; emptyEl.hidden = true;
      writeURL();
      var on = active();
      setMode(on);
      renderSS();
      if (!on) { renderMeta(); return; }
      fetchPage(false);
    }

    // ── saved searches (localStorage, shares the saved-tenders idea) ──────
    var SS_KEY = "qellal-saved-searches";
    function currentParams() {
      var p = {};
      if (curQ) p.q = curQ;
      if (sortSel && sortSel.value && sortSel.value !== "relevance") p.sort = sortSel.value;
      if (catSel && catSel.value) p.cat = catSel.value;
      if (curRegion) p.region = curRegion;
      if (deadlineSel && deadlineSel.value) p.deadline = deadlineSel.value;
      if (hideClosed && hideClosed.checked) p.closed = "0";
      return p;
    }
    function labelFor(p) {
      var b = [];
      if (p.q) b.push('"' + p.q + '"');
      if (p.cat && slugToName[p.cat]) b.push(slugToName[p.cat]);
      if (p.region) b.push(p.region);
      if (p.deadline) b.push("≤" + p.deadline + "d");
      if (p.sort === "deadline") b.push("closing soon"); else if (p.sort === "newest") b.push("newest");
      if (p.closed) b.push("open only");
      return b.join(" · ") || "All tenders";
    }
    function applyParams(p) {
      input.value = p.q || "";
      if (sortSel) sortSel.value = p.sort || "relevance";
      if (catSel) catSel.value = p.cat || "";
      curRegion = p.region || ""; if (regionSel) regionSel.value = curRegion;
      if (deadlineSel) deadlineSel.value = p.deadline || "";
      if (hideClosed) hideClosed.checked = p.closed === "0";
      newSearch();
    }
    var ssBar = document.createElement("div"); ssBar.className = "saved-searches"; ssBar.setAttribute("data-saved-searches", "");
    if (form && form.parentNode) form.parentNode.insertBefore(ssBar, form.nextSibling);
    function renderSS() {
      ssBar.innerHTML = "";
      loadSSList().forEach(function (item, idx) {
        var chip = document.createElement("span"); chip.className = "ss-chip";
        var go = document.createElement("button"); go.type = "button"; go.className = "ss-apply"; go.textContent = item.label;
        go.addEventListener("click", function () { applyParams(item.params); });
        var rm = document.createElement("button"); rm.type = "button"; rm.className = "ss-remove"; rm.setAttribute("aria-label", "Remove saved search"); rm.textContent = "×";
        rm.addEventListener("click", function () { var l = loadSSList(); l.splice(idx, 1); lsSet(SS_KEY, l); renderSS(); });
        chip.appendChild(go); chip.appendChild(rm); ssBar.appendChild(chip);
      });
      if (active()) {
        var p = currentParams();
        var dup = loadSSList().some(function (s) { return JSON.stringify(s.params) === JSON.stringify(p); });
        if (!dup) {
          var save = document.createElement("button"); save.type = "button"; save.className = "ss-save"; save.textContent = "☆ Save this search";
          save.addEventListener("click", function () { var l = loadSSList(); l.unshift({ label: labelFor(p), params: p }); lsSet(SS_KEY, l.slice(0, 20)); renderSS(); });
          ssBar.appendChild(save);
        }
        // Email/Telegram alerts for this search — members only.
        if (window.QELLAL_MEMBER) {
          var bell = document.createElement("button"); bell.type = "button"; bell.className = "ss-save ss-alert"; bell.textContent = "🔔 Get alerts";
          bell.addEventListener("click", function () {
            var crit = currentParams();
            if (crit.cat && slugToName[crit.cat]) crit.catName = slugToName[crit.cat];
            bell.disabled = true; bell.textContent = "Saving…";
            fetch("/ghost/alerts/api/subscriptions", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin",
              body: JSON.stringify({ label: labelFor(p), criteria: crit, channels: { email: true, telegram: true } }) })
              .then(function (r) { return r.ok ? r.json() : Promise.reject(); })
              .then(function () { bell.textContent = "✓ Alert saved — manage on /my-alerts"; })
              .catch(function () { bell.disabled = false; bell.textContent = "🔔 Get alerts"; alert("Could not save the alert. Please try again."); });
          });
          ssBar.appendChild(bell);
        } else {
          var signin = document.createElement("a"); signin.className = "ss-save ss-alert"; signin.href = "#/portal/signin"; signin.setAttribute("data-portal", "signin"); signin.textContent = "🔔 Sign in to get alerts";
          ssBar.appendChild(signin);
        }
      }
    }
    function loadSSList() { return lsGet(SS_KEY, []); }

    form.addEventListener("submit", function (e) { e.preventDefault(); newSearch(); });
    if (catSel) catSel.addEventListener("change", newSearch);
    if (regionSel) regionSel.addEventListener("change", function () { curRegion = regionSel.value; newSearch(); });
    if (sortSel) sortSel.addEventListener("change", newSearch);
    if (deadlineSel) deadlineSel.addEventListener("change", newSearch);
    if (hideClosed) hideClosed.addEventListener("change", newSearch);
    var t; input.addEventListener("input", function () { clearTimeout(t); t = setTimeout(newSearch, 250); });

    readURL();
    populateRegions(regionSel, curRegion);
    var on0 = active();
    setMode(on0);
    renderSS();
    if (on0) fetchPage(false); else { renderMeta(); if (!browseWrap) input.focus(); }
  }

  function init() {
    initSearch();
    initSearchPage();
    initSavedChrome();
    initCards();
    initClosingAlert();
    renderRecent();
    initList();
    initDetail();
    initKeyboard();
    initThemeToggle();
    initNav();
    initSubscribe();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
