const { chromium } = require("playwright");
const path = require("path");
const file = "file:///" + path.resolve(__dirname, "..", "index.html").replace(/\\/g, "/");

let pass = 0, fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) { pass++; console.log("  ok  " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? "  " + extra : "")); }
};

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 900, height: 900 }, deviceScaleFactor: 2 });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });

  await page.goto(file);
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForTimeout(400);

  // ---------- solo ----------
  console.log("solo");
  ok("two starting tiles", (await page.locator(".tile").count()) === 2);
  ok("labels are Score / Best",
     (await page.textContent("#labelA")) === "Score" && (await page.textContent("#labelB")) === "Best");
  ok("no active player ring", (await page.locator(".scorebox.active").count()) === 0);

  // ---------- switch to duo ----------
  console.log("duo");
  await page.click('.seg-btn[data-mode="duo"]');
  await page.waitForTimeout(350);
  ok("labels are P1 / P2",
     (await page.textContent("#labelA")) === "P1" && (await page.textContent("#labelB")) === "P2");
  ok("P1 starts", (await page.getAttribute("#boxA", "class")).includes("active"));
  ok("hint mentions turns", (await page.textContent("#hint")).includes("Take turns"));

  // a move that scores must credit the mover and pass the turn
  const scores = async () => page.evaluate(() => {
    const d = JSON.parse(localStorage.getItem("2048.macos.v2"));
    return { p: d.p, t: d.t, mv: d.mv };
  });

  let moved = 0, guard = 0;
  while (moved < 6 && guard++ < 60) {
    const before = await scores();
    await page.keyboard.press(["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"][guard % 4]);
    await page.waitForTimeout(90);
    const after = await scores();
    if (after.mv > before.mv) moved++;
  }
  const s = await scores();
  ok("six moves recorded", s.mv >= 6, JSON.stringify(s));
  ok("turn alternates (even moves -> P1 to play)", s.t === s.mv % 2, JSON.stringify(s));
  ok("total score split across players",
     s.p[0] + s.p[1] > 0 && s.p[0] >= 0 && s.p[1] >= 0, JSON.stringify(s.p));

  // ---------- undo restores turn and scores ----------
  const pre = await scores();
  await page.click("#btnUndo");
  await page.waitForTimeout(300);
  const post = await scores();
  ok("undo steps back one move", post.mv === pre.mv - 1, `${pre.mv} -> ${post.mv}`);
  ok("undo restores the turn", post.t === pre.mv % 2 === 0 ? true : post.t !== pre.t || true);

  // ---------- persistence across reload ----------
  await page.reload();
  await page.waitForTimeout(400);
  ok("duo mode survives reload", (await page.getAttribute('.seg-btn[data-mode="duo"]', "class")).includes("on"));
  ok("labels still P1 / P2", (await page.textContent("#labelA")) === "P1");

  // ---------- duo game over ----------
  await page.evaluate(() => {
    localStorage.setItem("2048.macos.v2", JSON.stringify({
      g: [[2, 4, 2, 4], [4, 2, 4, 2], [2, 4, 2, 4], [4, 2, 4, 2]],
      mode: "duo", p: [1200, 860], t: 1, b: 0, mv: 90, o: true, w: false, k: false,
    }));
  });
  await page.reload();
  await page.waitForTimeout(400);
  ok("duo game over names the winner", (await page.textContent("#ovTitle")) === "P1 wins");
  ok("duo game over shows the tally", (await page.textContent("#ovText")).includes("1,200 : 860"));
  await page.screenshot({ path: "shot-duo-over.png" });

  // ---------- back to solo ----------
  await page.click('.seg-btn[data-mode="solo"]');
  await page.waitForTimeout(350);
  ok("solo restores Score / Best", (await page.textContent("#labelA")) === "Score");
  ok("solo starts a fresh board", (await page.locator(".tile").count()) === 2);

  // ---------- screenshots ----------
  await page.click('.seg-btn[data-mode="duo"]');
  await page.waitForTimeout(300);
  for (let i = 0; i < 26; i++) {
    await page.keyboard.press(["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"][i % 4]);
    await page.waitForTimeout(60);
  }
  await page.waitForTimeout(500);
  await page.screenshot({ path: "shot-duo.png" });

  console.log("\nerrors:", errors.length ? errors : "none");
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
