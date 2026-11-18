/* Opening Draft Explorer -- UI. All game logic lives in model.js. */
(function () {
  "use strict";

  var GM = window.GameModel, BOARD = window.BOARD;
  var CATS = GM.CATS, CAT_NAMES = GM.CAT_NAMES, RES = GM.RESOURCES, SNAKE = GM.SNAKE, TOL = 1e-9;
  var SVGNS = "http://www.w3.org/2000/svg";
  var PLAYER = ["P1", "P2"];

  var params = Object.assign({}, GM.DEFAULT_PARAMS);
  var model = null, sol = null, ranks = {};

  /* --------------------------------------------------------- helpers */
  function $(id) { return document.getElementById(id); }
  function svgEl(tag, attrs, parent) {
    var e = document.createElementNS(SVGNS, tag);
    for (var k in attrs) e.setAttribute(k, attrs[k]);
    if (parent) parent.appendChild(e);
    return e;
  }
  function h(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  }
  function f2(x) { return (Math.abs(x) < 0.005 ? 0 : x).toFixed(2); }
  function signed(x) { return Math.abs(x) < 0.005 ? "0.00" : (x > 0 ? "+" : "−") + Math.abs(x).toFixed(2); }
  function catSpan(c) { return '<b class="cat-' + c + '">' + c + "</b>"; }
  function pathHtml(p) { return '<span class="mono path">' + p.split("").map(catSpan).join("") + "</span>"; }
  function prodChips(prod) {
    return RES.filter(function (r) { return prod[r] > 0; }).map(function (r) {
      return '<span><span class="sw" style="background:var(--' + r + ')"></span> ' + r + " " + prod[r] + "</span>";
    }).join(" ");
  }
  function prodText(prod) {
    return RES.filter(function (r) { return prod[r] > 0; }).map(function (r) { return r + " " + prod[r]; }).join(", ");
  }
  function portLabel(p) { return p === "any" ? "3:1 port" : "2:1 " + p + " port"; }
  function leadWords(x) {
    return Math.abs(x) < 0.005 ? "dead even" : (x > 0 ? '<span class="p1">P1</span> ahead' : '<span class="p2">P2</span> ahead');
  }

  /* ----------------------------------------------------------- board */
  var VB = { x: -6.3, y: -2.5, w: 12.6, h: 11 };
  var center = (function () {
    var cx = 0, cy = 0;
    BOARD.vertices.forEach(function (v) { cx += v.x; cy += v.y; });
    return { x: cx / BOARD.vertices.length, y: cy / BOARD.vertices.length };
  })();

  function hexPoints(x, y, r) {
    var pts = [];
    for (var k = 0; k < 6; k++) {
      var a = (60 * k - 90) * Math.PI / 180;
      pts.push((x + r * Math.cos(a)).toFixed(4) + "," + (y + r * Math.sin(a)).toFixed(4));
    }
    return pts.join(" ");
  }

  function drawBase(svg) {
    svg.setAttribute("viewBox", [VB.x, VB.y, VB.w, VB.h].join(" "));
    var sea = [], R = 5.35;
    for (var k = 0; k < 6; k++) {
      var a = (60 * k) * Math.PI / 180;
      sea.push((center.x + R * Math.cos(a)).toFixed(3) + "," + (center.y + R * Math.sin(a)).toFixed(3));
    }
    svgEl("polygon", { points: sea.join(" "), class: "sea", "stroke-linejoin": "round", stroke: "var(--sea)", "stroke-width": 0.8 }, svg);

    // ports: two piers from the port's corners to a badge just off the coast
    var gp = svgEl("g", {}, svg);
    BOARD.ports.forEach(function (p) {
      var a = BOARD.vertices[p.vertices[0]], b = BOARD.vertices[p.vertices[1]];
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, dx = mx - center.x, dy = my - center.y;
      var L = Math.sqrt(dx * dx + dy * dy), px = mx + dx / L * 0.78, py = my + dy / L * 0.78;
      var g = svgEl("g", {}, gp);
      [a, b].forEach(function (v) { svgEl("line", { x1: v.x, y1: v.y, x2: px, y2: py, class: "port-line" }, g); });
      var any = p.type === "any";
      var c = svgEl("circle", { cx: px, cy: py, r: 0.4, class: "port-badge" + (any ? " any" : "") }, g);
      if (!any) c.setAttribute("stroke", "var(--" + p.type + ")");
      var t = svgEl("text", { x: px, y: py + (any ? 0 : -0.06), "text-anchor": "middle", "dominant-baseline": "central",
        class: "port-text" + (any ? " any" : "") }, g);
      t.textContent = any ? "3:1" : "2:1";
      if (!any) {
        var t2 = svgEl("text", { x: px, y: py + 0.17, "text-anchor": "middle", "dominant-baseline": "central",
          class: "port-text sub" }, g);
        t2.textContent = p.type;
      }
      svgEl("title", {}, g).textContent = portLabel(p.type) + " (corners " + p.vertices.join(" and ") + ")";
    });

    var gh = svgEl("g", {}, svg);
    BOARD.hexes.forEach(function (hx) {
      var poly = svgEl("polygon", { points: hexPoints(hx.x, hx.y, 0.985), class: "hex", fill: "var(--" + hx.resource + ")" }, gh);
      svgEl("title", {}, poly).textContent = hx.resource + (hx.number ? " " + hx.number : "");
      if (!hx.number) return;
      var hot = hx.number === 6 || hx.number === 8;
      svgEl("circle", { cx: hx.x, cy: hx.y, r: 0.36, class: "token" }, gh);
      var t = svgEl("text", { x: hx.x, y: hx.y - 0.05, "text-anchor": "middle", "dominant-baseline": "central",
        class: "token-num" + (hot ? " hot" : "") }, gh);
      t.textContent = hx.number;
      for (var i = 0; i < hx.pips; i++) {
        svgEl("circle", { cx: hx.x + (i - (hx.pips - 1) / 2) * 0.085, cy: hx.y + 0.2, r: 0.03,
          class: "pip" + (hot ? " hot" : "") }, gh);
      }
    });
    return svgEl("g", {}, svg); // dynamic layer
  }

  /** Numbered placements: P1 red circles, P2 blue rounded squares. */
  function drawPlacements(layer, placements, blocked) {
    layer.innerHTML = "";
    var taken = {};
    placements.forEach(function (p) { taken[p.vertex] = true; });
    BOARD.vertices.forEach(function (v) {
      if (taken[v.id]) return;
      var isBlocked = blocked && v.neighbors.some(function (n) { return taken[n]; });
      svgEl("circle", { cx: v.x, cy: v.y, r: 0.08, class: "faint" + (isBlocked ? " blocked" : "") }, layer);
    });
    placements.forEach(function (p) {
      var v = BOARD.vertices[p.vertex], g = svgEl("g", {}, layer);
      if (p.player === 0) svgEl("circle", { cx: v.x, cy: v.y, r: 0.32, class: "place place-p1" }, g);
      else svgEl("rect", { x: v.x - 0.3, y: v.y - 0.3, width: 0.6, height: 0.6, rx: 0.1, class: "place place-p2" }, g);
      var t = svgEl("text", { x: v.x, y: v.y, "text-anchor": "middle", "dominant-baseline": "central", class: "place-num" }, g);
      t.textContent = p.move;
      svgEl("title", {}, g).textContent = "Move " + p.move + ": " + PLAYER[p.player] + " takes " + CAT_NAMES[p.category] + " (corner " + p.vertex + ")";
    });
  }

  function stepsHtml(placements) {
    return placements.map(function (p) {
      var v = BOARD.vertices[p.vertex], pl = p.player === 0 ? "p1" : "p2";
      return '<li><span class="badge ' + pl + '">' + p.move + '</span><span class="what"><span class="' + pl + '">' + PLAYER[p.player] +
        "</span> takes " + catSpan(p.category) + " " + CAT_NAMES[p.category] + " → corner " + p.vertex +
        "<small>" + prodText(v.production) + (v.port ? " · " + portLabel(v.port) : "") + "</small></span></li>";
    }).join("");
  }

  var boardSvg = $("board"), boardLayer = drawBase(boardSvg);
  var seqLayer = drawBase($("seq-board"));
  var playLayer = drawBase($("play-board"));
  var tooltip = $("tooltip"), wrap = $("board-wrap"), stickyVid = null;

  /* ------------------------------------------------- board + tooltip */
  function renderBoard() {
    boardLayer.innerHTML = "";
    var top = {};
    CATS.forEach(function (c) { if (ranks[c].length) top[ranks[c][0].vertex] = c; });
    BOARD.vertices.forEach(function (v) {
      var c = model.cat[v.id];
      var g = svgEl("g", { class: "vtx-g", "data-vid": v.id, "data-cat": c || "" }, boardLayer);
      svgEl("circle", { cx: v.x, cy: v.y, r: 0.3, class: "vtx-hit" }, g);
      var isTop = top[v.id] !== undefined;
      var dot = svgEl("circle", { cx: v.x, cy: v.y, r: isTop ? 0.27 : 0.15, class: "vtx" + (isTop ? " top-ring" : ""),
        fill: c ? "var(--cat-" + c + ")" : "var(--muted)", tabindex: 0, role: "button",
        "aria-label": "Corner " + v.id + ", category " + (c ? CAT_NAMES[c] : "none") }, g);
      if (isTop) {
        var t = svgEl("text", { x: v.x, y: v.y, "text-anchor": "middle", "dominant-baseline": "central", class: "top-label" }, g);
        t.textContent = c;
      }
      g.addEventListener("pointerenter", function (e) { if (e.pointerType === "mouse") showTip(v.id); });
      g.addEventListener("pointerleave", function (e) { if (e.pointerType === "mouse" && stickyVid === null) hideTip(); });
      g.addEventListener("click", function (e) { e.stopPropagation(); stickyVid = stickyVid === v.id ? null : v.id; if (stickyVid === null) hideTip(); else showTip(v.id); });
      dot.addEventListener("focus", function () { showTip(v.id); });
      dot.addEventListener("blur", function () { if (stickyVid === null) hideTip(); });
    });
    if (!tooltip.hidden && tooltip.dataset.vid) showTip(+tooltip.dataset.vid);
  }

  function showTip(vid) {
    var v = BOARD.vertices[vid], c = model.cat[vid], bd = model.breakdown([vid]);
    var rank = c ? ranks[c].findIndex(function (t) { return t.vertex === vid; }) : -1;
    var pips = RES.reduce(function (s, r) { return s + v.production[r]; }, 0);
    var html = '<div class="tt-title">Corner ' + vid + " · " + (c ? '<span class="cat-' + c + '">' + CAT_NAMES[c] + "</span>" : "no category") + "</div>";
    html += '<div class="chips">' + (prodChips(v.production) || '<span class="muted">no production</span>') + "</div>";
    html += '<div class="tt-row"><span>Pips (cards / 36 rolls)</span><span>' + pips + "</span></div>";
    if (v.port) html += '<div class="tt-row"><span>Port</span><span>' + portLabel(v.port).replace(" port", "") + "</span></div>";
    html += '<div class="tt-sep"></div>';
    html += '<div class="tt-row"><span>Income' + (params.scarcity ? " (scarcity-weighted)" : "") + "</span><span>" + f2(bd.income) + "</span></div>";
    html += '<div class="tt-row"><span>Diversity (δ × ' + RES.filter(function (r) { return v.production[r] > 0; }).length + ")</span><span>" + f2(bd.diversity) + "</span></div>";
    html += '<div class="tt-row"><span>Port gain (σ)</span><span>' + f2(bd.port) + "</span></div>";
    html += '<div class="tt-row total"><span>Value on its own</span><span>' + f2(bd.total) + "</span></div>";
    if (rank >= 0) html += '<div class="tt-row"><span>Rank in ' + c + "</span><span>" + (rank + 1) + " of " + ranks[c].length + "</span></div>";
    if (v.port) html += '<p class="tt-note">A port also converts the cards a second settlement produces, so its value in a hand can be higher.</p>';
    tooltip.innerHTML = html;
    tooltip.dataset.vid = vid;
    tooltip.hidden = false;
    boardLayer.querySelectorAll(".vtx.hover").forEach(function (n) { n.classList.remove("hover"); });
    var g = boardLayer.querySelector('[data-vid="' + vid + '"] .vtx');
    if (!g) return;
    g.classList.add("hover");
    var wr = wrap.getBoundingClientRect(), dr = g.getBoundingClientRect();
    var x = dr.left + dr.width / 2 - wr.left, y = dr.top + dr.height / 2 - wr.top;
    var tw = tooltip.offsetWidth, th = tooltip.offsetHeight, gap = 16;
    var left = x + gap + tw > wr.width ? x - gap - tw : x + gap;
    var topPx = y + gap + th > wr.height ? y - gap - th : y + gap;
    tooltip.style.left = Math.max(4, Math.min(wr.width - tw - 4, left)) + "px";
    tooltip.style.top = Math.max(4, topPx) + "px";
  }
  function hideTip() {
    tooltip.hidden = true;
    delete tooltip.dataset.vid;
    boardLayer.querySelectorAll(".vtx.hover").forEach(function (n) { n.classList.remove("hover"); });
  }
  document.addEventListener("click", function () { if (stickyVid !== null) { stickyVid = null; hideTip(); } });

  function renderLegend() {
    var ul = $("cat-legend");
    ul.innerHTML = "";
    CATS.forEach(function (c) {
      var li = h("li"), t = ranks[c][0];
      var b = h("button", "leg", '<span class="dot" style="background:var(--cat-' + c + ')"></span><b>' + c + "</b> " +
        CAT_NAMES[c] + ' <span class="leg-top">· ' + ranks[c].length + " corners · top " + (t ? f2(t.value) : "–") + "</span>");
      b.type = "button";
      b.setAttribute("aria-label", "Highlight " + CAT_NAMES[c] + " corners");
      function on() {
        boardSvg.classList.add("dim-others");
        boardLayer.querySelectorAll(".vtx-g").forEach(function (g) { g.classList.toggle("on", g.dataset.cat === c); });
      }
      function off() { boardSvg.classList.remove("dim-others"); }
      b.addEventListener("pointerenter", on); b.addEventListener("pointerleave", off);
      b.addEventListener("focus", on); b.addEventListener("blur", off);
      li.appendChild(b); ul.appendChild(li);
    });
    var rl = $("res-legend");
    if (!rl.childElementCount) {
      RES.concat(["desert"]).forEach(function (r) {
        rl.appendChild(h("li", "", '<span class="sw" style="background:var(--' + r + ')"></span>' + r));
      });
    }
  }

  /* ------------------------------------------------------- controls */
  var sDelta = $("s-delta"), sSigma = $("s-sigma"), tScar = $("t-scarcity");
  function syncInputs() {
    sDelta.value = params.delta;
    sSigma.value = params.sigma;
    tScar.checked = params.scarcity;
  }
  sDelta.addEventListener("input", function () { params.delta = parseFloat(this.value); schedule(); });
  sSigma.addEventListener("input", function () { params.sigma = parseFloat(this.value); schedule(); });
  tScar.addEventListener("change", function () { params.scarcity = this.checked; schedule(); });
  $("reset").addEventListener("click", function () {
    params = Object.assign({}, GM.DEFAULT_PARAMS);
    syncInputs();
    schedule();
  });

  function renderControls() {
    var d = GM.DEFAULT_PARAMS;
    $("o-delta").textContent = params.delta.toFixed(2);
    $("o-delta").classList.toggle("changed", Math.abs(params.delta - d.delta) > 1e-9);
    $("o-sigma").textContent = params.sigma.toFixed(2);
    $("o-sigma").classList.toggle("changed", Math.abs(params.sigma - d.sigma) > 1e-9);
    var note = $("sigma-note");
    note.textContent = params.sigma > 1 + 1e-9
      ? "σ > 1 is past the upper bound (σ = 1: every card traded), so ports are being overvalued on purpose as a stress test."
      : "σ = 1 (tick): every card traded — upper bound of conversion value.";
    note.classList.toggle("warn", params.sigma > 1 + 1e-9);
    $("weights-text").innerHTML = params.scarcity
      ? "· " + RES.map(function (r) { return r + " " + model.w[r].toFixed(2); }).join(", ")
      : "· off: every card counts 1";
  }

  /* --------------------------------------------------- reply matrix */
  function renderReplyMatrix() {
    var rm = sol.replyMatrix, rootV = sol.nodes[""].value, spe = sol.spe.path;
    var html = '<thead><tr><th class="corner">P1 \\ P2</th>' + CATS.map(function (c) {
      return '<th scope="col" title="' + CAT_NAMES[c] + '">' + c + "</th>";
    }).join("") + '<th scope="col" class="rowmin-h">row min</th></tr></thead><tbody>';
    CATS.forEach(function (a) {
      if (!rm[a]) {
        html += '<tr><th scope="row">' + a + '</th><td colspan="5" class="muted na">no legal corner</td></tr>';
        return;
      }
      var row = rm[a], lo = Infinity;
      Object.keys(row).forEach(function (c) { lo = Math.min(lo, row[c]); });
      var isMax = Math.abs(lo - rootV) < TOL;
      html += '<tr class="' + (isMax ? "maximin" : "") + '"><th scope="row" title="' + CAT_NAMES[a] + '">' + a + "</th>";
      CATS.forEach(function (c) {
        if (!(c in row)) { html += '<td class="na" aria-label="not available">–</td>'; return; }
        var isMin = Math.abs(row[c] - lo) < TOL, onPath = a === spe[0] && c === spe[1];
        var cls = (isMin ? "rmin" : "") + (isMin && isMax ? " hit" : "") + (onPath ? " spe" : "");
        html += '<td class="' + cls + '" aria-label="P1 opens ' + a + ", P2 replies " + c + ": P1 lead " + f2(row[c]) + (isMin ? " (P2's best reply)" : "") + '">' + signed(row[c]) + "</td>";
      });
      html += '<td class="rowmin' + (isMax ? " hit" : "") + '">' + signed(lo) + "</td></tr>";
    });
    $("reply-matrix").innerHTML = html + "</tbody>";
    var maxRows = CATS.filter(function (a) {
      if (!rm[a]) return false;
      var lo = Math.min.apply(null, Object.keys(rm[a]).map(function (c) { return rm[a][c]; }));
      return Math.abs(lo - rootV) < TOL;
    });
    $("reply-summary").innerHTML = "Maximin = " + signed(rootV) + ": P1 opens " + maxRows.map(catSpan).join(" or ") +
      " and P2 answers " + catSpan(spe[1]) + ". This is the value of the game.";
  }

  /* --------------------------------------------------- equilibrium */
  function renderEquilibrium() {
    var spe = sol.spe, v = spe.value, path = spe.path.join("");
    drawPlacements(seqLayer, sol.placements, false);
    var h1 = model.hand(spe.S0), h2 = model.hand(spe.S1);

    $("eq-summary").innerHTML = "Solved by backward induction over " + Object.keys(sol.nodes).filter(function (k) { return sol.nodes[k].leaf; }).length +
      " complete drafts (categories with no open corner are skipped). Subgame-perfect path " + pathHtml(path) + ", value " + signed(v) + ".";

    $("seq-stats").innerHTML =
      '<div class="stat"><div class="k">Value of the game</div><div class="v">' + signed(v) + '</div><div class="s">P1\'s lead · ' + leadWords(v) + "</div></div>" +
      '<div class="stat"><div class="k">V(P1)</div><div class="v p1">' + f2(h1.total) + '</div><div class="s">moves 1 and 4</div></div>' +
      '<div class="stat"><div class="k">V(P2)</div><div class="v p2">' + f2(h2.total) + '</div><div class="s">moves 2 and 3</div></div>';

    $("seq-steps").innerHTML = stepsHtml(sol.placements);

    var rows = [["P1", "p1", h1], ["P2", "p2", h2]].map(function (r) {
      var hd = r[2];
      return "<tr><th scope=\"row\" class=\"" + r[1] + "\">" + r[0] + "</th><td>" +
        hd.vertices.map(function (x, i) { return x + " (" + catSpan(hd.categories[i]) + ")"; }).join(", ") +
        '<small class="muted block">' + prodText(hd.production) + (hd.ports.length ? " · " + hd.ports.map(portLabel).join(", ") : "") + "</small></td>" +
        '<td class="num">' + f2(hd.income) + '</td><td class="num">' + f2(hd.diversity) + '</td><td class="num">' + f2(hd.port) +
        '</td><td class="num"><b>' + f2(hd.total) + "</b></td></tr>";
    });
    $("hands").innerHTML = '<thead><tr><th>Player</th><th>Corners</th><th class="num">Income</th><th class="num">Diversity</th>' +
      '<th class="num">Port</th><th class="num">V</th></tr></thead><tbody>' + rows.join("") +
      '<tr class="diff"><th scope="row">Lead</th><td class="muted">V(P1) − V(P2)</td><td class="num">' + signed(h1.income - h2.income) +
      '</td><td class="num">' + signed(h1.diversity - h2.diversity) + '</td><td class="num">' + signed(h1.port - h2.port) +
      '</td><td class="num"><b>' + signed(v) + "</b></td></tr></tbody>";

    // Nash outcomes
    var ne = sol.neOutcomes;
    $("ne-list").innerHTML = '<p class="hint">' + (ne.length === 1
      ? "Exactly one draft is the outcome of a Nash equilibrium."
      : ne.length + " drafts are Nash equilibrium outcomes. All pay the same lead (minimax theorem).") + "</p>" +
      '<ul class="list plain">' + ne.map(function (p) {
        var val = sol.nodes[p].value;
        return "<li>" + pathHtml(p) + ' <span class="muted">lead ' + signed(val) + "</span>" +
          (p === path ? ' <span class="tag best">subgame perfect</span>' : "") + "</li>";
      }).join("") + "</ul>";

    // ties
    var ties = sol.ties;
    $("ties").innerHTML = !ties.length
      ? '<p class="muted">No ties: every mover has a single best category everywhere in the tree, so there is no room to mix.</p>'
      : '<p class="hint">At these positions the mover has more than one optimal category, so mixing between them is also optimal. Tie-break: first in C, R, B, P order.</p>' +
        '<table class="ties"><thead><tr><th>After</th><th>Mover</th><th>Best</th><th class="num">Value</th><th>Path</th></tr></thead><tbody>' +
        ties.map(function (t) {
          return "<tr><td>" + (t.history ? pathHtml(t.history) : '<span class="muted">start</span>') + '</td><td class="' + t.mover.toLowerCase() + '">' + t.mover +
            "</td><td>" + t.best.map(catSpan).join(" / ") + '</td><td class="num">' + signed(t.value) + "</td><td>" +
            (t.on_path ? '<span class="tag best">on path</span>' : '<span class="tag">off path</span>') + "</td></tr>";
        }).join("") + "</tbody></table>";

    // order comparison
    var alt = sol.alt, d = v - alt.value;
    $("order-compare").innerHTML = '<table class="ties"><thead><tr><th>Order</th><th>Optimal path</th><th class="num">P1\'s lead</th></tr></thead><tbody>' +
      '<tr><td>Snake P1, P2, P2, P1</td><td>' + pathHtml(path) + '</td><td class="num"><b>' + signed(v) + "</b></td></tr>" +
      '<tr><td>Alternate P1, P2, P1, P2</td><td>' + pathHtml(alt.path.join("")) + '</td><td class="num">' + signed(alt.value) + "</td></tr></tbody></table>" +
      '<p class="hint">' + (Math.abs(d) < 0.005 ? "The order makes no difference here."
        : d < 0 ? "The snake order moves " + f2(-d) + " of lead from P1 to P2: getting two picks in a row compensates the second player."
          : "Here the snake order is " + f2(d) + " better for P1 than alternating.") + "</p>";

    $("vertex-check").innerHTML = '<p class="muted">Solving the game over all 54 corners…</p>';
  }

  function renderVertexCheck() {
    var vg = model.vertexGame(), gap = vg.value - sol.spe.value;
    $("vertex-check").innerHTML = "<p>If players may pick <em>any</em> corner rather than a category, the exact solution gives P1 a lead of <b>" +
      signed(vg.value) + "</b> (P1: " + vg.P1.join(", ") + "; P2: " + vg.P2.join(", ") + "; categories " + pathHtml(vg.cats.join("")) + "). " +
      (Math.abs(gap) < 1e-3
        ? "That matches the category game, so restricting moves to categories loses nothing here.</p>"
        : "That differs from the category game by " + signed(gap) + ", so at these settings the category shortcut is not exact.</p>");
  }

  /* ------------------------------------------------------- play mode */
  var play = { side: 0, hist: "" };
  function lossOf(h, c) {
    var nd = sol.nodes[h];
    return nd.mover === 0 ? nd.value - nd.children[c] : nd.children[c] - nd.value;
  }
  function computerMoves() {
    while (play.hist.length < SNAKE.length && SNAKE[play.hist.length] !== play.side) {
      play.hist += sol.nodes[play.hist].choice;
    }
  }
  function newGame() { play.hist = ""; computerMoves(); renderPlay(); }
  function userPick(c) {
    if (play.hist.length >= SNAKE.length || SNAKE[play.hist.length] !== play.side) return;
    if (!(c in sol.nodes[play.hist].children)) return;
    play.hist += c;
    computerMoves();
    renderPlay();
  }
  function undo() {
    // drop trailing computer moves, then the user's last move, then replay the computer
    var hst = play.hist;
    while (hst.length && SNAKE[hst.length - 1] !== play.side) hst = hst.slice(0, -1);
    if (hst.length) hst = hst.slice(0, -1);
    play.hist = hst;
    computerMoves();
    renderPlay();
  }
  $("play-p1").addEventListener("click", function () { play.side = 0; newGame(); });
  $("play-p2").addEventListener("click", function () { play.side = 1; newGame(); });
  $("play-new").addEventListener("click", newGame);
  $("play-undo").addEventListener("click", undo);
  $("play-hints").addEventListener("change", function () { renderPlay(); });

  function renderPlay() {
    var side = play.side, hist = play.hist, done = hist.length === SNAKE.length;
    var you = side === 0 ? "p1" : "p2";
    $("play-p1").setAttribute("aria-checked", side === 0); $("play-p1").classList.toggle("on", side === 0);
    $("play-p2").setAttribute("aria-checked", side === 1); $("play-p2").classList.toggle("on", side === 1);
    $("play-undo").disabled = !hist.split("").some(function (_, k) { return SNAKE[k] === side; });

    var pl = model.placements(SNAKE, hist.split("")) || [];
    drawPlacements(playLayer, pl, true);

    var nd = sol.nodes[hist], now = nd.value, v = sol.spe.value, hints = $("play-hints").checked;
    var box = $("play-cats");
    box.innerHTML = "";
    if (!done) {
      var bestSet = nd.best;
      CATS.forEach(function (c) {
        var ok = c in nd.children, b = h("button", "cat-btn");
        b.type = "button";
        b.disabled = !ok;
        var inner = '<span class="cb-cat">' + catSpan(c) + " " + CAT_NAMES[c] + "</span>";
        if (ok) {
          var got = model.placements(SNAKE, (hist + c).split(""));
          var vid = got[got.length - 1].vertex, vv = BOARD.vertices[vid];
          inner += '<span class="cb-sub">corner ' + vid + " · " + prodText(vv.production) + (vv.port ? " · " + portLabel(vv.port) : "") + "</span>";
          if (hints) {
            var loss = lossOf(hist, c);
            inner += '<span class="cb-val">' + (loss < 1e-9 ? "optimal" : "costs " + f2(loss)) + " · lead " + signed(nd.children[c]) + "</span>";
            if (bestSet.indexOf(c) >= 0) b.classList.add("best");
          }
        } else inner += '<span class="cb-sub">no open corner</span>';
        b.innerHTML = inner;
        b.addEventListener("click", function () { userPick(c); });
        box.appendChild(b);
      });
    }

    // user's total cost
    var cost = 0, nUser = 0;
    for (var k = 0; k < hist.length; k++) {
      if (SNAKE[k] !== side) continue;
      cost += lossOf(hist.slice(0, k), hist[k]); nUser++;
    }
    var S0 = [], S1 = [];
    pl.forEach(function (p) { (p.player === 0 ? S0 : S1).push(p.vertex); });
    var current = model.payoff(S0, S1);

    $("play-status").innerHTML = done
      ? "Draft over. Final lead " + signed(now) + " (" + leadWords(now) + "). With optimal play on both sides it would be " + signed(v) + "; " +
        (cost < 1e-9 ? "you matched the equilibrium." : 'your choices cost you <b class="' + you + '">' + f2(cost) + "</b>.")
      : 'Your turn as <span class="' + you + '">' + PLAYER[side] + "</span>, move " + (hist.length + 1) + " of 4. " +
        (side === 0 ? "You want the lead as high as possible." : "You want P1's lead as low as possible.");

    $("play-stats").innerHTML =
      '<div class="stat"><div class="k">' + (done ? "Final lead" : "Lead with best play from here") + '</div><div class="v">' + signed(now) + '</div><div class="s">P1 − P2 · equilibrium ' + signed(v) + "</div></div>" +
      '<div class="stat"><div class="k">Lead of hands so far</div><div class="v">' + signed(current) + '</div><div class="s">V(P1) − V(P2) now</div></div>' +
      '<div class="stat"><div class="k">Your cost</div><div class="v ' + you + '">' + f2(cost) + '</div><div class="s">over ' + nUser + " of your moves</div></div>";

    $("play-log").innerHTML = pl.map(function (p, k) {
      var hh = hist.slice(0, k), c = hist[k], node = sol.nodes[hh], loss = lossOf(hh, c), isUser = p.player === side;
      var vv = BOARD.vertices[p.vertex], cls = p.player === 0 ? "p1" : "p2";
      var note = isUser
        ? (loss < 1e-9 ? '<span class="tag best">optimal</span>' : '<span class="tag pd">−' + f2(loss) + " vs best " + node.best.map(catSpan).join("/") + "</span>")
        : '<span class="tag">computer</span>';
      return '<li><span class="badge ' + cls + '">' + p.move + '</span><span class="what"><span class="' + cls + '">' + (isUser ? "You" : "Computer") +
        "</span> took " + catSpan(c) + " → corner " + p.vertex + " " + note +
        "<small>" + prodText(vv.production) + (vv.port ? " · " + portLabel(vv.port) : "") + " · lead with best play after this: " + signed(node.children[c]) + "</small></span></li>";
    }).join("") || '<li class="muted">No moves yet.</li>';
  }

  /* ---------------------------------------------------------- update */
  var pending = false, vgTimer = null;
  function schedule() {
    if (pending) return;
    pending = true;
    requestAnimationFrame(function () { pending = false; render(); });
  }
  function render() {
    model = new GM.Model(BOARD, params);
    sol = model.solve();
    ranks = {};
    CATS.forEach(function (c) { ranks[c] = model.ranking(c, BOARD.vertices.length); });
    renderControls();
    renderBoard();
    renderLegend();
    renderReplyMatrix();
    renderEquilibrium();
    play.hist = "";
    computerMoves();
    renderPlay();
    clearTimeout(vgTimer);
    vgTimer = setTimeout(renderVertexCheck, 120);
  }

  syncInputs();
  render();
})();
