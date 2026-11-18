# Opening Draft Explorer

A static web app for the MATH 167 project. It models the opening settlement placement on a fixed hex board as a two-player **zero-sum** snake draft (P1, P2, P2, P1) and solves it by backward induction. Nothing needs to be built, and the app has no dependencies or network requests.

| File | What it is |
|---|---|
| `index.html` | Page structure |
| `style.css` | Layout, with light and dark themes that follow `prefers-color-scheme` |
| `app.js` | UI: board SVG, controls, reply matrix, equilibrium panel and the playable draft (DOM only) |
| `model.js` | The game model and solvers, a direct port of `../analysis/model.py`. It contains no DOM code. |
| `board-data.js` | `../data/board.json` embedded as `window.BOARD` (also `module.exports`) |
| `test.mjs` | Checks the JS against the Python outputs in `../data/` |

## The model in one paragraph

A hand S (a player's settlements) is worth V(S) = Σ_r w_r·prod_S(r) + δ·Distinct(S) + σ·PortGain(S), where w_r is a scarcity weight (average board supply / supply of r, or 1 with scarcity off), Distinct counts the resources produced, and PortGain = Σ_r (rate_S(r) − 1/4)·prod_S(r) with rate 1/2 for an owned 2:1 port of r, 1/3 for any owned 3:1 port, else 1/4 (the bank). σ = 1 means every card is traded, an upper bound on what ports are worth. P1's payoff is the lead V(S1) − V(S2) and P2's is its negative. A move is a category (C city, R road, B balanced, P port) and gives the best still-legal corner in it. Defaults: δ = 1, σ = 1, scarcity on. Ports are at the verified beginner-board positions.

## What the page shows

- **Board and categories**: every corner colored by category, the corrected ports, and a tooltip with production and the value breakdown (income, diversity, port gain).
- **Parameters**: δ (0–3), σ (0–4, with σ = 1 marked as the "every card traded" upper bound), the scarcity-weights toggle, and reset. Everything re-solves live.
- **Reply matrix**: rows are P1's opening, columns P2's first reply, cells P1's lead after the last two picks are played optimally. Bold cells are row minima (P2's best reply); the highlighted cell is the largest row minimum (maximin), P1's optimal opening. This lets a reader verify the solution by hand.
- **Equilibrium of the snake draft**: the subgame-perfect path and value, the two hands with their breakdown, the placements numbered 1–4 on the board (P1 red, P2 blue), every Nash equilibrium outcome path, every tie node (with on/off-path flags), the snake vs alternate-order (P1, P2, P1, P2) comparison, and the exact game over individual corners as a check on the category shortcut.
- **Play the draft**: play as P1 or P2 against the computer, which plays the subgame-perfect strategy. It shows the lead under optimal play from the current position and what each of your choices cost.

## Open it

Double-click `index.html`, or open it from `file://`. All the data is embedded, so no server is needed. To serve it locally instead, run `python3 -m http.server` in this folder and open <http://localhost:8000>.

## Live version

<https://jadonjzhu.github.io/catan-opening-game-theory/webapp/>

## Run the tests

```sh
node test.mjs
```

Requires Node 18 or later and no packages; it takes about half a minute. It checks:

- **Baseline** against `../data/results.json`: weights, supply, every vertex category, the top 4 spots per category (vertex, value, breakdown), the SPE (path, value, both hands with vertices, categories, production, ports and breakdown), the root values, the reply matrix, the NE outcomes (and that the value-optimal paths are the same set), the tie nodes, the leaf and decision-node counts, the alternate-order solution, the vertex-level game (value, vertices, categories, best openings), and the value, mover, best moves and children of every one of the 339 tree nodes.
- **All 442 rows** of `../data/sensitivity.json` (scarcity on/off × δ × σ): path, value, number of NE outcomes, port settlements in the SPE, alternate-order value, and the vertex-game value on the 48 rows that have it, to within 1e-3.
- `board-data.js` deep-equals `../data/board.json`.

It prints a pass/fail count and exits with a nonzero status if any check fails. After rerunning `../analysis/run_all.py`, regenerate `board-data.js` (below) and rerun the test.

## Regenerating `board-data.js`

If `../data/board.json` changes, run this from this folder:

```sh
node -e 'const fs=require("fs");const b=JSON.parse(fs.readFileSync("../data/board.json","utf8"));fs.writeFileSync("board-data.js","/* Generated from ../data/board.json -- do not edit by hand. */\n(function (root) {\n  \"use strict\";\n  var BOARD = "+JSON.stringify(b)+";\n  if (typeof module === \"object\" && module.exports) module.exports = BOARD;\n  root.BOARD = BOARD;\n})(typeof globalThis !== \"undefined\" ? globalThis : this);\n")'
```

## Using the model from node

```js
const BOARD = require("./board-data.js");
const GM = require("./model.js");
const m = new GM.Model(BOARD, { delta: 1, sigma: 1, scarcity: true });
const nodes = m.tree(GM.SNAKE);       // history string -> node, e.g. nodes["B"].children
m.spe(GM.SNAKE, nodes);               // { path, value, S0, S1 }
m.neOutcomes(GM.SNAKE, nodes);        // every Nash equilibrium outcome path
m.replyMatrix(nodes);                 // P1 opening x P2 reply -> P1's lead
m.spe(GM.ALTERNATE);                  // P1, P2, P1, P2 for comparison
m.vertexGame();                       // exact solve over individual corners
m.solve();                            // everything the UI uses, in one call
```

## Notes

- The hexes are generic flat colors. The board layout is the beginner board of a popular hex-tile trading board game, and the app is not affiliated with its publisher.
- Ties inside the tree are broken by taking the first optimal category in C, R, B, P order, the same as the Python model; ties between corners inside a category go to the lowest corner id.
