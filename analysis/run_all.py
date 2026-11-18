"""Run the whole analysis: board, solution, all-NE check, robustness, figures, paper tables.

    cd analysis && ../.venv/bin/python run_all.py      (~4 min, mostly the sensitivity grid)
    ../.venv/bin/python run_all.py --reuse-grid        (seconds: reuse data/sensitivity.json)
"""
from __future__ import annotations

import json
import sys
from collections import Counter
from pathlib import Path

import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from matplotlib.patches import RegularPolygon
import numpy as np

import board as boardmod
from board import RESOURCES
from model import ALTERNATE, CATS, CAT_NAMES, SNAKE, Model, Params

ROOT = Path(__file__).resolve().parent.parent
DATA, FIG = ROOT / "data", ROOT / "figures"
FIG.mkdir(exist_ok=True)
DEFAULT = Params()

RES_COLORS = {"wood": "#2e7d32", "brick": "#c0573e", "wool": "#9ccc65", "grain": "#f2c14e",
              "ore": "#8d99ae", "desert": "#e8d8b0"}
CAT_COLORS = {"C": "#5b6cff", "R": "#e4572e", "B": "#17a398", "P": "#8e44ad"}
P1C, P2C = "#d62828", "#1d3557"

DELTAS = [round(x, 2) for x in np.arange(0, 3.01, 0.25)]
SIGMAS = [round(x, 2) for x in np.arange(0, 4.01, 0.25)]
VERTEX_CHECK = {"delta": [0.0, 1.0, 2.0, 3.0], "sigma": [0.0, 0.5, 1.0, 2.0, 3.0, 4.0]}


def r3(x):
    return round(float(x), 3)


def hand(m, S):
    bd = m.breakdown(S)
    return {"vertices": S, "categories": [m.cat[v] for v in S],
            "production": m.prod(S), "ports": [m.V[v]["port"] for v in S if m.V[v]["port"]],
            **{k: r3(x) for k, x in bd.items()}}


def main():
    b = boardmod.save()
    m = Model(DEFAULT, b)
    nodes = m.tree(SNAKE)
    spe = m.spe(SNAKE, nodes)
    ne = m.ne_outcomes(SNAKE, nodes)
    opt = m.optimal_paths(SNAKE, nodes)
    assert set(ne) == set(opt), (ne, opt)   # theory: NE outcomes = value-optimal paths
    alt = m.spe(ALTERNATE)
    vg = m.vertex_game()
    assert abs(vg["value"] - spe["value"]) < 1e-6, (vg["value"], spe["value"])

    top = {c: [{"vertex": vid, "value": r3(val), "production": m.V[vid]["production"],
                "port": m.V[vid]["port"], "breakdown": {k: r3(x) for k, x in m.breakdown([vid]).items()}}
               for vid, val in m.ranking(c, 4)] for c in CATS}
    # P1 opening x P2 first reply -> P1's value after optimal play of the last two moves
    reply = {a: {c: r3(nodes[a]["children"][c]) for c in nodes[a]["children"]}
             for a in nodes[""]["children"]}
    ties = [{"history": h, "mover": "P1" if n["mover"] == 0 else "P2", "best": n["best"],
             "value": r3(n["value"]), "on_path": "".join(spe["path"]).startswith(h)}
            for h, n in nodes.items() if not n["leaf"] and len(n["best"]) > 1]

    results = {
        "params": DEFAULT.__dict__, "categories": CATS, "category_names": CAT_NAMES,
        "weights": {r: round(w, 4) for r, w in m.w.items()}, "supply": m.supply,
        "category_counts": dict(Counter(c for c in m.cat.values() if c)),
        "vertex_category": m.cat, "top_spots": top,
        "spe": {"path": spe["path"], "value": r3(spe["value"]),
                "P1": hand(m, spe["S0"]), "P2": hand(m, spe["S1"])},
        "root": {c: r3(v) for c, v in nodes[""]["children"].items()},
        "reply_matrix": reply,
        "ne_outcomes": ne, "ties": ties,
        "n_leaves": sum(1 for n in nodes.values() if n["leaf"]),
        "n_decision_nodes": sum(1 for n in nodes.values() if not n["leaf"]),
        "alternate": {"path": alt["path"], "value": r3(alt["value"]),
                      "P1": hand(m, alt["S0"]), "P2": hand(m, alt["S1"])},
        "vertex_game": {"value": r3(vg["value"]), "P1": vg["P1"], "P2": vg["P2"], "cats": vg["cats"],
                        "best_openings": sorted(((r3(v), k) for k, v in vg["root"].items()), reverse=True)[:5]},
        "nodes": {h: ({"value": r3(n["value"])} if n["leaf"] else
                      {"mover": n["mover"], "value": r3(n["value"]), "best": n["best"],
                       "children": {c: r3(v) for c, v in n["children"].items()}})
                  for h, n in nodes.items()},
    }

    # ---- robustness grid ------------------------------------------------
    grid = []
    if "--reuse-grid" in sys.argv and (DATA / "sensitivity.json").exists():
        grid = json.loads((DATA / "sensitivity.json").read_text())
    for sc in ((True, False) if not grid else ()):
        for d in DELTAS:
            for s in SIGMAS:
                mm = Model(Params(delta=d, sigma=s, scarcity=sc), b)
                nd = mm.tree(SNAKE)
                sp = mm.spe(SNAKE, nd)
                row = {"scarcity": sc, "delta": d, "sigma": s, "path": "".join(sp["path"]),
                       "value": r3(sp["value"]), "n_ne_outcomes": len(mm.ne_outcomes(SNAKE, nd)),
                       "ports_in_spe": sum(1 for v in sp["S0"] + sp["S1"] if mm.V[v]["port"]),
                       "alt_value": r3(mm.spe(ALTERNATE)["value"])}
                if d in VERTEX_CHECK["delta"] and s in VERTEX_CHECK["sigma"]:
                    row["vertex_value"] = r3(mm.vertex_game()["value"])
                grid.append(row)
    (DATA / "sensitivity.json").write_text(json.dumps(grid))
    results["sensitivity_summary"] = summarize(grid)
    (DATA / "results.json").write_text(json.dumps(results, indent=1))

    figures(m, nodes, spe, grid)
    tex_tables(m, results)
    print(json.dumps({k: results[k] for k in ["spe", "root", "ne_outcomes", "ties", "alternate",
                                              "vertex_game", "sensitivity_summary"]}, indent=1))


