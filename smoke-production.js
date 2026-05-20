const https = require("https");
const { URL } = require("url");
const fs = require("fs");
const path = require("path");

const release = JSON.parse(fs.readFileSync(path.join(__dirname, "release.json"), "utf8"));
const origin = release.productionOrigin;
const root = release.productionUrl;

function fetchText(url) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8")
      }));
    });
    request.setTimeout(30000, () => request.destroy(new Error(`Timeout: ${url}`)));
    request.on("error", reject);
  });
}

function assert(condition, message) {
  if (!condition) {
    console.error(message);
    process.exit(1);
  }
}

function headerIncludes(response, name, value) {
  return String(response.headers[name.toLowerCase()] || "").includes(value);
}

async function check(pathname, options = {}) {
  const url = new URL(pathname, root).toString();
  const response = await fetchText(url);
  assert(response.statusCode === 200, `${url}: expected 200, got ${response.statusCode}`);
  if (options.cache) assert(headerIncludes(response, "cache-control", options.cache), `${url}: missing cache header ${options.cache}`);
  if (options.contentType) assert(headerIncludes(response, "content-type", options.contentType), `${url}: missing content type ${options.contentType}`);
  if (options.includes) {
    for (const text of options.includes) assert(response.body.includes(text), `${url}: missing ${text}`);
  }
  return response;
}

(async () => {
  await check("/", {
    cache: "max-age=0, must-revalidate",
    contentType: "text/html",
    includes: [
      `<link rel="canonical" href="${root}">`,
      `<meta property="og:image" content="${origin}/icons/icon-512.png">`,
      "FoodFlow · План питания"
    ]
  });
  await check("/app.js", { cache: "max-age=0, must-revalidate", contentType: "application/javascript" });
  await check("/data-loader.js", { cache: "max-age=0, must-revalidate", contentType: "application/javascript" });
  await check("/data-bundle.js", { cache: "max-age=0, must-revalidate", contentType: "application/javascript" });
  await check("/sw.js", {
    cache: "max-age=0, must-revalidate",
    contentType: "application/javascript",
    includes: ["CACHE_VERSION", "2026-05-20-rc-3"]
  });
  await check("/manifest.webmanifest", { contentType: "application/manifest+json", includes: ["FoodFlow", "icons/icon-512.png"] });
  await check("/robots.txt", { cache: "max-age=0, must-revalidate", includes: [`Sitemap: ${origin}/sitemap.xml`] });
  await check("/sitemap.xml", { cache: "max-age=0, must-revalidate", contentType: "application/xml", includes: [`<loc>${root}</loc>`] });
  await check("/data/recipes.json", { cache: "max-age=0, must-revalidate", contentType: "application/json", includes: ["manual_reviewed"] });
  await check("/icons/icon-512.png", { cache: "max-age=31536000, immutable", contentType: "image/png" });
  console.log(`Production smoke passed: ${root}`);
})().catch(error => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
