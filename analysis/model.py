"""The opening snake draft as a two-player zero-sum game.

Units: "pips" = expected resource cards per 36 dice rolls.

Value of a hand S (a set of settlement vertices):

    V(S) = sum_r w_r * prod_S[r]          scarcity-weighted income
         + delta * Distinct(S)            one bonus per different resource produced
         + sigma * PortGain(S)            extra cards from trading at a port instead of the bank

    w_r          = (average board supply) / (board supply of r), or 1 if scarcity is off
    PortGain(S)  = sum_r (rate_S(r) - 1/4) * prod_S[r]
    rate_S(r)    = 1/2 if S owns the 2:1 port for r, else 1/3 if S owns a 3:1 port, else 1/4
                   (cards received per card given; the bank always trades 4:1)
    sigma        = share of a player's income they trade away (1 = all of it; an upper bound)

A port serves every card its owner produces, so a port is worth more when the
owner's OTHER settlement produces the matching resource.

Payoff (zero-sum): u1 = V(S1) - V(S2) = -u2. In a two-player game, anything that
helps the opponent hurts my chance of winning. Moves are deterministic, so replacing
the lead V(S1)-V(S2) with any increasing "win probability" f(lead) gives exactly the
same equilibria.

Moves are made at the CATEGORY level: choosing category k means "take the best
still-legal vertex in category k" (legal = not taken and not next to a taken
vertex, i.e. the distance rule; best = largest increase in my own V).
"""
from __future__ import annotations

from dataclasses import dataclass
import numpy as np

from board import RESOURCES, load

CATS = ["C", "R", "B", "P"]
CAT_NAMES = {"C": "City (ore/grain)", "R": "Road (wood/brick)", "B": "Balanced", "P": "Port"}
SNAKE = [0, 1, 1, 0]        # P1, P2, P2, P1
ALTERNATE = [0, 1, 0, 1]    # comparison only
BANK = 0.25
TOL = 1e-9


@dataclass
class Params:
    delta: float = 1.0      # diversity bonus per distinct resource
    sigma: float = 1.0      # share of income traded (scales the port gain)
    scarcity: bool = True   # weight resources by board scarcity


def category(v) -> str | None:
    p = v["production"]
    tot = sum(p.values())
    if tot == 0:
        return None
    if v["port"] is not None:
        return "P"
    og, wb = p["ore"] + p["grain"], p["wood"] + p["brick"]
    if p["ore"] > 0 and p["grain"] > 0 and og >= wb and og >= 0.5 * tot:
        return "C"
    if p["wood"] > 0 and p["brick"] > 0 and wb >= 0.5 * tot:
        return "R"
    return "B"


