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

function requestText(target) {
  return new Promise((resolve, reject) => {
    http.get(target, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    }).on("error", reject);
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
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "foodflow-smoke-"));
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
  const tab = await requestJson(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, "PUT");
  return connect(tab.webSocketDebuggerUrl);
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

async function render(page, offline) {
  await page.command("Page.enable");
  await page.command("Runtime.enable");
  await page.command("Network.enable");
  if (offline) await page.command("Network.emulateNetworkConditions", { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 });
  await page.command("Page.navigate", { url });
  await new Promise(resolve => setTimeout(resolve, offline ? 7000 : 9000));
  if (!offline) {
    await page.command("Runtime.evaluate", { expression: 'localStorage.setItem("family_adults", "1"); localStorage.setItem("family_children", "0"); localStorage.setItem("family_budget", "20000"); localStorage.setItem("foodflow_onboarded", "1");' });
    await page.command("Page.reload", { ignoreCache: false });
    await new Promise(resolve => setTimeout(resolve, 9000));
  }
  const result = await page.command("Runtime.evaluate", {
    returnByValue: true,
    expression: '(() => ({ title: document.title, hasToday: !!document.querySelector("#today"), text: document.body.innerText.slice(0, 2500), sw: !!navigator.serviceWorker, controlled: !!navigator.serviceWorker.controller, errors: localStorage.getItem("foodflow_runtime_errors") || "" }))()'
  });
  return result.result.value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  await withBrowser(async port => {
    const page = await newPage(port);
    const online = await render(page, false);
    assert(online.title.includes("FoodFlow"), "online: missing title");
    assert(online.hasToday, "online: missing #today");
    assert(/Сегодня|День|Завтрак|Расписание/.test(online.text), "online: schedule text not rendered");
    assert(online.sw, "online: service worker API unavailable");
    page.close();

    const offlinePage = await newPage(port);
    const offline = await render(offlinePage, true);
    assert(offline.title.includes("FoodFlow"), "offline: missing title");
    assert(offline.hasToday, "offline: missing #today");
    assert(/Сегодня|День|Завтрак|Расписание/.test(offline.text), "offline: schedule text not rendered");
    offlinePage.close();
  });
  console.log(`Browser online/offline smoke passed: ${url}`);
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
