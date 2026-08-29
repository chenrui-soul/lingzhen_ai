(() => {
  const api = window.lingframe?.models;
  if (!api) return;
  let providers = [], selectedId = "", busy = false;
  const MODEL_TYPES = [{value:'text',label:'文本'},{value:'audio',label:'音频'},{value:'image',label:'图片'},{value:'video',label:'视频'}];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const selected = () => providers.find(item => item.id === selectedId) || providers[0] || null;
  function parseJson(value, fallback) { if (!String(value || '').trim()) return fallback; try { return JSON.parse(value); } catch { throw new Error('JSON 格式不正确'); } }
  function typeOptions(selectedType='text') { return MODEL_TYPES.map(item => `<option value="${item.value}" ${item.value===selectedType?'selected':''}>${item.label}</option>`).join(''); }
  function message(value, error = false) { const node = document.querySelector('#model-message'); if (node) { node.textContent = value || ''; node.className = `model-message${error ? ' error' : ''}`; } }
  function enhanceModelRows(provider) {
    if (!provider) return;
    document.querySelectorAll('.model-row').forEach(row => {
      const model = provider.models.find(item => item.id === row.dataset.modelId);
      if (!model) return;
      const identity = row.firstElementChild;
      if (identity && !row.querySelector('[data-model-name]')) {
        const field = document.createElement('label');
        field.className = 'model-field model-name-field';
        field.innerHTML = `<span>显示名称<small>${esc(model.id)}</small></span><input data-model-name value="${esc(model.displayName || model.id)}" placeholder="显示名称">`;
        identity.replaceWith(field);
      }
      const chip = row.querySelector('.model-chip');
      if (chip) {
        const field = document.createElement('label');
        field.className = 'model-field';
        field.innerHTML = `模型分类<select data-model-type>${typeOptions(model.capabilities?.type || 'text')}</select>`;
        chip.replaceWith(field);
      }
    });
  }
  function bindEditableModelSaves() {
    document.querySelectorAll('.model-row').forEach(row => {
      const modelId = row.dataset.modelId;
      row.querySelector('[data-model-save]').onclick = () => run(async () => {
        await api.updateModel(selectedId, modelId, {displayName:row.querySelector('[data-model-name]').value.trim(),parameters:parseJson(row.querySelector('[data-model-parameters]').value,{}),capabilities:{type:row.querySelector('[data-model-type]').value,confirmed:true,source:'manual'}});
        await load();
      }, '模型名称、分类和参数已保存');
    });
  }
  async function load() { providers = await api.bootstrap(); if (!selectedId || !providers.some(item => item.id === selectedId)) selectedId = providers[0]?.id || ''; render(); }
  function providerForm(provider = {}) {
    return `<div class="model-form-grid"><label class="model-field">厂商名称<input id="mg-name" value="${esc(provider.name || '')}" placeholder="自定义名称"></label><label class="model-field">协议<select id="mg-protocol"><option value="openai-compatible">OpenAI Compatible</option><option value="openai-responses">OpenAI Responses</option><option value="anthropic-compatible">Anthropic Compatible</option><option value="custom-json">Custom JSON</option></select></label><label class="model-field">并发数<input id="mg-concurrency" type="number" min="1" max="64" value="${esc(provider.concurrency || 1)}"></label><label class="model-field wide">API Base URL<input id="mg-base-url" value="${esc(provider.baseUrl || '')}" placeholder="https://api.example.com"></label><label class="model-field">超时（秒）<input id="mg-timeout" type="number" min="5" max="600" value="${esc(provider.timeoutSeconds || 60)}"></label><label class="model-field">模型列表路径<input id="mg-models-path" value="${esc(provider.modelsPath || '/v1/models')}"></label><label class="model-field">对话路径<input id="mg-chat-path" value="${esc(provider.chatPath || '/v1/chat/completions')}"></label><label class="model-field">Responses 路径<input id="mg-responses-path" value="${esc(provider.responsesPath || '/v1/responses')}"></label><label class="model-field">图片生成路径<input id="mg-images-path" value="${esc(provider.imagesPath || '/v1/images/generations')}"></label><label class="model-field">视频生成路径<input id="mg-videos-path" value="${esc(provider.videosPath || '/v1/videos/generations')}"></label><label class="model-field">音频生成路径<input id="mg-audios-path" value="${esc(provider.audiosPath || '/v1/audio/generations')}"></label><label class="model-field wide">API Key<input id="mg-api-key" type="password" autocomplete="new-password" placeholder="${provider.hasApiKey ? '已加密保存；留空保持不变' : '输入厂商密钥'}"><span class="model-secret-note">${provider.hasApiKey ? `已保存：${provider.apiKeyMask}` : '密钥仅在本机租户加密区保存'}</span></label><label class="model-field">状态<select id="mg-enabled"><option value="true">启用</option><option value="false">停用</option></select></label><label class="model-field full">自定义请求头（JSON；值同样加密保存）<textarea id="mg-headers" placeholder='{"X-Region":"cn"}'></textarea><span class="model-secret-note">${provider.customHeaderNames?.length ? `已保存请求头：${esc(provider.customHeaderNames.join('、'))}；留空保持不变` : '可选；不会回填已保存的请求头值'}</span></label></div>`;
  }
  function render() {
    if (!document.querySelector('[data-page="settings"].active')) return;
    const grid = document.querySelector('.settings-grid'); if (!grid) return;
    let host = document.querySelector('#model-gateway-card'); if (!host) { host = document.createElement('section'); host.id = 'model-gateway-card'; host.className = 'glass setting-card model-gateway-card'; grid.appendChild(host); }
    const provider = selected();
    host.innerHTML = `<div class="model-gateway-head"><div><h3>自定义模型网关</h3><p>厂商、密钥、模型能力与参数按当前租户独立保存，统一供文本、任务、画布和短剧模板调用。</p></div><button class="primary" id="mg-new">新增厂商</button></div><div class="model-gateway-layout"><aside class="model-provider-rail"><b>模型厂商 · ${providers.length}</b><div class="model-provider-list">${providers.map(item => `<button class="model-provider-item ${item.id === provider?.id ? 'active' : ''}" data-provider-id="${esc(item.id)}"><span><b>${esc(item.name)}</b><small>${esc(item.protocol)} · ${item.models.length} 个模型</small></span><i class="model-status-dot ${esc(item.status)}"></i></button>`).join('') || '<div class="model-empty">尚未添加厂商</div>'}</div></aside><main class="model-provider-editor">${provider ? `${providerForm(provider)}<div class="model-actions"><button class="primary" id="mg-save">保存配置</button><button class="ghost" id="mg-test">测试连接</button><button class="ghost" id="mg-discover">自动获取模型</button><button class="ghost" id="mg-delete">删除厂商</button></div><div id="model-message" class="model-message">${esc(provider.statusText || '配置修改后请测试连接')}</div><div class="model-list-head"><h4>模型与能力参数</h4></div><div class="model-inline"><input id="mg-model-id" placeholder="模型 ID"><input id="mg-model-name" placeholder="显示名称"><select id="mg-model-type"><option value="text">文本</option><option value="image">图片</option><option value="video">视频</option><option value="audio">音频</option></select><button class="ghost" id="mg-add-model">手动添加</button></div><div class="model-list">${provider.models.map(model => `<div class="model-row" data-model-id="${esc(model.id)}"><span><b>${esc(model.displayName)}</b><small>${esc(model.id)}</small></span><span class="model-chip">${esc(model.capabilities?.type || 'text')}</span><label class="model-field">参数 JSON<input data-model-parameters value="${esc(JSON.stringify(model.parameters || {}))}"></label><span class="model-row-actions"><button class="ghost" data-model-toggle>${model.enabled ? '停用' : '启用'}</button><button class="ghost" data-model-save>保存</button><button class="ghost" data-model-delete>删除</button></span></div>`).join('') || '<div class="model-empty">可自动获取或手动添加模型</div>'}</div>` : '<div class="model-empty"><b>建立第一个模型厂商</b><p>完全自定义地址、协议、密钥、模型和生成参数。</p></div>'}</main></div>`;
    enhanceModelRows(provider);
    if (provider) { document.querySelector('#mg-protocol').value = provider.protocol; document.querySelector('#mg-enabled').value = String(provider.enabled); }
    bind();
    bindEditableModelSaves();
  }
  function formInput(existing) { const headerText = document.querySelector('#mg-headers').value; return {name: document.querySelector('#mg-name').value, protocol: document.querySelector('#mg-protocol').value, baseUrl: document.querySelector('#mg-base-url').value, modelsPath: document.querySelector('#mg-models-path').value, chatPath: document.querySelector('#mg-chat-path').value, responsesPath: document.querySelector('#mg-responses-path').value, imagesPath:document.querySelector('#mg-images-path').value, videosPath:document.querySelector('#mg-videos-path').value, audiosPath:document.querySelector('#mg-audios-path').value, concurrency: Number(document.querySelector('#mg-concurrency').value), timeoutSeconds: Number(document.querySelector('#mg-timeout').value), enabled: document.querySelector('#mg-enabled').value === 'true', ...(headerText.trim() ? {customHeaders: parseJson(headerText, {})} : existing ? {} : {customHeaders: {}}), ...(document.querySelector('#mg-api-key').value ? {apiKey: document.querySelector('#mg-api-key').value} : existing ? {} : {apiKey: ''})}; }
  function bind() {
    document.querySelectorAll('[data-provider-id]').forEach(node => node.onclick = () => { selectedId = node.dataset.providerId; render(); });
    document.querySelector('#mg-new')?.addEventListener('click', async () => { if (busy) return; const main = document.querySelector('.model-provider-editor'); main.innerHTML = `${providerForm({})}<div class="model-actions"><button class="primary" id="mg-create">创建厂商</button><button class="ghost" id="mg-cancel">取消</button></div><div id="model-message" class="model-message"></div>`; document.querySelector('#mg-create').onclick = async () => run(async () => { const value = await api.createProvider(formInput(false)); selectedId = value.id; await load(); }, '厂商已创建'); document.querySelector('#mg-cancel').onclick = render; });
    document.querySelector('#mg-save')?.addEventListener('click', () => run(async () => { await api.updateProvider(selectedId, formInput(true)); await load(); }, '配置已保存'));
    document.querySelector('#mg-test')?.addEventListener('click', () => run(async () => { const result = await api.testProvider(selectedId); await load(); if (!result.ok) throw new Error(result.statusText); }, '连接成功'));
    document.querySelector('#mg-discover')?.addEventListener('click', () => run(async () => { await api.discover(selectedId); await load(); }, '模型列表已更新'));
    document.querySelector('#mg-delete')?.addEventListener('click', () => { if (confirm('删除厂商会同时删除本机加密密钥，是否继续？')) run(async () => { await api.deleteProvider(selectedId); selectedId = ''; await load(); }, '厂商已删除'); });
    document.querySelector('#mg-add-model')?.addEventListener('click', () => run(async () => { const modelId = document.querySelector('#mg-model-id').value.trim(); await api.addModel(selectedId, {id: modelId, displayName: document.querySelector('#mg-model-name').value.trim() || modelId, capabilities: {type: document.querySelector('#mg-model-type').value, confirmed: true, source: 'manual'}}); await load(); }, '模型已添加'));
    document.querySelectorAll('.model-row').forEach(row => { const modelId = row.dataset.modelId; const model = selected()?.models.find(item => item.id === modelId); row.querySelector('[data-model-toggle]').onclick = () => run(async () => { await api.updateModel(selectedId, modelId, {enabled: !model.enabled}); await load(); }, '模型状态已更新'); row.querySelector('[data-model-save]').onclick = () => run(async () => { await api.updateModel(selectedId, modelId, {parameters: parseJson(row.querySelector('[data-model-parameters]').value, {})}); await load(); }, '模型参数已保存'); row.querySelector('[data-model-delete]').onclick = () => run(async () => { await api.deleteModel(selectedId, modelId); await load(); }, '模型已删除'); });
  }
  async function run(action, success) { if (busy) return; busy = true; message('处理中…'); try { await action(); message(success); } catch (error) { message(String(error.message || error), true); } finally { busy = false; } }
  document.addEventListener('click', event => { if (event.target.closest('[data-page="settings"]')) setTimeout(() => load().catch(error => message(String(error.message || error), true)), 100); });
  new MutationObserver(() => { if (document.querySelector('[data-page="settings"].active') && document.querySelector('.settings-grid') && !document.querySelector('#model-gateway-card')) load().catch(() => {}); }).observe(document.body, {childList: true, subtree: true});
})();
