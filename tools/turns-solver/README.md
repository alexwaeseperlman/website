# Turns solver toolkit

Everything lives in this one folder: the scripts expect the solver binaries and `levels6.json` in the working directory.

## Build (g++ with C++17)
    g++ -O2 -o turns turns.cpp
    g++ -O2 -std=c++17 -o lat2 lat2.cpp
Then check both against every stored par:
    python3 cpp_check.py      # turns.cpp
    python3 lat2_check.py     # lat2.cpp

## Solvers
- `turns.cpp` / `cpp.py`: exact BFS. Turns (ccw/cw, minimal angle), mirrors with an optional flip budget, links, arrows. Lists every legal selection up front, so it's best on small and medium boards.
- `lat2.cpp` / `lat.py`: piece-centric solver for big boards. A move is (centre, order, direction, which pieces' orbits turn); black dots are padding chosen so the turn is exactly the intended one. Bidirectional search for solving, random walks for proposing goals, fixed-angle tools (quarter/third turns), and a no-tilt mode (`lat.TILT = 90` or `60`) to test whether tilted squares/triangles are required. No mirrors.
- `solver2.py`: the original pure-Python BFS. Slow, but the only one that handles the add-points (building) tool.

## Level format
    { "pts": [[x,y],...],
      "tools": ["ccw","cw"] | ["cw"] | ["r90","r-90"] | ["r120","r-120"] | ["m","ccw","cw"],
      "start": ["r", null, "g", ...],          colour per dot: r, g, y or null
      "goal": [[dotIndex, "r"], ...],
      "links": [[a,b], ...], "arrows": [[from,to], ...],   dot indices at the start
      "flips": 1 }                              optional mirror budget (turns.cpp only)

## Examples
    import json, cpp, lat
    L = json.load(open('levels6.json'))
    lv = next(l for l in L if l['name'] == 'Gauntlet')
    print(cpp.solve(lv))                    # (17, [[dots, 0], ...]); full moves in cpp.solve.last
    print(lat.solve(lv, tl=60)[0])          # par via bidirectional search
    print(lat.explore(lv, tl=60)['maxdepth'])

## Design scripts
- `lattices.py`: board generators (square, hexagon, triangle, rhombus, honeycomb).
- `chal_layouts.py`: the small hand-made Challenge boards.
- `free_search.py`, `hole_search.py`, `lat_search3.py`, `chal_new.py`: random searches for deep levels (full boards, holes that force tilted shapes, far tethers, small challenge boards). Each takes `<seed> <seconds>` and appends JSON lines to a results file. They parallelise perfectly: run several seeds at once on a multi-core machine.
- `gen_sol.py`: regenerates a full par solution for every level (used by the in-game Shapes hints).
- `gen.py`, `lv2.py`, `shapes.py`: older level-generation helpers some scripts still import.

## Data
- `levels6.json`: the current 50 levels, with par, hint sizes and stored solutions.
- `levels6_with_mirrors.json`, `levels6_with_building.json`: earlier sets including the removed Mirror and Building levels.

## Note
`lat2`'s padding search is heuristic, so on very large boards a par could in rare cases be beatable. Every shipped par was cross-checked against `turns.cpp` where feasible.

## Tie-break on dots
Both solvers break ties between equally short solutions by the total number of dots selected, so the
stored solutions (and the Shapes and dots-per-move hints built from them) never select more than they need.
`turns.cpp` finishes the goal layer of its BFS keeping the cheapest way into each state; `lat2.cpp` keeps
the cheapest cost per state on both sides and picks the cheapest meeting state among those at par.

To refresh the game's solutions after changing levels: run `python3 gen_sol.py`, then copy each level's
`sol` from `sols.json` into `public/turns/index.html` (and set `parMoves` to `[[len(s), 0], ...]`).

Build outputs (`turns`, `lat2`, `sols.json`, `results*.jsonl`) are ignored by git.
