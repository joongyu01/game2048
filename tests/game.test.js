/*
 * Rules tests.  Run with:  node --test
 * No dependencies — uses the built-in test runner.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const G = require("../game.js");

/* Build a board from an ASCII spec: digits, or "." for empty. */
function parse(spec) {
  const g = G.emptyGrid();
  spec
    .trim()
    .split("\n")
    .forEach((line, y) => {
      line
        .trim()
        .split(/\s+/)
        .forEach((tok, x) => {
          if (tok === ".") return;
          g[y][x] = {
            id: 1e6 + y * 10 + x,
            value: parseInt(tok, 10),
            x,
            y,
            prev: { x, y },
            merged: false,
          };
        });
    });
  return g;
}

const values = (g) => G.serialize(g);
const move = (spec, dir) => G.applyMove(parse(spec), G.DIRS[dir]);

function expectMove(spec, dir, expected, gained) {
  const res = move(spec, dir);
  assert.deepEqual(
    values(res.grid),
    values(parse(expected)),
    `${dir} produced the wrong board`
  );
  if (gained !== undefined) assert.equal(res.gained, gained, "wrong score");
  return res;
}

/* ---------------------------------------------------------------- merging */

test("two equal neighbours merge", () => {
  expectMove("2 2 . .\n. . . .\n. . . .\n. . . .", "left", "4 . . .\n. . . .\n. . . .\n. . . .", 4);
  expectMove("2 2 . .\n. . . .\n. . . .\n. . . .", "right", ". . . 4\n. . . .\n. . . .\n. . . .", 4);
  expectMove("2 . . .\n2 . . .\n. . . .\n. . . .", "up", "4 . . .\n. . . .\n. . . .\n. . . .", 4);
  expectMove("2 . . .\n2 . . .\n. . . .\n. . . .", "down", ". . . .\n. . . .\n. . . .\n4 . . .", 4);
});

test("a full row of four becomes two pairs, not one tile", () => {
  expectMove("2 2 2 2\n. . . .\n. . . .\n. . . .", "left", "4 4 . .\n. . . .\n. . . .\n. . . .", 8);
  expectMove("2 2 2 2\n. . . .\n. . . .\n. . . .", "right", ". . 4 4\n. . . .\n. . . .\n. . . .", 8);
  expectMove("4 . . .\n4 . . .\n4 . . .\n4 . . .", "down", ". . . .\n. . . .\n8 . . .\n8 . . .", 16);
});

test("three in a row merges the far pair first", () => {
  expectMove("2 2 2 .\n. . . .\n. . . .\n. . . .", "left", "4 2 . .\n. . . .\n. . . .\n. . . .", 4);
  expectMove("2 2 2 .\n. . . .\n. . . .\n. . . .", "right", ". . 2 4\n. . . .\n. . . .\n. . . .", 4);
});

test("a tile only merges once per move", () => {
  expectMove("4 2 2 .\n. . . .\n. . . .\n. . . .", "left", "4 4 . .\n. . . .\n. . . .\n. . . .", 4);
  expectMove("2 2 4 4\n. . . .\n. . . .\n. . . .", "left", "4 8 . .\n. . . .\n. . . .\n. . . .", 12);
  expectMove("4 4 2 2\n. . . .\n. . . .\n. . . .", "left", "8 4 . .\n. . . .\n. . . .\n. . . .", 12);
});

test("unequal neighbours do not merge", () => {
  expectMove("2 4 2 4\n. . . .\n. . . .\n. . . .", "left", "2 4 2 4\n. . . .\n. . . .\n. . . .", 0);
  expectMove("2 . . .\n4 . . .\n2 . . .\n4 . . .", "up", "2 . . .\n4 . . .\n2 . . .\n4 . . .", 0);
});

test("tiles slide across empty squares", () => {
  expectMove(". . . 2\n. . . .\n. . . .\n. . . .", "left", "2 . . .\n. . . .\n. . . .\n. . . .", 0);
  expectMove("2 . 2 .\n. . . .\n. . . .\n. . . .", "left", "4 . . .\n. . . .\n. . . .\n. . . .", 4);
});

/* --------------------------------------------------------------- movement */

test("a settled board reports no move", () => {
  const dead = "2 4 2 4\n4 2 4 2\n2 4 2 4\n4 2 4 2";
  const res = move(dead, "left");
  assert.equal(res.moved, false);
  assert.deepEqual(values(res.grid), values(parse(dead)));
});

