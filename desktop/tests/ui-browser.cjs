const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const root = path.resolve(__dirname, '..');
const truth = JSON.parse(fs.readFileSync(path.join(root, 'references/desktop-batch1-ground-truth.json'), 'utf8'));

(async () => {
  const browser = await chromium.launch({headless: true, executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const checks = [];
  const shots = path.join(root, 'scripts', 'log', 'screenshots');
  fs.mkdirSync(shots, {recursive: true});
  for (const vp of truth.viewports) {
    const page = await browser.newPage({viewport: vp});
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto('file:///' + path.join(root, 'src/renderer/index.html').replace(/\\/g, '/'));
    await page.waitForSelector('.shell');
    const labels = await page.$$eval('.nav', els => els.map(el => el.textContent.trim()));
    checks.push({name: `nav:${vp.width}`, ok: truth.requiredNavigation.every(item => labels.some(label => label.includes(item)))});
    for (const [key, title] of Object.entries(truth.requiredPages)) {
      await page.click(`[data-page="${key}"]`);
      checks.push({name: `route:${key}:${vp.width}`, ok: (await page.textContent('.page-head h1')).includes(title)});
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    checks.push({name: `overflow:${vp.width}x${vp.height}`, ok: !overflow});
    checks.push({name: `console:${vp.width}`, ok: errors.length === 0, details: errors});
    if (vp.width === 1920) {
      await page.click('[data-page="home"]');
      await page.screenshot({path: path.join(shots, 'desktop-home-1920x1080.png'), fullPage: true});
      await page.click('[data-toggle="left"]');
      checks.push({name: 'interaction:left-collapse', ok: await page.locator('.shell.left-off').count() === 1});
      await page.click('[data-toggle="left"]');
      await page.click('[data-toggle="right"]');
      checks.push({name: 'interaction:right-collapse', ok: await page.locator('.shell.right-off').count() === 1});
    }
    await page.close();
  }
  await browser.close();
  const failed = checks.filter(check => !check.ok);
  const result = {test: 'desktop-batch1-ui-browser', timestamp: new Date().toISOString(), total: checks.length, passed: checks.length - failed.length, failed: failed.map(check => check.name), checks};
  const logDir = path.join(root, 'scripts', 'log');
  fs.mkdirSync(logDir, {recursive: true});
  fs.writeFileSync(path.join(logDir, 'desktop-batch1-ui-browser.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  if (failed.length) process.exit(1);
})().catch(error => { console.error(error); process.exit(1); });
