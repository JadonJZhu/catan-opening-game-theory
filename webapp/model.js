/* Opening Placement Game -- model + solvers (no DOM).
 *
 * A line-by-line port of ../analysis/model.py.
 * Loads in the browser as window.GameModel and in node via require().
 *
 * Units: "pips" = expected resource cards per 36 dice rolls.
 *
 * Value of a hand S (a set of settlement vertices):
 *
 *   V(S) = sum_r w_r * prod_S[r]        scarcity-weighted income
 *        + delta * Distinct(S)          one bonus per different resource produced
 *        + sigma * PortGain(S)          extra cards from trading at a port, not the bank
 *
 *   w_r         = (average board supply) / (board supply of r), or 1 if scarcity is off
 *   PortGain(S) = sum_r (rate_S(r) - 1/4) * prod_S[r]
 *   rate_S(r)   = 1/2 if S owns the 2:1 port for r, else 1/3 if S owns a 3:1 port, else 1/4
 *
 * Payoff (zero-sum): u1 = V(S1) - V(S2) = -u2.
 *
 * Moves are categories: choosing k means "take the best still-legal vertex in
 * category k" (legal = not taken and not next to a taken vertex; best = largest
 * increase in my own V, ties -> lowest vertex id). Snake order P1, P2, P2, P1.
 */
