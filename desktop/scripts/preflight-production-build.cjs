"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const bootstrapFile = path.join(root, "assets", "connection-bootstrap.json");
const bootstrap = JSON.parse(fs.readFileSync(bootstrapFile, "utf8"));
const updateConfig = JSON.parse(fs.readFileSync(path.join(root, "assets", "update-config.json"), "utf8"));
const urls = Array.isArray(bootstrap.bootstrapUrls) ? bootstrap.bootstrapUrls : [];
const allowPublicHttp = process.argv.includes("--allow-public-http");

function validBuildUrl(value) {
  try {
    const url = new URL(String(value || "").trim());
    if ((!allowPublicHttp && url.protocol !== "https:") || !["http:", "https:"].includes(url.protocol)) return false;
    if (url.username || url.password || url.search || url.hash) return false;
    return !["127.0.0.1", "localhost", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

if (packageJson.version !== "0.12.5") throw new Error(`构建版本必须为 0.12.5，当前为 ${packageJson.version || "未知"}`);
if (bootstrap.productionDomainRequired !== false) throw new Error("尚未写入正式配置引导域名，已阻止生成租户安装包");
if (bootstrap.allowPublicHttp === true && !allowPublicHttp) throw new Error("当前引导配置允许公网 HTTP，只能使用内测构建参数");
if (!urls.length || urls.some(url => !validBuildUrl(url))) throw new Error(allowPublicHttp ? "内测引导地址必须是非本机 HTTP/HTTPS 域名" : "正式引导地址必须全部为非本机 HTTPS 域名");
if (updateConfig.enabled !== true || !validBuildUrl(updateConfig.url)) throw new Error(allowPublicHttp ? "内测更新地址必须是非本机 HTTP/HTTPS 域名" : "正式更新地址必须是非本机 HTTPS 域名");
const publishUrl=packageJson.build?.publish?.[0]?.url;
if (String(publishUrl||"").replace(/\/+$/,"") !== String(updateConfig.url||"").replace(/\/+$/,"")) throw new Error("构建发布地址与客户端更新地址不一致");

console.log(JSON.stringify({ok: true, version: packageJson.version, bootstrapCount: urls.length, updateConfigured:true, allowPublicHttp}, null, 2));
