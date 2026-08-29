"use strict";

const fs = require("fs");
const path = require("path");

const raw = process.argv.slice(2);
const allowPublicHttp = raw.includes("--allow-public-http");
const values = raw.filter(value => value !== "--allow-public-http").flatMap(value => String(value).split(/[\s,;]+/)).filter(Boolean);
if (!values.length) {
  console.error(`用法：node scripts/configure-production-bootstrap.cjs [--allow-public-http] https://config.example.com`);
  process.exit(1);
}
const urls = [];
for (const value of values) {
  const parsed = new URL(value);
  if ((!allowPublicHttp && parsed.protocol !== "https:") || !["http:", "https:"].includes(parsed.protocol)) throw new Error(allowPublicHttp ? "内测配置引导域名只支持 HTTP 或 HTTPS" : "正式配置引导域名必须使用 HTTPS");
  if (parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error("配置引导域名不能包含账号、查询参数或锚点");
  const normalized = `${parsed.origin}${parsed.pathname.replace(/\/+$/, "")}`;
  if (!urls.includes(normalized)) urls.push(normalized);
}
const file = path.resolve(__dirname, "..", "assets", "connection-bootstrap.json");
fs.writeFileSync(file, JSON.stringify({version:1, bootstrapUrls:urls, productionDomainRequired:false, allowPublicHttp, note:allowPublicHttp ? "内测模式：允许公网 HTTP 或 HTTPS；正式上线前切换到 HTTPS" : "正式配置引导域名与实际业务域名均使用 HTTPS"}, null, 2) + "\n", "utf8");
console.log(`已写入配置引导域名：${urls.join(", ")}（allowPublicHttp=${allowPublicHttp}）`);
