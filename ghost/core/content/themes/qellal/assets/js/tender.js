/* Qellal theme — progressive enhancement.
 *
 * Ghost posts have no structured "deadline" field, so each imported tender
 * carries it in its excerpt ("Deadline YYYY-MM-DD · …") and in a "Tender
 * details" facts list in the body. This script reads that, computes days-left
 * (UTC, date-only), and drives: card/detail deadline badges, the list
 * sort/group/hide-closed toolbar, add-to-calendar + share, the light/dark
 * toggle, the mobile nav drawer, and subscribe-form feedback. Everything here
 * is enhancement — the page reads fine with JS disabled. */
(function () {
  "use strict";

  var DATE_RE = /(\d{4}-\d{2}-\d{2})/;
  var dateFmt;
  try {
    // Format in UTC to match daysLeft(), which counts calendar days in UTC.
    // Without this, a "2026-08-11" deadline renders as "10 Aug 2026" for a
    // viewer west of UTC (midnight-UTC falls on the previous local day).
    dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  } catch (e) {
    dateFmt = null;
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return dateFmt ? dateFmt.format(d) : iso;
  }

  function daysLeft(deadline) {
    if (!deadline) return null;
    var now = new Date();
    var today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    var dl = new Date(deadline);
    if (isNaN(dl.getTime())) return null;
    var due = Date.UTC(dl.getUTCFullYear(), dl.getUTCMonth(), dl.getUTCDate());
    return Math.round((due - today) / 86400000);
  }

  function deadlineFrom(text) {
    if (!text) return null;
    var idx = text.indexOf("Deadline");
    var slice = idx >= 0 ? text.slice(idx) : text;
    var m = slice.match(DATE_RE);
    return m ? m[1] : null;
  }

  // ── Cards ────────────────────────────────────────────────
  function renderBadge(el, d) {
    if (d === null) return;
    el.hidden = false;
    el.classList.remove("is-urgent", "is-warn", "is-closed");
    if (d < 0) {
      el.textContent = "Closed";
      el.classList.add("is-closed");
    } else if (d === 0) {
      el.textContent = "Closes today";
      el.classList.add("is-urgent");
    } else {
      el.textContent = d + "d left";
      if (d <= 3) el.classList.add("is-urgent");
      else if (d <= 7) el.classList.add("is-warn");
    }
  }

  function initCards() {
    var cards = document.querySelectorAll("[data-tender]");
    for (var i = 0; i < cards.length; i++) {
      var d = daysLeft(deadlineFrom(cards[i].getAttribute("data-excerpt")));
      var badge = cards[i].querySelector("[data-deadline-badge]");
      if (badge) renderBadge(badge, d);
    }
  }

  // ── List: sort / group / hide-closed ─────────────────────
  function makeBand(cls, text) {
    var li = document.createElement("li");
    li.className = "band" + (cls ? " " + cls : "");
    var span = document.createElement("span");
    span.className = "band-label";
    var dot = document.createElement("span");
    dot.className = "band-dot";
    span.appendChild(dot);
    span.appendChild(document.createTextNode(text));
    li.appendChild(span);
    return li;
  }

  function initList() {
    var ul = document.querySelector("[data-tender-list]");
    if (!ul) return;
    var toolbar = document.querySelector("[data-list-toolbar]");

    var lis = [].slice.call(ul.children).filter(function (li) {
      return li.querySelector && li.querySelector(".tender-card");
    });
    var items = lis.map(function (li) {
      var card = li.querySelector(".tender-card");
      return { li: li, card: card, d: daysLeft(deadlineFrom(card.getAttribute("data-excerpt"))) };
    });
    var original = items.slice();
    var withDeadline = items.filter(function (x) { return x.d !== null; });
    // Not worth a toolbar if the page has no deadlines to sort by.
    if (withDeadline.length < 2) return;
    if (toolbar) toolbar.hidden = false;

    var state = { view: "grouped", hideClosed: false };
    var groups = [
      { cls: "b-urgent", label: "Closing this week", test: function (d) { return d !== null && d >= 0 && d <= 7; } },
      { cls: "b-warn", label: "Closing this month", test: function (d) { return d !== null && d > 7 && d <= 30; } },
      { cls: "b-open", label: "Later", test: function (d) { return d !== null && d > 30; } },
      { cls: "", label: "No deadline", test: function (d) { return d === null; } },
      { cls: "", label: "Closed", test: function (d) { return d !== null && d < 0; } }
    ];

    function clearBands() {
      var bands = ul.querySelectorAll(".band");
      for (var i = 0; i < bands.length; i++) bands[i].parentNode.removeChild(bands[i]);
    }

    function apply() {
      clearBands();
      if (state.view === "newest") {
        original.forEach(function (x) { ul.appendChild(x.li); });
      } else {
        groups.forEach(function (g) {
          var members = items.filter(function (x) { return g.test(x.d); });
          if (!members.length) return;
          var closedGroup = g.label === "Closed";
          if (!(closedGroup && state.hideClosed)) ul.appendChild(makeBand(g.cls, g.label));
          if (g.label !== "No deadline") members.sort(function (a, b) { return a.d - b.d; });
          members.forEach(function (x) { ul.appendChild(x.li); });
        });
      }
      // hide-closed applies in either view
      items.forEach(function (x) {
        x.card.classList.toggle("is-hidden", state.hideClosed && x.d !== null && x.d < 0);
      });
    }

    if (toolbar) {
      var viewBtns = toolbar.querySelectorAll("[data-list-view]");
      for (var i = 0; i < viewBtns.length; i++) {
        viewBtns[i].addEventListener("click", function (e) {
          state.view = e.currentTarget.getAttribute("data-list-view");
          for (var j = 0; j < viewBtns.length; j++) {
            viewBtns[j].setAttribute("aria-pressed", viewBtns[j] === e.currentTarget ? "true" : "false");
          }
          apply();
        });
      }
      var chk = toolbar.querySelector("[data-hide-closed]");
      if (chk) chk.addEventListener("change", function () { state.hideClosed = chk.checked; apply(); });
    }

    apply();
  }

  // ── Detail: countdown + facts + calendar + share ─────────
  function extractFacts(content) {
    var facts = [];
    var nodes = [];
    if (!content) return { facts: facts, nodes: nodes };
    var heads = content.querySelectorAll("h3");
    var ul = null;
    for (var i = 0; i < heads.length; i++) {
      if (/tender details/i.test(heads[i].textContent || "")) {
        var prev = heads[i].previousElementSibling;
        if (prev && prev.tagName === "HR") nodes.push(prev);
        nodes.push(heads[i]);
        ul = heads[i].nextElementSibling;
        break;
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
        var node = p || links[i];
        if (node.parentNode) node.parentNode.removeChild(node);
        return;
      }
    }
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function icsEscape(s) { return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n"); }
  function slugify(s) { return String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "tender"; }

  function buildICS(title, deadline) {
    var s = new Date(deadline);
    var start = s.getUTCFullYear() + pad(s.getUTCMonth() + 1) + pad(s.getUTCDate());
    var e = new Date(deadline);
    e.setUTCDate(e.getUTCDate() + 1);
    var end = e.getUTCFullYear() + pad(e.getUTCMonth() + 1) + pad(e.getUTCDate());
    var now = new Date();
    var stamp = now.getUTCFullYear() + pad(now.getUTCMonth() + 1) + pad(now.getUTCDate()) + "T" +
      pad(now.getUTCHours()) + pad(now.getUTCMinutes()) + pad(now.getUTCSeconds()) + "Z";
    var uid = "qellal-" + start + "-" + slugify(title) + "@" + (location.hostname || "qellal");
    return [
      "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Qellal//Tender//EN", "CALSCALE:GREGORIAN",
      "BEGIN:VEVENT", "UID:" + uid, "DTSTAMP:" + stamp,
      "DTSTART;VALUE=DATE:" + start, "DTEND;VALUE=DATE:" + end,
      "SUMMARY:" + icsEscape("Tender deadline — " + title),
      "DESCRIPTION:" + icsEscape("Deadline for: " + title + "\n" + location.href),
      "URL:" + location.href, "END:VEVENT", "END:VCALENDAR"
    ].join("\r\n");
  }

  function initShareCalendar(root, deadline) {
    var actions = root.querySelector("[data-detail-actions]");
    if (!actions) return;
    var card = root.querySelector("[data-deadline-card]");
    var title = (card && card.getAttribute("data-title")) || document.title;
    var toast = root.querySelector("[data-share-toast]");

    var calLink = actions.querySelector("[data-add-calendar]");
    if (calLink) {
      if (deadline) {
        calLink.href = "data:text/calendar;charset=utf-8," + encodeURIComponent(buildICS(title, deadline));
        calLink.setAttribute("download", slugify(title) + ".ics");
      } else {
        calLink.parentNode.removeChild(calLink);
      }
    }

    var shareBtn = actions.querySelector("[data-share]");
    if (shareBtn) {
      shareBtn.addEventListener("click", function () {
        var data = { title: title, url: location.href };
        if (navigator.share) {
          navigator.share(data).catch(function () {});
        } else if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(location.href).then(function () {
            if (toast) toast.textContent = "Link copied to clipboard";
          }).catch(function () {
            if (toast) toast.textContent = location.href;
          });
        } else if (toast) {
          toast.textContent = location.href;
        }
      });
    }

    actions.hidden = false;
  }

  function initDetail() {
    var root = document.querySelector("[data-tender-detail]");
    if (!root) return;
    var content = root.querySelector("[data-tender-content]");
    var deadline = deadlineFrom(root.getAttribute("data-excerpt"));

    var card = root.querySelector("[data-deadline-card]");
    var d = deadline ? daysLeft(deadline) : null;

    if (card && d === null) card.hidden = true;

    if (card && d !== null) {
      var kicker = card.querySelector("[data-deadline-kicker]");
      var count = card.querySelector("[data-deadline-count]");
      var sub = card.querySelector("[data-deadline-sub]");
      var closed = d < 0;
      count.classList.remove("is-urgent", "is-warn", "is-closed");
      if (kicker) kicker.textContent = closed ? "Closed" : d === 0 ? "Closes today" : "Closes in";
      count.textContent = closed ? "—" : String(d);
      if (closed) count.classList.add("is-closed");
      else if (d <= 3) count.classList.add("is-urgent");
      else if (d <= 7) count.classList.add("is-warn");
      if (sub) {
        sub.textContent = closed
          ? "Closed " + formatDate(deadline)
          : d === 0
          ? "closes " + formatDate(deadline)
          : (d === 1 ? "day" : "days") + " · closes " + formatDate(deadline);
      }
    }

    stripAttribution(content);

    var extracted = extractFacts(content);
    var dl = card && card.querySelector("[data-deadline-facts]");
    if (dl && extracted.facts.length) {
      var any = false;
      for (var i = 0; i < extracted.facts.length; i++) {
        var f = extracted.facts[i];
        if (/^deadline$/i.test(f.label)) continue;
        var row = document.createElement("div");
        row.className = "row";
        var dt = document.createElement("dt");
        dt.textContent = f.label;
        var dd = document.createElement("dd");
        dd.textContent = f.value;
        row.appendChild(dt);
        row.appendChild(dd);
        dl.appendChild(row);
        any = true;
      }
      if (any) dl.hidden = false;
      for (var k = 0; k < extracted.nodes.length; k++) {
        if (extracted.nodes[k].parentNode) extracted.nodes[k].parentNode.removeChild(extracted.nodes[k]);
      }
    }

    initShareCalendar(root, deadline);
  }

  // ── Light / dark toggle ──────────────────────────────────
  function initThemeToggle() {
    var root = document.documentElement;
    var btn = document.querySelector("[data-theme-toggle]");
    if (!btn) return;
    var mq = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
    function current() {
      var dt = root.getAttribute("data-theme");
      if (dt) return dt;
      if (root.classList.contains("scheme-dark")) return "dark";
      if (root.classList.contains("scheme-auto")) return mq && mq.matches ? "dark" : "light";
      return "light";
    }
    btn.addEventListener("click", function () {
      var next = current() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("qellal-theme", next); } catch (e) {}
    });
  }

  // ── Mobile nav drawer ────────────────────────────────────
  function initNav() {
    var btn = document.querySelector(".nav-toggle");
    var nav = document.getElementById("site-nav");
    if (!btn || !nav) return;
    function setOpen(open) {
      nav.classList.toggle("is-open", open);
      btn.setAttribute("aria-expanded", open ? "true" : "false");
    }
    btn.addEventListener("click", function () { setOpen(!nav.classList.contains("is-open")); });
    nav.addEventListener("click", function (e) { if (e.target.closest("a")) setOpen(false); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") setOpen(false); });
  }

  // ── Subscribe form feedback ──────────────────────────────
  function initSubscribe() {
    var forms = document.querySelectorAll('[data-members-form]');
    for (var i = 0; i < forms.length; i++) {
      (function (form) {
        var section = form.closest ? form.closest("[data-subscribe]") : null;
        var note = section ? section.querySelector("[data-subscribe-note]") : null;
        form.addEventListener("submit", function () {
          if (note) { note.textContent = "Check your inbox to confirm your subscription."; note.className = "subscribe-note ok"; }
        });
      })(forms[i]);
    }
  }

  function init() {
    initCards();
    initList();
    initDetail();
    initThemeToggle();
    initNav();
    initSubscribe();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
