"""Board geometry and data for the beginner-board Catan opening model.

Builds the 19 land hexes, the 54 settlement vertices, adjacency between vertices
(for the distance rule), and port locations. Writes data/board.json.

The hex/number layout and the port positions are the rulebook beginner
("starting set-up") board. Port positions were checked against a photo of a
physical copy (Nov 2026).
"""
from __future__ import annotations

import json
import math
from pathlib import Path

DATA = Path(__file__).resolve().parent.parent / "data"

PIPS = {2: 1, 3: 2, 4: 3, 5: 4, 6: 5, 8: 5, 9: 4, 10: 3, 11: 2, 12: 1}
RESOURCES = ["wood", "brick", "wool", "grain", "ore"]

# Rows top -> bottom, left -> right: (resource, number). None number = desert.
LAYOUT = [
    [("ore", 10), ("wool", 2), ("wood", 9)],
    [("grain", 12), ("brick", 6), ("wool", 4), ("brick", 10)],
    [("grain", 9), ("wood", 11), ("desert", None), ("wood", 3), ("ore", 8)],
    [("wood", 8), ("ore", 3), ("grain", 4), ("wool", 5)],
    [("brick", 5), ("grain", 6), ("wool", 11)],
]

# Ports, clockwise from the top-left. "any" = 3:1 generic; a resource name = 2:1
# for that resource. Each port sits on one coastal edge, given as an index into
# the 30 coastal edges sorted clockwise (see build()); the comment names the land
# hex the edge belongs to and which side of that hex it is.
PORTS = [
    ("any", 29),    # ore 10, NW side      (top-left)
    ("grain", 2),   # wool 2, NE side      (top)
    ("ore", 6),     # brick 10, NE side    (top-right)
    ("any", 9),     # ore 8, E side        (right)
    ("wool", 12),   # wool 5, SE side      (bottom-right)
    ("any", 16),    # grain 6, SE side     (bottom)
    ("any", 19),    # brick 5, SW side     (bottom-left)
    ("brick", 22),  # wood 8, W side       (left)
    ("wood", 26),   # grain 12, W side     (top-left)
]
PORT_TYPES = [t for t, _ in PORTS]
PORTS_VERIFIED = True

SQ3 = math.sqrt(3)


def hex_centers():
    out = []
    for r, row in enumerate(LAYOUT):
        n = len(row)
        for i, (res, num) in enumerate(row):
            x = (i - (n - 1) / 2) * SQ3
            y = r * 1.5
            out.append({"id": len(out), "row": r, "col": i, "resource": res,
                        "number": num, "pips": PIPS.get(num, 0), "x": x, "y": y})
    return out


def corners(x, y):
    # pointy-top hex, circumradius 1
    return [(x + math.cos(math.radians(60 * k - 90)), y + math.sin(math.radians(60 * k - 90)))
            for k in range(6)]


def key(p):
    return (round(p[0], 3), round(p[1], 3))


def build():
    hexes = hex_centers()
    vmap: dict = {}
    vertices = []
    edges = set()
    for h in hexes:
        cs = [key(c) for c in corners(h["x"], h["y"])]
        ids = []
        for c in cs:
            if c not in vmap:
                vmap[c] = len(vertices)
                vertices.append({"id": len(vertices), "x": c[0], "y": c[1], "hexes": []})
            ids.append(vmap[c])
            vertices[vmap[c]]["hexes"].append(h["id"])
        for k in range(6):
            a, b = ids[k], ids[(k + 1) % 6]
            edges.add((min(a, b), max(a, b)))

    nbrs = {v["id"]: set() for v in vertices}
    for a, b in edges:
        nbrs[a].add(b)
        nbrs[b].add(a)

    # Coastal edges = edges belonging to exactly one hex.
    edge_count: dict = {}
    for h in hexes:
        cs = [vmap[key(c)] for c in corners(h["x"], h["y"])]
        for k in range(6):
            e = tuple(sorted((cs[k], cs[(k + 1) % 6])))
            edge_count[e] = edge_count.get(e, 0) + 1
    coast = [e for e, c in edge_count.items() if c == 1]

    # Order coastal edges clockwise by angle of midpoint around board centre.
    cx = sum(v["x"] for v in vertices) / len(vertices)
    cy = sum(v["y"] for v in vertices) / len(vertices)

    def ang(e):
        mx = (vertices[e[0]]["x"] + vertices[e[1]]["x"]) / 2 - cx
        my = (vertices[e[0]]["y"] + vertices[e[1]]["y"]) / 2 - cy
        # start at top-left, go clockwise (screen coords: y down)
        return (math.atan2(my, mx) + math.pi / 2 + 0.35) % (2 * math.pi)

    coast.sort(key=ang)
    assert len(coast) == 30, len(coast)
    port_edges = [coast[i] for _, i in PORTS]
    ports = []
    for t, e in zip(PORT_TYPES, port_edges):
        ports.append({"type": t, "vertices": list(e)})
        for vid in e:
            vertices[vid]["port"] = t

    for v in vertices:
        v["neighbors"] = sorted(nbrs[v["id"]])
        v.setdefault("port", None)
        prod = {r: 0 for r in RESOURCES}
        for hid in v["hexes"]:
            h = hexes[hid]
            if h["resource"] in prod:
                prod[h["resource"]] += h["pips"]
        v["production"] = prod
    return {"hexes": hexes, "vertices": vertices, "ports": ports,
            "ports_verified": PORTS_VERIFIED, "pips_table": PIPS}


def load():
    p = DATA / "board.json"
    if not p.exists():
        save()
    return json.loads(p.read_text())


def save():
    DATA.mkdir(parents=True, exist_ok=True)
    b = build()
    (DATA / "board.json").write_text(json.dumps(b, indent=1))
    return b


if __name__ == "__main__":
    b = save()
    print(len(b["hexes"]), "hexes,", len(b["vertices"]), "vertices,", len(b["ports"]), "ports")
