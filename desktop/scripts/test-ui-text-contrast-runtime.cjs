"use strict";

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const truth = JSON.parse(fs.readFileSync(path.join(root, "references", "ui-text-contrast-ground-truth.json"), "utf8"));
const port = Number(process.env.LINGFRAME_CDP_PORT || 9333);
const targetHint = String(process.env.LINGFRAME_TARGET_HINT || "lingzhen_ai_desktop");

async function connect() {
  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const target = targets.find(item => String(item.url || "").includes(targetHint) && String(item.url || "").includes("src/renderer"));
  if (!target) throw new Error(`未找到目标页面：${targetHint} @ ${port}`);
  const socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let sequence = 0;
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const handler = event => {
      const message = JSON.parse(String(event.data));
      if (message.id !== id) return;
      socket.removeEventListener("message", handler);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result || {});
    };
    socket.addEventListener("message", handler);
    socket.send(JSON.stringify({ id, method, params }));
  });
  const evaluate = async expression => {
    const result = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime.evaluate failed");
    return result.result?.value;
  };
  return { evaluate, close: () => socket.close() };
}

function contrastProbe(targets) {
  const parse = value => {
    const rgb = String(value || "").match(/rgba?\(([^)]+)\)/i);
    if (rgb) {
      const parts = rgb[1].split(/[ ,/]+/).filter(Boolean).map(Number);
      return { r: parts[0], g: parts[1], b: parts[2], a: Number.isFinite(parts[3]) ? parts[3] : 1 };
    }
    const srgb = String(value || "").match(/color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)/i);
    if (srgb) return { r: Number(srgb[1]) * 255, g: Number(srgb[2]) * 255, b: Number(srgb[3]) * 255, a: srgb[4] ? Number(srgb[4]) : 1 };
    return null;
  };
  const composite = (front, back) => {
    const alpha = front.a + back.a * (1 - front.a);
    if (!alpha) return { r: 255, g: 255, b: 255, a: 1 };
    return {
      r: (front.r * front.a + back.r * back.a * (1 - front.a)) / alpha,
      g: (front.g * front.a + back.g * back.a * (1 - front.a)) / alpha,
      b: (front.b * front.a + back.b * back.a * (1 - front.a)) / alpha,
      a: alpha
    };
  };
  const background = element => {
    const layers = [];
    for (let node = element; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color && color.a > 0) layers.push(color);
    }
    layers.push({ r: 255, g: 255, b: 255, a: 1 });
    return layers.reduceRight((back, front) => composite(front, back));
  };
  const luminance = color => {
    const channel = value => {
      value /= 255;
      return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4;
    };
    return .2126 * channel(color.r) + .7152 * channel(color.g) + .0722 * channel(color.b);
  };
  const ratio = (a, b) => {
    const first = luminance(a), second = luminance(b);
    return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
  };
  return targets.map(target => {
    const element = document.querySelector(target.selector);
    if (!element) return { ...target, found: false };
    const foreground = parse(getComputedStyle(element).color);
    const backdrop = background(element);
    return {
      ...target,
      found: Boolean(foreground && backdrop),
      color: getComputedStyle(element).color,
      background: backdrop,
      contrast: foreground && backdrop ? Number(ratio(foreground, backdrop).toFixed(2)) : 0
    };
  });
}