def summarize(grid):
    on = [g for g in grid if g["scarcity"]]
    off = [g for g in grid if not g["scarcity"]]
    conv = [g for g in on if g["sigma"] <= 1]
    checked = [g for g in grid if "vertex_value" in g]

    def first_sigma_with_port(rows):
        out = {}
        for d in DELTAS:
            ss = [g["sigma"] for g in rows if g["delta"] == d and g["ports_in_spe"] > 0]
            out[str(d)] = min(ss) if ss else None
        return out

    return {
        "n_settings": len(grid),
        "baseline_path_share_conversion_range": round(sum(g["path"] == "BCRB" for g in conv) / len(conv), 3),
        "paths_scarcity_on": dict(Counter(g["path"] for g in on).most_common()),
        "paths_scarcity_off": dict(Counter(g["path"] for g in off).most_common()),
        "first_move_scarcity_on": dict(Counter(g["path"][0] for g in on)),
        "first_move_scarcity_off": dict(Counter(g["path"][0] for g in off)),
        "first_move_off_conversion_range": dict(Counter(g["path"][0] for g in off if g["sigma"] <= 1)),
        "port_threshold_sigma": first_sigma_with_port(on),
        "value_range": [min(g["value"] for g in grid), max(g["value"] for g in grid)],
        "p1_ahead_share": round(sum(g["value"] > 1e-9 for g in grid) / len(grid), 3),
        "snake_helps_p2_share": round(sum(g["value"] < g["alt_value"] - 1e-9 for g in grid) / len(grid), 3),
        "unique_ne_outcome_share": round(sum(g["n_ne_outcomes"] == 1 for g in grid) / len(grid), 3),
        "unique_ne_outcome_share_conversion_range": round(sum(g["n_ne_outcomes"] == 1 for g in conv) / len(conv), 3),
        "vertex_checks": len(checked),
        "vertex_matches": sum(abs(g["vertex_value"] - g["value"]) < 1e-3 for g in checked),
        "vertex_max_abs_gap": max(round(abs(g["vertex_value"] - g["value"]), 3) for g in checked),
    }


