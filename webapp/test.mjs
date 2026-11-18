// Verification of the JS port (model.js, board-data.js) against the Python reference.
//   node test.mjs
// 1. baseline parameters vs ../data/results.json
// 2. all rows of ../data/sensitivity.json (every (scarcity, delta, sigma) on the grid)
// 3. board-data.js deep-equals ../data/board.json
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const readJSON = (p) => JSON.parse(readFileSync(path.join(here, p), "utf8"));
const BOARD = require("./board-data.js");
const GM = require("./model.js");
const { SNAKE, ALTERNATE } = GM;

const EPS = 1e-3;
let passed = 0, failed = 0;
function check(name, ok, detail = "") {
  if (ok) { passed++; console.log(`  ok    ${name}`); }
  else { failed++; console.log(`  FAIL  ${name}${detail ? "  -- " + detail : ""}`); }
}
const near = (a, b, eps = EPS) => typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= eps;
const sameArr = (a, b) => isDeepStrictEqual(a, b);
// numeric maps {k: number}, same keys in the same order
const mapNear = (a, b) => isDeepStrictEqual(Object.keys(a), Object.keys(b)) && Object.keys(a).every((k) => near(a[k], b[k]));
const show = (x) => JSON.stringify(x);

function checkHand(label, m, S, py) {
  const h = m.hand(S);
  check(`${label} vertices ${show(h.vertices)}`, sameArr(h.vertices, py.vertices), show(py.vertices));
  check(`${label} categories`, sameArr(h.categories, py.categories), `${show(h.categories)} vs ${show(py.categories)}`);
  check(`${label} production`, isDeepStrictEqual(h.production, py.production));
  check(`${label} ports`, sameArr(h.ports, py.ports));
  for (const k of ["income", "diversity", "port", "total"])
    check(`${label} ${k} = ${h[k].toFixed(3)}`, near(h[k], py[k]), `python ${py[k]}`);
}

/* ------------------------------------------------------------ 1. baseline */
console.log("Baseline (delta=1, sigma=1, scarcity on) vs ../data/results.json");
const R = readJSON("../data/results.json");
const m = new GM.Model(BOARD, R.params);
check("params match model defaults", isDeepStrictEqual(R.params, GM.DEFAULT_PARAMS));
check("weights", mapNear(m.w, R.weights), `${show(m.w)} vs ${show(R.weights)}`);
check("supply", isDeepStrictEqual(m.supply, R.supply));
check("vertex_category (all 54)", m.cat.every((c, i) => c === R.vertex_category[String(i)]) &&
  m.cat.length === Object.keys(R.vertex_category).length);
for (const c of GM.CATS) {
  const js = m.ranking(c, 4), py = R.top_spots[c];
  check(`top_spots ${c}: ${js.map((t) => `v${t.vertex}=${t.value.toFixed(3)}`).join(" ")}`,
    js.length === py.length && js.every((t, k) => t.vertex === py[k].vertex && near(t.value, py[k].value) &&
      Object.keys(py[k].breakdown).every((key) => near(m.breakdown([t.vertex])[key], py[k].breakdown[key]))));
}

const nodes = m.tree(SNAKE);
const spe = m.spe(SNAKE, nodes);
check(`spe path ${spe.path.join("")}`, sameArr(spe.path, R.spe.path), R.spe.path.join(""));
check(`spe value ${spe.value.toFixed(3)}`, near(spe.value, R.spe.value), `python ${R.spe.value}`);
checkHand("spe P1", m, spe.S0, R.spe.P1);
checkHand("spe P2", m, spe.S1, R.spe.P2);
check("root values", mapNear(nodes[""].children, R.root), `${show(nodes[""].children)} vs ${show(R.root)}`);
const rm = m.replyMatrix(nodes);
check("reply_matrix (rows and cells)", isDeepStrictEqual(Object.keys(rm), Object.keys(R.reply_matrix)) &&
  Object.keys(rm).every((a) => mapNear(rm[a], R.reply_matrix[a])));
const ne = m.neOutcomes(SNAKE, nodes);
check(`ne_outcomes ${show(ne)}`, sameArr(ne, R.ne_outcomes), show(R.ne_outcomes));
const opt = m.optimalPaths(SNAKE, nodes);
check("optimal_paths = ne_outcomes (as sets)", sameArr([...opt].sort(), [...ne].sort()), show(opt));
const ties = m.ties(nodes, spe);
check(`ties (${ties.length})`, ties.length === R.ties.length && ties.every((t, k) => {
  const p = R.ties[k];
  return t.history === p.history && t.mover === p.mover && sameArr(t.best, p.best) && near(t.value, p.value) && t.on_path === p.on_path;
}), `${show(ties.map((t) => t.history))} vs ${show(R.ties.map((t) => t.history))}`);
const keys = Object.keys(nodes);
const nLeaves = keys.filter((h) => nodes[h].leaf).length;
check(`n_leaves ${nLeaves}`, nLeaves === R.n_leaves, `python ${R.n_leaves}`);
check(`n_decision_nodes ${keys.length - nLeaves}`, keys.length - nLeaves === R.n_decision_nodes, `python ${R.n_decision_nodes}`);