test("every legal move records an animation plan", () => {
  const res = move("2 . . .\n. 2 . .\n. . 2 .\n. . . 2", "left");
  assert.equal(res.moved, true);
  assert.ok(res.moves.length + res.merges.length > 0);
  for (const m of res.moves) {
    assert.ok(m.from && m.to, "move needs an origin and a destination");
  }
});

/* ------------------------------------------------------------- game over */

test("game over detection", () => {
  assert.equal(G.anyMoves(parse("2 4 2 4\n4 2 4 2\n2 4 2 4\n4 2 4 2")), false);
  assert.equal(G.anyMoves(parse("2 4 2 4\n4 2 4 2\n2 4 2 4\n4 2 2 8")), true);
  assert.equal(G.anyMoves(parse("2 . . .\n. . . .\n. . . .\n. . . .")), true);
});

test("highest tile", () => {
  assert.equal(G.highest(parse("2 4 . .\n. 2048 . .\n. . . .\n. . . .")), 2048);
  assert.equal(G.highest(G.emptyGrid()), 0);
});

/* ----------------------------------------------------------- spawn / save */

test("spawn only lands on empty squares and only makes 2s or 4s", () => {
  for (let i = 0; i < 300; i++) {
    const g = G.emptyGrid();
    g[1][1] = { id: 1, value: 2, x: 1, y: 1, prev: { x: 1, y: 1 }, merged: false };
    const t = G.spawn(g);
    assert.ok(t, "should spawn while squares are free");
    assert.ok(t.value === 2 || t.value === 4);
    assert.ok(!(t.x === 1 && t.y === 1), "must not spawn onto an occupied square");
  }
});

test("spawn returns null on a full board", () => {
  const g = G.hydrate(G.emptyGrid(), [
    [2, 4, 2, 4],
    [4, 2, 4, 2],
    [2, 4, 2, 4],
    [4, 2, 4, 2],
  ]);
  assert.equal(G.spawn(g), null);
});

test("serialise round-trips", () => {
  const spec = "2 4 8 .\n. 16 . .\n. . 32 .\n. . . 64";
  const back = G.hydrate(G.emptyGrid(), G.serialize(parse(spec)));
  assert.deepEqual(values(back), values(parse(spec)));
});

/* ---------------------------------------------------------------- fuzzing */

test("invariants hold over random boards", () => {
  const pool = [2, 4, 8, 16, 32];
  const sum = (g) =>
    g.flat().reduce((s, t) => s + (t ? t.value : 0), 0);

  let checked = 0;
  for (let i = 0; i < 4000; i++) {
    const g = G.emptyGrid();
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++)
        if (Math.random() < 0.55)
          g[y][x] = {
            id: 1e6 + y * 10 + x,
            value: pool[(Math.random() * pool.length) | 0],
            x,
            y,
            prev: { x, y },
            merged: false,
          };

    const before = sum(g);
    const res = G.applyMove(g, Object.values(G.DIRS)[(Math.random() * 4) | 0]);
    if (!res.moved) continue;
    checked++;

    assert.equal(sum(res.grid), before, "merging must conserve total value");

    const ids = new Set();
    for (let y = 0; y < 4; y++)
      for (let x = 0; x < 4; x++) {
        const t = res.grid[y][x];
        if (!t) continue;
        assert.ok(!ids.has(t.id), "tile ids must be unique");
        ids.add(t.id);
        assert.equal(t.x, x, "tile x must match its square");
        assert.equal(t.y, y, "tile y must match its square");
      }
  }
  assert.ok(checked > 1000, `expected many moving boards, got ${checked}`);
});

test("a merged tile can merge again on the next move", () => {
  const step1 = move("2 2 . .\n. . . .\n. . . .\n. . . .", "left");
  const four = step1.grid[0][0];
  assert.equal(four.value, 4);
  // slide a fresh 4 next to the tile that a merge just produced
  step1.grid[0][1] = { id: 99999, value: 4, x: 1, y: 0, prev: { x: 1, y: 0 }, merged: false };
  const step2 = G.applyMove(step1.grid, G.DIRS.left);
  assert.equal(step2.gained, 8);
  assert.equal(step2.grid[0][0].value, 8);
});