(function (root) {
  "use strict";

  var RESOURCES = ["wood", "brick", "wool", "grain", "ore"];
  var CATS = ["C", "R", "B", "P"];
  var CAT_NAMES = { C: "City (ore/grain)", R: "Road (wood/brick)", B: "Balanced", P: "Port" };
  var SNAKE = [0, 1, 1, 0];
  var ALTERNATE = [0, 1, 0, 1];
  var BANK = 0.25;
  var TOL = 1e-9;
  var DEFAULT_PARAMS = { delta: 1.0, sigma: 1.0, scarcity: true };

  function category(v) {
    var p = v.production;
    var tot = p.wood + p.brick + p.wool + p.grain + p.ore;
    if (tot === 0) return null;
    if (v.port !== null && v.port !== undefined) return "P";
    var og = p.ore + p.grain, wb = p.wood + p.brick;
    if (p.ore > 0 && p.grain > 0 && og >= wb && og >= 0.5 * tot) return "C";
    if (p.wood > 0 && p.brick > 0 && wb >= 0.5 * tot) return "R";
    return "B";
  }

  function Model(board, params) {
    var self = this;
    this.b = board;
    this.V = board.vertices;
    this.p = Object.assign({}, DEFAULT_PARAMS, params || {});
    this.cat = this.V.map(category);
    this.supply = {};
    RESOURCES.forEach(function (r) {
      var s = 0;
      board.hexes.forEach(function (h) { if (h.resource === r) s += h.pips; });
      self.supply[r] = s;
    });
    var tot = 0;
    RESOURCES.forEach(function (r) { tot += self.supply[r]; });
    var avg = tot / RESOURCES.length;
    this.w = {};
    RESOURCES.forEach(function (r) { self.w[r] = self.p.scarcity ? avg / self.supply[r] : 1.0; });
  }

  /* ---- value of a hand ------------------------------------------------ */
  Model.prototype.prod = function (S) {
    var out = { wood: 0, brick: 0, wool: 0, grain: 0, ore: 0 };
    for (var i = 0; i < S.length; i++) {
      var pr = this.V[S[i]].production;
      for (var k = 0; k < RESOURCES.length; k++) out[RESOURCES[k]] += pr[RESOURCES[k]];
    }
    return out;
  };

  Model.prototype.ports = function (S) {
    var out = [];
    for (var i = 0; i < S.length; i++) {
      var pt = this.V[S[i]].port;
      if (pt && out.indexOf(pt) < 0) out.push(pt);
    }
    return out;
  };

  Model.prototype.rates = function (S) {
    var ports = this.ports(S), anyPort = ports.indexOf("any") >= 0, out = {};
    RESOURCES.forEach(function (r) {
      out[r] = ports.indexOf(r) >= 0 ? 0.5 : (anyPort ? 1 / 3 : BANK);
    });
    return out;
  };

  Model.prototype.portGain = function (S) {
    var pr = this.prod(S), rt = this.rates(S), s = 0;
    for (var k = 0; k < RESOURCES.length; k++) s += (rt[RESOURCES[k]] - BANK) * pr[RESOURCES[k]];
    return s;
  };

  Model.prototype.breakdown = function (S) {
    var pr = this.prod(S), inc = 0, distinct = 0, k;
    for (k = 0; k < RESOURCES.length; k++) inc += this.w[RESOURCES[k]] * pr[RESOURCES[k]];
    for (k = 0; k < RESOURCES.length; k++) if (pr[RESOURCES[k]] > 0) distinct++;
    var div = this.p.delta * distinct;
    var port = this.p.sigma * this.portGain(S);
    return { income: inc, diversity: div, port: port, total: inc + div + port };
  };

  Model.prototype.value = function (S) { return this.breakdown(S).total; };

  /** P1's payoff (P2's is the negative). */
  Model.prototype.payoff = function (S0, S1) { return this.value(S0) - this.value(S1); };

  /* ---- the draft ------------------------------------------------------ */
  Model.prototype.legal = function (vid, taken) {
    if (taken.has(vid)) return false;
    var nb = this.V[vid].neighbors;
    for (var i = 0; i < nb.length; i++) if (taken.has(nb[i])) return false;
    return true;
  };

  Model.prototype.bestIn = function (cat, mine, taken) {
    var base = this.value(mine), best = null, bestval = null;
    for (var i = 0; i < this.V.length; i++) {
      var vid = this.V[i].id;
      if (this.cat[vid] !== cat || !this.legal(vid, taken)) continue;
      var val = this.value(mine.concat([vid])) - base;
      if (bestval === null || val > bestval + 1e-12) { best = vid; bestval = val; }
    }
    return best;
  };

  /** Returns [S0, S1], or null if some choice has no legal vertex. */
  Model.prototype.runDraft = function (order, choices) {
    var S = [[], []], taken = new Set();
    var n = Math.min(order.length, choices.length);
    for (var t = 0; t < n; t++) {
      var pl = order[t], vid = this.bestIn(choices[t], S[pl], taken);
      if (vid === null) return null;
      S[pl].push(vid);
      taken.add(vid);
    }
    return S;
  };

  /** The draft move by move: [{move, player, category, vertex}], or null. */
  Model.prototype.placements = function (order, choices) {
    var S = [[], []], taken = new Set(), out = [];
    for (var t = 0; t < Math.min(order.length, choices.length); t++) {
      var pl = order[t], vid = this.bestIn(choices[t], S[pl], taken);
      if (vid === null) return null;
      S[pl].push(vid);
      taken.add(vid);
      out.push({ move: t + 1, player: pl, category: choices[t], vertex: vid });
    }
    return out;
  };

  Model.prototype.ranking = function (cat, k) {
    var self = this;
    if (k === undefined) k = 4;
    var vs = this.V.filter(function (v) { return self.cat[v.id] === cat; });
    var vals = {};
    vs.forEach(function (v) { vals[v.id] = self.value([v.id]); });
    vs.sort(function (a, b) { return vals[b.id] - vals[a.id]; });   // stable, like Python
    return vs.slice(0, k).map(function (v) { return { vertex: v.id, value: vals[v.id] }; });
  };

  /* ---- backward induction --------------------------------------------- */
  /**
   * Solve the category game. Returns an object history -> node (insertion
   * order matches Python's dict: post-order). Leaves: {leaf, value, S0, S1}.
   * Inner nodes: {leaf:false, mover, children {cat: value}, value, best, choice}.
   */
  Model.prototype.tree = function (order) {
    order = order || SNAKE;
    var self = this, nodes = {};
    function solve(hist) {
      var k = hist.length;
      if (k === order.length) {
        var S = self.runDraft(order, hist), val = self.payoff(S[0], S[1]);
        nodes[hist.join("")] = { leaf: true, value: val, S0: S[0], S1: S[1] };
        return val;
      }
      var pl = order[k], children = {}, keys = [];
      CATS.forEach(function (c) {
        if (self.runDraft(order.slice(0, k + 1), hist.concat([c])) === null) return;
        children[c] = solve(hist.concat([c]));
        keys.push(c);
      });
      var sign = pl === 0 ? 1 : -1, top = -Infinity;
      keys.forEach(function (c) { top = Math.max(top, sign * children[c]); });
      var best = CATS.filter(function (c) { return c in children && sign * children[c] >= top - TOL; });
      nodes[hist.join("")] = { leaf: false, mover: pl, children: children, value: sign * top,
        best: best, choice: best[0] };
      return sign * top;
    }
    solve([]);
    return nodes;
  };

  Model.prototype.spe = function (order, nodes) {
    order = order || SNAKE;
    nodes = nodes || this.tree(order);
    var h = "";
    while (!nodes[h].leaf) h += nodes[h].choice;
    var leaf = nodes[h];
    return { path: h.split(""), value: leaf.value, S0: leaf.S0, S1: leaf.S1,
      payoffs: [leaf.value, -leaf.value], order: order };
  };

  /**
   * Every terminal path that is the outcome of SOME Nash equilibrium: no mover
   * on the path gains by deviating when the opponent answers optimally.
   */
  Model.prototype.neOutcomes = function (order, nodes) {
    order = order || SNAKE;
    nodes = nodes || this.tree(order);
    var out = [];
    Object.keys(nodes).forEach(function (h) {
      var nd = nodes[h];
      if (!nd.leaf) return;
      var uz = nd.value, ok = true;
      for (var k = 0; k < h.length && ok; k++) {
        var parent = nodes[h.slice(0, k)], sign = parent.mover === 0 ? 1 : -1;
        for (var c in parent.children) {
          if (c !== h[k] && sign * parent.children[c] > sign * uz + TOL) { ok = false; break; }
        }
      }
      if (ok) out.push(h);
    });
    return out;
  };

  /** Paths that take a value-optimal category at every node (all tie-breaks). */
  Model.prototype.optimalPaths = function (order, nodes) {
    order = order || SNAKE;
    nodes = nodes || this.tree(order);
    var out = [];
    (function walk(h) {
      var nd = nodes[h];
      if (nd.leaf) { out.push(h); return; }
      nd.best.forEach(function (c) { walk(h + c); });
    })("");
    return out;
  };

  /** P1 opening x P2 first reply -> P1's lead after optimal play of the last two moves. */
  Model.prototype.replyMatrix = function (nodes) {
    var out = {};
    Object.keys(nodes[""].children).forEach(function (a) {
      out[a] = Object.assign({}, nodes[a].children);
    });
    return out;
  };

  /** Inner nodes with more than one value-optimal move (where mixing is possible). */
  Model.prototype.ties = function (nodes, spe) {
    var path = spe.path.join("");
    return Object.keys(nodes).filter(function (h) {
      return !nodes[h].leaf && nodes[h].best.length > 1;
    }).map(function (h) {
      var n = nodes[h];
      return { history: h, mover: n.mover === 0 ? "P1" : "P2", best: n.best.slice(),
        value: n.value, on_path: path.indexOf(h) === 0 };
    });
  };

  Model.prototype.hand = function (S) {
    var self = this, bd = this.breakdown(S);
    return { vertices: S.slice(), categories: S.map(function (v) { return self.cat[v]; }),
      production: this.prod(S),
      ports: S.map(function (v) { return self.V[v].port; }).filter(function (p) { return p; }),
      income: bd.income, diversity: bd.diversity, port: bd.port, total: bd.total };
  };

  /* ---- exact game over individual vertices (robustness check) --------- */
  /**
   * Snake draft where each move picks a specific vertex. P1's last pick is a
   * best reply and P2's two picks are one joint choice, so: P1 picks v1; P2
   * picks a pair (v2, v3); P1 picks v4.
   */
  Model.prototype.vertexGame = function () {
    var n = this.V.length, a, b, i, j;
    var PV = [];
    for (a = 0; a < n; a++) {
      PV.push(new Float64Array(n));
      for (b = 0; b < n; b++) PV[a][b] = this.value(a === b ? [a] : [a, b]);
    }
    var block = [];
    for (a = 0; a < n; a++) { block.push(new Uint8Array(n)); block[a][a] = 1; }
    this.V.forEach(function (v) { v.neighbors.forEach(function (u) { block[v.id][u] = 1; }); });
    var producing = this.V.map(function (v) {
      var p = v.production;
      return p.wood + p.brick + p.wool + p.grain + p.ore > 0;
    });
    var bestOverall = null, rootVals = {};
    for (var v1 = 0; v1 < n; v1++) {
      if (!producing[v1]) continue;
      var free1 = [];
      for (i = 0; i < n; i++) if (!block[v1][i] && producing[i]) free1.push(i);
      var worst = null;
      for (i = 0; i < free1.length; i++) {
        var v2 = free1[i], free2 = free1.filter(function (x) { return !block[v2][x]; });
        for (j = 0; j < free2.length; j++) {
          var v3 = free2[j];
          if (v3 === v2) continue;
          var k = -1, kv = -Infinity, row = PV[v1];
          for (var t = 0; t < free2.length; t++) {
            var v4 = free2[t];
            if (block[v3][v4]) continue;
            if (k < 0 || row[v4] > kv) { k = v4; kv = row[v4]; }
          }
          if (k < 0) continue;
          var val = row[k] - PV[v2][v3];
          if (worst === null || val < worst[0] - TOL) worst = [val, v2, v3, k];
        }
      }
      rootVals[v1] = worst[0];
      if (bestOverall === null || worst[0] > bestOverall[1][0] + TOL) bestOverall = [v1, worst];
    }
    var w = bestOverall[1], c = this.cat;
    return { value: w[0], P1: [bestOverall[0], w[3]], P2: [w[1], w[2]],
      cats: [c[bestOverall[0]], c[w[1]], c[w[2]], c[w[3]]], root: rootVals };
  };

  /** Everything the UI shows, in one call. */
  Model.prototype.solve = function () {
    var nodes = this.tree(SNAKE), spe = this.spe(SNAKE, nodes);
    var altNodes = this.tree(ALTERNATE), alt = this.spe(ALTERNATE, altNodes);
    return {
      nodes: nodes, spe: spe, alt: alt,
      neOutcomes: this.neOutcomes(SNAKE, nodes),
      optimalPaths: this.optimalPaths(SNAKE, nodes),
      replyMatrix: this.replyMatrix(nodes),
      ties: this.ties(nodes, spe),
      placements: this.placements(SNAKE, spe.path),
      altPlacements: this.placements(ALTERNATE, alt.path)
    };
  };

  var API = {
    RESOURCES: RESOURCES, CATS: CATS, CAT_NAMES: CAT_NAMES, SNAKE: SNAKE, ALTERNATE: ALTERNATE,
    BANK: BANK, TOL: TOL, DEFAULT_PARAMS: DEFAULT_PARAMS, category: category, Model: Model
  };
  if (typeof module === "object" && module.exports) module.exports = API;
  root.GameModel = API;
})(typeof globalThis !== "undefined" ? globalThis : this);
