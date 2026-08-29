(() => {
  const api = window.lingframe?.updates;
  if (!api) return;
  let status = null;
  let manualAction = false;
  let renderingSettingsCard = false;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const stateText = value => ({idle:'等待检查',ready:'自动检查已开启',checking:'正在检查更新',available:'发现可用更新',downloading:'正在后台下载',downloaded:'更新已下载',installing:'正在重启安装',blocked:'等待任务结束',error:'更新检查失败','up-to-date':'当前已是最新版','dev-disabled':'自动更新已启用',unconfigured:'更新服务器待配置'}[value] || '等待检查');
  function notesText(value) { if (Array.isArray(value)) return value.map(item => typeof item === 'string' ? item : item?.note).filter(Boolean).join('\n'); if (value && typeof value === 'object') return String(value.note || ''); return String(value || ''); }
  function closeOverlay() { document.querySelector('#lingframe-update-overlay')?.remove(); }
  function canOpenOverlay() { return !document.querySelector('#auth-gate,#license-notice-overlay,#license-gate,.pm-modal,#lingframe-update-overlay'); }
  function actionLabel() { if (status?.state === 'available') return '下载更新'; if (status?.state === 'downloading') return `下载中 ${Math.round(status.progress || 0)}%`; if (status?.state === 'downloaded') return '重启并安装'; if (status?.state === 'checking') return '检查中'; return '检查更新'; }
  async function primaryAction(button) {
    if (!status) return;
    button.disabled = true; manualAction = true;
    try {
      if (status.state === 'available') status = await api.download();
      else if (status.state === 'downloaded') status = await api.install();
      else status = await api.check();
      renderSettingsCard(); renderOverlay();
    } catch (error) { status = {...status,state:'error',error:String(error.message || error)}; renderOverlay(true); }
    finally { button.disabled = false; manualAction = false; }
  }
  function renderOverlay(force = false) {
    const visibleState = ['available','downloading','downloaded','blocked'].includes(status?.state) || (force && status?.state === 'error');
    if (!visibleState) { closeOverlay(); return; }
    if (!document.querySelector('#lingframe-update-overlay') && !canOpenOverlay()) return;
    let overlay = document.querySelector('#lingframe-update-overlay');
    if (!overlay) { overlay = document.createElement('div'); overlay.id = 'lingframe-update-overlay'; overlay.className = 'update-overlay'; document.body.appendChild(overlay); }
    const info = status.updateInfo || {}; const notes = notesText(info.releaseNotes);
    const blocked = status.state === 'blocked'; const downloaded = status.state === 'downloaded'; const downloading = status.state === 'downloading'; const error = status.state === 'error';
    const title = blocked ? '更新将在任务结束后安装' : downloaded ? '更新已准备完成' : downloading ? '正在下载更新' : error ? '更新暂时不可用' : '发现可用更新';
    const description = blocked ? (status.blockedReason || '当前存在未结束任务。') : downloaded ? '更新包已经下载并校验完成，重启后将自动安装。' : downloading ? '可以继续使用软件，下载完成前不要退出客户端。' : error ? (status.error || '请稍后重新检查。') : '本次更新包含稳定性改进和已确认的问题修复。';
    overlay.innerHTML = `<section class="update-dialog" role="dialog" aria-modal="true" aria-labelledby="update-dialog-title"><button class="update-close" data-update-close aria-label="稍后处理">×</button><div class="update-mark">↻</div><div class="update-kicker">灵帧AI 桌面更新</div><h2 id="update-dialog-title">${esc(title)}</h2><p>${esc(description)}</p>${notes && !blocked && !downloading ? `<pre>${esc(notes)}</pre>` : ''}<div class="update-progress ${downloading ? 'show' : ''}"><i style="width:${Math.max(0,Math.min(100,Number(status.progress)||0))}%"></i></div><div class="update-safe">更新只替换程序文件，不会清除密钥、豆包登录环境、项目、任务和素材。安装前会备份核心 JSON 数据。</div><div class="update-actions"><button class="ghost" data-update-close>${downloaded ? '稍后重启' : '稍后处理'}</button><button class="primary" data-update-primary ${downloading ? 'disabled' : ''}>${esc(blocked ? '我知道了' : actionLabel())}</button></div></section>`;
    overlay.querySelectorAll('[data-update-close]').forEach(button => button.onclick = closeOverlay);
    overlay.querySelector('[data-update-primary]').onclick = event => blocked ? closeOverlay() : primaryAction(event.currentTarget);
  }
  function renderSettingsCard() {
    if (renderingSettingsCard) return;
    if (!document.querySelector('[data-page="settings"].active')) return;
    const grid = document.querySelector('.settings-grid'); if (!grid) return;
    renderingSettingsCard = true;
    try {
      let card = grid.querySelector('#auto-update-settings-card');
      if (!card) { card = document.createElement('section'); card.id = 'auto-update-settings-card'; card.className = 'glass setting-card update-settings-card'; grid.appendChild(card); }
      const info = status?.updateInfo || {};
    card.innerHTML = `<h3>软件更新</h3><p>更新状态：<b>${esc(stateText(status?.state))}</b></p><p class="setting-note">发布新版本后，客户端会自动检查并提示下载。执行中的生成和回传任务不会被强制中断。</p>${status?.error ? `<p class="update-error">${esc(status.error)}</p>` : ''}<button class="primary" data-update-settings-action ${['checking','downloading','installing'].includes(status?.state) ? 'disabled' : ''}>${esc(actionLabel())}</button>`;
      card.querySelector('[data-update-settings-action]').onclick = event => primaryAction(event.currentTarget);
    } finally {
      renderingSettingsCard = false;
    }
  }
  function accept(next) { status = next || status; renderSettingsCard(); if (['available','downloading','downloaded','blocked'].includes(status?.state)) renderOverlay(); else if (status?.state === 'error' && manualAction) renderOverlay(true); }
  api.onStatus(accept);
  api.status().then(accept).catch(() => {});
  document.addEventListener('click', event => { if (event.target.closest('[data-page="settings"]')) setTimeout(renderSettingsCard, 60); });
  // 页面切换时设置面板是异步渲染的；仅在卡片尚未创建时补一次，避免
  // renderSettingsCard 写入 innerHTML 触发 MutationObserver 自循环卡死渲染进程。
  new MutationObserver(() => {
    if (!renderingSettingsCard && document.querySelector('[data-page="settings"].active') && !document.querySelector('#auto-update-settings-card')) renderSettingsCard();
  }).observe(document.body, {childList:true,subtree:true});
  setInterval(() => { if (['available','downloaded'].includes(status?.state)) renderOverlay(); }, 2000);
})();
