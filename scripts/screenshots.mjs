// 390×844 (iPhone 14/15) screenshots of the mock-data UI in light and dark mode.
// Drives the locally installed Chrome over the DevTools Protocol (Node 22 built-in
// WebSocket, no project dependency) so the viewport is exactly 390px wide (headless
// --window-size can't go below 500px) and prefers-color-scheme is emulated.
// Usage: MOCK_DATA=1 npm run dev (other terminal), then: npm run screenshots [outDir]
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const chrome = [
  process.env.CHROME_BIN,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
]
  .filter(Boolean)
  .find((p) => existsSync(p));
if (!chrome) {
  console.error("Chrome not found; set CHROME_BIN.");
  process.exit(1);
}

const base = process.env.SCREENSHOT_BASE ?? "http://localhost:3000";
const outDir = resolve(process.argv[2] ?? ".screenshots");
mkdirSync(outDir, { recursive: true });
const PORT = 9333;

const shots = [
  { name: "feed", path: "/" },
  { name: "feed-outages", path: "/?s=outages" },
  // Expand the first card's deep dive inline, then scroll it into view.
  { name: "feed-expanded", path: "/", script: "document.querySelector('button[aria-expanded]').click(); await new Promise(r => setTimeout(r, 400)); window.scrollTo(0, document.querySelector('[aria-expanded=true]').getBoundingClientRect().top + scrollY - 120);" },
  { name: "post-expanded", path: "/post/00000000-0000-4000-8000-000000000002", script: "window.scrollTo(0, 560);" },
  { name: "login", path: "/login" },
];

const proc = spawn(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--hide-scrollbars",
  "--no-first-run",
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${mkdtempSync(join(tmpdir(), "tf-shot-"))}`,
  "about:blank",
]);

async function waitForTarget() {
  for (let i = 0; i < 50; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === "page");
      if (page) return page.webSocketDebuggerUrl;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error("Chrome DevTools endpoint did not start");
}

const ws = new WebSocket(await waitForTarget());
await new Promise((r) => ws.addEventListener("open", r, { once: true }));
let nextId = 0;
const pending = new Map();
const waiters = [];
ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg);
    pending.delete(msg.id);
  } else if (msg.method) {
    for (const w of waiters.splice(0)) w(msg);
  }
});
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, (msg) => (msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)));
    ws.send(JSON.stringify({ id, method, params }));
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

await send("Page.enable");
await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send("Emulation.setTouchEmulationEnabled", { enabled: true });

for (const scheme of ["light", "dark"]) {
  await send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: scheme }] });
  for (const shot of shots) {
    await send("Page.navigate", { url: `${base}${shot.path}` });
    await sleep(2500);
    if (shot.script) {
      await send("Runtime.evaluate", { expression: `(async () => { ${shot.script} })()`, awaitPromise: true });
      await sleep(600);
    }
    const { result } = await send("Runtime.evaluate", { expression: "window.innerWidth + 'x' + window.innerHeight + ' scrollW=' + document.documentElement.scrollWidth", returnByValue: true });
    const { data } = await send("Page.captureScreenshot", { format: "png" });
    const file = join(outDir, `${shot.name}-${scheme}.png`);
    writeFileSync(file, Buffer.from(data, "base64"));
    console.log(`${file}  viewport=${result.value}`);
  }
}

ws.close();
proc.kill();