# ---------------------------------------------------------------- figures
def draw_board(ax, m, highlight=None, annotate_cats=True, id_labels=()):
    for h in m.b["hexes"]:
        ax.add_patch(RegularPolygon((h["x"], -h["y"]), 6, radius=0.98, orientation=0,
                                    facecolor=RES_COLORS[h["resource"]], edgecolor="white", lw=2))
        if h["number"]:
            col = "#b00020" if h["number"] in (6, 8) else "black"
            ax.add_patch(plt.Circle((h["x"], -h["y"]), 0.32, color="#fdf6e3", zorder=3))
            ax.text(h["x"], -h["y"], str(h["number"]), ha="center", va="center", fontsize=10,
                    weight="bold", color=col, zorder=4)
    cy = -np.mean([h["y"] for h in m.b["hexes"]])
    for p in m.b["ports"]:
        xs = [m.V[v]["x"] for v in p["vertices"]]; ys = [-m.V[v]["y"] for v in p["vertices"]]
        ax.plot(xs, ys, color="#333", lw=4, solid_capstyle="round", zorder=2)
        mx, my = np.mean(xs), np.mean(ys)
        ax.text(mx * 1.2, cy + (my - cy) * 1.2, "3:1" if p["type"] == "any" else f"2:1\n{p['type']}",
                ha="center", va="center", fontsize=6.5, color="#333")
    if annotate_cats:
        for v in m.V:
            c = m.cat[v["id"]]
            if c is None:
                continue
            ax.add_patch(plt.Circle((v["x"], -v["y"]), 0.11, color=CAT_COLORS[c], zorder=5))
    if highlight:
        for vid, (lab, col) in highlight.items():
            ax.add_patch(plt.Circle((m.V[vid]["x"], -m.V[vid]["y"]), 0.22, facecolor=col,
                                    edgecolor="black", lw=1.5, zorder=6))
            ax.text(m.V[vid]["x"], -m.V[vid]["y"], lab, ha="center", va="center", fontsize=7,
                    color="white", weight="bold", zorder=7)
    for vid in id_labels:  # print the vertex id next to spots the paper names
        x, y = m.V[vid]["x"], -m.V[vid]["y"]
        dx, dy = x, y - cy
        n = max(np.hypot(dx, dy), 1e-9)
        ax.text(x + 0.42 * dx / n, y + 0.42 * dy / n, f"v{vid}", ha="center", va="center", fontsize=7,
                weight="bold", zorder=8, bbox=dict(boxstyle="round,pad=0.12", fc="white", ec="none", alpha=0.85))
    ax.set_aspect("equal"); ax.axis("off")
    ax.set_xlim(-5.4, 5.4); ax.set_ylim(-7.9, 1.9)


