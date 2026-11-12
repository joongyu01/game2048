"use strict";
(function () {
  const {
    SIZE, DIRS, applyMove, spawn, anyMoves, highest,
    emptyGrid, serialize, hydrate,
  } = window.Game2048;
  /* ============================================================
     State
     ============================================================ */
  const KEY = "2048.macos.v2";
  const OLD_KEY = "2048.macos.v1";

  const state = {
    mode: "solo",        // "solo" | "duo"
    grid: emptyGrid(),
    scores: [0, 0],      // [P1, P2]; solo only ever uses [0]
    turn: 0,             // whose move it is
    lastMover: 0,        // who made the most recent move (for win credit)
    best: 0,
    moves: 0,
    over: false,
    won: false,
    keepPlaying: false,
    undo: null,
  };

  const els = new Map();       // tileId -> element
  let geo = { cell: 0, gap: 12 };
  let lock = false;
  let overlayMode = null;      // 'win' | 'over' | null

  /* ============================================================
     DOM
     ============================================================ */
  const $ = (s) => document.querySelector(s);
  const boardEl   = $("#board");
  const tilesEl   = $("#tiles");
  const boxA      = $("#boxA");
  const boxB      = $("#boxB");
  const labelA    = $("#labelA");
  const labelB    = $("#labelB");
  const valueA    = $("#valueA");
  const valueB    = $("#valueB");
  const gainA     = $("#gainA");
  const gainB     = $("#gainB");
  const modeSeg   = $("#modeSeg");
  const hintEl    = $("#hint");
  const movesEl   = $("#moves");
  const undoBtn   = $("#btnUndo");
  const newBtn    = $("#btnNew");
  const themeBtn  = $("#btnTheme");
  const overlayEl = $("#overlay");
  const ovTitle   = $("#ovTitle");
  const ovText    = $("#ovText");
  const ovPrimary = $("#ovPrimary");
  const ovSecond  = $("#ovSecondary");

  /* ---------- layout ---------- */
  function measure() {
    const w = boardEl.clientWidth;
    if (!w) return;
    const pad = Math.round(Math.max(9, Math.min(14, w * 0.028)));
    const gap = Math.round(Math.max(8, Math.min(13, w * 0.026)));
    const inner = w - pad * 2;
    const cell = (inner - gap * (SIZE - 1)) / SIZE;
    geo = { cell, gap, pad };
    boardEl.style.setProperty("--pad", pad + "px");
    boardEl.style.setProperty("--gap", gap + "px");
    boardEl.style.setProperty("--cell-size", cell + "px");
    // reposition existing tiles (resize / rotation)
    forEachTile(state.grid, (t) => {
      const el = els.get(t.id);
      if (el) place(el, t.x, t.y, false);
    });
  }

  const offset = (i) => i * (geo.cell + geo.gap);

  function place(el, x, y, animate = true) {
    if (!animate) el.style.transition = "none";
    el.style.transform =
      `translate3d(${offset(x)}px, ${offset(y)}px, 0)`;
    if (!animate) {
      // force reflow so the next transition isn't swallowed
      void el.offsetWidth;
      el.style.transition = "";
    }
  }

  function fontSizeFor(value) {
    const n = String(value).length;
    const f = n <= 2 ? 0.44 : n === 3 ? 0.35 : n === 4 ? 0.29 : 0.245;
    return `calc(var(--cell-size) * ${f})`;
  }

  function createTileEl(tile, anim) {
    const el = document.createElement("div");
    el.className = "tile";
    const face = document.createElement("div");
    face.className = "face";
    face.dataset.v = tile.value;
    if (tile.value > 2048) face.classList.add("super");
    face.textContent = tile.value;
    face.style.fontSize = fontSizeFor(tile.value);
    if (anim === "new") face.classList.add("pop");
    if (anim === "merge") face.classList.add("bump");
    el.appendChild(face);
    place(el, tile.x, tile.y, false);
    return el;
  }

  function forEachTile(grid, fn) {
    for (let y = 0; y < SIZE; y++)
      for (let x = 0; x < SIZE; x++)
        if (grid[y][x]) fn(grid[y][x]);
  }

  function rebuildTiles(anim) {
    tilesEl.textContent = "";
    els.clear();
    forEachTile(state.grid, (t) => {
      const el = createTileEl(t, anim);
      tilesEl.appendChild(el);
      els.set(t.id, el);
    });
  }

  /* ============================================================
     HUD
     ============================================================ */
  function paintHud() {
    const duo = state.mode === "duo";
    const fmt = (n) => n.toLocaleString();

    labelA.textContent = duo ? "P1" : "Score";
    labelB.textContent = duo ? "P2" : "Best";
    valueA.textContent = fmt(state.scores[0]);
    valueB.textContent = fmt(duo ? state.scores[1] : state.best);

    const live = duo && !state.over;
    boxA.classList.toggle("active", live && state.turn === 0);
    boxB.classList.toggle("active", live && state.turn === 1);

    const plural = state.moves === 1 ? " move" : " moves";
    const showTurn = duo && !state.over;
    movesEl.textContent = showTurn
      ? `P${state.turn + 1} to play · ${state.moves}${plural}`
      : `${state.moves}${plural}`;
    movesEl.classList.toggle("turn", showTurn);

    undoBtn.disabled = !state.undo || state.over;
  }

  function showGain(n, player) {
    if (!n) return;
    const el = player === 1 ? gainB : gainA;
    el.textContent = "+" + n;
    el.classList.remove("run");
    void el.offsetWidth;
    el.classList.add("run");
  }

  /* ============================================================
     Persistence
     ============================================================ */
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        g: serialize(state.grid),
        mode: state.mode,
        p: state.scores,
        t: state.turn,
        b: state.best,
        mv: state.moves,
        o: state.over,
        w: state.won,
        k: state.keepPlaying,
      }));
    } catch (_) {}
  }

  function load() {
    let raw = null;
    try { raw = localStorage.getItem(KEY); } catch (_) {}

    if (!raw) {
      // carry the best score across from the previous save layout
      try {
        const old = JSON.parse(localStorage.getItem(OLD_KEY) || "null");
        if (old && typeof old.b === "number") state.best = old.b;
      } catch (_) {}
      return false;
    }

    try {
      const d = JSON.parse(raw);
      if (!d || !Array.isArray(d.g) || d.g.length !== SIZE) return false;
      const values = d.g;
      // a saved board that is empty means "never started"
      const filled = values.flat().some((v) => v);
      if (!filled) return false;

      hydrate(state.grid, values);
      state.mode = d.mode === "duo" ? "duo" : "solo";
      state.scores = Array.isArray(d.p) ? [d.p[0] | 0, d.p[1] | 0] : [0, 0];
      state.turn = d.t === 1 ? 1 : 0;
      state.lastMover = state.turn;
      state.best = Math.max(d.b | 0, state.scores[0]);
      state.moves = d.mv | 0;
      state.over = !!d.o;
      state.won = !!d.w;
      state.keepPlaying = !!d.k;
      return true;
    } catch (_) { return false; }
  }

  /* ============================================================
     Game flow
     ============================================================ */
  function newGame() {
    hideOverlay();
    state.grid = emptyGrid();
    state.scores = [0, 0];
    state.turn = 0;
    state.lastMover = 0;
    state.moves = 0;
    state.over = false;
    state.won = false;
    state.keepPlaying = false;
    state.undo = null;
    spawn(state.grid);
    spawn(state.grid);
    rebuildTiles("new");
    paintHud();
    save();
    newBtn.classList.remove("spin");
    void newBtn.offsetWidth;
    newBtn.classList.add("spin");
  }

  function snapshot() {
    return {
      g: serialize(state.grid),
      p: [...state.scores],
      t: state.turn,
      mv: state.moves,
    };
  }

  function undo() {
    if (!state.undo || state.over) return;
    const snap = state.undo;
    state.grid = hydrate(emptyGrid(), snap.g);
    state.scores = [...snap.p];
    state.turn = snap.t;
    state.lastMover = snap.t;
    state.moves = snap.mv;
    state.undo = null;
    state.over = false;
    hideOverlay();
    rebuildTiles("new");
    paintHud();
    save();
  }

  function doMove(name) {
    if (lock || state.over) return;
    if (state.won && !state.keepPlaying) return;
    const dir = DIRS[name];
    if (!dir) return;

    const res = applyMove(state.grid, dir);
    if (!res.moved) {
      boardEl.classList.remove("nudge");
      void boardEl.offsetWidth;
      boardEl.classList.add("nudge");
      return;                       // no points, no turn change
    }

    const mover = state.turn;

    state.undo = snapshot();
    state.grid = res.grid;
    state.scores[mover] += res.gained;
    state.moves += 1;
    state.lastMover = mover;

    if (state.mode === "solo" && state.scores[0] > state.best) {
      state.best = state.scores[0];
    }
    if (state.mode === "duo") state.turn = 1 - state.turn;

    paintHud();
    showGain(res.gained, mover);
    animate(res);
  }

  function animate(res) {
    lock = true;

    // 1. slide everything that moved
    for (const m of res.moves) {
      const el = els.get(m.id);
      if (el) place(el, m.to.x, m.to.y);
    }
    // 2. slide both halves of every merge onto the landing square
    for (const m of res.merges) {
      const ea = els.get(m.a.id);
      const eb = els.get(m.b.id);
      if (ea) place(ea, m.result.x, m.result.y);
      if (eb) place(eb, m.result.x, m.result.y);
    }

    const settle = res.merges.length ? 112 : 62;

    // 3. commit: drop the merge halves, reveal results + the new tile
    window.setTimeout(() => {
      for (const m of res.merges) {
        const ea = els.get(m.a.id);
        const eb = els.get(m.b.id);
        if (ea) { ea.remove(); els.delete(m.a.id); }
        if (eb) { eb.remove(); els.delete(m.b.id); }
        const el = createTileEl(m.result, "merge");
        tilesEl.appendChild(el);
        els.set(m.result.id, el);
      }
      const born = spawn(state.grid);
      if (born) {
        const el = createTileEl(born, "new");
        tilesEl.appendChild(el);
        els.set(born.id, el);
      }
      lock = false;
      paintHud();
      evaluate();
      save();
    }, settle);
  }

  function evaluate() {
    const top = highest(state.grid);
    if (!state.won && top >= 2048) {
      state.won = true;
      state.keepPlaying = false;
      showOverlay("win");
      return;
    }
    if (!anyMoves(state.grid)) {
      state.over = true;
      showOverlay("over");
    }
  }

  /* ============================================================
     Overlay
     ============================================================ */
  function showOverlay(mode) {
    overlayMode = mode;
    const duo = state.mode === "duo";

    if (mode === "win") {
      ovTitle.textContent = duo ? "2048" : "You win";
      ovText.textContent = duo
        ? `P${state.lastMover + 1} reached 2048. Keep going?`
        : "You reached 2048. Keep going for a higher score?";
      ovPrimary.textContent = "Keep going";
      ovSecond.textContent = "New game";
      ovSecond.hidden = false;
    } else if (duo) {
      const [a, b] = state.scores;
      ovTitle.textContent = a === b ? "Draw" : `P${a > b ? 1 : 2} wins`;
      ovText.textContent = `${a.toLocaleString()} : ${b.toLocaleString()} — no moves left.`;
      ovPrimary.textContent = "Play again";
      ovSecond.textContent = "Undo";
      ovSecond.hidden = !state.undo;
    } else {
      ovTitle.textContent = "Game over";
      ovText.textContent = `No moves left. Final score ${state.scores[0].toLocaleString()}.`;
      ovPrimary.textContent = "Try again";
      ovSecond.textContent = "Undo";
      ovSecond.hidden = !state.undo;
    }

    overlayEl.hidden = false;
    paintHud();
  }

  function hideOverlay() {
    overlayMode = null;
    overlayEl.hidden = true;
  }

  ovPrimary.addEventListener("click", () => {
    if (overlayMode === "win") {
      state.keepPlaying = true;
      hideOverlay();
      save();
    } else {
      newGame();
    }
  });

  ovSecond.addEventListener("click", () => {
    if (overlayMode === "over" && state.undo) undo();
    else newGame();
  });

  /* ============================================================
     Input
     ============================================================ */
  const KEYS = {
    ArrowUp: "up", ArrowRight: "right", ArrowDown: "down", ArrowLeft: "left",
    w: "up", d: "right", s: "down", a: "left",
    W: "up", D: "right", S: "down", A: "left",
    k: "up", l: "right", j: "down", h: "left",
  };

  window.addEventListener("keydown", (e) => {
    if (e.metaKey || e.ctrlKey) {
      if (e.key === "z" || e.key === "Z") { e.preventDefault(); undo(); return; }
      if (e.key === "r" || e.key === "R") { e.preventDefault(); newGame(); return; }
      return;
    }
    const dir = KEYS[e.key];
    if (dir) {
      e.preventDefault();
      doMove(dir);
    } else if (e.key === "Enter" && overlayMode === "win") {
      ovPrimary.click();
    }
  }, { passive: false });

  // pointer / touch swipe
  let start = null;
  boardEl.addEventListener("pointerdown", (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    // never hijack the pointer over a dialog, or its buttons never get a click
    if (e.target.closest(".overlay")) return;
    start = { x: e.clientX, y: e.clientY };
    boardEl.setPointerCapture?.(e.pointerId);
  });

  boardEl.addEventListener("pointerup", (e) => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    const ax = Math.abs(dx);
    const ay = Math.abs(dy);
    if (Math.max(ax, ay) < 22) return;
    if (ax > ay) doMove(dx > 0 ? "right" : "left");
    else doMove(dy > 0 ? "down" : "up");
  });

  boardEl.addEventListener("pointercancel", () => { start = null; });

  // trackpad two-finger swipe
  let wheelAcc = 0, wheelLock = 0;
  boardEl.addEventListener("wheel", (e) => {
    e.preventDefault();
    const now = Date.now();
    if (now < wheelLock) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY)
      ? { axis: "x", v: e.deltaX }
      : { axis: "y", v: e.deltaY };
    if (Math.abs(d.v) < 8) return;
    wheelLock = now + 120;
    wheelAcc = 0;
    if (d.axis === "x") doMove(d.v > 0 ? "right" : "left");
    else doMove(d.v > 0 ? "down" : "up");
  }, { passive: false });

  /* ============================================================
     Mode
     ============================================================ */
  function syncModeUi() {
    const duo = state.mode === "duo";
    for (const b of modeSeg.children) {
      const on = b.dataset.mode === state.mode;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    hintEl.textContent = duo
      ? "Take turns · arrows or swipe"
      : "Arrows or WASD · swipe";
  }

  function setMode(mode) {
    if (mode !== "solo" && mode !== "duo") return;
    if (mode === state.mode) return;
    state.mode = mode;
    syncModeUi();
    newGame();          // a mode change starts a fresh board
  }

  modeSeg.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    setMode(btn.dataset.mode);
    btn.blur();   // otherwise the focus ring lingers while you play with the keyboard
  });

  /* ============================================================
     Chrome
     ============================================================ */
  newBtn.addEventListener("click", (e) => { newGame(); e.currentTarget.blur(); });
  undoBtn.addEventListener("click", (e) => { undo(); e.currentTarget.blur(); });

  const SUN = `<circle cx="8" cy="8" r="3.1"/><path d="M8 1.2v1.6M8 13.2v1.6M1.2 8h1.6M13.2 8h1.6M3.2 3.2l1.1 1.1M11.7 11.7l1.1 1.1M12.8 3.2l-1.1 1.1M4.3 11.7l-1.1 1.1"/>`;
  const MOON = `<path d="M13 9.6A5.6 5.6 0 0 1 6.4 3a5.7 5.7 0 1 0 6.6 6.6Z"/>`;

  function applyTheme(mode) {
    document.documentElement.dataset.theme = mode;
    const dark = mode === "dark" ||
      (mode === "auto" && window.matchMedia("(prefers-color-scheme: dark)").matches);
    $("#iconTheme").innerHTML = dark ? MOON : SUN;
    try { localStorage.setItem("2048.macos.theme", mode); } catch (_) {}
  }

  themeBtn.addEventListener("click", () => {
    const cur = document.documentElement.dataset.theme;
    const sysDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
    const isDark = cur === "dark" || (cur === "auto" && sysDark);
    applyTheme(isDark ? "light" : "dark");
  });

  /* ============================================================
     Boot
     ============================================================ */
  let themeMode = "auto";
  try { themeMode = localStorage.getItem("2048.macos.theme") || "auto"; } catch (_) {}
  applyTheme(themeMode);

  const restored = load();
  measure();
  syncModeUi();
  if (restored) {
    rebuildTiles(null);
    paintHud();
    if (state.over) showOverlay("over");
    else if (state.won && !state.keepPlaying) showOverlay("win");
  } else {
    newGame();
  }

  const ro = new ResizeObserver(() => measure());
  ro.observe(boardEl);
  window.addEventListener("orientationchange", () => setTimeout(measure, 120));
})();
