// Token Radar dashboard — renders window.RADAR (written beside dashboard/ by main.ts).
// Works fully offline: the data is inlined via <script src="../data.js">.
// No network: no links, no fetches, no external addresses anywhere in this file.
(function () {
  "use strict";
  var DATA = window.RADAR;
  if (!DATA) {
    document.getElementById("board").innerHTML =
      '<p class="empty">data.js failed to load.</p>';
    return;
  }
  var rows = DATA.rows.slice();
  var live = DATA.live.slice();

  var $ = function (id) { return document.getElementById(id); };
  var boardEl = $("board"), detailEl = $("detail"), statsEl = $("stats");
  var searchEl = $("search"), catEl = $("category"), sortEl = $("sort");
  var farmableEl = $("farmableOnly"), top10El = $("top10Only");
  var liveEl = $("live");

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return "n/a";
    if (n >= 1e9) return "$" + (n / 1e9).toFixed(2) + "B";
    if (n >= 1e6) return "$" + (n / 1e6).toFixed(0) + "M";
    if (n >= 1e3) return "$" + (n / 1e3).toFixed(0) + "K";
    return "$" + n.toFixed(0);
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return "n/a";
    return (n > 0 ? "+" : "") + n.toFixed(2) + "%";
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return "unknown";
    if (days >= 365) return (days / 365).toFixed(1) + "y";
    return Math.max(0, Math.round(days)) + "d";
  }
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }
  function farmClass(v) { return v >= 70 ? "" : v >= 45 ? "mid" : "low"; }

  // The model in one function: the page recomputes a row's implied value from
  // the snapshot figures, so the page's code and the board's data are visibly
  // the same arithmetic.
  function impliedOf(r) {
    var m = DATA.model;
    var growth = Math.min(m.growth_cap, Math.max(m.growth_floor, r.change_7d === null ? 0 : r.change_7d));
    var growthMult = 1 + (growth / 100) * m.growth_weight;
    var age = r.age_days === null ? m.unknown_age_days : r.age_days;
    var maturity = m.maturity_floor + (Math.min(Math.max(age, 0), m.maturity_days) / m.maturity_days) * m.maturity_range;
    return {
      growth: growth,
      growthMult: growthMult,
      maturity: maturity,
      value: Math.max(1, Math.round(r.tvl_usd * r.multiple * m.fdv_uplift * r.launch_probability * growthMult * maturity))
    };
  }

  // ---- stats ----
  var totalImplied = rows.reduce(function (a, r) { return a + r.implied_value_usd; }, 0);
  var topPick = rows[0];
  statsEl.innerHTML =
    stat("Protocols scanned", DATA.total_protocols.toLocaleString(), "Sealed snapshot") +
    stat("Board rows", String(DATA.board_size), DATA.watchlist_size + " watchlist + " + DATA.early_size + " early") +
    stat("Board implied value", fmtUsd(totalImplied), "Sum of implied launch values") +
    stat("Top pick", esc(topPick.name), "Implied " + fmtUsd(topPick.implied_value_usd), true);
  function stat(k, v, s, pink) {
    return '<div class="stat"><div class="k">' + k + '</div>' +
      '<div class="v' + (pink ? " pink" : "") + '">' + esc(v) + "</div>" +
      '<div class="s">' + esc(s) + "</div></div>";
  }

  // ---- category filter ----
  var cats = [];
  rows.forEach(function (r) { if (cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  catEl.innerHTML = '<option value="">All categories</option>' +
    cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + "</option>"; }).join("");

  // ---- fine print ----
  $("fineprint").textContent =
    "Data: " + DATA.source + " (snapshot " + DATA.as_of + "). " +
    "Model " + DATA.model_version + ": implied value = TVL × category multiple (median mcap/TVL of live-token protocols in the same category, " +
    "global median ×" + DATA.global_multiple.toFixed(2) + " when a category has fewer than 3 comps) × 2.0 FDV uplift × P(launch) × growth × maturity. " +
    "A protocol records no token when the snapshot carries no market cap, no CoinGecko id and no symbol for it. " +
    "This dashboard is a research tool, not investment advice.";

  var selectedSlug = null;

  function filtered() {
    var q = searchEl.value.trim().toLowerCase();
    var cat = catEl.value;
    var sortKey = sortEl.value;
    var list = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && (r.category || "").toLowerCase().indexOf(q) < 0) return false;
      if (cat && r.category !== cat) return false;
      if (farmableEl.checked && r.farmability < 70) return false;
      if (top10El.checked && r.rank > 10) return false;
      return true;
    });
    list.sort(function (a, b) { return b[sortKey] - a[sortKey]; });
    return list;
  }

  function renderBoard() {
    var list = filtered();
    $("empty").hidden = list.length > 0;
    boardEl.innerHTML = list.map(function (r) {
      var sel = r.slug === selectedSlug ? " selected" : "";
      var top3 = r.rank <= 3 ? " top3" : "";
      return '<div class="row' + sel + top3 + '" role="listitem" data-slug="' + esc(r.slug) + '">' +
        '<span class="rank">' + r.rank + "</span>" +
        '<span class="pname"><span class="n">' + esc(r.name) + '</span><br><span class="c">' + esc(r.category || "—") +
        " · " + esc(r.chains.slice(0, 3).join(", ") || "—") + "</span></span>" +
        '<span class="num">' + fmtUsd(r.tvl_usd) + "</span>" +
        '<span class="num">×' + r.multiple.toFixed(2) + "</span>" +
        '<span class="num elv">' + fmtUsd(r.implied_value_usd) + "</span>" +
        '<span class="farmcell"><span class="farmbar"><i class="' + farmClass(r.farmability) +
        '" style="width:' + r.farmability + '%"></i></span>' +
        '<span class="farmnum">' + r.farmability + "</span></span>" +
        "</div>";
    }).join("");
    boardEl.querySelectorAll(".row").forEach(function (el) {
      el.addEventListener("click", function () { select(el.getAttribute("data-slug")); });
    });
    if (list.length && !list.some(function (r) { return r.slug === selectedSlug; })) {
      select(list[0].slug, true);
    }
  }

  function select(slug, keepScroll) {
    selectedSlug = slug;
    var r = rows.find(function (x) { return x.slug === slug; });
    if (!r) return;
    boardEl.querySelectorAll(".row").forEach(function (el) {
      el.classList.toggle("selected", el.getAttribute("data-slug") === slug);
    });
    var calc = impliedOf(r);
    var why = fmtUsd(r.tvl_usd) + " TVL × " + r.multiple.toFixed(2) + " " + (r.category || "—") +
      " multiple × 2.0 FDV × " + Math.round(r.launch_probability * 100) + "% launch × " +
      calc.growthMult.toFixed(2) + " growth × " + calc.maturity.toFixed(2) +
      " maturity = " + fmtUsd(r.implied_value_usd) + " implied launch value.";
    var steps = r.farm_steps.map(function (s) {
      return "<li><p>" + esc(s) + "</p></li>";
    }).join("");
    detailEl.innerHTML =
      '<div class="cat">#' + r.rank + " · " + esc(r.category || "—") + "</div>" +
      "<h2>" + esc(r.name) + "</h2>" +
      '<p class="desc">Records no token in the sealed snapshot. Ranked #' + r.rank +
      " of " + rows.length + " on the board.</p>" +
      '<div class="kv">' +
      kv("TVL", fmtUsd(r.tvl_usd), "") +
      kv("7-day change", fmtPct(r.change_7d), "") +
      kv("Category multiple", "×" + r.multiple.toFixed(2), "mcap/TVL, ×2 FDV") +
      kv("P(launch)", Math.round(r.launch_probability * 100) + "%", "") +
      kv("Implied value", fmtUsd(r.implied_value_usd), "rank #" + r.rank, true) +
      kv("Farmability", r.farmability + " / 100", r.chains.length + " chain" + (r.chains.length === 1 ? "" : "s") + " · " + fmtAge(r.age_days)) +
      "</div>" +
      '<p class="why">' + esc(why) + "</p>" +
      "<h3>How to farm it</h3>" +
      '<ol class="steps">' + steps + "</ol>" +
      '<div class="chips">' +
      r.chains.map(function (c) { return '<span class="chip">' + esc(c) + "</span>"; }).join("") +
      "</div>";
    if (!keepScroll) detailEl.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function kv(k, v, s, pink) {
    return '<div class="cell"><div class="k">' + k + '</div><div class="v' + (pink ? " pink" : "") + '">' + esc(v) +
      (s ? " <small>" + esc(s) + "</small>" : "") + "</div></div>";
  }

  // ---- live comps ----
  liveEl.innerHTML =
    '<div class="live-head"><span>Protocol</span><span>TVL</span><span>Market cap</span><span>mcap / TVL</span><span>7-day</span></div>' +
    live.map(function (p) {
      var ratio = (p.mcap_usd !== null && p.tvl_usd > 0) ? (p.mcap_usd / p.tvl_usd).toFixed(2) + "×" : "—";
      return '<div class="live-row">' +
        '<span><span class="n">' + esc(p.name) + '</span><br><span class="c">' + esc(p.category || "—") + "</span></span>" +
        '<span class="num">' + fmtUsd(p.tvl_usd) + "</span>" +
        '<span class="num">' + fmtUsd(p.mcap_usd) + "</span>" +
        '<span class="num">' + ratio + "</span>" +
        '<span class="num">' + fmtPct(p.change_7d) + "</span>" +
        "</div>";
    }).join("");

  // Deep-link via hash: #slug=<slug> selects a protocol, #category=<name> filters.
  var hash = {};
  (location.hash || "").replace(/^#/, "").split("&").forEach(function (part) {
    var kv = part.split("=");
    if (kv[0]) hash[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || "");
  });
  if (hash.category) catEl.value = hash.category;
  if (hash.slug) selectedSlug = hash.slug;

  [searchEl, catEl, sortEl, farmableEl, top10El].forEach(function (el) {
    el.addEventListener("input", renderBoard);
    el.addEventListener("change", renderBoard);
  });

  renderBoard();
  if (hash.slug) select(hash.slug, true);
})();
