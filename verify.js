const { spawnSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const syntaxOnly = process.argv.includes("--syntax-only");

function run(command, args) {
  const result = spawnSync(command, args, { stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status || 1);
}

function checkSyntax() {
  for (const file of fs.readdirSync(__dirname)) {
    if (path.extname(file) === ".js") run(process.execPath, ["--check", path.join(__dirname, file)]);
  }
}

function readText(file) {
  return fs.readFileSync(path.join(__dirname, file), "utf8");
}

function assertIncludes(file, text, description) {
  if (!readText(file).includes(text)) {
    console.error(`${file}: missing ${description}: ${text}`);
    process.exit(1);
  }
}

function checkReleaseMetadata() {
  const release = JSON.parse(readText("release.json"));
  const url = release.productionUrl;
  const origin = release.productionOrigin;
  if (!/^https:\/\/[^/]+\/$/.test(url)) {
    console.error("release.json: productionUrl must be an absolute HTTPS URL ending with /.");
    process.exit(1);
  }
  if (!/^https:\/\/[^/]+$/.test(origin) || !url.startsWith(origin + "/")) {
    console.error("release.json: productionOrigin must match productionUrl origin.");
    process.exit(1);
  }
  assertIncludes("index.html", `<link rel="canonical" href="${url}">`, "absolute canonical URL");
  assertIncludes("index.html", `<meta property="og:image" content="${origin}/icons/icon-512.png">`, "absolute Open Graph image URL");
  assertIncludes("index.html", `<meta name="twitter:image" content="${origin}/icons/icon-512.png">`, "absolute Twitter image URL");
  assertIncludes("sitemap.xml", `<loc>${url}</loc>`, "absolute sitemap URL");
  assertIncludes("robots.txt", `Sitemap: ${origin}/sitemap.xml`, "absolute robots sitemap URL");
  assertIncludes("vercel.json", `"value": "public, max-age=0, must-revalidate"`, "non-immutable JavaScript cache policy");
}

if (!syntaxOnly) {
  run(process.execPath, ["test-runtime.js"]);
  run(process.execPath, ["check-html-refs.js"]);
  run(process.execPath, ["check-sw-files.js"]);
  run(process.execPath, ["audit.js"]);
  run(process.execPath, ["audit-all-profiles.js"]);
  run(process.execPath, ["check-recipe-coverage.js"]);
  run("python", ["validate_recipe_cleanup.py"]);
  checkReleaseMetadata();
}

checkSyntax();
