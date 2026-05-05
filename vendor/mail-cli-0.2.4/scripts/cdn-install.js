#!/usr/bin/env node
"use strict";

// postinstall script for CDN distribution mode.
// Downloads the platform-specific binary from a CDN URL during `npm install`.
//
// URLs are stored in this package's package.json under `clawemailCdn.urls`:
//   {
//     "clawemailCdn": {
//       "urls": {
//         "darwin-arm64": "http://mail-online.nosdn.127.net/abc123",
//         "linux-x64":    "http://mail-online.nosdn.127.net/def456",
//         ...
//       }
//     }
//   }

const https = require("https");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const zlib = require("zlib");

const SUPPORTED = ["darwin-arm64", "darwin-x64", "linux-x64", "linux-arm64", "win32-x64"];
const key = `${os.platform()}-${os.arch()}`;

if (!SUPPORTED.includes(key)) {
  console.error(`mail-cli: unsupported platform ${key}. Supported: ${SUPPORTED.join(", ")}`);
  process.exit(1);
}

const pkgJsonPath = path.join(__dirname, "..", "package.json");
const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
const cdnConfig = pkgJson.clawemailCdn;

if (!cdnConfig || !cdnConfig.urls) {
  process.exit(0);
}

const url = process.env.CLAWMAIL_CDN_OVERRIDE || cdnConfig.urls[key];

if (!url) {
  console.warn(`mail-cli: no CDN URL configured for ${key}, skipping`);
  process.exit(0);
}

const binDir = path.join(__dirname, "..", "bin");
const exe = os.platform() === "win32" ? "mail-cli-binary.exe" : "mail-cli-binary";
const binPath = path.join(binDir, exe);

// Skip if binary already exists
if (fs.existsSync(binPath)) {
  try {
    if (fs.statSync(binPath).size > 1024) {
      process.exit(0);
    }
  } catch {}
}

fs.mkdirSync(binDir, { recursive: true });
console.log(`mail-cli: downloading binary for ${key}...`);
console.log(`  ${url}`);

function fetch(targetUrl, redirects) {
  if (redirects > 5) {
    console.error("mail-cli: too many redirects");
    process.exit(1);
  }
  const mod = targetUrl.startsWith("https") ? https : http;
  return new Promise((resolve, reject) => {
    const req = mod.get(targetUrl, { headers: { "User-Agent": "mail-cli-installer" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let loc = res.headers.location;
        if (loc.startsWith("/")) {
          const u = new URL(targetUrl);
          loc = `${u.protocol}//${u.host}${loc}`;
        }
        res.resume();
        return resolve(fetch(loc, redirects + 1));
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} from ${targetUrl}`));
      }
      resolve(res);
    });
    req.on("error", reject);
    req.setTimeout(60000, () => { req.destroy(); reject(new Error("Download timed out")); });
  });
}

async function download() {
  try {
    const res = await fetch(url, 0);
    const tmpPath = binPath + ".tmp";
    const file = fs.createWriteStream(tmpPath);
    const contentLength = parseInt(res.headers["content-length"], 10);
    let downloaded = 0;
    let lastPct = -1;

    res.on("data", (chunk) => {
      downloaded += chunk.length;
      if (contentLength) {
        const pct = Math.floor((downloaded / contentLength) * 100);
        if (pct !== lastPct && pct % 10 === 0) {
          process.stdout.write(`\r  downloading... ${pct}%`);
          lastPct = pct;
        }
      }
    });

    const gunzip = zlib.createGunzip();
    res.pipe(gunzip).pipe(file);
    await new Promise((resolve, reject) => {
      file.on("finish", () => file.close(resolve));
      file.on("error", reject);
      gunzip.on("error", reject);
      res.on("error", reject);
    });
    process.stdout.write("\n");

    fs.renameSync(tmpPath, binPath);
    if (os.platform() !== "win32") fs.chmodSync(binPath, 0o755);

    const size = fs.statSync(binPath).size;
    console.log(`mail-cli: installed ${(size / 1024 / 1024).toFixed(1)}MB binary to ${binPath}`);
  } catch (err) {
    console.error("mail-cli: failed to download binary from CDN");
    console.error(`  ${err.message}`);
    console.error(`  url: ${url}`);
    console.error("");
    console.error("You can retry with: node node_modules/@clawemail/mail-cli/scripts/cdn-install.js");
    process.exit(0);
  }
}

download();
