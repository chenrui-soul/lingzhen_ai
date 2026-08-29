(() => {
  const api = window.lingframe;
  const store = window.lingframeAccountStore;
  if (!api || !store) return;

  const style = document.createElement('style');
  style.textContent = `
    .home-compose-fields{grid-template-columns:repeat(3,minmax(150px,1fr))}
    .home-model-status{display:flex;align-items:center;gap:8px;margin-top:9px;padding:8px 10px;border:1px solid rgba(117,154,222,.14);border-radius:9px;background:rgba(5,14,28,.42);color:#8299b8;font-size:9px;line-height:1.45}.home-model-status b{color:#dceafa;font-size:10px}.home-model-status strong{color:#55dcff;font-weight:600}.home-model-status.is-warning{border-color:rgba(255,181,103,.28)}.home-model-status.is-warning strong{color:#ffbf7b}.home-model-status.is-empty{border-color:rgba(117,154,222,.12);color:#7188a8}.home-model-status i{width:7px;height:7px;flex:0 0 7px;border-radius:50%;background:#43dfb5;box-shadow:0 0 8px rgba(67,223,181,.45)}.home-model-status.is-warning i{background:#ffb56b;box-shadow:0 0 8px rgba(255,181,107,.35)}.home-model-status.is-empty i{background:#71809a;box-shadow:none}
    .home-duration-row{display:flex;align-items:center;gap:8px;height:34px;padding:0 9px;border:1px solid rgba(117,154,222,.16);border-radius:8px;background:#09162a}
    .home-duration-row input{min-width:0;flex:1}.home-duration-row output{min-width:28px;color:#55dcff}
    .composer .compose-foot{height:auto;min-height:48px;flex-wrap:wrap}.home-asset-actionbar{display:flex;align-items:center;gap:6px;flex-wrap:wrap}.home-asset-actionbar .ghost{height:32px;padding:0 9px;font-size:9px}.home-asset-actionbar .ghost:hover{border-color:rgba(53,215,255,.42);color:#dff7ff}
    .home-assets{position:relative;z-index:2;margin-top:10px;padding:10px;border:1px solid rgba(92,214,255,.14);border-radius:12px;background:rgba(5,14,28,.5)}
    .home-assets-head{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;color:#8ba2c2;font-size:9px}.home-assets-head b{color:#d8e8fa;font-size:10px}.home-assets-head span{color:#627d9f}
    .home-assets-list{display:flex;gap:8px;overflow-x:auto;padding-bottom:2px}.home-asset-card{position:relative;display:grid;grid-template-columns:44px minmax(90px,1fr);align-items:center;gap:8px;min-width:176px;max-width:230px;height:58px;padding:6px 28px 6px 6px;border:1px solid rgba(117,154,222,.15);border-radius:10px;background:#09162a;color:#dceafa;text-align:left}
    .home-asset-card:hover{border-color:rgba(53,215,255,.42)}.home-asset-thumb{width:44px;height:44px;display:grid;place-items:center;overflow:hidden;border-radius:8px;background:linear-gradient(135deg,rgba(53,215,255,.18),rgba(119,88,244,.2));color:#65e1ff;font-size:10px;font-weight:700}.home-asset-thumb img{width:100%;height:100%;object-fit:cover}.home-asset-copy{min-width:0}.home-asset-copy b,.home-asset-copy small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.home-asset-copy b{font-size:9px}.home-asset-copy small{margin-top:4px;color:#718aaa;font-size:8px}.home-asset-remove{position:absolute;top:5px;right:5px;width:20px;height:20px;padding:0;border:0;border-radius:6px;background:rgba(255,105,130,.1);color:#ff8096;line-height:20px}
    .home-preview{position:fixed;inset:0;z-index:2147483500;display:grid;place-items:center}.home-preview-backdrop{position:absolute;inset:0;background:rgba(1,7,16,.78);backdrop-filter:blur(8px)}.home-preview-dialog{position:relative;width:min(920px,calc(100vw - 48px));max-height:calc(100vh - 48px);display:flex;flex-direction:column;overflow:hidden;border:1px solid rgba(92,214,255,.28);border-radius:16px;background:#081426;box-shadow:0 28px 90px rgba(0,0,0,.58)}
    .home-preview-head{height:56px;display:flex;align-items:center;gap:10px;padding:0 16px;border-bottom:1px solid rgba(117,154,222,.14)}.home-preview-head b{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.home-preview-head span{color:#6f89aa;font-size:9px}.home-preview-head button{margin-left:auto;width:32px;height:32px;border:0;border-radius:8px;background:rgba(117,154,222,.1);color:#b9cbe1}.home-preview-body{min-height:220px;overflow:auto;padding:18px;display:grid;place-items:center}.home-preview-body img{max-width:100%;max-height:calc(100vh - 150px);object-fit:contain;border-radius:10px}.home-preview-body video{width:100%;max-height:calc(100vh - 150px);border-radius:10px;background:#000}.home-preview-body audio{width:min(680px,100%)}.home-preview-body pre{width:100%;min-height:320px;margin:0;padding:18px;overflow:auto;border-radius:10px;background:#050d1a;color:#dceafa;font:12px/1.75 Consolas,"Microsoft YaHei",monospace;white-space:pre-wrap;word-break:break-word}.home-preview-note{width:100%;margin-top:10px;color:#7f98b8;font-size:9px;text-align:left}
    .home-source-dialog{width:min(560px,calc(100vw - 48px))}.home-source-options{display:grid;grid-template-columns:1fr 1fr;gap:12px;width:100%}.home-source-option{min-height:120px;padding:18px;border:1px solid rgba(117,154,222,.18);border-radius:12px;background:rgba(10,24,44,.78);color:#dceafa;text-align:left}.home-source-option:hover{border-color:rgba(53,215,255,.42)}.home-source-option b,.home-source-option span{display:block}.home-source-option b{font-size:13px}.home-source-option span{margin-top:9px;color:#718aaa;font-size:9px;line-height:1.6}
    .home-center-dialog{width:min(900px,calc(100vw - 48px))}.home-center-toolbar{width:100%;display:flex;align-items:center;justify-content:space-between;margin-bottom:10px;color:#718aaa;font-size:9px}.home-center-grid{width:100%;display:grid;grid-template-columns:repeat(4,minmax(140px,1fr));gap:9px;max-height:470px;overflow:auto}.home-center-card{position:relative;min-width:0;min-height:112px;padding:9px;border:1px solid rgba(117,154,222,.15);border-radius:11px;background:#09162a;color:#dceafa;text-align:left}.home-center-card:hover,.home-center-card.selected{border-color:rgba(53,215,255,.5);background:rgba(18,44,70,.88)}.home-center-card.existing{opacity:.58}.home-center-card .home-asset-thumb{width:100%;height:66px}.home-center-card b,.home-center-card small{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.home-center-card b{margin-top:7px;font-size:9px}.home-center-card small{margin-top:3px;color:#718aaa;font-size:8px}.home-center-check{position:absolute;top:6px;right:6px;width:19px;height:19px;display:grid;place-items:center;border-radius:50%;background:rgba(5,13,26,.84);color:#5ee2ff;font-size:10px}.home-center-actions{width:100%;display:flex;justify-content:flex-end;gap:8px;margin-top:13px}.home-center-empty{grid-column:1/-1;padding:44px 20px;text-align:center;color:#718aaa}
    .cards.four .card{cursor:pointer}.cards.four .card:hover{transform:translateY(-2px);border-color:rgba(53,215,255,.3)}
    .lingframe-toast-stack{position:fixed;top:64px;right:22px;z-index:2147483000;display:grid;gap:10px;max-width:min(420px,calc(100vw - 44px));pointer-events:none}.lingframe-toast{display:flex;align-items:flex-start;gap:10px;padding:12px 14px;border:1px solid rgba(80,220,255,.28);border-radius:12px;background:rgba(7,20,39,.96);box-shadow:0 18px 48px rgba(0,0,0,.36);color:#eaf8ff;line-height:1.45;pointer-events:auto;animation:lingframe-toast-in .2s ease-out}.lingframe-toast.success{border-color:rgba(67,232,170,.38)}.lingframe-toast.error{border-color:rgba(255,103,128,.42)}.lingframe-toast b{color:#55dcff;white-space:nowrap}.lingframe-toast.success b{color:#43e8aa}.lingframe-toast.error b{color:#ff7891}@keyframes lingframe-toast-in{from{opacity:0;transform:translateY(-8px)}to{opacity:1;transform:none}}
    .home-assets-list{align-items:stretch}.home-asset-card{display:grid;grid-template-columns:44px minmax(112px,1fr) 22px;grid-template-rows:52px 30px;min-width:248px;max-width:290px;height:92px;padding:5px;border-color:rgba(117,154,222,.18)}.home-asset-preview-button{grid-column:1/3;display:grid;grid-template-columns:44px minmax(90px,1fr);align-items:center;gap:8px;min-width:0;height:52px;padding:4px;border:0;border-radius:8px;background:transparent;color:inherit;text-align:left}.home-asset-preview-button:hover{background:rgba(53,215,255,.06)}.home-asset-card .home-asset-remove{grid-column:3;grid-row:1;position:static;align-self:start}.home-reference-row{grid-column:1/4;display:grid;grid-template-columns:auto minmax(90px,1fr) auto;align-items:center;gap:5px;padding:3px 4px 0;border-top:1px solid rgba(117,154,222,.1)}.home-reference-index{color:#5de0ff;font-size:8px;white-space:nowrap}.home-reference-role{min-width:0;height:25px;padding:0 5px;border:1px solid rgba(117,154,222,.16);border-radius:6px;background:#0c1b31;color:#a9c1df;font-size:8px}.home-reference-edit{height:25px;padding:0 7px;border:1px solid rgba(53,215,255,.18);border-radius:6px;background:rgba(53,215,255,.08);color:#85dff3;font-size:8px}.home-assets-head span strong{color:#ffbe78;font-weight:500}.home-reference-dialog textarea{width:100%;min-height:120px;padding:10px;border:1px solid rgba(117,154,222,.18);border-radius:9px;background:#09162a;color:#e8f3ff;resize:vertical}.home-reference-dialog select{width:100%;height:38px;padding:0 10px;border:1px solid rgba(117,154,222,.18);border-radius:9px;background:#09162a;color:#e8f3ff}.home-reference-preview{margin-top:10px;padding:10px;border-radius:9px;background:rgba(53,215,255,.07);color:#8ec9db;font-size:9px;line-height:1.7}
    @media(max-width:1150px){.home-compose-fields{grid-template-columns:1fr 1fr}.home-center-grid{grid-template-columns:repeat(3,minmax(140px,1fr))}}
  `;
  document.head.appendChild(style);

  const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const MODEL_TYPES=[{value:'text',label:'文本'},{value:'audio',label:'音频'},{value:'image',label:'图片'},{value:'video',label:'视频'}];
  const ASSET_TYPES={text:{label:'文本',icon:'T'},image:{label:'图片',icon:'▧'},video:{label:'视频',icon:'▶'},audio:{label:'音频',icon:'♫'}};
  const REFERENCE_ROLES=[{value:'character',label:'人物/角色'},{value:'scene',label:'场景'},{value:'prop',label:'道具'},{value:'costume',label:'服装'},{value:'pose',label:'姿势/构图'},{value:'style',label:'风格'},{value:'first-frame',label:'首帧'},{value:'last-frame',label:'尾帧'},{value:'other',label:'其他'}];
  const homeState = {projectId:'', targetProjectId:'', assets:[], models:new Map(), catalogModels:new Map(), modelType:''};
  let improving = false;
  let homeParameterPreference = null;

  function toast(message, type='info', timeout=4200) {
    let stack=document.querySelector('.lingframe-toast-stack');
    if(!stack){stack=document.createElement('div');stack.className='lingframe-toast-stack';stack.setAttribute('aria-live','polite');document.body.appendChild(stack);}
    const item=document.createElement('div');item.className=`lingframe-toast ${type}`;item.setAttribute('role','status');
    const label=type==='success'?'已提交':type==='error'?'操作失败':'提示';item.innerHTML=`<b>${label}</b><span>${esc(message)}</span>`;stack.appendChild(item);
    const remove=()=>{item.remove();if(!stack.children.length)stack.remove();};item.addEventListener('click',remove,{once:true});setTimeout(remove,timeout);return item;
  }
  window.lingframeToast = toast;

  function groupOptions() {
    return ['<option value="all">全部账号</option>', ...store.groups().map(group => `<option value="${esc(group.id)}">${esc(group.name)}</option>`)].join('');
  }

  function fillAccounts(composer) {
    const group = composer.querySelector('[data-home-group]')?.value || 'all';
    const select = composer.querySelector('[data-home-account-select]');
    if (!select) return;
    const previous = select.value;
    const accounts = store.accountsForGroup(group);
    const markup = accounts.length ? `<option value="__auto__">自动调度（额度不足自动换号）</option>${accounts.map(item => `<option value="${esc(item.id)}">指定：${esc(item.name)}</option>`).join('')}` : '<option value="">该分组暂无账号</option>';
    if (select.innerHTML !== markup) select.innerHTML = markup;
    if(!select.dataset.autoInitialized&&accounts.length){select.dataset.autoInitialized='1';select.value='__auto__';}
    else if (previous==='__auto__'||accounts.some(item => item.id === previous)) select.value = previous;
  }

  async function refreshHomeContext() {
    const [boot, providers, catalog] = await Promise.all([
      api.workbench.bootstrap(),
      (api.models.executionCatalog?.() || api.models.bootstrap()).catch(() => []),
      (api.models.catalog?.() || api.models.executionCatalog?.() || api.models.bootstrap?.() || Promise.resolve([])).catch(() => [])
    ]);
    const project = (boot.projects || []).find(item => item.id === boot.currentProjectId && !item.deletedAt && !item.archivedAt)
      || (boot.projects || []).find(item => !item.deletedAt && !item.archivedAt);
    const projectId = project?.id || '';
    homeState.projectId = projectId;
    const targetStillExists=(boot.projects||[]).some(item=>item.id===homeState.targetProjectId&&!item.deletedAt&&!item.archivedAt);
    if(!targetStillExists){homeState.targetProjectId=projectId;homeState.assets=[];}
    const chip = document.querySelector('.project');
    if (chip && projectId) chip.dataset.projectId = projectId;
    homeState.models.clear();
    for (const provider of providers || []) {
      for (const model of provider.models || []) {
        homeState.models.set(`${provider.id}::${model.id}`, {provider, model, capabilities:model.capabilities || {}, parameters:model.parameters || {}});
      }
    }
    homeState.catalogModels.clear();
    for (const provider of catalog || []) {
      for (const model of provider.models || []) {
        homeState.catalogModels.set(`${provider.id}::${model.id}`, {provider, model, capabilities:model.capabilities || {}});
      }
    }
    return homeState.targetProjectId||projectId;
  }

  function renderHomeModelStatus(composer) {
    if (!composer) return;
    let node = composer.querySelector('[data-home-model-status]');
    if (!node) {
      node = document.createElement('div');
      node.dataset.homeModelStatus = '';
      const fields = composer.querySelector('.home-compose-fields');
      fields?.insertAdjacentElement('afterend', node);
    }
    const published = homeState.catalogModels.size;
    const executable = homeState.models.size;
    node.className = `home-model-status ${published && !executable ? 'is-warning' : !published ? 'is-empty' : ''}`;
    if (executable) {
      const names = [...homeState.models.values()].map(entry => `${entry.provider?.name || '平台'} / ${entry.model?.displayName || entry.model?.id || '模型'}`).slice(0, 6);
      const suffix = names.length ? `：${names.join('、')}${executable > names.length ? ' 等' : ''}` : '';
      node.innerHTML = `<i aria-hidden="true"></i><span><b>可用模型</b> <strong>${executable}</strong> 个${suffix}${published > executable ? ` · 已发布 ${published} 个` : ''}，切换到“模型网关”后可选择。</span>`;
    } else if (published) {
      node.innerHTML = '<i aria-hidden="true"></i><span><b>模型目录已同步</b>，当前没有可执行模型。请管理员配置对应平台代理后再使用。</span>';
    } else {
      node.innerHTML = '<i aria-hidden="true"></i><span><b>模型目录暂未发布</b>，请先在管理中心发布模型目录。</span>';
    }
  }

  function optionMarkup(values, fallback='自动') {
    const unique=[...new Set((Array.isArray(values)?values:[]).map(value=>String(value||'').trim()).filter(Boolean))];
    if (!unique.length) return `<option value="">${esc(fallback)}</option>`;
    return unique.map(value=>`<option value="${esc(value)}">${esc(value)}</option>`).join('');
  }

  function selectedModel(composer) {
    return homeState.models.get(composer.querySelector('[data-home-model-select]')?.value || '') || null;
  }

  function usableModels(type='') {
    return [...homeState.models.entries()].filter(([,entry]) => entry.provider?.enabled !== false && entry.model?.enabled !== false && entry.model?.hidden !== true && (!type || (entry.capabilities?.type || 'text') === type));
  }

  function filterHomeModels(composer) {
    const typeSelect=composer.querySelector('[data-home-model-type]');
    const modelSelect=composer.querySelector('[data-home-model-select]');
    if(!typeSelect||!modelSelect)return;
    const type=typeSelect.value||'text';homeState.modelType=type;
    const previous=modelSelect.value;const items=usableModels(type);
    const markup=items.length?items.map(([value,entry])=>`<option value="${esc(value)}">${esc(entry.provider.name)} / ${esc(entry.model.displayName)}</option>`).join(''):`<option value="">暂无可用${esc(MODEL_TYPES.find(item=>item.value===type)?.label||'')}模型</option>`;
    if(modelSelect.innerHTML!==markup)modelSelect.innerHTML=markup;
    if(items.some(([value])=>value===previous))modelSelect.value=previous;
    syncGatewayCapabilities(composer);
  }

  function renderModelTypeOptions(composer, initialize=false) {
    const typeSelect=composer.querySelector('[data-home-model-type]');const modelSelect=composer.querySelector('[data-home-model-select]');if(!typeSelect||!modelSelect)return;
    const selectedEntry=homeState.models.get(modelSelect.value);let preferred=homeState.modelType;
    if(initialize&&selectedEntry)preferred=selectedEntry.capabilities?.type||'text';
    if(!MODEL_TYPES.some(item=>item.value===preferred))preferred=MODEL_TYPES.find(item=>usableModels(item.value).length)?.value||'text';
    const markup=MODEL_TYPES.map(item=>`<option value="${item.value}">${item.label}（${usableModels(item.value).length}）</option>`).join('');if(typeSelect.innerHTML!==markup)typeSelect.innerHTML=markup;
    typeSelect.value=preferred;homeState.modelType=preferred;filterHomeModels(composer);
  }

  function syncGatewayCapabilities(composer) {
    const channel = composer.querySelector('[data-home-channel]')?.value || 'doubao';
    const gateway = channel === 'model-gateway';
    for(const selector of ['[data-home-group-wrap]','[data-home-account]','[data-home-doubao-model-wrap]','[data-home-duration-wrap]']){
      const wrap=composer.querySelector(selector);if(wrap)wrap.style.display=gateway?'none':'';
    }
    const modelWrap=composer.querySelector('[data-home-model]');if(modelWrap)modelWrap.style.display=gateway?'':'none';
    const typeWrap=composer.querySelector('[data-home-model-type-wrap]');if(typeWrap)typeWrap.style.display=gateway?'':'none';
    const durationWrap=composer.querySelector('[data-home-gateway-duration-wrap]');
    const resolutionWrap=composer.querySelector('[data-home-gateway-resolution-wrap]');
    const ratioWrap=composer.querySelector('[data-home-ratio-wrap]');
    if (!gateway) {
      if(durationWrap)durationWrap.style.display='none';if(resolutionWrap)resolutionWrap.style.display='none';
      if(ratioWrap)ratioWrap.style.display='';
      const ratioSelect=composer.querySelector('[data-home-ratio]');const prior=ratioSelect?.value||'自动';
      if(ratioSelect){const markup=optionMarkup(['自动','3:4','4:3','9:16','16:9','1:1','21:9']);if(ratioSelect.innerHTML!==markup)ratioSelect.innerHTML=markup;if([...ratioSelect.options].some(option=>option.value===prior))ratioSelect.value=prior;}
      return;
    }
    const entry=selectedModel(composer);const capabilities=entry?.capabilities || {};const modelType=entry?.capabilities?.type||composer.querySelector('[data-home-model-type]')?.value||'text';
    const durations=Array.isArray(capabilities.durations)?capabilities.durations:[];
    const resolutions=Array.isArray(capabilities.resolutions)?capabilities.resolutions:[];
    const durationSelect=composer.querySelector('[data-home-gateway-duration]');
    const resolutionSelect=composer.querySelector('[data-home-gateway-resolution]');
    if(durationSelect){const markup=optionMarkup(durations);if(durationSelect.innerHTML!==markup)durationSelect.innerHTML=markup;const preferred=String(entry?.parameters?.duration||'');if(preferred&&[...durationSelect.options].some(option=>option.value===preferred))durationSelect.value=preferred;}
    if(resolutionSelect){const markup=optionMarkup(resolutions);if(resolutionSelect.innerHTML!==markup)resolutionSelect.innerHTML=markup;const preferred=String(entry?.parameters?.resolution||entry?.parameters?.quality||'');if(preferred&&[...resolutionSelect.options].some(option=>option.value===preferred))resolutionSelect.value=preferred;}
    if(durationWrap)durationWrap.style.display=durations.length?'':'none';
    if(resolutionWrap)resolutionWrap.style.display=resolutions.length?'':'none';
    if(ratioWrap)ratioWrap.style.display=['image','video'].includes(modelType)?'':'none';
    const ratioSelect=composer.querySelector('[data-home-ratio]');
    const ratios=Array.isArray(capabilities.ratios)?capabilities.ratios:[];
    if(ratioSelect&&ratios.length){const prior=ratioSelect.value;const markup=optionMarkup(ratios);if(ratioSelect.innerHTML!==markup)ratioSelect.innerHTML=markup;if([...ratioSelect.options].some(option=>option.value===prior))ratioSelect.value=prior;}
  }

  function assetIcon(asset) {
    if(asset.type==='image')return `<img src="${esc(asset.contentUrl)}" alt="">`;
    if(asset.type==='video')return 'VIDEO';
    if(asset.type==='audio')return 'AUDIO';
    return 'TEXT';
  }

  function inferReferenceRole(asset={}) {
    const text=[asset.name,asset.originalName,asset.notes,...(asset.tags||[])].filter(Boolean).join(' ');
    if(/首帧|第一帧|起始帧/.test(text))return'first-frame';if(/尾帧|末帧|结束帧/.test(text))return'last-frame';if(/场景|环境|建筑|室内|室外|街道|小巷|便利店|房间|背景/.test(text))return'scene';if(/道具|物件|物品|武器|伞|车辆|手机|杯|门|桌|椅/.test(text))return'prop';if(/服装|服饰|衣服|造型|妆容/.test(text))return'costume';if(/姿势|动作|构图|机位|运镜/.test(text))return'pose';if(/风格|色调|画风|质感|光影/.test(text))return'style';if(/人物|角色|男主|女主|男人|女人|男孩|女孩|店员|陌生人|头像|人像/.test(text))return'character';return'other';
  }

  function referenceDescription(asset={}) {
    if(asset.referenceDescription)return asset.referenceDescription;const label=asset.referenceLabel||asset.name||'参考素材';
    return {character:`角色“${label}”的人物外观参考，只参考人物身份、发型、服装和整体造型。`,scene:`场景“${label}”的环境参考，用于空间、建筑、灯光、天气和氛围。`,prop:`道具“${label}”的造型参考，用于外形、颜色、材质和细节。`,costume:`服装“${label}”的造型参考，用于服饰、配色和穿着细节。`,pose:`“${label}”的姿势与构图参考，用于动作、机位和画面布局。`,style:`“${label}”的视觉风格参考，用于画风、色调、光影和质感。`,['first-frame']:`“${label}”作为视频首帧参考，保持起始画面的主体与构图。`,['last-frame']:`“${label}”作为视频尾帧参考，保持结束画面的主体与构图。`,other:`“${label}”作为补充参考图，仅使用与视频内容相关的视觉信息。`}[asset.referenceRole||'other'];
  }

  function decorateReferenceAsset(asset={},prior={}) { const referenceRole=prior.referenceRole||asset.referenceRole||inferReferenceRole(asset);return{...asset,...prior,referenceRole,referenceLabel:prior.referenceLabel||asset.referenceLabel||asset.name||'参考素材',referenceDescription:prior.referenceDescription||asset.referenceDescription||''}; }
  function referenceRoleOptions(selected) { return REFERENCE_ROLES.map(item=>`<option value="${item.value}" ${item.value===selected?'selected':''}>${item.label}</option>`).join(''); }
  function taskReferenceAssets() { return homeState.assets.filter(asset=>asset.type==='image').map((asset,index)=>({assetId:asset.id,role:asset.referenceRole||inferReferenceRole(asset),label:asset.referenceLabel||asset.name,description:referenceDescription(asset),order:index+1})); }

  function renderHomeAssets(composer) {
    let host=composer.querySelector('[data-home-assets]');
    if(!host){host=document.createElement('div');host.dataset.homeAssets='';const fields=composer.querySelector('.home-compose-fields');fields?.insertAdjacentElement('beforebegin',host);}
    host.className='home-assets';
    host.style.display=homeState.assets.length?'':'none';
    const imageCount=homeState.assets.filter(asset=>asset.type==='image').length;let imageIndex=0;
    const markup=homeState.assets.length?`<div class="home-assets-head"><b>本次任务素材 · ${homeState.assets.length}</b><span>图片将按图号上传；<strong>人物图请避免真人肖像</strong></span></div><div class="home-assets-list">${homeState.assets.map(asset=>{const isImage=asset.type==='image',number=isImage?++imageIndex:0;return`<article class="home-asset-card" data-home-asset-card="${esc(asset.id)}"><button class="home-asset-preview-button" data-home-asset-preview="${esc(asset.id)}" title="预览 ${esc(asset.name)}"><span class="home-asset-thumb">${assetIcon(asset)}</span><span class="home-asset-copy"><b>${esc(asset.name)}</b><small>${esc(asset.type.toUpperCase())} · ${Math.max(1,Math.round(Number(asset.size||0)/1024))} KB</small></span></button><button class="home-asset-remove" data-home-asset-remove="${esc(asset.id)}" title="仅从本次任务移除">×</button>${isImage?`<div class="home-reference-row"><span class="home-reference-index">图${number}/${imageCount}</span><select class="home-reference-role" data-home-reference-role="${esc(asset.id)}" title="选择该图片的参考用途">${referenceRoleOptions(asset.referenceRole||inferReferenceRole(asset))}</select><button class="home-reference-edit" data-home-reference-edit="${esc(asset.id)}" title="编辑图${number}说明">说明</button></div>`:`<div class="home-reference-row"><span class="home-reference-index">非图片素材</span><span></span></div>`}</article>`}).join('')}</div>`:'';if(host.innerHTML!==markup)host.innerHTML=markup;
  }

  async function showAssetPreview(assetId) {
    const asset=await api.assets.preview(assetId);
    const host=document.createElement('div');host.className='home-preview';
    let content='';
    if(asset.previewType==='image')content=`<img src="${esc(asset.contentUrl)}" alt="${esc(asset.name)}">`;
    else if(asset.previewType==='video')content=`<video controls autoplay src="${esc(asset.contentUrl)}"></video>`;
    else if(asset.previewType==='audio')content=`<audio controls autoplay src="${esc(asset.contentUrl)}"></audio>`;
    else content=`<pre>${esc(asset.text||'')}</pre>${asset.truncated?'<div class="home-preview-note">文本较大，当前仅预览前 512KB；完整文件仍保存在素材中心。</div>':''}`;
    host.innerHTML=`<div class="home-preview-backdrop" data-home-preview-close></div><section class="home-preview-dialog"><header class="home-preview-head"><b>${esc(asset.name)}</b><span>${esc(asset.type)} · ${Math.max(1,Math.round(Number(asset.size||0)/1024))} KB</span><button data-home-preview-close>×</button></header><div class="home-preview-body">${content}</div></section>`;
    host.addEventListener('click',event=>{if(event.target.closest('[data-home-preview-close]'))host.remove();});
    document.body.appendChild(host);
  }

  function mergeHomeAssets(assets) {
    const merged=new Map(homeState.assets.map(asset=>[asset.id,asset]));for(const asset of assets||[]){const prior=merged.get(asset.id)||{};merged.set(asset.id,decorateReferenceAsset(asset,prior));}
    if(merged.size>10)throw new Error('单个任务最多引用 10 个素材，请先移除不需要的素材');
    homeState.assets=[...merged.values()];
  }

  function showReferenceEditor(composer,assetId) {
    const asset=homeState.assets.find(item=>item.id===assetId);if(!asset)return;const imageOrder=homeState.assets.filter(item=>item.type==='image').findIndex(item=>item.id===assetId)+1;
    const host=document.createElement('div');host.className='home-preview';const currentRole=asset.referenceRole||inferReferenceRole(asset);const currentDescription=referenceDescription(asset);
    host.innerHTML=`<div class="home-preview-backdrop" data-home-reference-close></div><section class="home-preview-dialog home-source-dialog home-reference-dialog"><header class="home-preview-head"><div><b>编辑图${imageOrder}参考说明</b><span>${esc(asset.name)} · 上传顺序和图号会保持一致</span></div><button data-home-reference-close>×</button></header><div class="home-preview-body"><div style="width:100%"><label>参考图用途<select data-home-reference-dialog-role>${referenceRoleOptions(currentRole)}</select></label><label style="display:block;margin-top:12px">给豆包的图片说明<textarea data-home-reference-dialog-description>${esc(currentDescription)}</textarea></label><div class="home-reference-preview">提交时将自动生成：图${imageOrder}（${esc(REFERENCE_ROLES.find(item=>item.value===currentRole)?.label||'其他')}）：${esc(currentDescription)}</div><div class="home-center-actions"><button class="ghost" data-home-reference-close>取消</button><button class="primary" data-home-reference-save>保存说明</button></div></div></div></section>`;
    const role=host.querySelector('[data-home-reference-dialog-role]'),description=host.querySelector('[data-home-reference-dialog-description]'),preview=host.querySelector('.home-reference-preview');const update=()=>{preview.textContent=`提交时将自动生成：图${imageOrder}（${REFERENCE_ROLES.find(item=>item.value===role.value)?.label||'其他'}）：${description.value.trim()||referenceDescription({...asset,referenceRole:role.value,referenceDescription:''})}`};role.onchange=()=>{description.value=referenceDescription({...asset,referenceRole:role.value,referenceDescription:''});update()};description.oninput=update;host.querySelectorAll('[data-home-reference-close]').forEach(button=>button.onclick=()=>host.remove());host.querySelector('[data-home-reference-save]').onclick=()=>{asset.referenceRole=role.value;asset.referenceDescription=description.value.trim().slice(0,500);renderHomeAssets(composer);host.remove();toast(`图${imageOrder}参考说明已更新`,'success')};document.body.appendChild(host);
  }

  async function openAssetPicker(options={}) {
    const boot=await api.workbench.bootstrap();const projects=(boot.projects||[]).filter(item=>!item.deletedAt&&!item.archivedAt);if(!projects.length)throw new Error('当前没有可用项目');
    let sourceProjectId=options.targetProjectId||boot.currentProjectId||projects[0].id;let targetProjectId=options.targetProjectId||boot.currentProjectId||projects[0].id;const allowed=new Set((options.allowedTypes||[]).map(String));const selected=new Set((options.selectedIds||[]).map(String));let visible=[];
    const host=document.createElement('div');host.className='home-preview home-asset-picker';
    host.innerHTML=`<div class="home-preview-backdrop" data-home-picker-cancel></div><section class="home-preview-dialog home-asset-picker-dialog"><header class="home-preview-head"><div><b>${esc(options.title||'选择素材')}</b><span>点击图片只预览；点击“选择素材”才会加入本次任务。</span></div><button data-home-picker-cancel aria-label="关闭">×</button></header><div class="home-asset-picker-toolbar"><label>素材来源项目<select data-home-picker-source>${projects.map(item=>`<option value="${esc(item.id)}" ${item.id===sourceProjectId?'selected':''}>${esc(item.name)}</option>`).join('')}</select></label>${options.targetProjectChangeable?`<label>添加到项目<select data-home-picker-target>${projects.map(item=>`<option value="${esc(item.id)}" ${item.id===targetProjectId?'selected':''}>${esc(item.name)}</option>`).join('')}</select></label>`:''}<span data-home-picker-count>已选择 ${selected.size}/${Number(options.maxCount||10)}</span></div><div class="home-asset-picker-guide"><span><i>⌕</i> 图片区域用于预览</span><span><i>✓</i> 选择按钮用于加入任务</span></div><div class="home-asset-picker-grid" data-home-picker-grid></div><footer class="home-asset-picker-actions"><button class="ghost" data-home-picker-cancel>取消</button><button class="primary" data-home-picker-confirm>添加已选素材</button></footer></section>`;
    document.body.appendChild(host);
    const finish=value=>{host.remove();return value};
    const render=async()=>{visible=(await api.assets.list({projectId:sourceProjectId})).filter(item=>!item.deletedAt&&!item.archivedAt&&(!allowed.size||allowed.has(item.type)));const grid=host.querySelector('[data-home-picker-grid]');grid.innerHTML=visible.length?visible.map(asset=>{const isSelected=selected.has(asset.id);return `<article class="home-asset-picker-card ${isSelected?'selected':''}" data-home-picker-card="${esc(asset.id)}"><button class="home-asset-picker-preview" data-home-picker-preview="${esc(asset.id)}" title="预览 ${esc(asset.name)}">${asset.type==='image'?`<img src="${esc(asset.contentUrl)}" alt="${esc(asset.name)}">`:`<i>${esc(asset.type.toUpperCase())}</i>`}<span>⌕ 预览大图</span></button><div class="home-asset-picker-info"><b title="${esc(asset.name)}">${esc(asset.name)}</b><small>${esc(asset.type.toUpperCase())} · ${Math.max(1,Math.round(Number(asset.size||0)/1024))} KB</small><button class="home-asset-picker-select" data-home-picker-select="${esc(asset.id)}" aria-pressed="${isSelected}"><i aria-hidden="true">${isSelected?'✓':'＋'}</i><span>${isSelected?'已选择':'选择素材'}</span></button></div></article>`}).join(''):'<div class="home-asset-picker-empty">这个项目暂时没有符合类型的素材</div>';host.querySelector('[data-home-picker-count]').textContent=`已选择 ${selected.size}/${Number(options.maxCount||10)}`;};
    await render();
    return new Promise(resolve=>{
      host.querySelectorAll('[data-home-picker-cancel]').forEach(button=>button.onclick=()=>resolve(finish(null)));
      host.querySelector('[data-home-picker-source]').onchange=async event=>{sourceProjectId=event.target.value;await render();};
      host.querySelector('[data-home-picker-target]')?.addEventListener('change',event=>{targetProjectId=event.target.value;});
      host.querySelector('[data-home-picker-grid]').onclick=async event=>{const preview=event.target.closest('[data-home-picker-preview]');if(preview){await showAssetPreview(preview.dataset.homePickerPreview);return;}const button=event.target.closest('[data-home-picker-select]');if(!button)return;const id=button.dataset.homePickerSelect;if(selected.has(id))selected.delete(id);else{if(selected.size>=Number(options.maxCount||10))return toast(`最多选择 ${Number(options.maxCount||10)} 个素材`,'error');selected.add(id);}await render();};
      host.querySelector('[data-home-picker-confirm]').onclick=async()=>{try{const chosen=[];for(const project of projects){const list=await api.assets.list({projectId:project.id});for(const item of list)if(selected.has(item.id))chosen.push(item);}if(!chosen.length)return toast('请至少选择一个素材','error');const foreign=chosen.filter(item=>item.projectId!==targetProjectId),local=chosen.filter(item=>item.projectId===targetProjectId);let copied=[];if(foreign.length){const result=await api.assets.copy({assetIds:foreign.map(item=>item.id),targetProjectId});copied=result.assets||[];}resolve(finish({targetProjectId,assets:[...local,...copied],copiedCount:copied.length}));}catch(error){toast(String(error.message||error),'error',7000);}};
    });
  }

  if(!window.LingframeAssetPicker)window.LingframeAssetPicker={open:openAssetPicker};

  async function showMaterialCenterPicker(composer,type) {
    const projectId=await refreshHomeContext();if(!projectId)throw new Error('请先建立或选择一个有效项目');
    const result=await window.LingframeAssetPicker.open({title:`创作首页 · 添加${ASSET_TYPES[type].label}素材`,targetProjectId:projectId,targetProjectChangeable:true,allowedTypes:[type],maxCount:10,selectedIds:homeState.assets.map(asset=>asset.id)});
    if(!result)return;
    homeState.targetProjectId=result.targetProjectId;
    const prior=new Map(homeState.assets.map(asset=>[asset.id,asset]));homeState.assets=(result.assets||[]).map(asset=>decorateReferenceAsset(asset,prior.get(asset.id)||{}));
    renderHomeAssets(composer);
    toast(`已添加 ${homeState.assets.length} 个${ASSET_TYPES[type].label}素材${result.copiedCount?`，其中 ${result.copiedCount} 个已复制到目标项目`:''}`,'success');
  }

  function showAssetSourceChooser(composer,type) {
    const meta=ASSET_TYPES[type];if(!meta)return;
    const host=document.createElement('div');host.className='home-preview';
    host.innerHTML=`<div class="home-preview-backdrop" data-home-source-close></div><section class="home-preview-dialog home-source-dialog"><header class="home-preview-head"><b>添加${esc(meta.label)}素材</b><span>选择素材来源</span><button data-home-source-close>×</button></header><div class="home-preview-body"><div class="home-source-options"><button class="home-source-option" data-home-source="local"><b>从本地导入</b><span>选择客户电脑上的${esc(meta.label)}文件，导入后自动保存到当前项目素材中心。</span></button><button class="home-source-option" data-home-source="center"><b>从素材中心选择</b><span>选择当前项目已经保存的${esc(meta.label)}素材，只建立本次任务引用。</span></button></div></div></section>`;
    host.addEventListener('click',async event=>{try{if(event.target.closest('[data-home-source-close]')){host.remove();return;}const source=event.target.closest('[data-home-source]')?.dataset.homeSource;if(!source)return;host.remove();if(source==='local')await importHomeAssets(composer,type);else await showMaterialCenterPicker(composer,type);}catch(error){toast(String(error.message||error),'error',7000);}});
    document.body.appendChild(host);
  }

  async function importHomeAssets(composer,type) {
    const projectId=await refreshHomeContext();
    if(!projectId)throw new Error('请先建立或选择一个有效项目');
    const imported=await api.assets.pickImport({projectId,type});
    if(!imported?.length)return;
    if(imported.some(asset=>asset.type!==type))throw new Error('导入结果与选择的素材类型不一致');
    mergeHomeAssets(imported);
    renderHomeAssets(composer);
    toast(`已导入 ${imported.length} 个${ASSET_TYPES[type].label}素材并保存到当前项目素材中心`,'success');
  }

  function decoratePromptEditor(composer) {
    const input=composer?.querySelector('[data-home-prompt]');
    if(!input)return;
    let editor=input.closest('[data-home-prompt-editor]');
    if(!editor){
      editor=document.createElement('section');
      editor.className='home-prompt-editor';
      editor.dataset.homePromptEditor='';
      editor.innerHTML='<header class="home-prompt-editor-head"><div class="home-prompt-editor-title"><span aria-hidden="true">✦</span><div><b>创作提示词</b><small>写清主体、场景、镜头与氛围，生成结果会更稳定</small></div></div><div class="home-prompt-editor-tools"><span class="home-prompt-count" data-home-prompt-count>0 字</span><button type="button" data-home-prompt-toggle aria-expanded="false">展开编辑</button><button type="button" data-home-prompt-clear disabled>清空</button></div></header><div class="home-prompt-editor-body"></div><footer><span>内容会自动保存到当前创作对话</span><span>Enter 换行</span></footer>';
      input.insertAdjacentElement('beforebegin',editor);
      editor.querySelector('.home-prompt-editor-body')?.appendChild(input);
    }
    if(input.dataset.homePromptEditorBound)return;
    input.dataset.homePromptEditorBound='1';
    input.setAttribute('aria-label','创作提示词');
    const count=editor.querySelector('[data-home-prompt-count]');
    const clear=editor.querySelector('[data-home-prompt-clear]');
    const toggle=editor.querySelector('[data-home-prompt-toggle]');
    const sync=()=>{
      const length=[...input.value].length;
      if(count)count.textContent=`${length.toLocaleString('zh-CN')} 字`;
      if(clear)clear.disabled=!length;
      input.style.height='auto';
      const maxHeight=editor.classList.contains('is-expanded')?360:176;
      input.style.height=`${Math.max(112,Math.min(input.scrollHeight,maxHeight))}px`;
      input.classList.toggle('has-content',length>0);
    };
    input.addEventListener('input',sync);
    input.addEventListener('lingframe:prompt-value-changed',sync);
    input.addEventListener('focus',()=>editor.classList.add('is-focused'));
    input.addEventListener('blur',()=>editor.classList.remove('is-focused'));
    toggle?.addEventListener('click',()=>{
      const expanded=editor.classList.toggle('is-expanded');
      toggle.textContent=expanded?'收起':'展开编辑';
      toggle.setAttribute('aria-expanded',String(expanded));
      sync();
      input.focus();
    });
    clear?.addEventListener('click',()=>{
      if(!input.value)return;
      input.value='';
      input.dispatchEvent(new Event('input',{bubbles:true}));
      input.focus();
    });
    sync();
  }

  function syncHomeComposerDensity(composer=document.querySelector('.home-chat-shell .home-chat-composer')) {
    if(!composer)return;
    const foot=composer.querySelector('.compose-foot');
    if(!foot)return;
    let toggle=foot.querySelector('[data-home-parameters-toggle]');
    if(!toggle){
      toggle=document.createElement('button');
      toggle.type='button';
      toggle.className='ghost home-parameters-toggle';
      toggle.dataset.homeParametersToggle='';
      const hint=foot.querySelector('.home-hint');
      foot.insertBefore(toggle,hint||foot.querySelector('[data-home-submit]')||null);
      toggle.addEventListener('click',()=>{
        homeParameterPreference=!composer.classList.contains('is-parameters-collapsed');
        syncHomeComposerDensity(composer);
      });
    }
    const availableWidth=composer.getBoundingClientRect().width||window.innerWidth;
    const compactViewport=window.innerHeight<=900||availableWidth<=820;
    const collapsed=homeParameterPreference===null?compactViewport:homeParameterPreference;
    composer.classList.toggle('is-parameters-collapsed',collapsed);
    toggle.textContent=collapsed?'展开参数':'收起参数';
    toggle.setAttribute('aria-expanded',String(!collapsed));
    toggle.setAttribute('aria-controls','home-compose-parameters');
    const fields=composer.querySelector('.home-compose-fields');
    if(fields)fields.id='home-compose-parameters';
  }

  async function improveHome() {
    const composer = document.querySelector('.composer');
    if (!composer || improving) return;
    improving = true;
    try {
      await Promise.all([store.ready, refreshHomeContext()]);
      const head = document.querySelector('.page-head h1');
      const sub = document.querySelector('.page-head p');
      if (head) head.textContent = '创作首页';
      if (sub) sub.textContent = '开始新创作，或继续最近的项目与会话。';
      const hero = composer.querySelector('.home-hero-copy');
      if (hero) {
        const kicker = hero.querySelector('.home-kicker');
        const title = hero.querySelector('h2');
        const description = hero.querySelector('p');
        if (kicker) kicker.textContent = '快速创作';
        if (title) title.textContent = '今天想创作什么？';
        if (description) description.textContent = '描述你的想法，选择执行通道后直接开始。';
      }
      decoratePromptEditor(composer);
      const originalAttach=composer.querySelector('[data-home-attach]');
      if(originalAttach)originalAttach.outerHTML=`<div class="home-asset-actionbar" data-home-asset-buttons>${Object.entries(ASSET_TYPES).map(([type,item])=>`<button class="ghost" data-home-asset-add="${type}">${item.icon} 添加${item.label}</button>`).join('')}</div>`;
      const fields = composer.querySelector('.home-compose-fields');
      if (fields && !fields.querySelector('[data-home-doubao-model]')) {
        const ratio=fields.querySelector('[data-home-ratio]')?.closest('label');
        if(ratio)ratio.dataset.homeRatioWrap='';
        ratio?.insertAdjacentHTML('beforebegin','<label data-home-doubao-model-wrap>豆包模型<select data-home-doubao-model><option value="Seedance 2.0 Fast">Seedance 2.0 Fast</option><option value="Seedance 2.0 Mini" selected>Seedance 2.0 Mini</option></select></label>');
        if(ratio){ratio.innerHTML='<span>画面比例</span><select data-home-ratio><option value="自动">自动</option><option value="3:4">3:4</option><option value="4:3">4:3</option><option value="9:16">9:16</option><option value="16:9">16:9</option><option value="1:1">1:1</option><option value="21:9">21:9</option></select>';ratio.insertAdjacentHTML('afterend','<label data-home-duration-wrap>视频时长<div class="home-duration-row"><input type="range" min="4" max="15" step="1" value="10" data-home-duration><output data-home-duration-output>10s</output></div></label><label data-home-gateway-duration-wrap style="display:none">视频时长<select data-home-gateway-duration></select></label><label data-home-gateway-resolution-wrap style="display:none">清晰度<select data-home-gateway-resolution></select></label>');const duration=fields.querySelector('[data-home-duration]'),output=fields.querySelector('[data-home-duration-output]');duration?.addEventListener('input',()=>{if(output)output.textContent=`${duration.value}s`});}
      }
      if (fields && !fields.querySelector('[data-home-group]')) {
        const account = fields.querySelector('[data-home-account]');
        account?.insertAdjacentHTML('beforebegin', `<label data-home-group-wrap>账号分组<select data-home-group>${groupOptions()}</select></label>`);
        fields.querySelector('[data-home-group]')?.addEventListener('change', () => fillAccounts(composer));
      }
      if(fields&&!fields.querySelector('[data-home-model-type]')){const modelWrap=fields.querySelector('[data-home-model]');modelWrap?.insertAdjacentHTML('beforebegin','<label data-home-model-type-wrap style="display:none">模型类型<select data-home-model-type></select></label>');}
      const groupSelect = fields?.querySelector('[data-home-group]');
      if (groupSelect) { const current=groupSelect.value||'all';const markup=groupOptions();if(groupSelect.innerHTML!==markup)groupSelect.innerHTML=markup;if([...groupSelect.options].some(option=>option.value===current))groupSelect.value=current; }
      const channel = composer.querySelector('[data-home-channel]');
      if (channel && !channel.dataset.homeCapabilityBound) {channel.dataset.homeCapabilityBound='1';channel.addEventListener('change',()=>syncGatewayCapabilities(composer));}
      const modelSelect=composer.querySelector('[data-home-model-select]');
      if(modelSelect&&!modelSelect.dataset.homeCapabilityBound){modelSelect.dataset.homeCapabilityBound='1';modelSelect.addEventListener('change',()=>syncGatewayCapabilities(composer));}
      const modelTypeSelect=composer.querySelector('[data-home-model-type]');
      if(modelTypeSelect&&!modelTypeSelect.dataset.homeTypeBound){modelTypeSelect.dataset.homeTypeBound='1';modelTypeSelect.addEventListener('change',()=>filterHomeModels(composer));}
      fillAccounts(composer);
      renderHomeModelStatus(composer);
      renderModelTypeOptions(composer,true);
      renderHomeAssets(composer);
      syncGatewayCapabilities(composer);
      syncHomeComposerDensity(composer);
      document.querySelectorAll('.cards.four .card').forEach(card => {
        if (card.dataset.homeWorkflowBound) return;
        card.dataset.homeWorkflowBound = '1';
        card.addEventListener('click', () => {
          const text = card.innerText || '';
          if (text.includes('无限画布')) document.querySelector('[data-page="canvas"]')?.click();
          else if (text.includes('短剧生产')) document.querySelector('[data-page="template"]')?.click();
          else {composer.dataset.homeWorkflow = text.includes('图生视频') ? 'image-to-video' : 'text-to-video';composer.querySelector('[data-home-prompt]')?.focus();}
        });
      });
    } catch (error) { console.error('home enhancement failed', error); }
    finally { improving = false; }
  }

  document.addEventListener('click', async event => {
    const newConversation=event.target.closest('[data-home-chat-new]');
    if(newConversation){
      // 新对话不继承上一条对话的临时素材；任务快照仍会保留已提交任务的素材绑定。
      homeState.assets=[];
      const composer=newConversation.closest('.home-chat-shell')?.querySelector('.composer')||document.querySelector('.home-chat-shell .composer,.workspace > .composer');
      if(composer)renderHomeAssets(composer);
      return;
    }
    const assetAdd=event.target.closest('[data-home-asset-add]');
    if(assetAdd){event.preventDefault();event.stopImmediatePropagation();showAssetSourceChooser(assetAdd.closest('.composer'),assetAdd.dataset.homeAssetAdd);return;}
    const remove=event.target.closest('[data-home-asset-remove]');
    if(remove){event.preventDefault();event.stopImmediatePropagation();homeState.assets=homeState.assets.filter(asset=>asset.id!==remove.dataset.homeAssetRemove);renderHomeAssets(remove.closest('.composer'));toast('已从本次任务移除，素材中心中的原文件仍然保留');return;}
    const preview=event.target.closest('[data-home-asset-preview]');
    if(preview){event.preventDefault();event.stopImmediatePropagation();try{await showAssetPreview(preview.dataset.homeAssetPreview);}catch(error){toast(String(error.message||error),'error');}return;}
    const referenceEdit=event.target.closest('[data-home-reference-edit]');
    if(referenceEdit){event.preventDefault();event.stopImmediatePropagation();showReferenceEditor(referenceEdit.closest('.composer'),referenceEdit.dataset.homeReferenceEdit);return;}
    const button = event.target.closest('[data-home-submit]');
    if (!button) return;
    event.preventDefault();event.stopImmediatePropagation();
    const composer = button.closest('.composer');
    const prompt = composer?.querySelector('[data-home-prompt]')?.value.trim();
    if (!prompt) return toast('请先输入创作内容');
    const channel = composer.querySelector('[data-home-channel]')?.value || 'doubao';
    button.disabled = true;const originalText=button.textContent;
    try {
      const projectId=await refreshHomeContext();
      if(!projectId)throw new Error('请先建立或选择一个有效项目');
      const gatewayType=composer.querySelector('[data-home-model-type]')?.value||'video';const ratioVisible=composer.querySelector('[data-home-ratio-wrap]')?.style.display!=='none';
      const input = {title:prompt.slice(0,36),prompt,projectId,creationType:channel==='model-gateway'?gatewayType:'video',creationSource:'home',executionChannel:channel,ratio:ratioVisible?(composer.querySelector('[data-home-ratio]')?.value || '自动'):'',assetIds:homeState.assets.map(asset=>asset.id),referenceAssets:taskReferenceAssets(),workflowType:channel==='model-gateway'?(gatewayType==='video'?(composer.dataset.homeWorkflow||'text-to-video'):gatewayType==='image'?'text-to-image':gatewayType==='audio'?'text-to-audio':'text-generation'):(composer.dataset.homeWorkflow || 'text-to-video')};
      if (channel === 'doubao') {
        input.duration=`${composer.querySelector('[data-home-duration]')?.value || '10'}s`;
        input.doubaoModel=composer.querySelector('[data-home-doubao-model]')?.value || 'Seedance 2.0 Mini';
        const groupId = composer.querySelector('[data-home-group]')?.value || 'all';const accountId = composer.querySelector('[data-home-account-select]')?.value;const pool = store.accountsForGroup(groupId);const account = accountId==='__auto__'?pool[0]:pool.find(item => item.id === accountId);
        if (!account) throw new Error('当前分组没有可用账号，请先切换分组或配置账号');
        input.accountGroupId=groupId;input.accountId=account.id;input.accountName=account.name;input.accountSelectionMode=accountId==='__auto__'?'auto':'manual';input.accountCandidates=(accountId==='__auto__'?pool:[account]).map(item=>({id:item.id,name:item.name,platform:'豆包'}));
      } else {
        const selected = composer.querySelector('[data-home-model-select]')?.value || '';const [providerId,...parts] = selected.split('::');if (!providerId || !parts.length) throw new Error(`当前“${MODEL_TYPES.find(item=>item.value===gatewayType)?.label||''}”分类没有可用模型，请先在系统设置配置或修改模型分类`);
        input.providerId=providerId;input.modelId=parts.join('::');
        const duration=composer.querySelector('[data-home-gateway-duration-wrap]')?.style.display!=='none'?composer.querySelector('[data-home-gateway-duration]')?.value:'';
        const resolution=composer.querySelector('[data-home-gateway-resolution-wrap]')?.style.display!=='none'?composer.querySelector('[data-home-gateway-resolution]')?.value:'';
        input.duration=duration||'';input.resolution=resolution||'';input.parameters={};if(input.ratio&&input.ratio!=='自动')input.parameters.ratio=input.ratio;if(duration)input.parameters.duration=duration;if(resolution)input.parameters.resolution=resolution;
      }
      const task = await api.generation.create(input);
      window.dispatchEvent(new CustomEvent('lingframe:home-task-created',{detail:{task,prompt,projectId,assetIds:input.assetIds.slice()}}));
      const promptInput=composer.querySelector('[data-home-prompt]');
      promptInput.value='';
      promptInput.dispatchEvent(new Event('input',{bubbles:true}));
      button.textContent='✓ 已提交';
      toast(`任务“${task.title}”已进入任务中心；${input.assetIds.length?`已绑定 ${input.assetIds.length} 个素材。`:'你可以继续操作其他模块。'}`,'success');
    } catch (error) { toast(String(error.message || error),'error',7000); }
    finally { setTimeout(()=>{button.disabled=false;button.textContent=originalText;},900); }
  }, true);

  document.addEventListener('change',event=>{const select=event.target.closest('[data-home-reference-role]');if(!select)return;const asset=homeState.assets.find(item=>item.id===select.dataset.homeReferenceRole);if(!asset)return;asset.referenceRole=select.value;asset.referenceDescription='';renderHomeAssets(select.closest('.composer'));toast(`${asset.name} 已标记为${REFERENCE_ROLES.find(item=>item.value===select.value)?.label||'其他'}参考`,'success');});

  let observedHomeComposer = null;
  const observer = new MutationObserver(() => {
    const composer=document.querySelector('.composer');
    if(!composer||composer===observedHomeComposer)return;
    observedHomeComposer=composer;
    queueMicrotask(improveHome);
  });
  observer.observe(document.querySelector('#root') || document.body, {childList:true, subtree:true});
  window.addEventListener('lingframe:account-store-ready', improveHome);
  window.addEventListener('lingframe:account-profiles-changed', improveHome);
  window.addEventListener('lingframe:account-groups-changed', improveHome);
  window.addEventListener('lingframe:model-catalog-changed', improveHome);
  window.addEventListener('resize',()=>requestAnimationFrame(()=>syncHomeComposerDensity()));
  window.addEventListener('lingframe:generation-status', async event => {
    const detail=event.detail||{};
    if(detail.creationSource!=='home'||detail.state!=='completed'||!detail.resultAssetId)return;
    try{
      const assets=await api.assets.list({projectId:detail.projectId||homeState.targetProjectId||homeState.projectId});
      const result=assets.find(item=>item.id===detail.resultAssetId);if(!result)return;
      mergeHomeAssets([result]);const composer=document.querySelector('.home-chat-shell .composer,.workspace > .composer');if(composer)renderHomeAssets(composer);
      toast(`“${detail.title||'生成任务'}”已回传创作首页，并保存到素材中心`,'success',5000);
    }catch(error){console.error('home result asset sync failed',error);}
  });
  improveHome();
})();
