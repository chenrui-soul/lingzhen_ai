(() => {
  const api = window.lingframe?.auth;
  if (!api) return;

  let mode = 'login';
  let status = null;
  let busy = false;
  let loadingNoticeTimer = null;
  let loadingRequestId = 0;
  const WORKSPACE_SLOW_NOTICE_MS = 8000;

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const gate = () => document.querySelector('#auth-gate');

  function windowBar() {
    return `<div class="auth-windowbar"><span>灵帧AI</span><div class="auth-window-actions"><button type="button" data-auth-win="min" aria-label="最小化">−</button><button type="button" data-auth-win="close" aria-label="关闭">×</button></div></div>`;
  }

  function story() {
    return `<section class="auth-story" aria-label="灵帧AI介绍"><div class="auth-brand"><span class="auth-brand-mark"><img src="../../assets/lingframe-mark.png" alt="灵帧AI"></span><div><b>灵帧AI</b><small>LINGFRAME CREATIVE OS</small></div></div><div class="auth-story-copy"><div class="auth-eyebrow">专属创作空间</div><h1>让灵感有迹可循，<br>让创作持续生长。</h1><p>项目、任务、素材和创作账号都归属于你的工作空间，登录后即可继续上次的创作。</p></div><div class="auth-points"><div class="auth-point"><b>统一身份</b><span>一个账号访问自己的创作数据</span></div><div class="auth-point"><b>持续同步</b><span>桌面端与服务端状态保持一致</span></div><div class="auth-point"><b>空间隔离</b><span>不同工作空间的数据互不混用</span></div></div></section>`;
  }

  function shell(card) {
    return `${windowBar()}<main class="auth-layout ${mode === 'register' ? 'is-register-layout' : 'is-login-layout'}">${story()}<div class="auth-card-shell">${card}</div></main>`;
  }

  function field(name, label, type, placeholder, options = {}) {
    const hint = options.hint ? `<em>${esc(options.hint)}</em>` : '';
    const toggle = type === 'password' ? `<button class="auth-password-toggle" type="button" data-password-toggle="${name}" aria-label="显示密码">显示</button>` : '';
    return `<label class="auth-field"><span class="auth-field-label"><span>${esc(label)}</span>${hint}</span><span class="auth-input-wrap"><input name="${name}" type="${type}" placeholder="${esc(placeholder)}" autocomplete="${esc(options.autocomplete || 'off')}" maxlength="${Number(options.maxlength || 320)}">${toggle}</span><span class="auth-field-error" data-field-error="${name}" aria-live="polite"></span></label>`;
  }

  function formCard() {
    const login = mode === 'login';
    const fields = login
      ? `${field('identity','账号','text','请输入用户名或邮箱',{autocomplete:'username'})}${field('password','密码','password','请输入登录密码',{autocomplete:'current-password',maxlength:128})}`
      : `${field('username','用户名','text','3-64 位字母、数字或 . _ -',{autocomplete:'username',maxlength:64})}${field('email','邮箱','email','用于登录和接收账号通知',{autocomplete:'email'})}${field('password','设置密码','password','至少 12 位',{autocomplete:'new-password',maxlength:128,hint:'至少 12 位'})}${field('confirmPassword','确认密码','password','再次输入密码',{autocomplete:'new-password',maxlength:128})}${field('invitationToken','邀请码','text','没有邀请码可留空',{maxlength:512,hint:'选填'})}`;
    const action = login ? '登录并进入工作台' : '注册并进入工作台';
    return `<section class="auth-card ${login ? 'is-login' : 'is-register'}" aria-labelledby="auth-title"><div class="auth-card-head"><span class="auth-card-kicker">${login ? '继续创作' : '新建账号'}</span><h2 id="auth-title">${login ? '欢迎回来' : '创建灵帧AI账号'}</h2><p>${login ? '登录你的创作空间，继续上次的工作。' : '注册后将自动创建个人创作空间。'}</p></div><div class="auth-tabs" role="tablist" aria-label="账号操作"><button type="button" role="tab" data-auth-mode="login" class="${login?'active':''}" aria-selected="${login}">登录</button><button type="button" role="tab" data-auth-mode="register" class="${!login?'active':''}" aria-selected="${!login}">注册</button></div><form class="auth-form" data-auth-form novalidate>${fields}<div class="auth-message" data-auth-message role="alert"></div><button class="auth-submit" type="submit"><span class="auth-submit-label">${action}</span><span class="auth-submit-mark" aria-hidden="true">›</span></button></form><div class="auth-safe"><span class="auth-safe-mark" aria-hidden="true">✓</span><span>登录凭证由 Windows 安全存储加密保存，不会写入页面或普通配置文件。</span></div></section>`;
  }

  function loadingCard(delayed = false) {
    if (!delayed) return `<section class="auth-card"><div class="auth-loading" aria-live="polite"><div class="auth-loading-mark" aria-hidden="true"><span></span><span></span><span></span></div><b>正在初始化工作台</b><span>确认登录状态、空间权限和工作台配置…</span><small>通常只需要几秒钟</small></div></section>`;
    return `<section class="auth-card"><div class="auth-loading auth-loading-delayed" aria-live="polite"><div class="auth-loading-mark" aria-hidden="true"><span></span><span></span><span></span></div><b>工作台加载时间较长</b><span>服务仍在连接，成功后会自动进入桌面。</span><div class="auth-loading-status"><i aria-hidden="true"></i><span>正在检查登录会话与空间权限</span></div><div class="auth-workspace-actions"><button type="button" class="auth-submit" data-bootstrap-retry-slow>重新检查</button><button type="button" class="auth-secondary" data-bootstrap-wait>继续等待</button></div><small>重新检查不会重复创建项目、任务或素材。</small></div></section>`;
  }

  function workspaceFailureCard() {
    const forbidden = status?.bootstrap?.state === 'forbidden';
    const title = forbidden ? '当前账号暂时无法使用工作台' : '工作台初始化失败';
    const message = status?.bootstrap?.error?.message || status?.reason || '暂时无法加载工作台，请稍后重试。';
    return `<section class="auth-card" aria-labelledby="auth-title"><div class="auth-workspace-error"><span class="auth-workspace-error-icon" aria-hidden="true">!</span><div class="auth-card-head"><h2 id="auth-title">${esc(title)}</h2><p>${esc(message)}</p></div><div class="auth-workspace-actions"><button type="button" class="auth-submit" data-bootstrap-retry>${forbidden ? '重新检查权限' : '重新加载工作台'}</button><button type="button" class="auth-secondary" data-bootstrap-logout>退出登录</button></div><small>如果问题持续存在，请联系管理员确认账号和工作空间权限。</small></div></section>`;
  }

  function roleName(role) {
    return ({owner:'所有者',admin:'管理员',member:'成员'})[String(role || '').toLowerCase()] || '成员';
  }

  function tenantCard() {
    const tenants = status?.tenantSelection?.tenants || [];
    return `<section class="auth-card" aria-labelledby="auth-title"><div class="auth-card-head"><h2 id="auth-title">选择创作空间</h2><p>这个账号属于多个工作空间，请选择本次要进入的空间。</p></div><div class="auth-message" data-auth-message role="alert"></div><div class="auth-tenant-list">${tenants.map(item=>`<button type="button" class="auth-tenant" data-tenant-id="${esc(item.tenantId)}"><span class="auth-tenant-icon">◇</span><span class="auth-tenant-copy"><b>${esc(item.tenantName || item.tenantCode)}</b><small>${esc(item.tenantCode || item.tenantId)}</small></span><span class="auth-tenant-role">${esc(roleName(item.role))}</span></button>`).join('')}</div><button type="button" class="auth-back" data-auth-back>← 返回重新登录</button></section>`;
  }

  function ensureGate() {
    let node = gate();
    if (!node) {
      node = document.createElement('div');
      node.id = 'auth-gate';
      node.className = 'auth-gate';
      document.body.appendChild(node);
    }
    return node;
  }

  function bindCommon(node) {
    node.querySelector('[data-auth-win="min"]')?.addEventListener('click', () => window.lingframe.window.minimize());
    node.querySelector('[data-auth-win="close"]')?.addEventListener('click', () => window.lingframe.window.close());
  }

  function setMessage(message, kind = 'error') {
    const node = gate()?.querySelector('[data-auth-message]');
    if (!node) return;
    node.textContent = String(message || '');
    node.className = `auth-message${message ? ' show' : ''}${kind === 'success' ? ' success' : ''}`;
  }

  function clearErrors(form) {
    form.querySelectorAll('[aria-invalid="true"]').forEach(input => input.removeAttribute('aria-invalid'));
    form.querySelectorAll('[data-field-error]').forEach(node => { node.textContent = ''; });
    setMessage('');
  }

  function fieldError(form, name, message) {
    const input = form.elements.namedItem(name);
    input?.setAttribute('aria-invalid','true');
    const error = form.querySelector(`[data-field-error="${CSS.escape(name)}"]`);
    if (error) error.textContent = message;
  }

  function validate(form) {
    clearErrors(form);
    const values = Object.fromEntries(new FormData(form).entries());
    let first = '';
    const invalid = (name, message) => { fieldError(form,name,message); if (!first) first = name; };
    if (mode === 'login') {
      if (!String(values.identity || '').trim()) invalid('identity','请输入用户名或邮箱');
      if (!String(values.password || '')) invalid('password','请输入登录密码');
    } else {
      if (!/^[A-Za-z0-9._-]{3,64}$/.test(String(values.username || ''))) invalid('username','用户名需为 3-64 位字母、数字或 . _ -');
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(values.email || ''))) invalid('email','请输入有效邮箱地址');
      if (String(values.password || '').length < 12) invalid('password','密码至少需要 12 位');
      if (values.confirmPassword !== values.password) invalid('confirmPassword','两次输入的密码不一致');
    }
    if (first) form.elements.namedItem(first)?.focus();
    return first ? null : values;
  }

  function friendlyError(error) {
    const code = String(error?.code || '');
    const messages = {
      AUTH_INVALID_CREDENTIALS:'账号或密码不正确，请检查后重试。',
      AUTH_IDENTITY_EXISTS:'用户名或邮箱已被使用，请更换后重试。',
      AUTH_ACCOUNT_LOCKED:'登录尝试次数过多，请稍后再试。',
      AUTHENTICATION_REQUIRED:'登录会话已过期，请重新登录。',
      TENANT_SELECTION_INVALID:'空间选择已失效，请重新登录。',
      AUTH_SERVICE_TIMEOUT:'连接身份服务超时，请检查网络后重试。',
      AUTH_SERVICE_UNAVAILABLE:'身份服务暂时不可用，请确认服务已启动。',
      DESKTOP_BOOTSTRAP_FORBIDDEN:'当前账号没有进入桌面工作台的权限。',
      DESKTOP_BOOTSTRAP_UNAVAILABLE:'工作台初始化失败，请稍后重试。',
      INVALID_DESKTOP_BOOTSTRAP_RESPONSE:'工作台初始化数据异常，请重新加载。',
      SECURE_STORAGE_UNAVAILABLE:'Windows 安全存储暂不可用，请重启客户端后再试。',
    };
    return messages[code] || String(error?.message || error || '操作失败，请稍后重试。');
  }

  function applyServerFieldErrors(form, errors = {}) {
    Object.entries(errors).forEach(([name,message]) => fieldError(form,name,String(message || '输入内容不正确')));
  }

  function setSubmitState(button, label, isBusy = false) {
    if (!button) return;
    button.classList.toggle('busy', isBusy);
    button.querySelector('.auth-submit-label').textContent = label;
    button.querySelector('.auth-submit-mark').textContent = isBusy ? '•••' : '›';
  }

  function bindForm(node) {
    node.querySelectorAll('[data-auth-mode]').forEach(button => button.addEventListener('click', () => {
      if (busy || button.dataset.authMode === mode) return;
      mode = button.dataset.authMode;
      renderForm();
    }));
    node.querySelectorAll('[data-password-toggle]').forEach(button => button.addEventListener('click', () => {
      const input = node.querySelector(`[name="${CSS.escape(button.dataset.passwordToggle)}"]`);
      if (!input) return;
      const visible = input.type === 'text';
      input.type = visible ? 'password' : 'text';
      button.textContent = visible ? '显示' : '隐藏';
      button.setAttribute('aria-label',visible ? '显示密码' : '隐藏密码');
      input.focus();
    }));
    const form = node.querySelector('[data-auth-form]');
    form?.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy) return;
      const values = validate(form);
      if (!values) return;
      busy = true;
      const submit = form.querySelector('.auth-submit');
      submit.disabled = true;
      setSubmitState(submit, mode === 'login' ? '正在验证账号…' : '正在创建账号…', true);
      try {
        status = mode === 'login' ? await api.login(values) : await api.register(values);
        if (status?.state === 'tenant_selection_required') renderTenantSelection();
        else if (status?.authenticated && status?.workspaceReady) enterWorkbench();
        else if (status?.authenticated) renderWorkspaceFailure();
        else setMessage(status?.reason || '登录未完成，请重试。');
      } catch (error) {
        applyServerFieldErrors(form,error?.fieldErrors);
        setMessage(friendlyError(error));
      } finally {
        busy = false;
        if (submit.isConnected) {
          submit.disabled = false;
          setSubmitState(submit, mode === 'login' ? '登录并进入工作台' : '注册并进入工作台');
        }
      }
    });
    requestAnimationFrame(() => form?.querySelector('input')?.focus());
  }

  function renderForm(message = '') {
    clearLoadingNotice();
    const node = ensureGate();
    node.innerHTML = shell(formCard());
    bindCommon(node);
    bindForm(node);
    if (message) setMessage(message);
  }

  function clearLoadingNotice() {
    if (loadingNoticeTimer) clearTimeout(loadingNoticeTimer);
    loadingNoticeTimer = null;
  }

  function scheduleSlowNotice(requestId) {
    clearLoadingNotice();
    loadingNoticeTimer = setTimeout(() => {
      if (requestId !== loadingRequestId || !gate() || status?.workspaceReady) return;
      renderLoading(true, requestId);
    }, WORKSPACE_SLOW_NOTICE_MS);
  }

  function renderLoading(delayed = false, requestId = loadingRequestId) {
    const node = ensureGate();
    node.innerHTML = shell(loadingCard(delayed));
    bindCommon(node);
    if (!delayed) return;
    node.querySelector('[data-bootstrap-wait]')?.addEventListener('click', () => {
      if (requestId !== loadingRequestId) return;
      renderLoading(false, requestId);
      scheduleSlowNotice(requestId);
    });
    node.querySelector('[data-bootstrap-retry-slow]')?.addEventListener('click', () => {
      runWorkspaceRequest(() => api.bootstrap(), {reloadOnReady:true});
    });
  }

  function applyStatus(next, {reloadOnReady = false} = {}) {
    status = next;
    if (next?.authenticated && next?.workspaceReady) {
      clearLoadingNotice();
      if (reloadOnReady) enterWorkbench();
      else gate()?.remove();
    } else if (next?.state === 'tenant_selection_required') renderTenantSelection();
    else if (next?.authenticated && next?.bootstrap?.state === 'loading') {
      renderLoading(false, loadingRequestId);
      scheduleSlowNotice(loadingRequestId);
    } else if (next?.authenticated) renderWorkspaceFailure();
    else renderForm(next?.lastError?.message ? friendlyError(next.lastError) : '');
  }

  async function runWorkspaceRequest(request, {reloadOnReady = false} = {}) {
    const requestId = ++loadingRequestId;
    busy = true;
    renderLoading(false, requestId);
    scheduleSlowNotice(requestId);
    try {
      const next = await request();
      if (requestId !== loadingRequestId) return;
      clearLoadingNotice();
      applyStatus(next, {reloadOnReady});
    } catch (error) {
      if (requestId !== loadingRequestId) return;
      clearLoadingNotice();
      status = {...status,reason:friendlyError(error)};
      if (status?.authenticated) renderWorkspaceFailure();
      else renderForm(friendlyError(error));
    } finally {
      if (requestId === loadingRequestId) busy = false;
    }
  }

  function renderWorkspaceFailure() {
    clearLoadingNotice();
    const node = ensureGate();
    node.innerHTML = shell(workspaceFailureCard());
    bindCommon(node);
    node.querySelector('[data-bootstrap-retry]')?.addEventListener('click', async button => {
      if (busy) return;
      button.currentTarget.disabled = true;
      button.currentTarget.textContent = '正在重新加载…';
      runWorkspaceRequest(() => api.bootstrap(), {reloadOnReady:true});
    });
    node.querySelector('[data-bootstrap-logout]')?.addEventListener('click', async button => {
      if (busy) return;
      busy = true;
      button.currentTarget.disabled = true;
      try { status = await api.logout(); }
      finally { busy = false; mode = 'login'; renderForm(); }
    });
  }

  function renderTenantSelection() {
    clearLoadingNotice();
    const node = ensureGate();
    node.innerHTML = shell(tenantCard());
    bindCommon(node);
    node.querySelectorAll('[data-tenant-id]').forEach(button => button.addEventListener('click', async () => {
      if (busy) return;
      busy = true;
      node.querySelectorAll('[data-tenant-id]').forEach(item => { item.disabled = true; });
      setMessage('正在进入所选创作空间…','success');
      try {
        status = await api.selectTenant(button.dataset.tenantId);
        if (status?.authenticated && status?.workspaceReady) enterWorkbench();
        else if (status?.authenticated) renderWorkspaceFailure();
        else setMessage(status?.reason || '无法进入该创作空间。');
      } catch (error) {
        setMessage(friendlyError(error));
        node.querySelectorAll('[data-tenant-id]').forEach(item => { item.disabled = false; });
      } finally { busy = false; }
    }));
    node.querySelector('[data-auth-back]')?.addEventListener('click', () => { status = null; mode = 'login'; renderForm(); });
  }

  function enterWorkbench() {
    clearLoadingNotice();
    const node = gate();
    if (!node) return;
    node.classList.add('is-leaving');
    setTimeout(() => location.reload(), 220);
  }

  async function init() {
    runWorkspaceRequest(() => api.status());
  }

  api.onChanged?.(next => {
    if (next?.authenticated && next?.workspaceReady) {
      status = next;
      clearLoadingNotice();
      gate()?.remove();
    } else if (!next?.authenticated) {
      status = next;
      renderForm('登录会话已结束，请重新登录。');
    } else if (next?.authenticated && next?.bootstrap?.state === 'loading' && gate()) {
      status = next;
      renderLoading(false, loadingRequestId);
      scheduleSlowNotice(loadingRequestId);
    } else if (next?.authenticated && !next?.workspaceReady) {
      status = next;
      renderWorkspaceFailure();
    }
  });

  window.lingframeAuthUi = {open:message=>renderForm(message),status:()=>status};
  init();
})();
