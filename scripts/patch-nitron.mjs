import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import JSZip from "jszip";

const require = createRequire(import.meta.url);
const aapt = require("aaptjs3");
const execFileAsync = promisify(execFile);

const cliPath = path.resolve("node_modules", "nitron", "dist", "cli.js");
const originalPermissions = 'const permissions = [.../* @__PURE__ */ new Set([...config.permissions.map((p) => p.toUpperCase()), "INTERNET"])];';
const offlinePermissions = 'const permissions = [.../* @__PURE__ */ new Set(config.permissions.map((p) => p.toUpperCase()))];';

let source = await fs.readFile(cliPath, "utf8");
let changed = false;
if (source.includes(originalPermissions)) {
  source = source.replace(originalPermissions, offlinePermissions);
  changed = true;
} else if (!source.includes(offlinePermissions)) {
  throw new Error("Unsupported Nitron build: permission patch target was not found.");
}

const noIcon = 'this.attr(nsUriIdx, this.getIdx("label"), config.appLabel, TYPE_STRING),\n      this.attr(nsUriIdx, this.getIdx("hardwareAccelerated"), true, TYPE_INT_BOOLEAN),';
const systemIcon = 'this.attr(nsUriIdx, this.getIdx("label"), config.appLabel, TYPE_STRING),\n      this.attr(nsUriIdx, this.getIdx("icon"), 17301651, TYPE_REFERENCE),\n      this.attr(nsUriIdx, this.getIdx("hardwareAccelerated"), true, TYPE_INT_BOOLEAN),';
const customIcon = 'this.attr(nsUriIdx, this.getIdx("label"), config.appLabel, TYPE_STRING),\n      this.attr(nsUriIdx, this.getIdx("icon"), 2130771968, TYPE_REFERENCE),\n      this.attr(nsUriIdx, this.getIdx("hardwareAccelerated"), true, TYPE_INT_BOOLEAN),';
if (source.includes(noIcon)) {
  source = source.replace(noIcon, customIcon);
  changed = true;
} else if (source.includes(systemIcon)) {
  source = source.replace(systemIcon, customIcon);
  changed = true;
} else if (!source.includes(customIcon)) {
  throw new Error("Unsupported Nitron build: launcher icon patch target was not found.");
}

const defaultExcludes = '  "node_modules",\n  "dist",';
const iconExcludes = '  "node_modules",\n  "android-icon",\n  "apktool-v1.5.4",\n  "outputs",\n  "dist",';
const previousIconExcludes = '  "node_modules",\n  "android-icon",\n  "dist",';
if (source.includes(defaultExcludes)) {
  source = source.replace(defaultExcludes, iconExcludes);
  changed = true;
} else if (source.includes(previousIconExcludes)) {
  source = source.replace(previousIconExcludes, iconExcludes);
  changed = true;
} else if (!source.includes(iconExcludes)) {
  throw new Error("Unsupported Nitron build: asset exclusion patch target was not found.");
}
if (changed) await fs.writeFile(cliPath, source, "utf8");

const resDir = path.resolve("android-icon", "res");
const baseApkPath = path.resolve("node_modules", "nitron", "template", "base.apk");
const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "pipedesk-icon-"));
try {
  const manifestPath = path.join(tempDir, "AndroidManifest.xml");
  const compiledPath = path.join(tempDir, "compiled.zip");
  const resourceApkPath = path.join(tempDir, "resources.apk");
  await fs.writeFile(manifestPath, '<manifest xmlns:android="http://schemas.android.com/apk/res/android" package="vn.thansang.pipedesk" />', "utf8");
  const aapt2 = aapt.getBinPath();
  await execFileAsync(aapt2, ["compile", "--dir", resDir, "-o", compiledPath], { maxBuffer: 10 * 1024 * 1024 });
  await execFileAsync(aapt2, ["link", "-o", resourceApkPath, "--manifest", manifestPath, compiledPath], { maxBuffer: 10 * 1024 * 1024 });
  const [resourceZip, baseZip] = await Promise.all([
    JSZip.loadAsync(await fs.readFile(resourceApkPath)),
    JSZip.loadAsync(await fs.readFile(baseApkPath))
  ]);
  for (const [name, entry] of Object.entries(resourceZip.files)) {
    if (name !== "resources.arsc" && !name.startsWith("res/")) continue;
    if (entry.dir) baseZip.folder(name);
    else baseZip.file(name, await entry.async("nodebuffer"), { compression: "STORE" });
  }
  await fs.writeFile(baseApkPath, await baseZip.generateAsync({
    type: "nodebuffer",
    compression: "DEFLATE",
    compressionOptions: { level: 9 }
  }));
} finally {
  await fs.rm(tempDir, { recursive: true, force: true });
}
