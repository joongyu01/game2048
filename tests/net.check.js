/* Two-player online race check. Requires network access to the PeerJS broker. */
const { chromium } = require("playwright");
const path = require("path");
const file = "file:///" + path.resolve(__dirname, "..", "index.html").replace(/\\/g, "/");

let pass = 0, fail = 0;
const ok = (n, c, x = "") => { c ? (pass++, console.log("  ok  " + n)) : (fail++, console.log("  FAIL " + n + "  " + x)); };

(async () => {
  const browser = await chromium.launch();
  const hostCtx = await browser.newContext({ viewport: { width: 900, height: 950 }, deviceScaleFactor: 2 });
  const guestCtx = await browser.newContext({ viewport: { width: 900, height: 950 }, deviceScaleFactor: 2 });
  const host = await hostCtx.newPage();
  const guest = await guestCtx.newPage();

  const errs = [];
  for (const [tag, p] of [["host", host], ["guest", guest]]) {
    p.on("pageerror", (e) => errs.push(tag + ": " + e));
    p.on("console", (m) => { if (m.type() === "error") errs.push(tag + " console: " + m.text()); });
  }

  for (const p of [host, guest]) {
    await p.goto(file);
    await p.evaluate(() => localStorage.clear());
    await p.reload();
    await p.waitForTimeout(300);
  }

  // ---- host creates a room ----
  await host.click('.seg-btn[data-mode="online"]');
  await host.waitForTimeout(200);
  await host.fill("#netName", "영희");
  await host.click("#netCreate");
  await host.waitForTimeout(3500);

  const code = (await host.textContent("#netCodeBig")).trim();
  ok("room code issued", /^[A-Z0-9]{4}$/.test(code), code);
  ok("host lobby shows 1 waiting", (await host.textContent("#netWait")).includes("1명"));
  ok("start disabled with one player", await host.locator("#netStart").isDisabled());

  // ---- guest joins ----
  await guest.click('.seg-btn[data-mode="online"]');
  await guest.waitForTimeout(200);
  await guest.fill("#netName", "철수");
  await guest.fill("#netCode", code);
  await guest.click("#netJoin");
  await guest.waitForTimeout(4000);

  ok("host sees 2 waiting", (await host.textContent("#netWait")).includes("2명"), await host.textContent("#netWait"));
  ok("guest sees the same code", (await guest.textContent("#netCodeBig")).trim() === code);
  ok("start now enabled", await host.locator("#netStart").isEnabled());
  ok("guest cannot start", await guest.locator("#netStart").isHidden());

  // ---- start the race ----
  await host.click("#netStart");
  await host.waitForTimeout(1200);

  ok("host sheet closed", await host.locator("#net").isHidden());
  ok("guest sheet closed", await guest.locator("#net").isHidden());
  ok("race strip visible on host", await host.locator("#race").isVisible());
  ok("two racers listed", (await host.locator(".race-chip").count()) === 2);

  // ---- both play ----
  for (let i = 0; i < 18; i++) {
    await host.keyboard.press(["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"][i % 4]);
    await host.waitForTimeout(70);
    if (i % 2 === 0) {
      await guest.keyboard.press(["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"][i % 4]);
      await guest.waitForTimeout(70);
    }
  }
  await host.waitForTimeout(1500);

  const hostChips = await host.locator(".race-chip").count();
  const scores = await host.evaluate(() =>
    [...document.querySelectorAll(".race-chip")].map((c) => ({
      name: c.querySelector(".race-name").textContent,
      score: c.querySelector(".race-score").textContent,
      filled: [...c.querySelectorAll(".mini i")].filter((d) => d.style.background).length,
    }))
  );
  ok("both racers still shown", hostChips === 2);
  ok("host sees its own live board in the strip", scores.some((s) => s.name === "YOU" && s.filled > 0), JSON.stringify(scores));
  ok("host sees the guest's board filling in", scores.some((s) => s.name === "철수" && s.filled > 0), JSON.stringify(scores));
  ok("scores are moving", scores.some((s) => s.score !== "0"), JSON.stringify(scores));

  const guestScores = await guest.evaluate(() =>
    [...document.querySelectorAll(".race-chip")].map((c) => c.querySelector(".race-name").textContent)
  );
  ok("guest labels itself YOU", guestScores.includes("YOU"), JSON.stringify(guestScores));
  ok("guest sees the host by name", guestScores.includes("영희"), JSON.stringify(guestScores));

  await host.screenshot({ path: "shot-race-host.png" });
  await guest.screenshot({ path: "shot-race-guest.png" });

  // ---- leaving tears the room down ----
  await guest.click("#btnTheme"); // just to be sure the page is responsive
  await guest.evaluate(() => window.dispatchEvent(new Event("beforeunload")));

  console.log("\nerrors:", errs.length ? errs.slice(0, 5) : "none");
  console.log(`${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
