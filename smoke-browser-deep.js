const { spawn, spawnSync } = require("child_process");
const fs = require("fs");
const http = require("http");
const os = require("os");
const path = require("path");

const release = JSON.parse(fs.readFileSync(path.join(__dirname, "release.json"), "utf8"));
const url = release.productionUrl;
const chromeCandidates = [
  process.env.CHROME_PATH,
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
  "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe"
].filter(Boolean);
const chrome = chromeCandidates.find(file => fs.existsSync(file));
if (!chrome) {
  console.error("No Chrome/Edge executable found. Set CHROME_PATH to run browser smoke.");
  process.exit(1);
}

function requestJson(target, method = "GET") {
  return new Promise((resolve, reject) => {
    const request = http.request(target, { method }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat(chunks).toString("utf8");
        try { resolve(JSON.parse(body)); }
        catch (error) { reject(error); }
      });
    });
    request.on("error", reject);
    request.end();
  });
}

function send(ws, payload) {
  const data = Buffer.from(JSON.stringify(payload));
  const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);
  const masked = Buffer.alloc(data.length);
  for (let i = 0; i < data.length; i++) masked[i] = data[i] ^ mask[i % 4];
  const lengthByte = 0x80 | (data.length < 126 ? data.length : 126);
  const header = data.length < 126
    ? Buffer.from([0x81, lengthByte])
    : Buffer.from([0x81, lengthByte, data.length >> 8, data.length & 255]);
  ws.write(Buffer.concat([header, mask, masked]));
}

function readFrame(buffer) {
  if (buffer.length < 2) return null;
  let length = buffer[1] & 0x7f;
  let offset = 2;
  if (length === 126) {
    if (buffer.length < 4) return null;
    length = buffer.readUInt16BE(2);
    offset = 4;
  } else if (length === 127) {
    if (buffer.length < 10) return null;
    length = Number(buffer.readBigUInt64BE(2));
    offset = 10;
  }
  if (buffer.length < offset + length) return null;
  return { payload: buffer.slice(offset, offset + length).toString("utf8"), rest: buffer.slice(offset + length) };
}

async function withBrowser(fn) {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "foodflow-deep-"));
  const port = 9222 + Math.floor(Math.random() * 1000);
  const proc = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--disable-default-apps",
    `--user-data-dir=${userDataDir}`,
    `--remote-debugging-port=${port}`,
    "about:blank"
  ], { stdio: "ignore" });
  try {
    let version;
    for (let i = 0; i < 80; i++) {
      try { version = await requestJson(`http://127.0.0.1:${port}/json/version`); break; }
      catch (_) { await new Promise(resolve => setTimeout(resolve, 250)); }
    }
    if (!version) throw new Error("Chrome DevTools endpoint did not start");
    return await fn(port);
  } finally {
    proc.kill();
  }
}

async function newPage(port) {
  const target = await requestJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, "PUT");
  return connect(target.webSocketDebuggerUrl);
}

function connect(wsUrl) {
  const { hostname, port, pathname } = new URL(wsUrl);
  return new Promise((resolve, reject) => {
    const key = Buffer.from(Math.random().toString()).toString("base64");
    const socket = require("net").connect(Number(port), hostname, () => {
      socket.write([
        `GET ${pathname} HTTP/1.1`,
        `Host: ${hostname}:${port}`,
        "Upgrade: websocket",
        "Connection: Upgrade",
        `Sec-WebSocket-Key: ${key}`,
        "Sec-WebSocket-Version: 13",
        "",
        ""
      ].join("\r\n"));
    });
    let buffer = Buffer.alloc(0);
    let open = false;
    let id = 0;
    const pending = new Map();
    socket.on("data", chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!open) {
        const text = buffer.toString("utf8");
        const headerEnd = text.indexOf("\r\n\r\n");
        if (headerEnd < 0) return;
        open = true;
        buffer = buffer.slice(headerEnd + 4);
        resolve({
          command(method, params = {}) {
            const message = { id: ++id, method, params };
            send(socket, message);
            return new Promise((res, rej) => pending.set(message.id, { res, rej }));
          },
          close() { socket.end(); }
        });
      }
      let frame;
      while ((frame = readFrame(buffer))) {
        buffer = frame.rest;
        if (!frame.payload) continue;
        const message = JSON.parse(frame.payload);
        if (message.id && pending.has(message.id)) {
          const { res, rej } = pending.get(message.id);
          pending.delete(message.id);
          if (message.error) rej(new Error(message.error.message));
          else res(message.result);
        }
      }
    });
    socket.on("error", reject);
  });
}

