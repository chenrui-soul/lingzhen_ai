(() => {
  const storageKey = 'lingframe.appearance.v1';
  const defaults = {
    theme: 'system',
    fontSize: 'standard',
    contrast: 'soft',
    reduceGlow: true,
    reduceMotion: false
  };
  const allowed = {
    theme: ['system', 'dark', 'light', 'comfort'],
    fontSize: ['small', 'standard', 'large', 'xlarge'],
    contrast: ['soft', 'standard', 'clear']
  };
  const systemTheme = window.matchMedia('(prefers-color-scheme: light)');
  let preferences = loadPreferences();

  function loadPreferences() {
    try {
      const stored = JSON.parse(localStorage.getItem(storageKey) || '{}');
      return normalize({...defaults, ...stored});
    } catch {
      return {...defaults};
    }
  }

  function normalize(input) {
    return {
      theme: allowed.theme.includes(input.theme) ? input.theme : defaults.theme,
      fontSize: allowed.fontSize.includes(input.fontSize) ? input.fontSize : defaults.fontSize,
      contrast: allowed.contrast.includes(input.contrast) ? input.contrast : defaults.contrast,
      reduceGlow: input.reduceGlow !== false,
      reduceMotion: input.reduceMotion === true
    };
  }

  function resolvedTheme() {
    if (preferences.theme !== 'system') return preferences.theme;
    return systemTheme.matches ? 'light' : 'dark';
  }

  function applyPreferences({persist = false} = {}) {
    const root = document.documentElement;
    const theme = resolvedTheme();
    root.dataset.theme = theme;
    root.dataset.themePreference = preferences.theme;
    root.dataset.brightTheme = String(theme === 'light' || theme === 'comfort');
    root.dataset.fontSize = preferences.fontSize;
    root.dataset.contrast = preferences.contrast;
    root.dataset.reduceGlow = String(preferences.reduceGlow);
    root.dataset.reduceMotion = String(preferences.reduceMotion);
    if (persist) localStorage.setItem(storageKey, JSON.stringify(preferences));
    updateQuickToggle();
    updateSettingsState();
    window.dispatchEvent(new CustomEvent('lingframe:appearance-changed', {detail: {...preferences, resolvedTheme: theme}}));
    window.dispatchEvent(new Event('resize'));
  }

  function updatePreferences(patch) {
    preferences = normalize({...preferences, ...patch});
    applyPreferences({persist: true});
  }

  function themeLabel(theme) {
    return ({system: '跟随系统', dark: '深色', light: '明亮', comfort: '护眼'})[theme] || '主题';
  }

  function themeIcon(theme) {
    return ({dark: '☾', light: '☀', comfort: '◉'})[theme] || '◐';
  }

  function ensureQuickToggle() {
    const titlebar = document.querySelector('.titlebar');
    const windowControls = titlebar?.querySelector('.window');
    if (!titlebar || !windowControls) return;
    let button = titlebar.querySelector('#appearance-quick-toggle');
    if (!button) {
      button = document.createElement('button');
      button.id = 'appearance-quick-toggle';
      button.type = 'button';
      button.className = 'icon appearance-quick-toggle';
      button.addEventListener('click', () => {
        const current = resolvedTheme();
        const sequence = ['dark', 'light', 'comfort'];
        updatePreferences({theme: sequence[(sequence.indexOf(current) + 1) % sequence.length]});
      });
      titlebar.insertBefore(button, windowControls);
    }
    updateQuickToggle();
  }

  function updateQuickToggle() {
    const button = document.querySelector('#appearance-quick-toggle');
    if (!button) return;
    const theme = resolvedTheme();
    button.textContent = themeIcon(theme);
    button.title = `当前：${themeLabel(preferences.theme)}，点击切换主题`;
    button.setAttribute('aria-label', button.title);
    button.dataset.theme = theme;
  }

  function choiceButton(group, value, label, description = '') {
    return `<button type="button" class="appearance-choice" data-appearance-group="${group}" data-appearance-value="${value}"><b>${label}</b>${description ? `<small>${description}</small>` : ''}</button>`;
  }

  function renderSettingsCard() {
    if (!document.querySelector('[data-page="settings"].active')) return;
    const grid = document.querySelector('.settings-grid');
    if (!grid || grid.querySelector('#appearance-settings-card')) return;
    const card = document.createElement('section');
    card.id = 'appearance-settings-card';
    card.className = 'glass setting-card appearance-settings-card';
    card.innerHTML = `
      <div class="appearance-card-head">
        <div><h3>显示与外观</h3><p>调整字号、主题和视觉强度。设置仅保存在当前电脑。</p></div>
        <span>即时生效</span>
      </div>
      <div class="appearance-setting-row">
        <div class="appearance-setting-copy"><b>界面主题</b><small>明亮模式避免纯白，深色模式降低强光，护眼模式适合长时间创作。</small></div>
        <div class="appearance-choice-grid theme-grid">
          ${choiceButton('theme', 'system', '跟随系统', '自动适应')}
          ${choiceButton('theme', 'dark', '深色', '夜间使用')}
          ${choiceButton('theme', 'light', '明亮', '白天使用')}
          ${choiceButton('theme', 'comfort', '护眼', '长时创作')}
        </div>
      </div>
      <div class="appearance-setting-row">
        <div class="appearance-setting-copy"><b>字体大小</b><small>只调整文字体系，不整体缩放页面，避免界面错位。</small></div>
        <div class="appearance-choice-grid font-grid">
          ${choiceButton('fontSize', 'small', '小号')}
          ${choiceButton('fontSize', 'standard', '标准')}
          ${choiceButton('fontSize', 'large', '大号')}
          ${choiceButton('fontSize', 'xlarge', '特大')}
        </div>
      </div>
      <div class="appearance-setting-row">
        <div class="appearance-setting-copy"><b>文字对比度</b><small>柔和模式适合长时间使用，清晰模式适合视力较弱或远距离屏幕。</small></div>
        <div class="appearance-choice-grid contrast-grid">
          ${choiceButton('contrast', 'soft', '柔和')}
          ${choiceButton('contrast', 'standard', '标准')}
          ${choiceButton('contrast', 'clear', '清晰')}
        </div>
      </div>
      <div class="appearance-switch-row">
        <label><input type="checkbox" data-appearance-toggle="reduceGlow"><span><b>减少光晕</b><small>降低蓝紫色发光和大面积阴影。</small></span></label>
        <label><input type="checkbox" data-appearance-toggle="reduceMotion"><span><b>减少动效</b><small>关闭非必要动画和过渡效果。</small></span></label>
      </div>
      <div class="appearance-preview">
        <span class="appearance-preview-mark">灵</span>
        <div><b>灵感，即刻成帧。</b><p>这是当前主题、字号和对比度的实时预览。</p></div>
        <em id="appearance-current-summary"></em>
      </div>
    `;
    grid.appendChild(card);
    card.querySelectorAll('[data-appearance-group]').forEach(button => {
      button.addEventListener('click', () => updatePreferences({[button.dataset.appearanceGroup]: button.dataset.appearanceValue}));
    });
    card.querySelectorAll('[data-appearance-toggle]').forEach(input => {
      input.addEventListener('change', () => updatePreferences({[input.dataset.appearanceToggle]: input.checked}));
    });
    updateSettingsState();
  }

  function updateSettingsState() {
    const card = document.querySelector('#appearance-settings-card');
    if (!card) return;
    card.querySelectorAll('[data-appearance-group]').forEach(button => {
      button.classList.toggle('on', preferences[button.dataset.appearanceGroup] === button.dataset.appearanceValue);
      button.setAttribute('aria-pressed', String(button.classList.contains('on')));
    });
    card.querySelectorAll('[data-appearance-toggle]').forEach(input => {
      input.checked = Boolean(preferences[input.dataset.appearanceToggle]);
    });
    const summary = card.querySelector('#appearance-current-summary');
    if (summary) summary.textContent = `${themeLabel(preferences.theme)} · ${{small:'小号',standard:'标准',large:'大号',xlarge:'特大'}[preferences.fontSize]}字体`;
  }

  function ensureUi() {
    ensureQuickToggle();
    renderSettingsCard();
  }

  systemTheme.addEventListener?.('change', () => {
    if (preferences.theme === 'system') applyPreferences();
  });
  new MutationObserver(ensureUi).observe(document.documentElement, {childList: true, subtree: true});
  window.lingframeAppearance = {
    get: () => ({...preferences, resolvedTheme: resolvedTheme()}),
    set: patch => updatePreferences(patch),
    reset: () => { preferences = {...defaults}; applyPreferences({persist: true}); }
  };
  applyPreferences();
  ensureUi();
})();
