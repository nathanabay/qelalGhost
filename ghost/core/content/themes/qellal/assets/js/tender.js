/* Qellal theme — deadline countdowns.
 *
 * Ghost posts have no structured "deadline" field, so each imported tender
 * carries it in its excerpt ("Deadline YYYY-MM-DD · …") and in a "Tender
 * details" facts list in the body. This script reads that, computes days-left
 * (UTC, date-only — matching the source app), and renders the urgency badges on
 * cards and the big ink countdown on the detail page. Progressive enhancement:
 * without JS the facts still read fine inline. */
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
    var now = new Date();
    var today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    var dl = new Date(deadline);
    if (isNaN(dl.getTime())) return null;
    var due = Date.UTC(dl.getUTCFullYear(), dl.getUTCMonth(), dl.getUTCDate());
    return Math.round((due - today) / 86400000);
  }

  // Pull a YYYY-MM-DD deadline from an excerpt string ("Deadline 2026-08-11 · …").
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

  // ── Detail: big countdown + facts relocation ─────────────
  function extractFacts(content) {
    // Find the "Tender details" <h3> and its following <ul>; return [{label,value}]
    // and the nodes to remove so they don't duplicate below the countdown.
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

  // Remove the inline "View the original notice on …" attribution paragraph
  // from the body — the detail page renders a dedicated Source card instead.
  function stripAttribution(content) {
    if (!content) return;
    var links = content.querySelectorAll('a[href]');
    for (var i = 0; i < links.length; i++) {
      if (/view the original notice/i.test(links[i].textContent || "")) {
        var p = links[i].closest ? links[i].closest("p") : null;
        var node = p || links[i];
        if (node.parentNode) node.parentNode.removeChild(node);
        return;
      }
    }
  }

  function initDetail() {
    var root = document.querySelector("[data-tender-detail]");
    if (!root) return;
    var content = root.querySelector("[data-tender-content]");
    var deadline = deadlineFrom(root.getAttribute("data-excerpt"));

    var card = root.querySelector("[data-deadline-card]");
    var d = deadline ? daysLeft(deadline) : null;

    // The ink deadline card only makes sense for a tender with a deadline;
    // hide it for pages/posts without one instead of showing a stuck "—".
    if (card && d === null) {
      card.hidden = true;
    }

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

    // The post body carries a "View the original notice" link (from the
    // scraper); the styled Source card already shows it, so drop the duplicate.
    stripAttribution(content);

    // Move the "Tender details" facts into the ink card, mono-styled. Build
    // real DOM nodes with textContent (never innerHTML) so a value containing
    // "<", ">" or "&" can't corrupt the markup. Skip "Deadline" — the countdown
    // already shows it.
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
  }

  function init() {
    initCards();
    initDetail();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
