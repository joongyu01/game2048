/*
 * game2048 — pure rules engine
 * ---------------------------------------------------------------------------
 * No DOM, no timers, no storage. Everything here is a pure function over a
 * board so it can be unit-tested in Node and driven by any front-end.
 *
 * Board shape: board[y][x] -> tile | null          (row-major, 4x4)
 * Tile:        { id, value, x, y, prev:{x,y}, merged }
 *
 * The move algorithm is a single traversal pass per direction. Tiles are
 * visited from the destination edge inward, so each tile resolves against a
 * neighbour that has already settled. That ordering is what produces the
 * canonical 2048 behaviour: `2 2 2 2` becomes `4 4`, never `8`.
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Game2048 = factory();
})(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  const SIZE = 4;

  const DIRS = {
    up: { x: 0, y: -1 },
    right: { x: 1, y: 0 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
  };

  let uid = 0;
  const newId = () => ++uid;

  const emptyGrid = () =>
    Array.from({ length: SIZE }, () => Array(SIZE).fill(null));

  const cloneGrid = (g) => g.map((row) => row.slice());

  const samePos = (a, b) => a.x === b.x && a.y === b.y;

  function cellAt(g, p) {
    if (p.y < 0 || p.y >= SIZE || p.x < 0 || p.x >= SIZE) return undefined;
    return g[p.y][p.x];
  }

  function put(g, p, v) {
    g[p.y][p.x] = v;
  }

  /* Walk from `pos` in `dir` while cells are empty.
     Returns the last empty square and whatever stopped the walk. */
  function findFarthest(g, pos, dir) {
    let prev = pos;
    let here = { x: pos.x, y: pos.y };
    let c;
    do {
      prev = here;
      here = { x: here.x + dir.x, y: here.y + dir.y };
      c = cellAt(g, here);
    } while (c !== undefined && c === null);
    return {
      emptyPosition: prev,
      obstacle:
        c === undefined
          ? { type: "boundary" }
          : { type: "tile", tile: c, position: here },
    };
  }

  /* Drop one tile on a uniformly random empty square.
     90% twos, 10% fours. Mutates and returns the grid. */
  function spawn(g) {
    const empties = [];
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) if (!g[y][x]) empties.push({ x, y });
    if (!empties.length) return null;
    const pos = empties[Math.floor(Math.random() * empties.length)];
    const tile = {
      id: newId(),
      value: Math.random() < 0.9 ? 2 : 4,
      x: pos.x,
      y: pos.y,
      prev: { x: pos.x, y: pos.y },
      merged: false,
    };
    put(g, pos, tile);
    return tile;
  }

  /*
   * Apply one move. Returns a new board plus the animation plan:
   *   moves  — tiles that slid, with origin and destination
   *   merges — the two halves that collide and the tile they become
   * `gained` is the score earned by this move.
   */
  function applyMove(grid, dir) {
    /* Fresh tile objects every pass: coordinates are re-derived from the
       board and the per-move `merged` guard is cleared. Without this a tile
       produced by a merge last turn could never merge again. */
    const g = grid.map((row, y) =>
      row.map((t, x) =>
        t ? { id: t.id, value: t.value, x, y, prev: { x, y }, merged: false } : null
      )
    );

    const xs = [0, 1, 2, 3];
    const ys = [0, 1, 2, 3];
    if (dir.x === 1) xs.reverse();
    if (dir.y === 1) ys.reverse();

    let moved = false;
    let gained = 0;
    const movedIds = new Set();
    const moves = [];
    const merges = [];

    for (const x of xs) {
      for (const y of ys) {
        const pos = { x, y };
        const tile = g[y][x];
        if (!tile) continue;

        const far = findFarthest(g, pos, dir);
        const blocker = far.obstacle.type === "tile" ? far.obstacle : null;
        const canMerge =
          blocker &&
          !tile.merged &&
          !blocker.tile.merged &&
          blocker.tile.value === tile.value;

        if (!canMerge) {
          if (samePos(pos, far.emptyPosition)) continue;
          const dest = far.emptyPosition;
          put(g, pos, null);
          put(g, dest, {
            id: tile.id,
            value: tile.value,
            x: dest.x,
            y: dest.y,
            prev: { x: pos.x, y: pos.y },
            merged: false,
          });
          movedIds.add(tile.id);
          moves.push({ id: tile.id, from: pos, to: dest });
        } else {
          const dest = blocker.position;
          const target = blocker.tile;
          /* If the blocker already slid this turn, its visual origin is
             where it came from, not where it now sits. */
          const originB = movedIds.has(target.id)
            ? { x: target.prev.x, y: target.prev.y }
            : { x: target.x, y: target.y };

          const result = {
            id: newId(),
            value: tile.value + target.value,
            x: dest.x,
            y: dest.y,
            prev: { x: dest.x, y: dest.y },
            merged: true,
          };
          put(g, pos, null);
          put(g, dest, result);
          merges.push({
            result,
            a: { id: tile.id, value: tile.value, from: { ...pos }, to: { ...dest } },
            b: { id: target.id, value: target.value, from: originB, to: { ...dest } },
          });
          gained += result.value;
        }
        moved = true;
      }
    }

    return { moved, gained, grid: g, moves, merges };
  }

  /* A move exists if any square is empty, or any two orthogonal
     neighbours share a value. */
  function anyMoves(g) {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) if (!g[y][x]) return true;
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const t = g[y][x];
        for (const d of Object.values(DIRS)) {
          const { obstacle } = findFarthest(g, { x, y }, d);
          if (obstacle.type === "tile" && obstacle.tile.value === t.value) return true;
        }
      }
    }
    return false;
  }

  function highest(g) {
    let m = 0;
    for (const row of g) for (const t of row) if (t && t.value > m) m = t.value;
    return m;
  }

  /* ---- serialisation (plain numbers, safe for localStorage / JSON) ---- */

  const serialize = (g) => g.map((row) => row.map((t) => (t ? t.value : 0)));

  function hydrate(g, values) {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++) {
        const v = values[y] && values[y][x];
        g[y][x] = v
          ? { id: newId(), value: v, x, y, prev: { x, y }, merged: false }
          : null;
      }
    return g;
  }

  return {
    SIZE,
    DIRS,
    newId,
    emptyGrid,
    cloneGrid,
    applyMove,
    spawn,
    anyMoves,
    highest,
    serialize,
    hydrate,
  };
});