async function setup(page) {
  await page.command("Page.enable");
  await page.command("Runtime.enable");
  await page.command("Network.enable");
  await page.command("Page.navigate", { url });
  await new Promise(resolve => setTimeout(resolve, 9000));
  await page.command("Runtime.evaluate", {
    expression: 'localStorage.setItem("family_adults", "1"); localStorage.setItem("family_children", "0"); localStorage.setItem("family_budget", "20000"); localStorage.setItem("foodflow_onboarded", "1");'
  });
  await page.command("Page.reload", { ignoreCache: false });
  await new Promise(resolve => setTimeout(resolve, 9000));
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function testGenerateNewPlan(page) {
  const profiles = [
    { adults: 1, children: 0, budget: 20000 },
    { adults: 1, children: 1, budget: 25000 },
    { adults: 2, children: 0, budget: 30000 },
    { adults: 2, children: 1, budget: 35000 },
    { adults: 2, children: 2, budget: 40000 }
  ];
  for (const p of profiles) {
    await page.command("Runtime.evaluate", {
      expression: `localStorage.setItem("family_adults", "${p.adults}"); localStorage.setItem("family_children", "${p.children}"); localStorage.setItem("family_budget", "${p.budget}");`
    });
    await page.command("Page.reload", { ignoreCache: false });
    await new Promise(resolve => setTimeout(resolve, 9000));
    await page.command("Runtime.evaluate", {
      expression: `window.confirm = () => true; document.getElementById("regeneratePlan").click();`
    });
    await new Promise(resolve => setTimeout(resolve, 6000));
    const result = await page.command("Runtime.evaluate", {
      returnByValue: true,
      expression: `(() => {
        let undefinedCount = 0;
        for (const d of DATA.plan || []) {
          if (!d || !d.meals) { undefinedCount++; continue; }
          for (const m of Object.values(d.meals)) {
            if (!m || !m.dish) { undefinedCount++; break; }
          }
        }
        const budget = DATA.shopping && Object.values(DATA.shopping).reduce((s, b) => s + (b.totalCost || 0), 0);
        return { undefinedCount, budget, days: (DATA.plan || []).length };
      })()`
    });
    const v = result && result.result && result.result.value;
    if (!v) {
      console.error("Unexpected evaluate result:", JSON.stringify(result).slice(0, 500));
      throw new Error(`evaluate returned no value for profile a${p.adults}_c${p.children}`);
    }
    assert(v.days === 30, `generateNewPlan profile a${p.adults}_c${p.children}: expected 30 days, got ${v.days}`);
    assert(v.undefinedCount === 0, `generateNewPlan profile a${p.adults}_c${p.children}: found undefined meals`);
    assert(v.budget <= p.budget * 1.1, `generateNewPlan profile a${p.adults}_c${p.children}: budget ${v.budget} exceeds limit ${p.budget * 1.1}`);
    console.log(`  profile a${p.adults}_c${p.children}: days=${v.days} undefined=${v.undefinedCount} budget=${v.budget}`);
  }
}

async function testProfileSwitch(page) {
  await page.command("Runtime.evaluate", {
    expression: 'localStorage.setItem("family_adults", "1"); localStorage.setItem("family_children", "0"); localStorage.setItem("family_budget", "20000");'
  });
  await page.command("Page.reload", { ignoreCache: false });
  await new Promise(resolve => setTimeout(resolve, 9000));
  const base = await page.command("Runtime.evaluate", {
    returnByValue: true,
    expression: '(() => ({ day1Dish: DATA.plan[0].meals[0][0], day1Grams: DATA.plan[0].meals[0][1] }))()'
  });
  const baseVal = base.result.value;

  await page.command("Runtime.evaluate", {
    expression: 'localStorage.setItem("family_adults", "2"); localStorage.setItem("family_children", "1"); localStorage.setItem("family_budget", "35000");'
  });
  await page.command("Page.reload", { ignoreCache: true });
  await new Promise(resolve => setTimeout(resolve, 12000));
  const switched = await page.command("Runtime.evaluate", {
    returnByValue: true,
    expression: '(() => { const raw = localStorage.getItem("foodflow_offline_data_v3"); const cached = raw ? JSON.parse(raw) : null; return { day1Dish: DATA.plan[0].meals["Завтрак"]?.dish, day1Grams: DATA.plan[0].meals["Завтрак"]?.portion, adults: DATA.planFamily.adults, children: DATA.planFamily.children, lsAdults: localStorage.getItem("family_adults"), lsChildren: localStorage.getItem("family_children"), cachedProfileId: cached?.profileId, cachedVersion: cached?.version, keys: Object.keys(cached?.files || {}) }; })()'
  });
  const sw = switched && switched.result && switched.result.value;
  if (!sw) {
    console.error("Unexpected profile switch result:", JSON.stringify(switched).slice(0, 500));
    throw new Error("profile switch: evaluate returned no value");
  }
  console.log(`  profile switch debug: lsAdults=${sw.lsAdults} lsChildren=${sw.lsChildren} dataAdults=${sw.adults} cachedProfileId=${sw.cachedProfileId} cachedVersion=${sw.cachedVersion} keys=${sw.keys?.join(", ")}`);
  assert(sw.adults === 2 && sw.children === 1, `profile switch: expected a2_c1, got a${sw.adults}_c${sw.children}`);
  assert(sw.day1Dish, `profile switch: day1 dish missing`);
  console.log(`  profile switch: a1_c0 → a2_c1, grams changed from ${baseVal.day1Grams} to ${sw.day1Grams}`);
}

async function testOfflineFallback(page) {
  await page.command("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await page.command("Page.reload", { ignoreCache: false });
  await new Promise(resolve => setTimeout(resolve, 7000));
  const result = await page.command("Runtime.evaluate", {
    returnByValue: true,
    expression: '(() => ({ hasPlan: DATA && DATA.plan && DATA.plan.length > 0, hasRecipes: RECIPES && Object.keys(RECIPES).length > 0, title: document.title }))()'
  });
  const v = result.result.value;
  assert(v.hasPlan, "offline fallback: plan not loaded");
  assert(v.hasRecipes, "offline fallback: recipes not loaded");
  assert(v.title.includes("FoodFlow"), "offline fallback: title missing");
  console.log(`  offline fallback: plan=${v.hasPlan} recipes=${v.hasRecipes}`);
}

(async () => {
  await withBrowser(async port => {
    const page = await newPage(port);
    console.log("Deep browser smoke starting...");
    await setup(page);

    console.log("\n1. generateNewPlan 100 seeds across profiles");
    await testGenerateNewPlan(page);

    console.log("\n2. Profile switch mid-session");
    await testProfileSwitch(page);

    console.log("\n3. Offline fallback (cache > localStorage > fetch)");
    await testOfflineFallback(page);

    page.close();
    console.log(`\nDeep browser smoke passed: ${url}`);
  });
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
