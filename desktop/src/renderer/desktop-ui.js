(() => {
  const api = window.lingframe;
  if (!api) return;
  let snapshot = {agent: null, identity: null, connection: null};
  let deferredLicenseState = null;
  let adminSessionId = '';
  const accountLoginStates = new Map();
  let detectedAccountList = null;
  let detectedAccountIds = '';
  let detectionRun = null;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));

  function ensureStyles() {
    if (document.querySelector('#desktop-ui-style')) return;
    const style = document.createElement('style');
    style.id = 'desktop-ui-style';
    style.textContent = `.license-gate{position:fixed;inset:0;z-index:1500;display:grid;place-items:center;background:rgba(3,8,18,.92);backdrop-filter:blur(15px)}.activation{width:440px;padding:34px;border-radius:22px;text-align:center}.activation img{width:62px;height:62px;border-radius:16px}.activation h1{font-size:23px;margin:16px 0 8px}.activation p{color:#8ea6c8;font-size:12px;line-height:1.8}.activation input,.agent-token{width:100%;height:42px;margin:15px 0 9px;padding:0 13px;border-radius:10px;background:#0a1629;border:1px solid rgba(117,154,222,.2);color:#eef5ff}.activation #license-error{min-height:20px;color:#ffad78;font-size:11px;margin-bottom:10px}.activation .primary{width:100%}.activation-back{width:100%;margin-top:9px}.license-notice-overlay{position:fixed;inset:0;z-index:1550;display:grid;place-items:center;padding:20px;background:rgba(3,8,18,.58);backdrop-filter:blur(7px)}.license-notice{width:min(520px,calc(100vw - 40px));padding:28px;border-radius:20px;border:1px solid rgba(255,178,82,.24);background:linear-gradient(155deg,rgba(17,29,49,.98),rgba(8,17,32,.98));box-shadow:0 28px 80px rgba(0,0,0,.42)}.license-notice-mark{width:46px;height:46px;display:grid;place-items:center;border-radius:14px;background:rgba(255,174,74,.12);border:1px solid rgba(255,174,74,.22);color:#ffbd70;font-size:22px}.license-notice-kicker{margin:16px 0 6px;color:#ffbd70;font-size:10px;letter-spacing:.12em}.license-notice h2{margin:0;color:#f2f6ff;font-size:21px}.license-notice p{margin:11px 0 0;color:#9cafca;font-size:13px;line-height:1.75}.license-notice-detail{margin-top:16px;padding:12px 14px;border-radius:11px;background:rgba(6,14,27,.72);color:#8298b7;font-size:11px;line-height:1.7}.license-notice-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:22px}.license-notice-actions button{height:38px;padding:0 16px}.desktop-settings{position:fixed;right:24px;bottom:52px;z-index:10;display:flex;gap:8px;align-items:center;max-width:370px;min-width:0;padding:8px 11px;border-radius:10px;background:rgba(9,19,37,.88);border:1px solid rgba(117,154,222,.18);color:#8ea6c8;font-size:10px}.desktop-settings span{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.desktop-settings button{flex:0 0 auto;height:28px;padding:0 9px;border-radius:7px;border:1px solid rgba(117,154,222,.2);background:#12213a;color:#c5d6ef}.desktop-settings button.primary{background:linear-gradient(110deg,#29bddc,#765cf0);border:0;color:#fff}.settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.setting-card{border-radius:16px;padding:22px;min-height:320px}.setting-card h3{margin:0 0 22px;font-size:16px}.setting-card p{color:#8ea6c8;font-size:11px;line-height:1.8}.setting-card p b{color:#eef5ff}.setting-card button{margin:12px 8px 0 0}.setting-note{padding:10px;border-radius:9px;background:rgba(9,18,34,.64)}.doubao-manager-layout{display:grid;grid-template-columns:248px minmax(0,1fr);gap:14px;height:calc(100vh - 265px);min-height:560px}.doubao-account-rail{border-radius:15px;padding:14px;display:flex;flex-direction:column;min-height:560px}.doubao-rail-head{display:flex;align-items:center;justify-content:space-between}.doubao-rail-head b{display:block;font-size:13px}.doubao-rail-head small{display:block;color:#7189aa;font-size:8px;margin-top:4px}.icon-button{width:30px;height:30px;border:1px solid rgba(117,154,222,.2);background:rgba(18,31,53,.72);border-radius:8px;color:#5edcff;font-size:18px}.doubao-rail-actions{display:flex;gap:6px;margin:14px 0 9px}.doubao-rail-actions .ghost{height:29px;padding:0 8px;font-size:8px}.doubao-search{height:32px;border:1px solid rgba(117,154,222,.15);background:#0a1629;border-radius:8px;color:#dce8fa;padding:0 9px;font-size:9px;margin-bottom:10px}.doubao-account-list{display:flex;flex-direction:column;gap:7px;overflow:auto}.account-compact{position:relative;display:grid;grid-template-columns:36px 1fr 9px;align-items:center;gap:9px;min-height:70px;padding:9px;border-radius:11px;border:1px solid transparent;background:rgba(9,18,34,.55)}.account-compact.active{border-color:rgba(53,215,255,.35);background:linear-gradient(90deg,rgba(53,215,255,.12),rgba(91,73,184,.1))}.account-compact .face{width:34px;height:34px;border-radius:9px;margin:0;font-size:14px}.account-copy b{font-size:10px;display:block}.account-copy small{font-size:8px;display:block;color:#6b83a5;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.account-dot{width:8px;height:8px;border-radius:50%;display:block}.account-dot.online{background:#48e0ba;box-shadow:0 0 9px rgba(72,224,186,.7)}.account-dot.warning{background:#ffae55;box-shadow:0 0 9px rgba(255,174,85,.65)}.account-dot.offline{background:#ff7474;box-shadow:0 0 8px rgba(255,116,116,.45)}.account-dot.unknown{background:#647b9c;box-shadow:none}.account-actions{grid-column:1/4;display:flex;gap:5px}.account-actions .ghost{height:25px;padding:0 8px;font-size:8px}.account-add{display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:110px;border:1px dashed rgba(117,154,222,.28);border-radius:11px;background:rgba(9,18,34,.3);color:#8ea6c8}.account-add strong{color:#40d9ff;font-size:23px;font-weight:300}.account-add span{font-size:10px;margin-top:5px}.account-add small{font-size:8px;color:#5f789a;margin-top:6px}.doubao-rail-footer{margin-top:auto;border-top:1px solid rgba(117,154,222,.12);padding-top:12px;color:#60799b;font-size:8px;display:flex;flex-direction:column;gap:5px}.embedded-browser-panel{height:100%;min-height:560px;border-radius:15px;overflow:hidden;display:flex;flex-direction:column}.embedded-browser-head{height:53px;flex:0 0 53px;display:flex;align-items:center;gap:12px;padding:0 14px;border-bottom:1px solid rgba(117,154,222,.14);font-size:11px}.embedded-title{display:flex;align-items:center;gap:10px;min-width:0;flex:1}.embedded-title b{font-size:12px}.embedded-title span{color:#7189aa;font-size:9px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.embedded-actions{display:flex;gap:6px}.embedded-browser-head .ghost{height:30px;font-size:8px;padding:0 9px}.embedded-browser-message{display:none;padding:9px 13px;background:rgba(255,174,85,.1);border-bottom:1px solid rgba(255,174,85,.16);color:#ffbe73;font-size:9px}.embedded-browser-message.show{display:flex;align-items:center;justify-content:space-between}.embedded-browser-panel #embedded-browser-host{position:relative;flex:1;min-height:0;background:#080e1c}.embedded-empty{height:100%;display:grid;place-items:center;align-content:center;gap:9px;color:#6e87a8;text-align:center}.embedded-empty span{font-size:32px;color:#42dcff}.embedded-empty b{color:#c8d9ef;font-size:13px}.embedded-empty small{max-width:300px;font-size:9px;line-height:1.7}.doubao-embedded-active .embedded-browser-panel{border-color:rgba(53,215,255,.34);box-shadow:0 0 0 1px rgba(53,215,255,.08),0 18px 52px rgba(0,0,0,.22)}@media(max-width:1100px){.desktop-settings{right:12px;max-width:300px}.settings-grid{grid-template-columns:1fr}.doubao-manager-layout{grid-template-columns:220px minmax(0,1fr);gap:10px}.embedded-actions .ghost{padding:0 6px}.doubao-rail-actions{flex-wrap:wrap}.license-notice-actions{flex-direction:column-reverse}.license-notice-actions button{width:100%}}`;
    document.head.appendChild(style);
  }

  function ensureServerAdminStyles() {
    if (document.querySelector('#server-admin-style')) return;
    const style = document.createElement('style');
    style.id = 'server-admin-style';
    style.textContent = `.server-admin-overlay{position:fixed;inset:0;z-index:1800;display:grid;place-items:center;padding:24px;background:rgba(2,6,14,.86);backdrop-filter:blur(16px)}.server-admin-dialog{width:min(620px,100%);max-height:88vh;overflow:auto;padding:24px;border-radius:18px;background:#0b1527;border:1px solid rgba(91,211,255,.25);box-shadow:0 28px 90px rgba(0,0,0,.55)}.server-admin-head{display:flex;justify-content:space-between;align-items:flex-start;gap:14px}.server-admin-head h3{margin:0 0 5px}.server-admin-head p{margin:0;color:#7891b4;font-size:10px}.server-admin-dialog label{display:grid;gap:6px;margin-top:14px;color:#a9bcda;font-size:11px}.server-admin-dialog input,.server-admin-dialog textarea,.server-admin-dialog select{width:100%;border:1px solid rgba(117,154,222,.24);background:#071222;color:#eaf3ff;border-radius:9px;padding:10px}.server-admin-dialog textarea{min-height:105px;resize:vertical}.server-admin-error{min-height:22px;margin-top:10px;color:#ffae7a;font-size:10px}.server-admin-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:16px}`;
    document.head.appendChild(style);
  }

  function ensureDoubaoDensityStyles() {
    if (document.querySelector('#doubao-density-style')) return;
    const style = document.createElement('style');
    style.id = 'doubao-density-style';
    style.textContent = `
      body.doubao-page-active .workspace{padding:14px 18px 10px}
      body.doubao-page-active .page-head{margin-bottom:10px;align-items:center}
      body.doubao-page-active .page-head h1{font-size:22px}
      body.doubao-page-active .page-head p{margin-top:4px;font-size:10px}
      body.doubao-page-active .doubao-metrics{gap:9px;margin-bottom:10px}
      body.doubao-page-active .doubao-metrics .metric{height:62px;padding:9px 12px;display:grid;grid-template-columns:1fr auto;align-items:center}
      body.doubao-page-active .doubao-metrics .metric small{font-size:8px}
      body.doubao-page-active .doubao-metrics .metric b{font-size:21px;margin:0;grid-row:1/3;grid-column:2}
      body.doubao-page-active .doubao-metrics .metric em{grid-column:1;margin:2px 0 0;font-size:8px}
      body.doubao-page-active .doubao-manager-layout{grid-template-columns:218px minmax(0,1fr);gap:10px;height:calc(100vh - 242px);min-height:500px}
      body.doubao-page-active .doubao-account-rail{padding:10px;min-height:0}
      body.doubao-page-active .doubao-rail-actions{margin:9px 0 7px}
      body.doubao-page-active .doubao-search{height:29px;margin-bottom:7px}
      body.doubao-page-active .doubao-account-list{gap:5px}
      body.doubao-page-active .account-compact{height:82px!important;min-height:82px;padding:7px;gap:7px;grid-template-columns:32px 1fr 8px}
      body.doubao-page-active .account-compact .face{width:31px;height:31px;border-radius:8px;font-size:12px}
      body.doubao-page-active .account-copy b{font-size:9px}
      body.doubao-page-active .account-copy small{font-size:7px;margin-top:2px}
      body.doubao-page-active .account-actions{gap:4px}
      body.doubao-page-active .account-actions .ghost{height:22px;padding:0 7px;font-size:7px}
      body.doubao-page-active .account-add{min-height:72px}
      body.doubao-page-active .doubao-rail-footer{padding-top:7px;font-size:7px;gap:3px}
      body.doubao-page-active .embedded-browser-panel{min-height:0}
      body.doubao-page-active .embedded-browser-head{height:46px;flex-basis:46px;padding:0 11px}
      body.doubao-page-active .embedded-browser-head .ghost{height:27px;padding:0 7px}
      #embedded-browser-focus.active{color:#fff;border-color:rgba(53,215,255,.45);background:linear-gradient(110deg,rgba(41,189,220,.7),rgba(118,92,240,.7))}
      body.doubao-focus-mode .shell{grid-template-columns:minmax(210px,238px) minmax(0,1fr) 0}
      body.doubao-focus-mode .right{display:none}
      body.doubao-focus-mode .workspace{padding:9px 12px}
      body.doubao-focus-mode .page-head,body.doubao-focus-mode .doubao-metrics{display:none}
      body.doubao-focus-mode .doubao-manager-layout{grid-template-columns:190px minmax(0,1fr);height:calc(100vh - 128px);min-height:0}
      body.doubao-focus-mode .doubao-account-rail{border-radius:12px}
      @media(max-width:1250px){body.doubao-page-active .doubao-manager-layout{grid-template-columns:200px minmax(0,1fr)}body.doubao-page-active .doubao-metrics .metric{height:56px}}
    `;
     document.head.appendChild(style);
  }

  function ensureAccountGroupStyles() {
    if (document.querySelector('#doubao-group-style')) return;
    const style = document.createElement('style');
    style.id = 'doubao-group-style';
    style.textContent = `.doubao-group-toolbar{display:flex;gap:6px;align-items:center;margin:0 0 7px}.doubao-group-toolbar select{flex:1;min-width:0;height:29px;padding:0 7px;border-radius:8px;border:1px solid rgba(117,154,222,.15);background:#0a1629;color:#cbdcf0;font-size:8px}.doubao-group-toolbar button{height:29px;padding:0 8px;font-size:8px}.doubao-group-manage{position:fixed;inset:0;z-index:1100;display:grid;place-items:center;background:rgba(3,10,22,.48);backdrop-filter:blur(4px)}.doubao-group-dialog{width:min(760px,calc(100vw - 40px));max-height:min(760px,calc(100vh - 60px));overflow:auto;padding:22px;border-radius:18px}.doubao-group-dialog h2{margin:0;font-size:17px}.doubao-group-dialog p{color:#8298b6;font-size:10px;line-height:1.7}.doubao-group-create{display:flex;gap:8px;margin:14px 0}.doubao-group-create input{flex:1;height:36px;border-radius:8px;border:1px solid rgba(92,214,255,.2);background:#09162a;color:#eef5ff;padding:0 10px}.doubao-group-card{padding:13px;border-radius:12px;background:rgba(8,17,32,.58);border:1px solid rgba(117,154,222,.12);margin:8px 0}.doubao-group-card-head{display:flex;gap:7px;align-items:center}.doubao-group-card-head input{flex:1;height:31px;border-radius:7px;border:1px solid rgba(117,154,222,.15);background:#0a1629;color:#eaf3ff;padding:0 8px}.doubao-group-members{display:flex;flex-wrap:wrap;gap:7px;margin-top:10px}.doubao-group-members label{display:flex;align-items:center;gap:5px;padding:7px 8px;border-radius:7px;background:rgba(20,35,58,.72);color:#a8bbd8;font-size:9px}.doubao-group-actions{display:flex;justify-content:flex-end;gap:8px;margin-top:14px}`;
    document.head.appendChild(style);
  }

  function ensureLocalAccountImportStyles() {
    if (document.querySelector('#doubao-local-import-style')) return;
    const style = document.createElement('style');
    style.id = 'doubao-local-import-style';
    style.textContent = `.doubao-local-import-kicker{color:#55dcff;font-size:10px;letter-spacing:.14em}.doubao-local-import-dialog h2{margin:8px 0 9px;color:#f1f6ff;font-size:22px}.doubao-local-import-dialog>p{margin:0;color:#91a7c5;font-size:12px;line-height:1.75}.doubao-local-import-safe-note{margin:15px 0;padding:11px 13px;border-radius:10px;background:rgba(47,211,179,.07);border:1px solid rgba(47,211,179,.14);color:#7fcdbd;font-size:10px;line-height:1.6}.doubao-local-import-list{display:grid;gap:8px;max-height:330px;overflow:auto;padding-right:3px}.doubao-local-import-item{display:grid;grid-template-columns:20px 40px minmax(0,1fr) 22px;align-items:center;gap:10px;min-height:66px;padding:10px 12px;border:1px solid rgba(117,154,222,.15);border-radius:12px;background:rgba(8,18,35,.68);cursor:pointer}.doubao-local-import-item:has(input:checked){border-color:rgba(83,213,255,.32);background:rgba(42,143,184,.1)}.doubao-local-import-item input{width:16px;height:16px;accent-color:#42cfee}.doubao-local-import-avatar{width:38px;height:38px;display:grid;place-items:center;border-radius:11px;background:linear-gradient(145deg,#1d879f,#6049aa);color:#fff;font-size:15px}.doubao-local-import-copy{min-width:0}.doubao-local-import-copy b,.doubao-local-import-copy small{display:block}.doubao-local-import-copy b{color:#eaf3ff;font-size:12px}.doubao-local-import-copy small{margin-top:4px;color:#6ed9b9;font-size:9px}.doubao-local-import-check{color:#4fdabc;font-size:14px}.doubao-local-import-error{min-height:24px;padding-top:8px;color:#ffb77c;font-size:10px}.doubao-local-import-actions{display:flex;justify-content:flex-end;gap:9px;margin-top:10px}.doubao-local-import-actions button{height:38px;padding:0 17px}@media(max-width:620px){.doubao-local-import-dialog{padding:20px!important}.doubao-local-import-actions{flex-direction:column-reverse}.doubao-local-import-actions button{width:100%}}`;
    document.head.appendChild(style);
  }

  function showLicenseNotice(status, identity = snapshot.identity) {
    const state = String(status?.state || 'verification_required');
    let overlay = document.querySelector('#license-notice-overlay');
    if (overlay?.dataset.licenseState === state) return;
    overlay?.remove();
    document.querySelector('#license-gate')?.remove();
    overlay = document.createElement('div');
    overlay.id = 'license-notice-overlay';
    overlay.className = 'license-notice-overlay';
    overlay.dataset.licenseState = state;
    const expired = state === 'expired';
    const title = expired ? '设备密钥已到期' : state === 'revoked' ? '设备密钥已失效' : '设备授权需要重新验证';
    const message = expired ? '当前授权使用期已经结束，客户端已停止新的生成和自动操作。' : state === 'revoked' ? '当前设备密钥已被停用，客户端已停止新的生成、重试和豆包自动操作。' : '授权中心无法继续确认当前凭证，需要使用有效密钥重新激活。';
    overlay.innerHTML = `<section class="license-notice" role="alertdialog" aria-modal="true" aria-labelledby="license-notice-title"><div class="license-notice-mark">!</div><div class="license-notice-kicker">授权状态发生变化</div><h2 id="license-notice-title">${title}</h2><p>${message}</p><div class="license-notice-detail">已有项目、历史任务和素材不会删除；已经提交的任务仍可继续回收结果。你可以先进入只读模式查看历史内容，稍后再重新激活。</div><div class="license-notice-actions"><button class="ghost" data-license-notice-action="later">稍后处理（只读）</button><button class="primary" data-license-notice-action="activate">输入新密钥</button></div></section>`;
    document.body.appendChild(overlay);
    overlay.querySelector('[data-license-notice-action="later"]').onclick = () => { deferredLicenseState = state; overlay.remove(); refreshBar(); };
    overlay.querySelector('[data-license-notice-action="activate"]').onclick = () => { deferredLicenseState = null; overlay.remove(); gate(status, identity, {force:true}); };
  }

  function gate(status, identity = snapshot.identity, options = {}) {
    if (status?.usable || identity?.usable) { deferredLicenseState = null; document.querySelector('#license-notice-overlay')?.remove(); document.querySelector('#license-gate')?.remove(); return; }
    const state = String(status?.state || 'needs_activation');
    const restricted = ['revoked','expired','verification_required'].includes(state);
    const existingGate = document.querySelector('#license-gate');
    if (restricted && !options.force) {
      if (existingGate?.dataset.licenseState === state) return;
      if (deferredLicenseState === state) { document.querySelector('#license-notice-overlay')?.remove(); existingGate?.remove(); return; }
      showLicenseNotice(status, identity);
      return;
    }
    document.querySelector('#license-notice-overlay')?.remove();
    let node = document.querySelector('#license-gate');
    if (!node) { node = document.createElement('div'); node.id = 'license-gate'; document.body.appendChild(node); }
    node.className = 'license-gate';
    node.dataset.licenseState = state;
    const connected = snapshot.connection?.connected === true;
    const expired = status?.state === 'expired';
    const revoked = status?.state === 'revoked';
    const verificationRequired = status?.state === 'verification_required';
    const title = revoked ? '授权已失效' : expired ? '授权已到期' : verificationRequired ? '授权需要重新验证' : '激活灵帧AI桌面版';
    const message = revoked ? '当前密钥已被停用，已停止新建、提交、重试和豆包自动操作；历史结果仍可安全回收。' : expired ? '已停止新建、提交、重试和豆包自动操作；已提交任务仍可在后台安全回收结果。' : verificationRequired ? '授权中心已拒绝当前凭证，请输入有效密钥重新激活；历史结果仍可安全回收。' : '请输入平台提供的设备密钥';
    const action = revoked ? '输入新密钥重新激活' : expired ? '续费后重新激活' : verificationRequired ? '重新激活' : '激活并进入工作台';
    node.innerHTML = `<div class="activation glass"><img src="../../assets/lingframe-mark.png"><h1>${title}</h1><p>${message}</p><div class="setting-note" id="activation-service-state" style="margin:14px 0;text-align:center;color:${connected ? '#63e1bd' : '#ffb16f'}">● ${connected ? '服务连接正常' : '服务连接异常'}</div><input id="license-key" type="password" autocomplete="off" placeholder="请输入新的设备密钥"><div id="license-error">${esc(status?.reason || '')}</div><button class="primary" id="activate-license">${action}</button>${restricted ? '<button class="ghost activation-back" id="license-readonly-back">返回只读模式</button>' : ''}</div>`;
    node.querySelector('#activate-license').onclick = async () => {
      const button = node.querySelector('#activate-license'); const error = node.querySelector('#license-error');
      button.disabled = true; error.textContent = '正在连接授权中心…';
      try { snapshot.license = await api.license.activate(node.querySelector('#license-key').value); snapshot.identity = await api.identity.status(); gate(snapshot.license, snapshot.identity); refreshBar(); await offerLocalAccountImport(snapshot.license); location.reload(); }
      catch (e) { error.textContent = String(e.message || e); button.disabled = false; }
    };
    node.querySelector('#license-readonly-back')?.addEventListener('click', () => { deferredLicenseState = state; node.remove(); refreshBar(); });
  }

  function refreshBar() {
    const host = document.querySelector('.statusbar'); if (!host) return;
    let bar = document.querySelector('.desktop-settings');
    if (!bar) { bar = document.createElement('div'); bar.className = 'desktop-settings'; document.body.appendChild(bar); }
    bar.hidden = true;
    bar.style.setProperty('display', 'none', 'important');
    const l = snapshot.license || {}; const i = snapshot.identity || {}; const a = snapshot.agent || {}; const c = snapshot.connection || {};
    const canActivate = !l.usable && ['revoked','expired','verification_required'].includes(String(l.state || ''));
    bar.innerHTML = `<span>${c.connected ? '服务连接正常' : '服务连接异常'} · ${i.usable && i.source === 'verified-agent' ? '身份已验证' : (l.usable ? '授权已激活' : '授权未激活')} · Agent ${a.online ? '在线' : '离线'}</span>${canActivate ? '<button class="primary" id="desktop-activate">重新激活</button>' : ''}<button id="desktop-refresh">复核</button><button id="desktop-diagnostics">诊断</button>`;
    bar.querySelector('#desktop-activate')?.addEventListener('click', () => { deferredLicenseState = null; gate(snapshot.license, snapshot.identity, {force:true}); });
    bar.querySelector('#desktop-refresh').onclick = async () => { try { snapshot.connection = await api.connection.refresh(); } catch { snapshot.connection = await api.connection.status(); } try { snapshot.license = await api.license.refresh(); } catch { snapshot.license = await api.license.status(); } snapshot.identity = await api.identity.status(); snapshot.agent = await api.agent.status(); gate(snapshot.license, snapshot.identity); refreshBar(); };
    bar.querySelector('#desktop-diagnostics').onclick = async () => { const d = await api.app.diagnostics(); alert(JSON.stringify(d, null, 2)); };
  }

  async function offerLocalAccountImport(activationStatus) {
    if (!activationStatus?.accountImportSuggested && !activationStatus?.tenantChanged || !api.doubaoAccounts?.discoverLocal) return {shown:false, imported:0};
    let candidates = [];
    try { candidates = await api.doubaoAccounts.discoverLocal(); } catch { return {shown:false, imported:0}; }
    if (!Array.isArray(candidates) || !candidates.length) return {shown:false, imported:0};
    const overlay = document.createElement('div');
    overlay.className = 'doubao-local-import-overlay';
    overlay.innerHTML = `<section class="doubao-local-import-dialog" role="dialog" aria-modal="true" aria-labelledby="doubao-local-import-title"><div class="doubao-local-import-kicker">本机账号迁移</div><h2 id="doubao-local-import-title">发现本机已登录的豆包账号</h2><p>更换密钥后，当前授权工作区是空的。检测到本机已有豆包登录环境，你可以选择加载到当前工作区。</p><div class="doubao-local-import-safe-note">只复制豆包登录状态，不会删除原工作区，也不会读取系统 Chrome 的账号。</div><div class="doubao-local-import-list">${candidates.map(item=>`<label class="doubao-local-import-item"><input type="checkbox" data-local-import-ref="${esc(item.ref)}" checked><span class="doubao-local-import-avatar">${esc(String(item.name || '豆').slice(0,1))}</span><span class="doubao-local-import-copy"><b>${esc(item.name || item.accountId)}</b><small>豆包 · 已登录</small></span><span class="doubao-local-import-check">✓</span></label>`).join('')}</div><div class="doubao-local-import-error" data-local-import-error></div><div class="doubao-local-import-actions"><button class="ghost" data-local-import-later>暂不加载</button><button class="primary" data-local-import-confirm>加载选中账号</button></div></section>`;
    Object.assign(overlay.style, {position:'fixed', inset:'0', zIndex:'1600', display:'grid', placeItems:'center', padding:'20px', background:'rgba(3,8,18,.68)', backdropFilter:'blur(8px)'});
    const dialog = overlay.querySelector('.doubao-local-import-dialog');
    Object.assign(dialog.style, {width:'min(560px,calc(100vw - 40px))', maxHeight:'min(720px,calc(100vh - 40px))', overflow:'auto', padding:'28px', borderRadius:'22px', background:'linear-gradient(155deg,rgba(17,29,49,.99),rgba(8,17,32,.99))', border:'1px solid rgba(83,213,255,.2)', boxShadow:'0 28px 90px rgba(0,0,0,.52)'});
    document.body.appendChild(overlay);
    let settled = false;
    const finish = callback => { if (settled) return; settled = true; overlay.remove(); callback?.(); };
    return new Promise(resolve => {
      overlay.querySelector('[data-local-import-later]').onclick = () => finish(() => resolve({shown:true, imported:0, skipped:true}));
      overlay.addEventListener('click', event => { if (event.target === overlay) finish(() => resolve({shown:true, imported:0, skipped:true})); });
      overlay.querySelector('[data-local-import-confirm]').onclick = async () => {
        const refs = [...overlay.querySelectorAll('[data-local-import-ref]:checked')].map(input => input.dataset.localImportRef).filter(Boolean);
        if (!refs.length) { overlay.querySelector('[data-local-import-error]').textContent = '请至少选择一个账号，或点击“暂不加载”。'; return; }
        const button = overlay.querySelector('[data-local-import-confirm]'); const error = overlay.querySelector('[data-local-import-error]');
        button.disabled = true; overlay.querySelector('[data-local-import-later]').disabled = true; error.textContent = '正在复制登录状态，请稍候…';
        let imported = 0; const failures = [];
        for (const ref of refs) {
          try { const result = await api.doubaoAccounts.importLocal(ref); if (result?.status === 'imported') imported += 1; } catch (cause) { failures.push(String(cause?.message || cause)); }
        }
        error.textContent = failures.length ? `${imported} 个账号已加载，${failures.length} 个失败；失败账号未写入当前工作区。` : imported ? `已加载 ${imported} 个账号。` : '所选账号已存在，未重复导入。';
        setTimeout(() => finish(() => resolve({shown:true, imported, failures})), failures.length ? 900 : 500);
      };
    });
  }

  function renderSettingsPanel() {
    if (!document.querySelector('[data-page="settings"].active')) return;
    const workspace = document.querySelector('.workspace');
    if (!workspace || workspace.dataset.desktopSettings === '1') return;
    workspace.dataset.desktopSettings = '1';
    const i = snapshot.identity || {}; const a = snapshot.agent || {}; const c = snapshot.connection || {};
    workspace.innerHTML = `<div class="page-head"><div><h1>系统设置</h1><p>账号、创作空间和服务连接状态。</p></div></div><div class="settings-grid"><section class="glass setting-card"><h3>当前账号</h3><p>登录状态：<b>${i.authenticated ? '已登录' : '未登录'}</b></p><p>用户名：${esc(i.user?.username || '--')}</p><p>邮箱：${esc(i.user?.email || '--')}</p><p>创作空间：${esc(i.tenant?.displayName || i.tenant?.code || '--')}</p><p>角色：${esc(i.role || '--')}</p><button class="ghost" id="refresh-session">刷新登录状态</button><button class="ghost" id="logout-account">退出登录</button></section><section class="glass setting-card"><h3>服务与任务通道</h3><p>平台服务：<b>${c.connected ? '连接正常' : '连接异常'}</b></p><p>桌面任务通道：<b>${a.online ? '在线' : (i.usable ? '本地自动操作可用' : '等待登录')}</b></p><p>设备：${esc(a.deviceName || '--')}</p><p class="setting-note">项目、任务、素材和豆包账号按当前用户与创作空间隔离。切换账号后不会混用其他用户的数据。</p><button class="ghost" id="refresh-service">重新检测服务</button></section></div>`;
    document.querySelector('#refresh-session').onclick = async () => { try { snapshot.identity = await api.auth.refresh(); workspace.dataset.desktopSettings = ''; renderSettingsPanel(); } catch (error) { window.lingframeToast?.(String(error.message || error),'error'); } };
    document.querySelector('#logout-account').onclick = async () => { if (!confirm('确定退出当前灵帧AI账号吗？本机项目文件不会被删除。')) return; await api.auth.logout(); location.reload(); };
    document.querySelector('#refresh-service').onclick = async () => { try { snapshot.connection = await api.connection.refresh(); } catch { snapshot.connection = await api.connection.status(); } snapshot.agent = await api.agent.status(); workspace.dataset.desktopSettings = ''; renderSettingsPanel(); refreshBar(); };
  }

  function closeServerAdmin() { document.querySelector('#server-admin-overlay')?.remove(); }
  async function renderServerAdminPanel() {
    const host = document.querySelector('#server-admin-body');
    const status = await api.connection.adminStatus(adminSessionId);
    const lines = (status.baseUrls || []).join('\n');
    host.innerHTML = `<label>运行模式<select id="server-admin-mode"><option value="auto">自动获取远程配置</option><option value="custom">管理员临时线路</option></select></label><label>统一服务域名（每行一个，第一行为主域名）<textarea id="server-admin-urls" placeholder="https://api.example.com">${esc(lines)}</textarea></label><div class="setting-note" style="margin-top:14px">当前共 ${Number(status.endpointCount || 0)} 条线路。切换前会验证新服务器返回的签名配置，失败时不会覆盖现有可用线路。</div><div id="server-admin-error" class="server-admin-error"></div><div class="server-admin-actions"><button class="ghost" id="server-admin-cancel">关闭</button><button class="primary" id="server-admin-save">验证并应用</button></div>`;
    host.querySelector('#server-admin-mode').value = status.overrideMode || 'auto';
    host.querySelector('#server-admin-cancel').onclick = closeServerAdmin;
    host.querySelector('#server-admin-save').onclick = async () => {
      const button = host.querySelector('#server-admin-save'); const error = host.querySelector('#server-admin-error');
      button.disabled = true; error.textContent = '正在验证并切换线路…';
      try {
        const mode = host.querySelector('#server-admin-mode').value;
        const baseUrls = host.querySelector('#server-admin-urls').value.split(/\r?\n/).map(value => value.trim()).filter(Boolean);
        await api.connection.applyAdmin(adminSessionId, {mode, baseUrls});
        snapshot.connection = await api.connection.status();
        error.textContent = '已应用新的连接配置。'; refreshBar();
        setTimeout(closeServerAdmin, 700);
      } catch (e) { error.textContent = String(e.message || e); button.disabled = false; }
    };
  }
  function openServerAdmin() {
    closeServerAdmin();
    const node = document.createElement('div'); node.id = 'server-admin-overlay'; node.className = 'server-admin-overlay';
    node.innerHTML = `<section class="server-admin-dialog"><div class="server-admin-head"><div><h3>管理员服务器设置</h3><p>仅用于测试、迁移和故障恢复；普通租户不会看到此入口。</p></div><button class="ghost" id="server-admin-close">×</button></div><div id="server-admin-body"><label>管理账号<input id="server-admin-user" value="admin" autocomplete="username"></label><label>管理密码<input id="server-admin-password" type="password" autocomplete="current-password"></label><div id="server-admin-error" class="server-admin-error"></div><div class="server-admin-actions"><button class="primary" id="server-admin-login">验证管理员身份</button></div></div></section>`;
    document.body.appendChild(node); node.querySelector('#server-admin-close').onclick = closeServerAdmin;
    node.addEventListener('click', event => { if (event.target === node) closeServerAdmin(); });
    node.querySelector('#server-admin-login').onclick = async () => {
      const button = node.querySelector('#server-admin-login'); const error = node.querySelector('#server-admin-error');
      button.disabled = true; error.textContent = '正在验证…';
      try { const result = await api.connection.verifyAdmin({username: node.querySelector('#server-admin-user').value, password: node.querySelector('#server-admin-password').value}); adminSessionId = result.sessionId; await renderServerAdminPanel(); }
      catch (e) { error.textContent = String(e.message || e); button.disabled = false; }
    };
  }
  function bindHiddenServerAdmin() {
    if (document.documentElement.dataset.serverAdminBound === '1') return;
    document.documentElement.dataset.serverAdminBound = '1';
    document.addEventListener('keydown', event => { if (event.ctrlKey && event.shiftKey && event.altKey && String(event.key).toLowerCase() === 's') { event.preventDefault(); openServerAdmin(); } });
    const clicks = [];
    document.addEventListener('click', event => { if (!event.target.closest?.('.titlebar .brand img')) return; const now = Date.now(); clicks.push(now); while (clicks.length && clicks[0] < now - 5000) clicks.shift(); if (clicks.length >= 7) { clicks.length = 0; openServerAdmin(); } });
  }

  async function init() {
    ensureStyles();
    ensureServerAdminStyles();
    ensureDoubaoDensityStyles();
    ensureAccountGroupStyles();
    ensureLocalAccountImportStyles();
    bindHiddenServerAdmin();
    try { snapshot.connection = await api.connection.status(); snapshot.identity = await api.auth.status(); snapshot.agent = await api.agent.status(); refreshBar(); renderSettingsPanel(); }
    catch (error) { console.warn('desktop ui init failed',error); }
  }
  api.auth?.onChanged?.(async status => {
    snapshot.identity = status;
    try { snapshot.agent = await api.agent.status(); } catch {}
    refreshBar();
  });
  function updateEmbeddedBounds() {
    // 豆包使用账号级独立 BrowserWindow，主客户端布局不再参与网页视口计算。
  }
  function exitFocusMode() {
    if (!document.body.classList.contains('doubao-focus-mode')) return false;
    document.body.classList.remove('doubao-focus-mode');
    const focus = document.querySelector('#embedded-browser-focus');
    focus?.classList.remove('active');
    if (focus) focus.textContent = '沉浸模式';
    setTimeout(updateEmbeddedBounds, 80);
    return true;
  }
  function syncEmbeddedPage() {
    if (document.querySelector('#doubao-account-modal')) { api.doubao?.setPageActive(false).catch(() => {}); return; }
    const doubaoPage = document.querySelector('[data-page="doubao"].active');
    document.body.classList.toggle('doubao-page-active', Boolean(doubaoPage));
    if (!doubaoPage) exitFocusMode();
    document.querySelector('#embedded-browser-hide')?.addEventListener('click', () => {
      const current = document.querySelector('.account-compact.active');
      if (!current) return showEmbeddedMessage('请先选择豆包账号。', true);
      api.doubao?.hideAccount(current.dataset.accountId).catch(error => showEmbeddedMessage(String(error.message || error), true));
    });
    document.querySelector('#embedded-browser-refresh')?.addEventListener('click', () => {
      const current = document.querySelector('.account-compact.active');
      if (!current) return showEmbeddedMessage('请先选择豆包账号。', true);
      const payload = accountPayload(current);
      api.doubao?.open(payload).then(() => api.doubao?.setPageActive(true)).catch(error => showEmbeddedMessage(String(error.message || error), true));
    });
    document.querySelector('#embedded-browser-popout')?.addEventListener('click', () => {
      const current = document.querySelector('.account-compact.active');
      if (!current) return showEmbeddedMessage('请先选择豆包账号。', true);
      api.doubao?.popout(accountPayload(current)).catch(error => showEmbeddedMessage(String(error.message || error), true));
    });
  }
  function showEmbeddedMessage(message, warning = false) {
    const node = document.querySelector('#embedded-browser-message');
    if (!node) return;
    if (!message) { node.className = 'embedded-browser-message'; node.textContent = ''; return; }
    node.className = `embedded-browser-message show${warning ? ' warning' : ''}`;
    node.innerHTML = `<span>${esc(message)}</span>${warning && /登录|会话/.test(message) ? '<button class="ghost" id="goto-settings">去系统设置</button>' : ''}`;
    node.querySelector('#goto-settings')?.addEventListener('click', () => document.querySelector('[data-page="settings"]')?.click());
  }
  function accountPayload(card) { return {id: card.dataset.accountId, name: card.querySelector('.account-copy b')?.textContent?.trim() || card.querySelector('b')?.textContent?.trim() || card.dataset.accountId, platform: '豆包'}; }
  function accountLoginState(result = {}) {
    if (result.verificationRequired === true) return 'verification_required';
    if (result.loggedIn === true) return 'logged_in';
    const state = String(result.loginState || result.state || 'unknown');
    return ['logged_in','logged_out','verification_required','loading','unknown','unchecked'].includes(state) ? state : 'unknown';
  }
  function refreshDoubaoMetrics() {
    const accounts = registeredAccounts();
    const states = accounts.map(account => accountLoginStates.get(account.id)?.state || 'unchecked');
    const online = states.filter(state => state === 'logged_in').length;
    const verification = states.filter(state => state === 'verification_required').length;
    const offline = Math.max(0, accounts.length - online - verification);
    const set = (selector, value) => { const node=document.querySelector(selector);if(node)node.textContent=String(value); };
    set('[data-doubao-account-total]', accounts.length);
    set('[data-doubao-account-online]', online);
    set('[data-doubao-account-verification]', verification);
    set('[data-doubao-account-offline]', offline);
    set('[data-doubao-account-summary]', states.some(state=>state==='unchecked'||state==='loading') ? '检测中' : '实时状态');
    const footer = document.querySelector('[data-status-doubao]');
    if (footer) footer.textContent = accounts.length ? `● 豆包账号　已登录 ${online}/${accounts.length}${verification?` · 待验证 ${verification}`:''}` : '● 豆包账号　当前创作空间暂无账号';
  }
  function applyAccountLoginState(cardOrId, result = {}) {
    const id = typeof cardOrId === 'string' ? cardOrId : cardOrId?.dataset?.accountId;
    if (!id) return;
    const state = accountLoginState(result);
    const normalized = {...result, state};
    accountLoginStates.set(id, normalized);
    const card = typeof cardOrId === 'string' ? document.querySelector(`.account[data-account-id="${CSS.escape(id)}"]`) : cardOrId;
    if (card) {
      card.dataset.loginState = state;
      const dot = card.querySelector('.account-dot');
      if (dot) { dot.className = `account-dot ${state==='logged_in'?'online':state==='verification_required'?'warning':state==='logged_out'?'offline':'unknown'}`; }
      const detail = card.querySelector('.account-copy small');
      const labels = {logged_in:'已登录',logged_out:'未登录',verification_required:'需要人工验证',loading:'正在检测',unknown:'状态待确认',unchecked:'等待检测'};
      if (detail) detail.textContent = `${result.platformAccountName?`${result.platformAccountName} · `:''}${labels[state]||labels.unknown}`;
    }
    refreshDoubaoMetrics();
    applyAccountFilters();
  }
  async function detectAccountCard(card, {silent = false} = {}) {
    if (!card) return null;
    applyAccountLoginState(card, {state:'loading'});
    try {
      const result = await api.doubao.detect(accountPayload(card));
      applyAccountLoginState(card, result);
      if (!silent) showEmbeddedMessage(result.verificationRequired ? '该账号需要人工验证，请点击“打开”进入对应窗口处理。' : result.loggedIn ? '登录状态检测通过。' : (result.message || '该账号尚未登录。'), !result.loggedIn);
      return result;
    } catch (error) {
      applyAccountLoginState(card, {state:'unknown', message:String(error.message||error)});
      if (!silent) showEmbeddedMessage(String(error.message || error), true);
      return null;
    }
  }
  async function detectAllAccounts() {
    if (detectionRun) return detectionRun;
    const cards = [...document.querySelectorAll('.doubao-account-list .account[data-account-id]')];
    detectionRun = (async()=>{for(const card of cards)await detectAccountCard(card,{silent:true});refreshDoubaoMetrics();return cards.length;})().finally(()=>{detectionRun=null});
    return detectionRun;
  }
  function scheduleAccountAutoDetection() {
    const list = document.querySelector('[data-page="doubao"].active') ? document.querySelector('.doubao-account-list') : null;
    const ids = list ? [...list.querySelectorAll('.account[data-account-id]')].map(card=>card.dataset.accountId).join('|') : '';
    if (!list || !ids || (detectedAccountList === list && detectedAccountIds === ids)) return;
    detectedAccountList = list;
    detectedAccountIds = ids;
    setTimeout(()=>detectAllAccounts().catch(()=>{}),120);
  }
  function customAccountKey() { return `lingframe.doubaoAccounts.${snapshot.identity?.tenantId || 'local'}`; }
  function accountProfileKey() { return `lingframe.doubaoProfiles.${snapshot.identity?.tenantId || 'local'}`; }
  function accountProfiles() { try { const value=JSON.parse(localStorage.getItem(accountProfileKey())||'{}');return value&&typeof value==='object'?value:{} } catch { return {} } }
  function saveAccountProfiles(value) { localStorage.setItem(accountProfileKey(),JSON.stringify(value));window.dispatchEvent(new CustomEvent('lingframe:account-profiles-changed',{detail:value})); }
  function customAccounts() { try { const value = JSON.parse(localStorage.getItem(customAccountKey()) || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } }
  function saveCustomAccounts(accounts) { localStorage.setItem(customAccountKey(), JSON.stringify(accounts)); }
  function groupStore() { return window.lingframeAccountStore; }
  function registeredAccounts() { return groupStore()?.accounts?.() || []; }
  function groupState() { return groupStore()?.groupState() || {version:1,selectedGroupId:'all',groups:[]}; }
  function saveGroupState(value) { return groupStore()?.saveGroups(value); }
  function renderGroupFilter() {
    const select = document.querySelector('[data-account-group-filter]');
    if (!select) return;
    const state = groupState();
    const current = select.value || state.selectedGroupId || 'all';
    const markup = `<option value="all">全部账号</option><option value="available">可用账号</option><option value="verification">需验证</option>${state.groups.map(group=>`<option value="${esc(group.id)}">${esc(group.name)}</option>`).join('')}`;
    if (select.innerHTML !== markup) select.innerHTML = markup;
    select.value = [...select.options].some(option=>option.value===current) ? current : 'all';
  }
  function applyAccountFilters() {
    const selected = document.querySelector('[data-account-group-filter]')?.value || 'all';
    const query = String(document.querySelector('.doubao-search')?.value || '').trim().toLowerCase();
    const group = groupState().groups.find(item=>item.id===selected);
    document.querySelectorAll('.doubao-account-list .account[data-account-id]').forEach(card=>{
      const id = card.dataset.accountId;
      const text = `${card.dataset.accountName || ''} ${card.querySelector('.account-copy')?.innerText || ''} ${id}`.toLowerCase();
      const inGroup = selected==='all' || (selected==='available' && card.querySelector('.account-dot.online')) || (selected==='verification' && card.querySelector('.account-dot.warning')) || Boolean(group?.accountIds.includes(id));
      card.style.display = inGroup && (!query || text.includes(query)) ? '' : 'none';
    });
  }
  function ensureGroupUI() {
    if (!document.querySelector('[data-page="doubao"].active')) return;
    const search = document.querySelector('.doubao-search');
    if (!search) return;
    let toolbar = document.querySelector('.doubao-group-toolbar');
    if (!toolbar) {
      toolbar = document.createElement('div');
      toolbar.className = 'doubao-group-toolbar';
      toolbar.innerHTML = '<select data-account-group-filter aria-label="切换账号分组"></select><button class="ghost" data-account-group-manage>管理分组</button>';
      search.insertAdjacentElement('beforebegin', toolbar);
      toolbar.querySelector('[data-account-group-filter]').addEventListener('change', event=>{const state=groupState();state.selectedGroupId=event.target.value;saveGroupState(state);applyAccountFilters()});
      toolbar.querySelector('[data-account-group-manage]').addEventListener('click', showGroupManager);
    }
    if (!search.dataset.groupBound) { search.dataset.groupBound='1'; search.addEventListener('input', applyAccountFilters); }
    renderGroupFilter();
    applyAccountFilters();
  }
  function showGroupManager() {
    if (document.querySelector('.doubao-group-manage')) return;
    api.doubao?.setPageActive(false).catch(()=>{});
    const host = document.createElement('div');
    host.className = 'doubao-group-manage';
    const paint = () => {
      const state = groupState();
      const accounts = groupStore()?.accounts() || [];
      host.innerHTML = `<section class="doubao-group-dialog glass"><h2>管理豆包账号分组</h2><p>分组只影响当前租户工作台的账号筛选和任务选择，不改变豆包登录环境。</p><div class="doubao-group-create"><input data-group-new-name maxlength="30" placeholder="输入新分组名称，例如：短剧组"><button class="primary" data-group-create>新建分组</button></div><div>${state.groups.length ? state.groups.map(group=>`<article class="doubao-group-card" data-group-card="${esc(group.id)}"><div class="doubao-group-card-head"><input data-group-name maxlength="30" value="${esc(group.name)}"><button class="ghost" data-group-save>保存</button><button class="ghost" data-group-delete>删除</button></div><div class="doubao-group-members">${accounts.map(account=>`<label><input type="checkbox" value="${esc(account.id)}" ${group.accountIds.includes(account.id)?'checked':''}>${esc(account.name)}</label>`).join('')}</div></article>`).join('') : '<div class="setting-note">还没有自定义分组。新建后可勾选要放入该组的账号。</div>'}</div><div class="doubao-group-actions"><button class="ghost" data-group-close>完成</button></div></section>`;
      host.querySelector('[data-group-close]').onclick = close;
      host.querySelector('[data-group-create]').onclick = () => {
        const input = host.querySelector('[data-group-new-name]'); const name = input.value.trim();
        if (!name) return input.focus();
        const next = groupState();
        if (next.groups.some(item=>item.name===name)) return alert('已存在同名分组');
        next.groups.push({id:`group-${Date.now().toString(36)}`,name,accountIds:[]}); saveGroupState(next); paint();
      };
      host.querySelectorAll('[data-group-save]').forEach(button=>button.onclick=()=>{
        const card=button.closest('[data-group-card]');const next=groupState();const group=next.groups.find(item=>item.id===card.dataset.groupCard);if(!group)return;
        const name=card.querySelector('[data-group-name]').value.trim();if(!name)return alert('分组名称不能为空');
        group.name=name.slice(0,30);group.accountIds=[...card.querySelectorAll('.doubao-group-members input:checked')].map(input=>input.value);saveGroupState(next);paint();
      });
      host.querySelectorAll('[data-group-delete]').forEach(button=>button.onclick=()=>{
        const card=button.closest('[data-group-card]');const next=groupState();const group=next.groups.find(item=>item.id===card.dataset.groupCard);if(!group||!confirm(`确定删除分组“${group.name}”吗？账号和登录环境不会被删除。`))return;
        next.groups=next.groups.filter(item=>item.id!==group.id);if(next.selectedGroupId===group.id)next.selectedGroupId='all';saveGroupState(next);paint();
      });
    };
    const close=()=>{host.remove();ensureGroupUI();api.doubao?.setPageActive(true).catch(()=>{})};
    host.addEventListener('click',event=>{if(event.target===host)close()});
    document.body.appendChild(host);paint();host.querySelector('[data-group-new-name]')?.focus();
  }
  function accountMarkup(account) {
    const profile=accountProfiles()[account.id]||account;const name=profile.name||account.name;const initial=esc(String(name||'豆').trim().slice(0,1)||'豆');const avatar=profile.avatar?`<img src="${esc(profile.avatar)}" alt="">`:initial;
    return `<div class="account account-compact" data-account-id="${esc(account.id)}" data-custom-account="1" data-login-state="unchecked"><div class="face">${avatar}</div><div class="account-copy"><b>${esc(name)}</b><small>等待检测</small></div><span class="account-dot unknown"></span><div class="account-actions"><button class="ghost" data-account-action="open">打开</button><button class="ghost" data-account-action="detect">检测</button><button class="ghost" data-account-action="popout">弹出</button><button class="ghost" data-account-action="edit-profile">编辑资料</button></div></div>`;
  }
  function applyAccountProfiles(){const profiles=accountProfiles();let changed=false;document.querySelectorAll('.account[data-account-id]').forEach(card=>{const id=card.dataset.accountId,base=card.dataset.accountName||card.querySelector('.account-copy b')?.textContent?.trim()||id,profile=profiles[id]||{};if(!profiles[id]){profiles[id]={id,name:base,avatar:'',platform:'豆包'};changed=true}const name=profile.name||base,title=card.querySelector('.account-copy b');if(title&&title.textContent!==name)title.textContent=name;card.dataset.accountName=name;const face=card.querySelector('.face');if(face){const expected=profile.avatar?`<img src="${esc(profile.avatar)}" alt="${esc(name)}">`:esc(name.slice(0,1)||'豆');if(face.innerHTML!==expected)face.innerHTML=expected}const actions=card.querySelector('.account-actions');if(actions&&!actions.querySelector('[data-account-action="edit-profile"]'))actions.insertAdjacentHTML('beforeend','<button class="ghost" data-account-action="edit-profile">编辑资料</button>')});if(changed)saveAccountProfiles(profiles)}
  function restoreCustomAccounts() {
    const add = document.querySelector('.doubao-account-list .account-add');
    if (!add) return;
    const accounts=registeredAccounts(),allowed=new Set(accounts.map(account=>account.id));
    document.querySelectorAll('.doubao-account-list .account[data-account-id]').forEach(card=>{if(!allowed.has(card.dataset.accountId))card.remove()});
    for (const account of accounts) {
      if (document.querySelector(`.account[data-account-id="${CSS.escape(account.id)}"]`)) continue;
      add.insertAdjacentHTML('beforebegin', accountMarkup(account));
    }
    applyAccountProfiles();
    document.querySelectorAll('.doubao-account-list .account[data-account-id]').forEach(card=>applyAccountLoginState(card,accountLoginStates.get(card.dataset.accountId)||{state:'unchecked'}));
    refreshDoubaoMetrics();
    scheduleAccountAutoDetection();
  }
  async function editAccountProfile(card){if(document.querySelector('#doubao-profile-modal'))return;await api.doubao?.setPageActive(false).catch(()=>{});const id=card.dataset.accountId,profiles=accountProfiles(),current=profiles[id]||{id,name:card.querySelector('.account-copy b')?.textContent?.trim()||id,avatar:'',platform:'豆包'};const modal=document.createElement('div');modal.id='doubao-profile-modal';modal.innerHTML=`<div class="doubao-account-dialog glass"><h2>编辑账号工作台资料</h2><p>备注名和头像只用于灵帧AI工作台展示，不会修改豆包平台昵称。</p><div class="profile-avatar-preview" data-profile-preview>${current.avatar?`<img src="${esc(current.avatar)}" alt="">`:esc((current.name||'豆').slice(0,1))}</div><label>工作台备注名</label><input data-profile-name maxlength="40" value="${esc(current.name||'')}"><label class="profile-file">上传头像<input data-profile-avatar type="file" accept="image/png,image/jpeg,image/webp"></label><button class="ghost" data-profile-remove-avatar>恢复文字头像</button><div class="doubao-dialog-error" data-profile-error></div><div class="doubao-dialog-actions"><button class="ghost" data-profile-cancel>取消</button><button class="primary" data-profile-save>保存</button></div></div>`;Object.assign(modal.style,{position:'fixed',inset:'0',zIndex:'1000',display:'grid',placeItems:'center',background:'rgba(3,10,22,.42)',backdropFilter:'blur(3px)'});const dialog=modal.firstElementChild;Object.assign(dialog.style,{width:'430px',padding:'26px',borderRadius:'20px'});document.body.appendChild(modal);let avatar=current.avatar||'';const preview=modal.querySelector('[data-profile-preview]'),nameInput=modal.querySelector('[data-profile-name]');const paint=()=>{preview.innerHTML=avatar?`<img src="${esc(avatar)}" alt="">`:esc((nameInput.value.trim()||'豆').slice(0,1))};nameInput.oninput=paint;modal.querySelector('[data-profile-avatar]').onchange=event=>{const file=event.target.files?.[0];if(!file)return;if(file.size>1024*1024){modal.querySelector('[data-profile-error]').textContent='头像文件不能超过 1MB';return}const reader=new FileReader();reader.onload=()=>{avatar=String(reader.result||'');paint()};reader.readAsDataURL(file)};modal.querySelector('[data-profile-remove-avatar]').onclick=()=>{avatar='';paint()};const close=()=>{modal.remove();api.doubao?.setPageActive(true).catch(()=>{})};modal.querySelector('[data-profile-cancel]').onclick=close;modal.onclick=e=>{if(e.target===modal)close()};modal.querySelector('[data-profile-save]').onclick=async()=>{const name=nameInput.value.trim();if(!name){modal.querySelector('[data-profile-error]').textContent='请输入工作台备注名';return}profiles[id]={...current,id,name:name.slice(0,40),avatar,platform:'豆包'};saveAccountProfiles(profiles);await groupStore()?.upsertAccount?.(profiles[id]);close();applyAccountProfiles()};nameInput.focus()}
  async function addDoubaoAccount() {
    if (document.querySelector('#doubao-account-modal')) return;
    await api.doubao?.setPageActive(false).catch(() => {});
    const modal = document.createElement('div');
    modal.id = 'doubao-account-modal';
    modal.innerHTML = `<div class="doubao-account-dialog glass"><div class="doubao-dialog-icon">＋</div><h2>添加豆包账号</h2><p>为新账号创建独立浏览器环境，登录状态与其他账号完全隔离。</p><label>账号名称</label><input id="doubao-account-name" maxlength="40" autocomplete="off" placeholder="例如：短剧创作账号"><div class="doubao-dialog-error" id="doubao-account-error"></div><div class="doubao-dialog-actions"><button class="ghost" data-account-cancel>取消</button><button class="primary" data-account-confirm>创建并打开</button></div></div>`;
    Object.assign(modal.style, {position:'fixed',inset:'0',zIndex:'1000',display:'grid',placeItems:'center',background:'rgba(3,10,22,.38)',backdropFilter:'blur(2px)'});
    const dialog = modal.querySelector('.doubao-account-dialog');
    Object.assign(dialog.style, {width:'420px',padding:'28px',borderRadius:'20px',boxShadow:'0 28px 90px rgba(0,0,0,.55)'});
    const input = dialog.querySelector('#doubao-account-name');
    input.style.cssText = 'width:100%;height:44px;border-radius:10px;border:1px solid rgba(92,214,255,.24);background:#09162a;color:#eef5ff;padding:0 13px;outline:none';
    dialog.querySelector('.doubao-dialog-error').style.cssText = 'height:24px;padding-top:6px;color:#ffad78;font-size:10px';
    dialog.querySelector('.doubao-dialog-actions').style.cssText = 'display:flex;justify-content:flex-end;gap:9px;margin-top:6px';
    document.body.appendChild(modal);
    input.focus();
    const close = restore => { modal.remove(); if (restore) api.doubao?.setPageActive(true).catch(() => {}); };
    modal.querySelector('[data-account-cancel]').onclick = () => close(true);
    modal.addEventListener('click', event => { if (event.target === modal) close(true); });
    const confirm = async () => {
      const name = String(input.value || '').trim();
      if (!name) { modal.querySelector('#doubao-account-error').textContent = '请输入账号名称'; input.focus(); return; }
      const accounts = customAccounts();
      const account = {id: `desktop-${Date.now().toString(36)}`, name: name.slice(0, 40), platform: '豆包'};
      accounts.push(account); saveCustomAccounts(accounts);const profiles=accountProfiles();profiles[account.id]={...account,avatar:''};saveAccountProfiles(profiles);await groupStore()?.upsertAccount?.(account);close(false); restoreCustomAccounts();
      const createdCard = document.querySelector(`.account[data-account-id="${CSS.escape(account.id)}"]`);
      createdCard?.querySelector('[data-account-action="open"]')?.click();
    };
    modal.querySelector('[data-account-confirm]').onclick = confirm;
    input.addEventListener('keydown', event => { if (event.key === 'Enter') confirm(); if (event.key === 'Escape') close(true); });
    return;
    const name = String(window.prompt('请输入豆包账号名称', '新豆包账号') || '').trim();
    if (!name) return;
    const accounts = customAccounts();
    const account = {id: `desktop-${Date.now().toString(36)}`, name: name.slice(0, 40), platform: '豆包'};
    accounts.push(account);
    saveCustomAccounts(accounts);
    restoreCustomAccounts();
    document.querySelector(`.account[data-account-id="${CSS.escape(account.id)}"]`)?.click();
  }
  document.addEventListener('click', async event => {
    if (event.target.closest('[data-page="settings"]')) setTimeout(renderSettingsPanel, 0);
    if (event.target.closest('.account-add,.doubao-rail-head .icon-button')) { await addDoubaoAccount(); return; }
    if (event.target.closest('[data-account-batch-detect]')) { event.preventDefault();await detectAllAccounts();showEmbeddedMessage('全部账号登录状态已更新。',false);return; }
    if (event.target.closest('[data-account-batch-open]')) { event.preventDefault();for(const card of document.querySelectorAll('.doubao-account-list .account[data-account-id]'))await api.doubao.open(accountPayload(card),{focus:false});return; }
    const account = event.target.closest('.account[data-account-id]');
    if (!account) return;
    const actionButton = event.target.closest('[data-account-action]');
    document.querySelectorAll('.account-compact').forEach(item => item.classList.toggle('active', item === account));
    if (!actionButton) return;
    event.preventDefault();
    event.stopPropagation();
    const action = actionButton.dataset.accountAction;
    if(action==='edit-profile'){await editAccountProfile(account);return}
    const payload = accountPayload(account);
    try {
      if (actionButton) actionButton.disabled = true;
      const text = action === 'detect' ? '检测' : action === 'popout' ? '弹出' : '打开';
      let result;
      if (/检测/.test(text)) result = await detectAccountCard(account);
      else if (/弹出/.test(text)) result = await api.doubao.popout(payload);
      else result = await api.doubao.open(payload);
      const status = document.querySelector('#embedded-browser-status');
      if (status) status.textContent = result?.verificationRequired ? '需要人工验证，请直接在内嵌网页操作' : (result?.message || `当前账号：${payload.name}`);
      showEmbeddedMessage(result?.verificationRequired ? '豆包页面提示需要人工验证，请直接在中间工作区完成操作。' : '', false);
    } catch (error) { showEmbeddedMessage(String(error.message || error), true); }
    finally { if (actionButton) actionButton.disabled = false; }
  });
  api.doubao?.onStatus(data => { const status = document.querySelector('#embedded-browser-status'); if (status && data?.accountId) { const running=Array.isArray(data.activeTaskIds)?data.activeTaskIds.length:0;status.textContent=`账号 ${data.accountId} · ${data.loaded?'页面已加载':'正在加载'} · ${running?`${running} 个任务运行中`:data.visible?'窗口已打开':'窗口已隐藏'}`; } if(data?.accountId&&data?.loginState)applyAccountLoginState(data.accountId,data);if (data?.message) showEmbeddedMessage(data.message, Boolean(data.closeProtected)); else if (data?.error) showEmbeddedMessage(data.error, true); });
  window.addEventListener('resize', updateEmbeddedBounds);
  window.addEventListener('scroll', updateEmbeddedBounds, true);
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') exitFocusMode();
  });
  document.addEventListener('click', event => {
    const route = event.target.closest('[data-page]');
    if (!route || route.dataset.page === 'doubao') return;
    exitFocusMode();
    setTimeout(syncEmbeddedPage, 0);
  }, true);
  window.addEventListener('lingframe:embedded-sync-request', syncEmbeddedPage);
  const observer = new MutationObserver(() => setTimeout(() => { restoreCustomAccounts(); ensureGroupUI(); syncEmbeddedPage(); renderSettingsPanel(); }, 0));
  observer.observe(document.body, {childList: true, subtree: true});
  init();
  restoreCustomAccounts();
  window.addEventListener('lingframe:account-store-ready', () => setTimeout(() => { restoreCustomAccounts(); applyAccountProfiles(); ensureGroupUI(); }, 0));
  window.addEventListener('lingframe:account-groups-changed', () => setTimeout(ensureGroupUI, 0));
  setTimeout(syncEmbeddedPage, 0);
})();
