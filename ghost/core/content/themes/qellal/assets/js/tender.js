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

    var emptyEl = document.createElement("p"); emptyEl.className = "list-empty"; emptyEl.setAttribute("role", "status");
    emptyEl.textContent = "No tenders match these filters."; emptyEl.hidden = true;
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
      var viewBtns = toolbar.querySelectorAll("[data-list-view]");
      [].forEach.call(viewBtns, function (b) { b.addEventListener("click", function () { state.view = b.getAttribute("data-list-view"); [].forEach.call(viewBtns, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); }); apply(); }); });
      var densBtns = toolbar.querySelectorAll("[data-list-density]");
      [].forEach.call(densBtns, function (b) { b.addEventListener("click", function () { state.density = b.getAttribute("data-list-density"); lsSet(DENSITY_KEY, state.density); [].forEach.call(densBtns, function (x) { x.setAttribute("aria-pressed", x === b ? "true" : "false"); }); applyDensity(); writeHash(); }); });
      var chk = toolbar.querySelector("[data-hide-closed]");
      if (chk) chk.addEventListener("change", function () { state.hideClosed = chk.checked; apply(); });
      var textInput = toolbar.querySelector("[data-text-filter]");
      if (textInput) textInput.addEventListener("input", function () { state.q = textInput.value.trim().toLowerCase(); apply(); });
      var catSel = toolbar.querySelector("[data-cat-filter]"), catField = toolbar.querySelector("[data-cat-field]");
      if (catSel && catField) {
        var cats = {}; items.forEach(function (x) { if (x.primary) cats[x.primary] = x.name || x.primary; });
        var keys = Object.keys(cats).sort(function (a, b) { return cats[a].localeCompare(cats[b]); });
        if (keys.length >= 2) {
          keys.forEach(function (k) { var o = document.createElement("option"); o.value = k; o.textContent = cats[k]; catSel.appendChild(o); });
          catField.hidden = false;
          catSel.addEventListener("change", function () { state.cat = catSel.value; apply(); });
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
      var any = false;
      for (var i = 0; i < extracted.facts.length; i++) {
        var f = extracted.facts[i]; if (/^deadline$/i.test(f.label)) continue;
        var row = document.createElement("div"); row.className = "row";
        var dt = document.createElement("dt"); dt.textContent = f.label;
        var dd = document.createElement("dd"); dd.textContent = f.value;
        row.appendChild(dt); row.appendChild(dd); dl.appendChild(row); any = true;
      }
      if (any) dl.hidden = false;
      extracted.nodes.forEach(function (n) { if (n.parentNode) n.parentNode.removeChild(n); });
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
        var tf = document.querySelector("[data-text-filter]");
        if (tf && tf.offsetParent !== null) { e.preventDefault(); tf.focus(); }
        else { var s = document.querySelector("[data-ghost-search]"); if (s) { e.preventDefault(); s.click(); } }
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

  function init() {
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