// every node
check(`same node set (${keys.length})`, sameArr([...keys].sort(), Object.keys(R.nodes).sort()));
let bad = [];
for (const h of Object.keys(R.nodes)) {
  const js = nodes[h], py = R.nodes[h];
  if (!js) { bad.push(h); continue; }
  let ok = near(js.value, py.value);
  if (!js.leaf) ok = ok && js.mover === py.mover && sameArr(js.best, py.best) && mapNear(js.children, py.children);
  else ok = ok && !("mover" in py);
  if (!ok) bad.push(h);
}
check(`every node value/mover/best/children matches (${Object.keys(R.nodes).length} nodes)`, bad.length === 0,
  `${bad.length} mismatched: ${bad.slice(0, 10).join(", ")}`);

const alt = m.spe(ALTERNATE);
check(`alternate path ${alt.path.join("")}`, sameArr(alt.path, R.alternate.path), R.alternate.path.join(""));
check(`alternate value ${alt.value.toFixed(3)}`, near(alt.value, R.alternate.value), `python ${R.alternate.value}`);
checkHand("alternate P1", m, alt.S0, R.alternate.P1);
checkHand("alternate P2", m, alt.S1, R.alternate.P2);

const vg = m.vertexGame();
check(`vertex_game value ${vg.value.toFixed(3)}`, near(vg.value, R.vertex_game.value), `python ${R.vertex_game.value}`);
check(`vertex_game P1 ${show(vg.P1)}`, sameArr(vg.P1, R.vertex_game.P1), show(R.vertex_game.P1));
check(`vertex_game P2 ${show(vg.P2)}`, sameArr(vg.P2, R.vertex_game.P2), show(R.vertex_game.P2));
check(`vertex_game cats ${vg.cats.join("")}`, sameArr(vg.cats, R.vertex_game.cats));
const r3 = (x) => Math.round(x * 1000) / 1000;
const openings = Object.entries(vg.root).map(([k, v]) => [r3(v), +k])
  .sort((a, b) => b[0] - a[0] || b[1] - a[1]).slice(0, 5);
check("vertex_game best_openings", openings.length === R.vertex_game.best_openings.length &&
  openings.every((o, i) => near(o[0], R.vertex_game.best_openings[i][0]) && o[1] === R.vertex_game.best_openings[i][1]),
  `${show(openings)} vs ${show(R.vertex_game.best_openings)}`);

/* ------------------------------------------------------ 2. sensitivity grid */
const G = readJSON("../data/sensitivity.json");
console.log(`\nSensitivity grid: ${G.length} rows of ../data/sensitivity.json`);
let rowFails = 0, vertexRows = 0;
const t0 = Date.now();
for (const g of G) {
  const mm = new GM.Model(BOARD, { delta: g.delta, sigma: g.sigma, scarcity: g.scarcity });
  const nd = mm.tree(SNAKE);
  const sp = mm.spe(SNAKE, nd);
  const got = {
    path: sp.path.join(""),
    value: sp.value,
    n_ne_outcomes: mm.neOutcomes(SNAKE, nd).length,
    ports_in_spe: sp.S0.concat(sp.S1).filter((v) => mm.V[v].port).length,
    alt_value: mm.spe(ALTERNATE).value,
  };
  if ("vertex_value" in g) { got.vertex_value = mm.vertexGame().value; vertexRows++; }
  const errs = [];
  if (got.path !== g.path) errs.push(`path ${got.path} vs ${g.path}`);
  for (const k of ["value", "alt_value", "vertex_value"])
    if (k in g && !near(got[k], g[k])) errs.push(`${k} ${got[k].toFixed(3)} vs ${g[k]}`);
  for (const k of ["n_ne_outcomes", "ports_in_spe"])
    if (got[k] !== g[k]) errs.push(`${k} ${got[k]} vs ${g[k]}`);
  const label = `scarcity=${g.scarcity ? "on " : "off"} delta=${g.delta.toFixed(2)} sigma=${g.sigma.toFixed(2)} ${got.path}`;
  if (errs.length) { rowFails++; check(label, false, errs.join("; ")); }
  else passed++;
}
console.log(`  ${G.length - rowFails}/${G.length} rows match (path, value, n_ne_outcomes, ports_in_spe, alt_value; ` +
  `vertex_value on ${vertexRows} rows) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
check("grid has 442 rows", G.length === 442, `${G.length}`);

/* ---------------------------------------------------------- 3. board data */
console.log("\nEmbedded board");
const BJ = readJSON("../data/board.json");
check("board-data.js deep-equals ../data/board.json", isDeepStrictEqual(BOARD, BJ));
check("ports_verified is true", BOARD.ports_verified === true);

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
