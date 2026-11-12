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
  const coachEl   = $("#coach");
  const coachText = $("#coachText");
  const coachBtn  = $("#btnCoach");
  const prankBtn  = $("#btnPrank");
  const raceEl    = $("#race");
  const netEl     = $("#net");
  const netForm   = $("#netForm");
  const netLobby  = $("#netLobby");
  const netTitle  = $("#netTitle");
  const netText   = $("#netText");
  const netName   = $("#netName");
  const netCode   = $("#netCode");
  const netCreate = $("#netCreate");
  const netJoin   = $("#netJoin");
  const netStart  = $("#netStart");
  const netLeave  = $("#netLeave");
  const netCodeBig = $("#netCodeBig");
  const netWait   = $("#netWait");
  const netPlayers = $("#netPlayers");
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

    undoBtn.disabled = !state.undo || state.over || state.mode === "online";
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
  function newGame(opts) {
    opts = opts || {};
    if (!opts.force && state.mode === "online" && net.status === "playing") return;
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
    hideCoach();
    say("start", { force: true, delay: 500, hold: 2600 });
    bumpIdle();
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
    say("undo", { force: true, hold: 2800 });
    bumpIdle();
  }

  function doMove(name) {
    if (lock || state.over) return;
    if (state.won && !state.keepPlaying) return;
    if (state.mode === "online" && net.status !== "playing") return;
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

    // how did that go? let the peanut gallery weigh in
    let empties = 0;
    for (const row of state.grid) for (const t of row) if (!t) empties++;
    if (empties <= 2) say("tight", { hold: 4200 });
    else if (res.gained === 0) say("flat");
    else if (res.gained <= 8) say("small");
    else if (res.gained < 128) say("good");
    else say("great", { force: true });

    if (state.mode === "duo" && Math.random() < 0.45) {
      say("duo", { force: true, delay: 900, hold: 2600 });
    }
    if (state.mode === "online") reportProgress();
    bumpIdle();
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

    // in a race you are authoritative over your own board — the host
    // decides when the room is over, not you
    if (state.mode === "online") {
      if (!state.won && top >= 2048) state.won = true;
      if (!anyMoves(state.grid)) state.over = true;
      reportProgress();
      paintHud();
      return;
    }

    if (!state.won && top >= 2048) {
      state.won = true;
      state.keepPlaying = false;
      showOverlay("win");
      say("win", { force: true, delay: 400, hold: 4200 });
      return;
    }
    if (!anyMoves(state.grid)) {
      state.over = true;
      showOverlay("over");
      say("over", { force: true, delay: 400, hold: 4200 });
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
    } else if (overlayMode === "race") {
      hideOverlay();
      if (net.role === "host") startRace();
      else leaveRoom();
    } else {
      newGame({ force: true });
    }
  });

  ovSecond.addEventListener("click", () => {
    if (overlayMode === "race") { leaveRoom(); return; }
    if (overlayMode === "over" && state.undo) undo();
    else newGame({ force: true });
  });

  /* ---------------- room controls ---------------- */

  netCreate.addEventListener("click", async () => {
    const name = netName.value.trim() || "P1";
    net.name = name;
    netCreate.disabled = true;
    netText.textContent = "방을 만드는 중…";
    try {
      await createRoom(name);
    } catch (_) {
      netError("연결에 실패했어요. 네트워크를 확인해 주세요.");
    } finally {
      netCreate.disabled = false;
    }
  });

  netJoin.addEventListener("click", async () => {
    const code = netCode.value.trim().toUpperCase();
    const name = netName.value.trim() || "P1";
    if (code.length !== 4) {
      netText.textContent = "4자리 코드를 입력해 주세요.";
      return;
    }
    net.name = name;
    netJoin.disabled = true;
    netText.textContent = "방을 찾는 중…";
    try {
      await joinRoom(code, name);
    } catch (_) {
      netError("연결에 실패했어요. 네트워크를 확인해 주세요.");
    } finally {
      netJoin.disabled = false;
    }
  });

  netCode.addEventListener("input", () => {
    netCode.value = netCode.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  });

  netCodeBig.addEventListener("click", () => {
    if (!net.room) return;
    try {
      navigator.clipboard.writeText(net.room.code);
      netWait.textContent = "코드를 복사했어요";
    } catch (_) {}
  });

  netStart.addEventListener("click", startRace);
  netLeave.addEventListener("click", leaveRoom);

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
    for (const b of modeSeg.children) {
      const on = b.dataset.mode === state.mode;
      b.classList.toggle("on", on);
      b.setAttribute("aria-pressed", String(on));
    }
    hintEl.textContent =
      state.mode === "duo" ? "Take turns · arrows or swipe"
      : state.mode === "online" ? "Your own board · first to 2048"
      : "Arrows or WASD · swipe";
  }

  function setMode(mode) {
    if (mode !== "solo" && mode !== "duo" && mode !== "online") return;

    if (mode === "online") {
      if (state.mode === "online") return;
      state.mode = "online";
      syncModeUi();
      raceEl.hidden = true;
      openNetSheet();
      return;
    }

    if (mode === state.mode) return;
    teardownPeer();
    hideNetSheet();
    raceEl.hidden = true;
    state.mode = mode;
    syncModeUi();
    newGame({ force: true });   // a mode change starts a fresh board
  }

  modeSeg.addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn) return;
    setMode(btn.dataset.mode);
    btn.blur();   // otherwise the focus ring lingers while you play with the keyboard
  });

  /* ============================================================
     훈수 — the backseat driver
     ============================================================ */
  const COACH_KEY = "2048.macos.coach";
  let coachOn = true;
  let coachTimer = 0;
  let idleTimer = 0;
  let lastSpoke = 0;
  let lastLine = "";

  const LINES = {
    start: [
      "시작하자. 나는 옆에서 구경할게.",
      "새 판이네. 이번엔 좀 다르게 해봐.",
      "자, 가자. 나는 입만 놀릴 거야.",
    ],
    flat: [
      "그 방향은 아닌 것 같은데.",
      "아무 일도 안 일어났어. 다시.",
      "지금 그거, 그냥 시간 낭비야.",
      "손이 미끄러졌지? 그렇다고 해줄게.",
    ],
    small: [
      "나쁘지 않은데, 딱 그 정도.",
      "조금 아깝다.",
      "일단 굴러는 가네.",
      "그렇게 두는 거야? 뭐, 알겠어.",
    ],
    good: [
      "오, 좀 치는데?",
      "그 수 괜찮았어.",
      "이 흐름이면 되겠는데.",
      "방금 건 나도 인정.",
    ],
    great: [
      "야, 이거 잘하는데?",
      "그건 좀 멋졌다.",
      "이 정도면 자랑해도 돼.",
      "방금 그거, 저장해두고 싶다.",
    ],
    tight: [
      "위험해 보이는데. 책임은 안 질게.",
      "숨 막히네. 나는 손 떼고 볼게.",
      "지금부터는 실수 한 번이야.",
      "칸이 없어. 정신 차려.",
    ],
    undo: [
      "되돌리기. 그것도 실력이라고 치지 뭐.",
      "없던 일로. 나도 못 본 걸로 할게.",
      "후회는 빠를수록 좋지.",
    ],
    idle: [
      "고민 돼? 나는 그냥 왼쪽 눌렀을 텐데.",
      "계속 그렇게 있으면 내가 눌러버린다?",
      "생각보다 오래 걸리는데.",
      "손가락은 왜 안 움직여?",
    ],
    over: [
      "끝났네. 나쁘지 않았어, 진짜로.",
      "여기까지. 다음엔 더 갈 수 있어.",
    ],
    win: [
      "2048. 이건 인정.",
      "해냈네. 나도 좀 뿌듯하다.",
    ],
    duo: [
      "턴 넘어갔다. 집중해.",
      "이제 상대 차례야. 잘 보고 있어.",
      "둘이서 이걸 한다고? 재밌네.",
      "방금 그거, 상대가 좋아하겠는데.",
    ],
  };

  function pick(cat) {
    const pool = LINES[cat] || LINES.small;
    let line = pool[Math.floor(Math.random() * pool.length)];
    let guard = 0;
    while (pool.length > 1 && line === lastLine && guard++ < 6) {
      line = pool[Math.floor(Math.random() * pool.length)];
    }
    lastLine = line;
    return line;
  }

  function sayLine(text, hold) {
    coachText.textContent = text;
    coachEl.classList.add("show");
    lastSpoke = Date.now();
    clearTimeout(coachTimer);
    coachTimer = setTimeout(() => coachEl.classList.remove("show"), hold || 3400);
  }

  function hideCoach() {
    clearTimeout(coachTimer);
    coachEl.classList.remove("show");
  }

  /* Gated: not every move earns a comment, and never two in quick succession. */
  function say(cat, opts) {
    opts = opts || {};
    if (!coachOn) return;
    if (!netEl.hidden) return;   // don't heckle someone sitting in a lobby
    const now = Date.now();
    if (!opts.force) {
      if (now - lastSpoke < 4500) return;
      if (Math.random() > 0.62) return;
    }
    const run = () => {
      if (opts.onlyIfIdle && (lock || state.over || overlayMode)) return;
      sayLine(pick(cat), opts.hold);
    };
    if (opts.delay) setTimeout(run, opts.delay);
    else run();
  }

  function bumpIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (lock || state.over || overlayMode) return;
      say("idle", { force: true, hold: 4200 });
    }, 9000);
  }

  /* ============================================================
     장난 — harmless mischief, never touches game state
     ============================================================ */
  const PRANKS = [
    { cls: "prank-tilt",   ms: 780, line: "잠깐, 손이 미끄러졌어." },
    { cls: "prank-mirror", ms: 820, line: "어? 뭐가 이상한데." },
    { cls: "prank-blur",   ms: 680, line: "안경 닦고 올게." },
    { cls: "prank-spin",   ms: 800, line: "돌려볼까." },
  ];

  function runPrank() {
    if (lock || state.over || overlayMode) return;

    // one in six is a fake announcement instead of a visual gag
    if (Math.random() < 0.17) {
      sayLine("축하합니다! 4096 달성!", 1500);
      setTimeout(() => sayLine("…농담이야.", 2400), 1650);
      return;
    }

    const p = PRANKS[Math.floor(Math.random() * PRANKS.length)];
    boardEl.classList.add(p.cls);
    setTimeout(() => boardEl.classList.remove(p.cls), p.ms);
    sayLine(p.line, 2800);
  }

  /* ============================================================
     Online — public MQTT broker. Everyone plays their own board at
     the same time and watches each other's progress.

     WebRTC was the first attempt and it failed in the field: the public
     TURN relays are gone, so any two players behind carrier-grade NAT
     (most mobile networks) simply never connected. MQTT over WSS has no
     such problem — both sides only ever dial out to the broker.
     ============================================================ */
  const MQTT_CDNS = [
    "https://unpkg.com/mqtt@5.10.1/dist/mqtt.min.js",
    "https://cdn.jsdelivr.net/npm/mqtt@5.10.1/dist/mqtt.min.js",
  ];
  const BROKERS = [
    "wss://broker.emqx.io:8084/mqtt",
    "wss://broker.hivemq.com:8884/mqtt",
  ];
  const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no O/0/I/1
  const MAX_PLAYERS = 4;

  const topicRoom = (code) => "g2048/" + code + "/room";
  const topicIn = (code) => "g2048/" + code + "/in";

  const net = {
    role: null,        // "host" | "guest"
    client: null,
    pid: "",
    code: "",
    mySeat: 0,
    status: "idle",    // idle | connecting | lobby | playing | over
    room: null,
    name: "",
    loading: null,
    timer: 0,
    beat: 0,
    lastRoomAt: 0,
  };

  const randId = () => Math.random().toString(36).slice(2, 10);

  const blankPlayer = (seat, name, pid) => ({
    seat, name, pid, connected: true,
    score: 0, top: 0, board: null, out: false, won: false,
  });

  const randomCode = () =>
    Array.from({ length: 4 }, () =>
      CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    ).join("");

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = true;
      s.onload = () => resolve();
      s.onerror = () => reject(new Error("load-failed"));
      document.head.appendChild(s);
    });
  }

  function loadMqtt() {
    if (window.mqtt) return Promise.resolve();
    if (net.loading) return net.loading;
    net.loading = (async () => {
      for (const src of MQTT_CDNS) {
        try {
          await loadScript(src);
          if (window.mqtt) return;
        } catch (_) { /* next mirror */ }
      }
      throw new Error("mqtt-load-failed");
    })();
    return net.loading;
  }

  /* Try each broker in turn; the first one that answers wins. */
  async function connectBroker(code, pid) {
    await loadMqtt();
    let lastErr = null;
    for (const url of BROKERS) {
      try {
        return await new Promise((resolve, reject) => {
          const c = window.mqtt.connect(url, {
            clientId: "g2048_" + randId() + randId(),
            clean: true,
            connectTimeout: 7000,
            reconnectPeriod: 0,
            keepalive: 30,
            will: {
              topic: topicIn(code),
              payload: JSON.stringify({ t: "bye", pid }),
              qos: 0,
              retain: false,
            },
          });
          const t = setTimeout(() => {
            try { c.end(true); } catch (_) {}
            reject(new Error("timeout"));
          }, 9000);
          c.on("connect", () => { clearTimeout(t); resolve(c); });
          c.on("error", (e) => {
            clearTimeout(t);
            try { c.end(true); } catch (_) {}
            reject(e || new Error("connect-failed"));
          });
        });
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error("no-broker");
  }

  /* ---------------- room state ---------------- */

  function onRoom(room) {
    if (!room) return;
    const before = net.status;
    net.room = room;
    net.status = room.status;

    if (room.status === "lobby") {
      renderLobby();
    } else if (room.status === "playing" && before !== "playing") {
      hideNetSheet();
      state.mode = "online";
      syncModeUi();
      newGame({ force: true });
      renderRace();
    } else if (room.status === "over") {
      renderRace();
      showRaceResult();
    } else {
      renderRace();
    }
  }

  function publishRoom() {
    if (!net.client || !net.room) return;
    net.client.publish(topicRoom(net.code), JSON.stringify(net.room), { retain: true });
  }

  function hostPlayer() {
    return net.room && net.room.players[net.mySeat];
  }

  function firstFreeSeat(room) {
    for (let i = 0; i < MAX_PLAYERS; i++) if (!room.players[i]) return i;
    return -1;
  }

  /* ---------------- progress ---------------- */

  function myProgress() {
    return {
      score: state.scores[0],
      top: highest(state.grid),
      board: serialize(state.grid),
      out: state.over && !state.won,
      won: state.won,
    };
  }

  function reportProgress() {
    if (net.status !== "playing" && net.status !== "over") return;
    const p = myProgress();

    if (net.role === "host") {
      const me = hostPlayer();
      if (me) Object.assign(me, p);
      checkRaceEnd();
      publishRoom();
    } else if (net.client) {
      net.client.publish(topicIn(net.code), JSON.stringify({ t: "prog", pid: net.pid, p }));
    }
    renderRace();
  }

  function checkRaceEnd() {
    const room = net.room;
    if (!room || room.status !== "playing") return;

    const live = room.players.filter((p) => p && p.connected);
    const winner = live.find((p) => p.won || p.top >= 2048);
    if (winner) {
      room.status = "over";
      room.winner = winner.seat;
      publishRoom();
      onRoom(room);
      return;
    }

    if (live.length && live.every((p) => p.out)) {
      let best = live[0];
      for (const p of live) if (p.score > best.score) best = p;
      room.status = "over";
      room.winner = best.seat;
      publishRoom();
      onRoom(room);
    }
  }

  /* ---------------- host ---------------- */

  async function createRoom(name) {
    net.role = "host";
    net.pid = randId();
    net.code = randomCode();
    net.name = name;
    net.mySeat = 0;
    net.room = {
      code: net.code,
      status: "lobby",
      winner: null,
      players: [blankPlayer(0, name || "P1", net.pid)],
    };

    const client = await connectBroker(net.code, net.pid);
    net.client = client;
    net.status = "lobby";

    client.subscribe(topicIn(net.code));
    client.on("message", (topic, buf) => {
      if (topic === topicIn(net.code)) hostOnMessage(buf);
    });

    publishRoom();
    clearInterval(net.beat);
    net.beat = setInterval(() => {
      if (net.room) publishRoom();
    }, 4000);

    renderLobby();
  }

  function hostOnMessage(buf) {
    let msg;
    try { msg = JSON.parse(buf.toString()); } catch (_) { return; }
    if (!msg || !net.room) return;

    if (msg.t === "join") {
      const room = net.room;
      let p = room.players.find((x) => x && x.pid === msg.pid);

      if (!p) {
        if (room.status !== "lobby") return;      // races are not joinable
        const seat = firstFreeSeat(room);
        if (seat < 0) return;                     // full
        p = blankPlayer(seat, String(msg.name || "").slice(0, 12).trim() || "P" + (seat + 1), msg.pid);
        room.players[seat] = p;
      } else {
        p.connected = true;
      }
      publishRoom();
      renderLobby();

    } else if (msg.t === "prog") {
      const p = net.room.players.find((x) => x && x.pid === msg.pid);
      if (!p) return;
      Object.assign(p, msg.p);
      checkRaceEnd();
      publishRoom();

    } else if (msg.t === "bye") {
      const p = net.room.players.find((x) => x && x.pid === msg.pid);
      if (!p) return;
      p.connected = false;
      p.out = true;
      publishRoom();
      renderLobby();
    }
  }

  /* ---------------- guest ---------------- */

  async function joinRoom(code, name) {
    net.role = "guest";
    net.pid = randId();
    net.code = code;
    net.name = name;
    net.status = "connecting";

    const client = await connectBroker(code, net.pid);
    net.client = client;

    client.subscribe(topicRoom(code));
    client.on("message", (topic, buf) => {
      if (topic === topicRoom(code)) guestOnRoom(buf);
    });

    client.publish(topicIn(code), JSON.stringify({ t: "join", pid: net.pid, name }));

    clearTimeout(net.timer);
    net.timer = setTimeout(() => {
      if (net.status === "connecting") {
        netError("방을 찾을 수 없어요. 코드를 확인해 주세요.");
      }
    }, 9000);
  }

  function guestOnRoom(buf) {
    let room;
    try { room = JSON.parse(buf.toString()); } catch (_) { return; }
    if (!room || !room.players) return;

    clearTimeout(net.timer);
    net.lastRoomAt = Date.now();

    const me = room.players.find((p) => p && p.pid === net.pid);
    if (me) net.mySeat = me.seat;

    onRoom(room);
  }

  /* ---------------- race UI ---------------- */

  const TILE_VARS = [2, 4, 8, 16, 32, 64, 128, 256, 512, 1024, 2048];

  function tileVar(v) {
    return "var(--t" + (TILE_VARS.includes(v) ? v : "super") + ")";
  }

  function renderRace() {
    if (state.mode !== "online" || !net.room) {
      raceEl.hidden = true;
      return;
    }
    raceEl.hidden = false;
    raceEl.textContent = "";

    for (const p of net.room.players) {
      if (!p) continue;
      const isMe = p.pid === net.pid;
      const board = isMe ? serialize(state.grid) : p.board;
      const score = isMe ? state.scores[0] : p.score;

      const chip = document.createElement("div");
      chip.className = "race-chip" + (isMe ? " me" : "") +
        (p.out || !p.connected ? " out" : "");

      const mini = document.createElement("div");
      mini.className = "mini";
      for (let i = 0; i < 16; i++) {
        const d = document.createElement("i");
        if (board) {
          const v = board[(i / 4) | 0][i % 4];
          if (v) d.style.background = tileVar(v);
        }
        mini.appendChild(d);
      }

      const meta = document.createElement("div");
      meta.className = "race-meta";
      const nm = document.createElement("span");
      nm.className = "race-name";
      nm.textContent = isMe ? "YOU" : p.name;
      const sc = document.createElement("span");
      sc.className = "race-score";
      sc.textContent = (score || 0).toLocaleString();
      meta.append(nm, sc);

      chip.append(mini, meta);
      raceEl.appendChild(chip);
    }
  }

  function renderLobby() {
    if (!net.room) return;
    netEl.hidden = false;
    netForm.hidden = true;
    netLobby.hidden = false;
    netCodeBig.textContent = net.room.code;

    const list = net.room.players.filter(Boolean);
    netWait.textContent = `대기 인원 ${list.length}명`;

    netPlayers.textContent = "";
    for (const p of list) {
      const li = document.createElement("li");
      const who = document.createElement("span");
      who.textContent = p.name;
      const tag = document.createElement("span");
      tag.textContent = p.pid === net.pid ? "나" : (p.connected ? "" : "나감");
      li.append(who, tag);
      if (p.pid === net.pid) li.classList.add("me");
      netPlayers.appendChild(li);
    }

    netStart.hidden = net.role !== "host";
    netStart.disabled = list.length < 2;
    netStart.textContent = list.length < 2 ? "Waiting…" : "Start race";
    netTitle.textContent = net.role === "host" ? "Your room" : "Waiting room";
    netText.textContent = net.role === "host"
      ? "Share the code. Everyone plays their own board."
      : "Waiting for the host to start.";
  }

  function startRace() {
    if (net.role !== "host" || !net.room) return;
    const list = net.room.players.filter(Boolean);
    if (list.length < 2) return;
    for (const p of net.room.players) {
      if (!p) continue;
      p.score = 0; p.top = 0; p.board = null; p.out = false; p.won = false;
    }
    net.room.winner = null;
    net.room.status = "playing";
    publishRoom();
    onRoom(net.room);
  }

  function showRaceResult() {
    const room = net.room;
    if (!room) return;
    const winner = room.winner != null ? room.players[room.winner] : null;
    const iWon = winner && winner.pid === net.pid;

    ovTitle.textContent = !winner
      ? "Race over"
      : iWon ? "You win the race" : `${winner.name} wins`;

    const tally = room.players
      .filter(Boolean)
      .map((p) => `${p.pid === net.pid ? "you" : p.name} ${(p.score || 0).toLocaleString()}`)
      .join(" · ");
    ovText.textContent = tally;

    ovPrimary.textContent = net.role === "host" ? "New race" : "Leave";
    ovSecond.textContent = "Leave";
    ovSecond.hidden = net.role !== "host";
    overlayMode = "race";
    overlayEl.hidden = false;
    paintHud();
  }

  /* ---------------- sheet plumbing ---------------- */

  function openNetSheet() {
    netEl.hidden = false;
    netForm.hidden = false;
    netLobby.hidden = true;
    netTitle.textContent = "Play online";
    netText.textContent = "Create a room, or join one with a code.";
    if (net.name) netName.value = net.name;
    setTimeout(() => netName.focus(), 60);
  }

  function hideNetSheet() {
    netEl.hidden = true;
  }

  function netError(text) {
    netEl.hidden = false;
    netForm.hidden = false;
    netLobby.hidden = true;
    netTitle.textContent = "Can't connect";
    netText.textContent = text;
    teardownPeer();
    state.mode = "solo";
    syncModeUi();
    raceEl.hidden = true;
    paintHud();
  }

  function teardownPeer() {
    clearTimeout(net.timer);
    clearInterval(net.beat);
    if (net.client) {
      try { net.client.end(true); } catch (_) {}
    }
    net.client = null;
    net.room = null;
    net.role = null;
    net.status = "idle";
  }

  function leaveRoom() {
    if (net.client && net.role === "guest") {
      try {
        net.client.publish(topicIn(net.code), JSON.stringify({ t: "bye", pid: net.pid }));
      } catch (_) {}
    }
    teardownPeer();
    hideNetSheet();
    raceEl.hidden = true;
    state.mode = "solo";
    syncModeUi();
    newGame({ force: true });
  }

  /* ============================================================
     Chrome
     ============================================================ */

  /* ============================================================
     Chrome
     ============================================================ */
  newBtn.addEventListener("click", (e) => { newGame(); e.currentTarget.blur(); });
  undoBtn.addEventListener("click", (e) => { undo(); e.currentTarget.blur(); });
  prankBtn.addEventListener("click", (e) => { runPrank(); e.currentTarget.blur(); });

  coachBtn.addEventListener("click", (e) => {
    coachOn = !coachOn;
    coachBtn.classList.toggle("off", !coachOn);
    coachBtn.setAttribute("aria-pressed", String(coachOn));
    try { localStorage.setItem(COACH_KEY, coachOn ? "1" : "0"); } catch (_) {}
    if (coachOn) say("start", { force: true, hold: 2800 });
    else hideCoach();
    e.currentTarget.blur();
  });

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

  try { coachOn = localStorage.getItem(COACH_KEY) !== "0"; } catch (_) {}
  coachBtn.classList.toggle("off", !coachOn);
  coachBtn.setAttribute("aria-pressed", String(coachOn));

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

  window.addEventListener("beforeunload", teardownPeer);

  const ro = new ResizeObserver(() => measure());
  ro.observe(boardEl);
  window.addEventListener("orientationchange", () => setTimeout(measure, 120));
})();
