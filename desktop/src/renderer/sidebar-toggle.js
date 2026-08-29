(() => {
  const leftStorageKey = 'lingframe.sidebarCollapsed';
  const rightStorageKey = 'lingframe.rightPanelCollapsed';
  const responsive = {mode: '', page: '', forcedRightOpen: false};

  function layoutMode() {
    if (window.innerWidth >= 1680) return 'spacious';
    if (window.innerWidth >= 1360) return 'standard';
    if (window.innerWidth >= 1220) return 'compact';
    return 'minimal';
  }

  function pageKeepsRightClosed(shell) {
    const page = shell?.dataset.currentPage || '';
    // Utility pages without a live rail keep the right column unavailable;
    // creation, task and text pages may still open it on compact windows.
    return ['doubao', 'credits', 'resources'].includes(page);
  }

  function ensureStyle() {
    if (document.querySelector('#panel-toggle-style')) return;
    const style = document.createElement('style');
    style.id = 'panel-toggle-style';
    style.textContent = `
      .titlebar .panel-toggle-button{
        position:relative;flex:0 0 36px;width:36px;height:36px;margin-left:6px;
        display:grid;place-items:center;border:1px solid rgba(117,154,222,.12);
        border-radius:9px;background:rgba(16,28,49,.72);color:#91a9c9;
        font-size:17px;line-height:1;cursor:pointer;pointer-events:auto;
        -webkit-app-region:no-drag;transition:.16s ease;
      }
      .titlebar .panel-toggle-button:hover{
        color:#ecfaff;border-color:rgba(53,215,255,.38);
        background:linear-gradient(135deg,rgba(34,103,139,.82),rgba(73,53,139,.78));
        box-shadow:0 0 18px rgba(53,215,255,.12);
      }
      .titlebar .panel-toggle-button.is-collapsed{color:#50dcff;border-color:rgba(53,215,255,.3)}
      #left-panel-toggle{
        position:fixed;left:var(--shell-left-width,238px);top:66px;z-index:1300;width:30px;height:30px;
        margin:0;transform:translateX(-50%);border-radius:8px;
        background:linear-gradient(145deg,rgba(18,35,60,.98),rgba(12,24,43,.98));
        box-shadow:0 8px 22px rgba(0,0,0,.32),0 0 0 1px rgba(53,215,255,.05);
      }
      #left-panel-toggle.is-collapsed{left:10px;transform:none}
      #right-panel-toggle{
        position:fixed;right:var(--shell-right-width,320px);top:66px;z-index:1300;width:30px;height:30px;
        margin:0;transform:translateX(50%);border-radius:8px;
        background:linear-gradient(145deg,rgba(18,35,60,.98),rgba(12,24,43,.98));
        box-shadow:0 8px 22px rgba(0,0,0,.32),0 0 0 1px rgba(53,215,255,.05);
      }
      #right-panel-toggle.is-collapsed{right:10px;transform:none}
      .right [data-toggle="right"]{display:none!important}
      #sidebar-restore-handle{display:none!important}
      .shell[data-layout="minimal"]:not(.right-off) #right-panel-toggle{right:264px}
    `;
    document.head.appendChild(style);
  }

  function storedState(key, fallback) {
    const value = localStorage.getItem(key);
    return value === null ? Boolean(fallback) : value === '1';
  }

  function refreshEmbeddedBounds() {
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new CustomEvent('lingframe:embedded-sync-request'));
  }

  function updateButton(button, collapsed, side) {
    if (!button) return;
    const isLeft = side === 'left';
    const action = collapsed ? '展开' : '收起';
    button.textContent = isLeft
      ? (collapsed ? '⟩' : '⟨')
      : (collapsed ? '⟨' : '⟩');
    button.title = `${action}${isLeft ? '左侧导航栏' : '右侧助手栏'}`;
    button.setAttribute('aria-label', button.title);
    button.setAttribute('aria-expanded', String(!collapsed));
    button.classList.toggle('is-collapsed', collapsed);
  }

  function applyPanelState(shell, leftCollapsed, rightCollapsed) {
    if (!shell) return;
    const mode = layoutMode();
    const page = shell.dataset.currentPage || '';
    if (responsive.mode && responsive.mode !== mode && mode !== 'minimal') responsive.forcedRightOpen = false;
    if (responsive.page && responsive.page !== page) responsive.forcedRightOpen = false;
    responsive.mode = mode;
    responsive.page = page;
    const autoRightCollapsed = mode === 'minimal' && !responsive.forcedRightOpen;
    const fixedRightCollapsed = pageKeepsRightClosed(shell);
    const effectiveRightCollapsed = Boolean(rightCollapsed || autoRightCollapsed || fixedRightCollapsed);
    shell.dataset.layout = mode;
    shell.dataset.autoRightCollapsed = String(autoRightCollapsed);
    shell.classList.toggle('left-off', Boolean(leftCollapsed));
    shell.classList.toggle('right-off', effectiveRightCollapsed);
    updateButton(document.querySelector('#left-panel-toggle'), leftCollapsed, 'left');
    updateButton(document.querySelector('#right-panel-toggle'), effectiveRightCollapsed, 'right');
  }

  function setPanelCollapsed(side, collapsed) {
    const shell = document.querySelector('.shell');
    if (!shell) return;
    if (side === 'left') {
      localStorage.setItem(leftStorageKey, collapsed ? '1' : '0');
      applyPanelState(shell, collapsed, storedState(rightStorageKey, false));
    } else {
      if (pageKeepsRightClosed(shell)) return;
      if (layoutMode() === 'minimal') {
        responsive.forcedRightOpen = !collapsed;
      } else {
        localStorage.setItem(rightStorageKey, collapsed ? '1' : '0');
      }
      applyPanelState(shell, storedState(leftStorageKey, false), storedState(rightStorageKey, false));
    }
    refreshEmbeddedBounds();
  }

  function createTopButton(id, side) {
    const button = document.createElement('button');
    button.id = id;
    button.type = 'button';
    button.className = 'panel-toggle-button';
    button.dataset.panelToggle = side;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const shell = document.querySelector('.shell');
      if (!shell) return;
      setPanelCollapsed(side, !shell.classList.contains(side === 'left' ? 'left-off' : 'right-off'));
    });
    return button;
  }

  function ensureControls() {
    ensureStyle();
    document.querySelector('#sidebar-restore-handle')?.remove();

    const shell = document.querySelector('.shell');
    const titlebar = document.querySelector('.titlebar');
    const brand = document.querySelector('.brand');
    if (!shell || !titlebar || !brand) return;

    let leftButton = titlebar.querySelector('#left-panel-toggle');
    if (!leftButton) {
      leftButton = createTopButton('left-panel-toggle', 'left');
      brand.after(leftButton);
    }

    let rightButton = titlebar.querySelector('#right-panel-toggle');
    if (!rightButton) {
      rightButton = createTopButton('right-panel-toggle', 'right');
      const user = titlebar.querySelector('.user');
      if (user) titlebar.insertBefore(rightButton, user);
      else titlebar.appendChild(rightButton);
    }
    rightButton.hidden = pageKeepsRightClosed(shell);

    document.querySelector('.right [data-toggle="right"]')?.remove();

    shell.querySelectorAll('.nav[data-page]').forEach(button => {
      const label = button.getAttribute('aria-label') || button.textContent.trim();
      button.setAttribute('aria-label', label);
      if (!button.getAttribute('title')) button.setAttribute('title', label);
    });
    const leftCollapsed = storedState(leftStorageKey, false);
    const rightCollapsed = storedState(rightStorageKey, false);
    applyPanelState(shell, leftCollapsed, rightCollapsed);
  }

  new MutationObserver(ensureControls).observe(document.documentElement, {childList: true, subtree: true});
  window.addEventListener('resize', () => requestAnimationFrame(() => {
    const shell = document.querySelector('.shell');
    if (!shell) return;
    applyPanelState(shell, storedState(leftStorageKey, false), storedState(rightStorageKey, false));
    refreshEmbeddedBounds();
  }));
  ensureControls();
})();