def figures(m, nodes, spe, grid):
    plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10})

    # 1. board with categories + top spot per category
    fig, ax = plt.subplots(figsize=(6.5, 6.5))
    hl = {m.ranking(c, 1)[0][0]: (c, CAT_COLORS[c]) for c in CATS}
    named = {v for c in CATS for v, _ in m.ranking(c, 2)} | set(spe["S0"]) | set(spe["S1"])
    draw_board(ax, m, highlight=hl, id_labels=sorted(named))
    for c in CATS:
        ax.scatter([], [], color=CAT_COLORS[c], label=CAT_NAMES[c])
    ax.legend(loc="lower center", ncol=2, frameon=False, bbox_to_anchor=(0.5, -0.12), fontsize=9)
    fig.savefig(FIG / "board_categories.png", dpi=200, bbox_inches="tight"); plt.close(fig)

    # 2. SPE placements on the board
    fig, ax = plt.subplots(figsize=(6.5, 6.5))
    S = {0: list(spe["S0"]), 1: list(spe["S1"])}
    cnt = {0: 0, 1: 0}
    hl = {}
    for t, pl in enumerate(SNAKE):
        vid = S[pl][cnt[pl]]; cnt[pl] += 1
        hl[vid] = (f"{t + 1}", P1C if pl == 0 else P2C)
    draw_board(ax, m, highlight=hl, annotate_cats=False, id_labels=list(hl))
    p = spe["path"]
    ax.set_title(f"Equilibrium draft: P1 (red) takes {p[0]} then {p[3]}; P2 (blue) takes {p[1]} then {p[2]}",
                 fontsize=10)
    fig.savefig(FIG / "sequential_board.png", dpi=200, bbox_inches="tight"); plt.close(fig)

    # 3. game tree: P1's opening, P2's first reply, values after optimal play
    fig, ax = plt.subplots(figsize=(10, 4.2)); ax.axis("off")
    ax.text(0.5, 0.95, "P1", ha="center", fontsize=11, weight="bold", bbox=dict(boxstyle="circle", fc="#fde2e2"))
    xs = np.linspace(0.12, 0.88, 4)
    root = nodes[""]
    for c, x in zip(CATS, xs):
        if c not in root["children"]:
            continue
        on = c == spe["path"][0]
        ax.plot([0.5, x], [0.92, 0.62], color=P1C if on else "#999", lw=2.5 if on else 1)
        ax.text((0.5 + x) / 2 - .02, 0.79, c, fontsize=10, weight="bold")
        ax.text(x, 0.57, "P2", ha="center", fontsize=9, bbox=dict(boxstyle="circle", fc="#dde6f5"))
        ax.text(x, 0.47, f"{root['children'][c]:+.2f}", ha="center", fontsize=10, weight="bold" if on else "normal")
        node = nodes[c]
        sub = np.linspace(x - .09, x + .09, len(node["children"]))
        for (c2, u2), x2 in zip(node["children"].items(), sub):
            on2 = c2 in node["best"]
            ax.plot([x, x2], [0.43, 0.25], color=P2C if on2 else "#bbb", lw=2 if on2 else .8)
            ax.text(x2, 0.21, c2, ha="center", fontsize=8, weight="bold")
            ax.text(x2, 0.15, f"{u2:+.2f}", ha="center", va="top", fontsize=7)
    ax.text(0.5, 0.0, "Numbers = P1's lead V(P1) − V(P2) after both players play the remaining moves optimally. "
            "P1 maximizes, P2 minimizes; thick lines = optimal moves.", ha="center", fontsize=8, style="italic")
    fig.savefig(FIG / "sequential_tree.png", dpi=200, bbox_inches="tight"); plt.close(fig)

    # 4. value breakdown of the best spot in each category
    fig, ax = plt.subplots(figsize=(6, 3.4))
    parts = [("income", "scarcity-weighted income", "#4c78a8"), ("diversity", "diversity bonus δ", "#f58518"),
             ("port", "port gain (σ = 1)", "#8e44ad")]
    bottoms = np.zeros(4)
    for key, lab, col in parts:
        vals = np.array([m.breakdown([m.ranking(c, 1)[0][0]])[key] for c in CATS])
        ax.bar(range(4), vals, bottom=bottoms, color=col, label=lab, width=0.6)
        bottoms += vals
    for i, t in enumerate(bottoms):
        ax.text(i, t + 0.2, f"{t:.2f}", ha="center", fontsize=9)
    ax.set_xticks(range(4), [f"{c}: v{m.ranking(c, 1)[0][0]}" for c in CATS])
    ax.set_ylabel("value V (pips per 36 rolls)")
    ax.set_title("Best single spot in each category", fontsize=10)
    ax.legend(frameon=False, fontsize=8, loc="upper center", ncol=3, bbox_to_anchor=(0.5, -0.12))
    ax.set_ylim(0, bottoms.max() * 1.12)
    fig.tight_layout(); fig.savefig(FIG / "value_breakdown.png", dpi=200); plt.close(fig)

    # 5. robustness over (delta, sigma), scarcity on
    on = [g for g in grid if g["scarcity"]]
    P = np.zeros((len(SIGMAS), len(DELTAS))); Vv = np.zeros_like(P); Same = np.zeros_like(P)
    for g in on:
        i, j = SIGMAS.index(g["sigma"]), DELTAS.index(g["delta"])
        P[i, j] = g["ports_in_spe"]; Vv[i, j] = g["value"]; Same[i, j] = g["path"] == "BCRB"
    ext = [DELTAS[0] - .125, DELTAS[-1] + .125, SIGMAS[0] - .125, SIGMAS[-1] + .125]
    fig, axs = plt.subplots(1, 2, figsize=(10, 4))
    cmap = plt.get_cmap("Purples", int(P.max()) + 1)
    im = axs[0].imshow(P, origin="lower", aspect="auto", cmap=cmap, extent=ext, vmin=-.5, vmax=P.max() + .5)
    fig.colorbar(im, ax=axs[0], ticks=range(int(P.max()) + 1), label="port settlements in the equilibrium")
    axs[0].contour(DELTAS, SIGMAS, Same, levels=[0.5], colors="#17a398", linewidths=2)
    axs[0].set_title("Port settlements in the equilibrium\n(below the teal line the draft is always B→C→R→B)", fontsize=9.5)
    im2 = axs[1].imshow(Vv, origin="lower", aspect="auto", cmap="RdBu", extent=ext,
                        vmin=-abs(Vv).max(), vmax=abs(Vv).max())
    fig.colorbar(im2, ax=axs[1], label="P1's lead in equilibrium (pips)")
    axs[1].set_title("Value of the game to P1", fontsize=10)
    for a in axs:
        a.axhline(1.0, color="black", ls="--", lw=1)
        a.text(DELTAS[-1], 1.05, "σ = 1: every card traded", ha="right", va="bottom", fontsize=7.5)
        a.plot(DEFAULT.delta, DEFAULT.sigma, "*", color="gold", mec="black", ms=13)
        a.set_xlabel("δ (diversity bonus)"); a.set_ylabel("σ (port weight)")
    fig.tight_layout(); fig.savefig(FIG / "sensitivity.png", dpi=200); plt.close(fig)