(async () => {
  const cdp = await connect();
  const savedAppearance = await cdp.evaluate("localStorage.getItem('lingframe.appearance.v1')");
  const activePage = await cdp.evaluate("document.querySelector('.nav.active')?.dataset.page || 'home'");
  try {
    await cdp.evaluate("location.reload(); true");
    await new Promise(resolve => setTimeout(resolve, 450));
    await cdp.evaluate(`(()=>{
      document.getElementById('ui-contrast-audit-fixture')?.remove();
      const host=document.createElement('section');
      host.id='ui-contrast-audit-fixture';
      host.className='glass setting-card model-gateway-card';
      host.style.cssText='position:fixed;left:-12000px;top:0;width:1100px;z-index:-1;';
      host.innerHTML='<span class="contrast-audit-text" style="color:var(--appearance-text)">正文</span><span class="contrast-audit-soft" style="color:var(--appearance-text-soft)">次级文字</span><span class="contrast-audit-muted" style="color:var(--appearance-muted)">说明文字</span><span class="contrast-audit-accent" style="color:var(--appearance-accent)">强调文字</span><div class="model-gateway-layout"><aside class="model-provider-rail"><div class="model-provider-list"><button class="model-provider-item active"><span><b>选中厂商</b><small>协议与模型数量</small></span></button><button class="model-provider-item"><span><b>普通厂商</b><small>协议与模型数量</small></span></button></div></aside><main class="model-provider-editor"><label class="model-field">厂商名称<input value="GPT"></label><span class="model-secret-note">已加密保存</span><div class="model-message">配置修改后请测试连接</div><div class="model-row"><span><b>模型显示名称</b><small>model-real-id</small></span></div><div class="model-empty">空状态说明</div></main></div><div class="text-history"><button class="text-session"><span><b>文本会话标题</b><small>会话说明</small></span></button></div><div class="text-reference-row"><span>文本引用标签</span></div><div class="pm-dialog glass"><div class="pm-dialog-head"><div><b>弹窗标题</b><span>弹窗说明</span></div></div><label>弹窗表单标签<input></label><div class="generation-fields"><label>生成弹窗标签<select></select></label></div></div><span class="task-channel-badge">模型网关</span><span class="status-pill">运行中</span><div class="task-result-url"><div><b>任务结果标题</b><span>https://result.example</span><small>结果说明</small></div></div><div class="project-card"><div class="project-card-body"><p>项目说明</p><div class="project-meta">项目元信息</div></div></div><div class="asset-card"><div class="asset-info"><p>素材元信息</p><div class="asset-tags"><i>素材标签</i></div></div></div><div class="asset-reference-strip"><button>素材引用按钮</button></div><div class="material-drop"><span>素材拖拽说明</span></div>';
      host.insertAdjacentHTML("beforeend", '<span class="status-pill success">success</span><span class="status-pill danger">danger</span><span class="status-pill warning">warning</span><span class="status-pill muted">muted</span>');
      document.body.appendChild(host);
      return true;
    })()`);
    const audits = {};
    for (const theme of truth.themes) {
      audits[theme] = {};
      for (const contrast of truth.contrasts) {
        await cdp.evaluate(`window.lingframeAppearance.set(${JSON.stringify({ theme, fontSize: "standard" })})`);
        await cdp.evaluate(`window.lingframeAppearance.set({contrast:${JSON.stringify(contrast)}})`);
        audits[theme][contrast] = await cdp.evaluate(`(${contrastProbe.toString()})(${JSON.stringify(truth.targets)})`);
      }
    }
    const checks = truth.themes.flatMap(theme => truth.contrasts.flatMap(contrast => audits[theme][contrast].map(item => ({
      name: `${theme}/${contrast}/${item.name}`,
      ok: item.found && item.contrast >= truth.minimumNormalTextContrast,
      detail: item
    }))));
    const failed = checks.filter(item => !item.ok);
    const report = { test: "ui-text-contrast-runtime", timestamp: new Date().toISOString(), port, targetHint, groundTruth: truth, total: checks.length, passed: checks.length - failed.length, failed: failed.length, checks };
    const logDir = path.join(root, "scripts", "log");
    fs.mkdirSync(logDir, { recursive: true });
    fs.writeFileSync(path.join(logDir, "ui-text-contrast-runtime.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
    if (failed.length) process.exitCode = 1;
  } finally {
    await cdp.evaluate(`(()=>{document.getElementById('ui-contrast-audit-fixture')?.remove();const saved=${JSON.stringify(savedAppearance)};if(saved===null)localStorage.removeItem('lingframe.appearance.v1');else localStorage.setItem('lingframe.appearance.v1',saved);document.querySelector('[data-page=${JSON.stringify(activePage)}]')?.click();location.reload();return true})()`).catch(() => {});
    cdp.close();
  }
})().catch(error => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