class Model:
    def __init__(self, params: Params | None = None, board=None):
        self.p = params or Params()
        self.b = board or load()
        self.V = self.b["vertices"]
        self.cat = {v["id"]: category(v) for v in self.V}
        self.supply = {r: sum(h["pips"] for h in self.b["hexes"] if h["resource"] == r)
                       for r in RESOURCES}
        avg = sum(self.supply.values()) / len(RESOURCES)
        self.w = {r: (avg / self.supply[r]) if self.p.scarcity else 1.0 for r in RESOURCES}

    # ---- value of a hand ---------------------------------------------------
    def prod(self, S):
        out = {r: 0 for r in RESOURCES}
        for vid in S:
            for r, x in self.V[vid]["production"].items():
                out[r] += x
        return out

    def rates(self, S):
        ports = {self.V[v]["port"] for v in S if self.V[v]["port"]}
        return {r: 0.5 if r in ports else (1 / 3 if "any" in ports else BANK) for r in RESOURCES}

    def port_gain(self, S):
        pr, rt = self.prod(S), self.rates(S)
        return sum((rt[r] - BANK) * pr[r] for r in RESOURCES)

    def breakdown(self, S):
        pr = self.prod(S)
        inc = sum(self.w[r] * x for r, x in pr.items())
        div = self.p.delta * sum(1 for x in pr.values() if x > 0)
        port = self.p.sigma * self.port_gain(S)
        return {"income": inc, "diversity": div, "port": port, "total": inc + div + port}

    def value(self, S):
        return self.breakdown(S)["total"]

    def payoff(self, S0, S1):
        """P1's payoff (P2's is the negative)."""
        return self.value(S0) - self.value(S1)

    # ---- the draft ---------------------------------------------------------
    def legal(self, vid, taken):
        if vid in taken:
            return False
        return not any(n in taken for n in self.V[vid]["neighbors"])

    def best_in(self, cat, mine, taken):
        base = self.value(mine)
        best, bestval = None, None
        for v in self.V:
            vid = v["id"]
            if self.cat[vid] != cat or not self.legal(vid, taken):
                continue
            val = self.value(mine + [vid]) - base
            if bestval is None or val > bestval + 1e-12:
                best, bestval = vid, val
        return best

    def run_draft(self, order, choices):
        """Returns (S0, S1), or None if some choice has no legal vertex."""
        S = ([], [])
        taken = set()
        for pl, c in zip(order, choices):
            vid = self.best_in(c, S[pl], taken)
            if vid is None:
                return None
            S[pl].append(vid)
            taken.add(vid)
        return S

    def ranking(self, cat, k=4):
        vs = [v for v in self.V if self.cat[v["id"]] == cat]
        vs.sort(key=lambda v: -self.value([v["id"]]))
        return [(v["id"], self.value([v["id"]])) for v in vs[:k]]

    # ---- backward induction -----------------------------------------------
    def tree(self, order=SNAKE):
        """Solve the category game by backward induction.

        Returns a dict history -> node, where history is a string like "BC".
        Leaves have "value" (P1's payoff) and "S0"/"S1". Inner nodes have
        "mover", "children" {cat: value}, "value", "best" (all value-optimal
        categories) and "choice" (the tie-break pick, first in C,R,B,P order).
        P1 maximizes the value and P2 minimizes it.
        """
        nodes = {}

        def solve(hist):
            k = len(hist)
            if k == len(order):
                S0, S1 = self.run_draft(order, hist)
                val = self.payoff(S0, S1)
                nodes["".join(hist)] = {"leaf": True, "value": val, "S0": S0, "S1": S1}
                return val
            pl = order[k]
            children = {}
            for c in CATS:
                if self.run_draft(order[:k + 1], hist + [c]) is None:
                    continue
                children[c] = solve(hist + [c])
            sign = 1 if pl == 0 else -1
            top = max(sign * v for v in children.values())
            best = [c for c in CATS if c in children and sign * children[c] >= top - TOL]
            nodes["".join(hist)] = {"leaf": False, "mover": pl, "children": children,
                                    "value": sign * top, "best": best, "choice": best[0]}
            return sign * top

        solve([])
        return nodes

    def spe(self, order=SNAKE, nodes=None):
        nodes = nodes or self.tree(order)
        h = ""
        while not nodes[h]["leaf"]:
            h += nodes[h]["choice"]
        leaf = nodes[h]
        return {"path": list(h), "value": leaf["value"], "S0": leaf["S0"], "S1": leaf["S1"],
                "payoffs": (leaf["value"], -leaf["value"])}

    def ne_outcomes(self, order=SNAKE, nodes=None):
        """Every terminal path that is the outcome of SOME Nash equilibrium.

        Test, straight from the definition: path z is an NE outcome iff no mover
        on the path can gain by deviating when the opponent answers the deviation
        as harshly as possible. In a zero-sum game the harshest answer is the
        opponent's optimal play, so the deviator gets the backward-induction
        value of the subtree they deviate into.
        """
        nodes = nodes or self.tree(order)
        out = []
        for h, nd in nodes.items():
            if not nd["leaf"]:
                continue
            uz = nd["value"]
            ok = True
            for k in range(len(h)):
                parent = nodes[h[:k]]
                sign = 1 if parent["mover"] == 0 else -1
                if any(sign * v > sign * uz + TOL for c, v in parent["children"].items() if c != h[k]):
                    ok = False
                    break
            if ok:
                out.append(h)
        return out

    def optimal_paths(self, order=SNAKE, nodes=None):
        """Paths that take a value-optimal category at every node (all tie-breaks)."""
        nodes = nodes or self.tree(order)
        out = []

        def walk(h):
            nd = nodes[h]
            if nd["leaf"]:
                out.append(h)
                return
            for c in nd["best"]:
                walk(h + c)

        walk("")
        return out

    # ---- exact game over individual vertices (robustness check) ----------
    def vertex_game(self):
        """Snake draft where each move picks a specific vertex (no categories).

        P1's last pick is a best reply, and P2's two picks in a row are one joint
        choice, so the game reduces to: P1 picks v1; P2 picks a pair (v2, v3);
        P1 picks v4. Solved exactly with numpy.
        """
        n = len(self.V)
        prod_v = np.array([[v["production"][r] for r in RESOURCES] for v in self.V], float)
        PV = np.zeros((n, n))
        for a in range(n):
            for b in range(n):
                PV[a, b] = self.value([a] if a == b else [a, b])
        block = np.eye(n, dtype=bool)
        for v in self.V:
            for u in v["neighbors"]:
                block[v["id"], u] = True
        producing = prod_v.sum(1) > 0
        best_overall = None
        root = {}
        for v1 in range(n):
            if not producing[v1]:
                continue
            free1 = ~block[v1] & producing
            worst = None  # P2 minimizes P1's payoff
            for v2 in np.flatnonzero(free1):
                free2 = free1 & ~block[v2]
                for v3 in np.flatnonzero(free2):
                    if v3 == v2:
                        continue
                    free3 = free2 & ~block[v3]
                    if not free3.any():
                        continue
                    v4s = np.flatnonzero(free3)
                    k = v4s[np.argmax(PV[v1, v4s])]
                    val = PV[v1, k] - PV[v2, v3]
                    if worst is None or val < worst[0] - TOL:
                        worst = (val, int(v2), int(v3), int(k))
            root[v1] = worst
            if best_overall is None or worst[0] > best_overall[1][0] + TOL:
                best_overall = (v1, worst)
        v1, (val, v2, v3, v4) = best_overall
        return {"value": val, "P1": [v1, v4], "P2": [v2, v3],
                "cats": [self.cat[v1], self.cat[v2], self.cat[v3], self.cat[v4]],
                "root": {k: v[0] for k, v in root.items()}}