def tex_tables(m, res):
    out = ["% auto-generated by analysis/run_all.py -- do not edit"]
    w = m.w
    out.append("\\newcommand{\\weighttable}{%\n\\begin{tabular}{l" + "r" * 5 + "}\n\\toprule\n & " +
               " & ".join(w) + "\\\\\\midrule\nSupply (pips) & " + " & ".join(str(m.supply[r]) for r in w) +
               "\\\\\nWeight $w_r$ & " + " & ".join(f"{w[r]:.3f}" for r in w) + "\\\\\\bottomrule\\end{tabular}}\n")
    out.append("\\newcommand{\\topspots}{%\n\\begin{tabular}{llrl}\n\\toprule\nCat. & Vertex & $V$ & Production (pips)\\\\\\midrule")
    for c in CATS:
        for k, t in enumerate(res["top_spots"][c][:2]):
            prod = ", ".join(f"{r} {x}" for r, x in t["production"].items() if x)
            port = f"; {'3:1' if t['port'] == 'any' else '2:1 ' + t['port']} port" if t["port"] else ""
            out.append(f"{c if k == 0 else ''} & $v_{{{t['vertex']}}}$ & {t['value']:.2f} & {prod}{port}\\\\")
    out.append("\\bottomrule\\end{tabular}}\n")
    # reply matrix: rows P1 opening, cols P2 first reply
    rm = res["reply_matrix"]
    out.append("\\newcommand{\\replytable}{%\n\\begin{tabular}{c|cccc|c}\n & " +
               " & ".join(f"\\textbf{{{c}}}" for c in CATS) + " & row min\\\\\\hline")
    for a in CATS:
        if a not in rm:
            continue
        row = rm[a]; lo = min(row.values())
        cells = [("$\\mathbf{%+.2f}$" % row[c] if abs(row[c] - lo) < 1e-9 else "$%+.2f$" % row[c]) if c in row else "--"
                 for c in CATS]
        best = abs(lo - res["spe"]["value"]) < 1e-9
        out.append(f"\\textbf{{{a}}} & " + " & ".join(cells) + (" & $\\boxed{%+.2f}$\\\\" % lo if best else " & $%+.2f$\\\\" % lo))
    out.append("\\end{tabular}}\n")
    # SPE hands
    out.append("\\newcommand{\\handtable}{%\n\\begin{tabular}{lllrrrr}\n\\toprule\nPlayer & Spots & Production (pips) & Income & Diversity & Port & $V$\\\\\\midrule")
    for pl in ("P1", "P2"):
        h = res["spe"][pl]
        prod = ", ".join(f"{r} {x}" for r, x in h["production"].items() if x)
        spots = ", ".join(f"$v_{{{v}}}$ ({c})" for v, c in zip(h["vertices"], h["categories"]))
        out.append(f"{pl} & {spots} & {prod} & {h['income']:.2f} & {h['diversity']:.2f} & {h['port']:.2f} & {h['total']:.2f}\\\\")
    out.append("\\bottomrule\\end{tabular}}\n")
    # worked example: the last two moves after the SPE's first two moves
    pre = "".join(res["spe"]["path"][:2]); nd = res["nodes"]
    out.append("\\newcommand{\\workedprefix}{" + "\\to ".join(pre) + "}")
    out.append("\\newcommand{\\workedtable}{%\n\\begin{tabular}{c|cccc|c}\n & " +
               " & ".join(f"\\textbf{{{c}}}" for c in CATS) + " & row max\\\\\\hline")
    for a3 in [c for c in CATS if pre + c in nd]:
        row = {c: nd[pre + a3 + c]["value"] for c in CATS if pre + a3 + c in nd}
        hi = max(row.values())
        cells = [("$\\mathbf{%+.2f}$" % row[c] if abs(row[c] - hi) < 1e-9 else "$%+.2f$" % row[c]) if c in row else "--"
                 for c in CATS]
        best = abs(hi - nd[pre]["value"]) < 1e-9
        out.append(f"\\textbf{{{a3}}} & " + " & ".join(cells) +
                   (" & $\\boxed{%+.2f}$\\\\" % hi if best else " & $%+.2f$\\\\" % hi))
    out.append("\\end{tabular}}\n")
    (ROOT / "paper" / "tables.tex").write_text("\n".join(out))


if __name__ == "__main__":
    main()
