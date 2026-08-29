"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const dist = path.join(root, "dist-tenant");
const target = path.join(dist, "update-upload", "stable");
const expected = "灵帧AI-Setup-x64.exe";
const required = ["latest.yml", expected, `${expected}.blockmap`];
for (const name of required) if (!fs.existsSync(path.join(dist, name))) throw new Error(`缺少更新发布文件：${name}，请先完成 Windows NSIS 打包`);
fs.mkdirSync(target, {recursive: true});
const files = required.map(name => {
  const source = path.join(dist, name), destination = path.join(target, name);
  fs.copyFileSync(source, destination);
  const buffer = fs.readFileSync(destination);
  return {name, bytes: buffer.length, sha256: crypto.createHash("sha256").update(buffer).digest("hex").toUpperCase()};
});
const manifest = {version: pkg.version, channel: "stable", generatedAt: new Date().toISOString(), uploadPath: "/desktop-updates/stable", files};
fs.writeFileSync(path.join(target, "release-manifest.json"), JSON.stringify(manifest, null, 2));
console.log(JSON.stringify({ok:true,target,files},null,2));
