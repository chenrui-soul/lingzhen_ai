(function(){
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=cents=>`¥${(Number(cents||0)/100).toFixed(2)}`;
  const number=value=>new Intl.NumberFormat('zh-CN').format(Number(value||0));
  const date=value=>{if(!value)return'—';const d=new Date(value);return Number.isNaN(d.getTime())?'—':d.toLocaleString('zh-CN',{month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});};
  const statusLabel={manual_review:'等待人工核对',paid:'已到账',rejected:'已驳回',closed:'已取消',pending:'待处理'};
  const statusTone={manual_review:'warning',paid:'success',rejected:'danger',closed:'muted',pending:'warning'};
  let refreshTimer=null,selectedPackage=null,submitting=false;
  const toast=(text,tone='info')=>window.lingframeToast?.(text,tone);
  const stopPolling=()=>{if(refreshTimer){clearInterval(refreshTimer);refreshTimer=null;}};
  const closeModal=()=>{document.querySelector('[data-credits-modal]')?.remove();selectedPackage=null;submitting=false;};
  function openRechargeModal(packages){
    if(document.querySelector('[data-credits-modal]'))return;
    const host=document.createElement('div');host.className='pm-modal credits-modal';host.dataset.creditsModal='';
    host.innerHTML=`<div class="pm-modal-backdrop" data-credits-close></div><section class="pm-dialog glass credits-dialog" role="dialog" aria-modal="true" aria-labelledby="credits-modal-title" tabindex="-1"><button class="credits-modal-close" data-credits-close aria-label="关闭充值申请">×</button><span class="credits-modal-kicker">MANUAL TOP-UP</span><h2 id="credits-modal-title">提交积分充值申请</h2><p class="credits-modal-sub">选择套餐后提交申请，管理员核对线下款项到账后会为你入账。</p><div class="credits-package-options">${packages.map((item,i)=>`<button class="credits-package-option ${i===0?'selected':''}" data-package-id="${esc(item.id)}" type="button"><span>${esc(item.displayName||item.code)}</span><strong>${money(item.cashAmountCents)}</strong><small>${number(item.creditAmount)} 积分${item.bonusCredits?` + 赠送 ${number(item.bonusCredits)}`:''}</small></button>`).join('')}</div><label class="credits-note-field"><span>给管理员的备注（可选）</span><textarea data-credits-note maxlength="500" rows="3" placeholder="例如：已通过线下转账支付，请核对尾号 1234"></textarea></label><div class="credits-form-error" data-credits-form-error role="alert"></div><div class="credits-modal-actions"><button class="ghost" data-credits-close type="button">取消</button><button class="primary" data-credits-submit type="button">提交充值申请</button></div></section>`;
    document.body.appendChild(host);selectedPackage=packages[0]||null;
    host.querySelectorAll('[data-package-id]').forEach(button=>button.onclick=()=>{selectedPackage=packages.find(item=>item.id===button.dataset.packageId)||null;host.querySelectorAll('[data-package-id]').forEach(item=>item.classList.toggle('selected',item===button));});
    host.querySelectorAll('[data-credits-close]').forEach(button=>button.onclick=closeModal);
    host.querySelector('[data-credits-submit]').onclick=async()=>{if(submitting||!selectedPackage)return;submitting=true;const errorNode=host.querySelector('[data-credits-form-error]');const button=host.querySelector('[data-credits-submit]');button.disabled=true;button.textContent='正在提交…';errorNode.textContent='';try{const order=await window.lingframe.credits.createOrder({packageId:selectedPackage.id,note:host.querySelector('[data-credits-note]').value});closeModal();toast(`充值申请 ${order.orderNo} 已提交，等待管理员核对。`,'success');await loadCredits();}catch(error){errorNode.textContent=String(error?.message||error||'提交失败');submitting=false;button.disabled=false;button.textContent='提交充值申请';}};
    host.querySelector('.credits-dialog').focus();
  }
  function renderOrders(items){if(!items.length)return'<div class="credits-empty"><span>◎</span><b>还没有充值记录</b><small>选择一个积分套餐，提交你的第一笔充值申请。</small></div>';return`<div class="credits-orders">${items.map(order=>`<article class="credits-order"><div class="credits-order-main"><div class="credits-order-title"><strong>${esc(order.packageCode||order.orderNo)}</strong><span class="credits-status credits-status--${statusTone[order.status]||'muted'}">${statusLabel[order.status]||esc(order.status)}</span></div><div class="credits-order-meta"><span>${esc(order.orderNo)}</span><span>${date(order.createdAt)}</span><span>${money(order.cashAmountCents)}</span><b>${number(order.creditAmount+order.bonusCredits)} 积分</b></div>${order.submissionNote?`<p>备注：${esc(order.submissionNote)}</p>`:''}${order.reviewReason?`<p class="credits-review-reason">处理说明：${esc(order.reviewReason)}</p>`:''}</div>${order.status==='manual_review'?`<button class="credits-cancel-order" data-cancel-order="${esc(order.id)}" type="button">取消申请</button>`:''}</article>`).join('')}</div>`;}
  const ledgerLabel={recharge:'充值到账',reserve:'任务预占',settle:'任务结算',release:'任务释放',refund:'退款',manual_adjustment:'积分补充',reversal:'冲正',migration:'迁移入账'};
  function renderLedger(items){if(!items.length)return'<div class="credits-empty credits-empty--compact"><span>↔</span><b>暂时没有积分流水</b><small>充值或提交创作任务后，这里会显示完整账务记录。</small></div>';return`<div class="credits-ledger">${items.map(entry=>{const delta=Number(entry.availableDelta||0);const sign=delta>0?'+':'';const tone=delta>0?'positive':delta<0?'negative':'neutral';return`<article class="credits-ledger-row"><div class="credits-ledger-icon credits-ledger-icon--${tone}">${delta>0?'＋':delta<0?'−':'·'}</div><div class="credits-ledger-main"><strong>${esc(ledgerLabel[entry.entryType]||entry.entryType)}</strong><small>${esc(entry.reason||entry.businessType||'账务变更')} · ${date(entry.createdAt)}</small></div><b class="credits-ledger-delta credits-ledger-delta--${tone}">${sign}${number(delta)}</b><span class="credits-ledger-balance">余额 ${number(entry.availableAfter)}</span></article>`}).join('')}</div>`;}
  async function bootstrapWalletFallback(){
    const cached=window.lingframeWorkspaceSummary?.credits;
    if(cached)return {availableBalance:Number(cached.balance||0),reservedBalance:0,updatedAt:null,source:'bootstrap'};
    try{const identity=await window.lingframe.identity?.status?.();const credits=identity?.bootstrap?.data?.credits;if(credits)return {availableBalance:Number(credits.balance||0),reservedBalance:0,updatedAt:identity?.bootstrap?.cachedAt||null,source:'bootstrap'};}catch{}
    return null;
  }
  function renderCreditsError(message){return `<div class="credits-inline-error"><span>${esc(message)}</span></div>`;}
  async function loadCredits(){
    const page=document.querySelector('[data-credits-page]');if(!page)return;
    const [walletResult,packagesResult,ordersResult,ledgerResult]=await Promise.allSettled([window.lingframe.credits.wallet(),window.lingframe.credits.packages(),window.lingframe.credits.orders(),window.lingframe.credits.ledger(20)]);
    let wallet=walletResult.status==='fulfilled'?walletResult.value:null;
    if(!wallet)wallet=await bootstrapWalletFallback();
    const balanceNode=page.querySelector('[data-credits-balance]'),reservedNode=page.querySelector('[data-credits-reserved]');
    if(balanceNode)balanceNode.textContent=wallet?number(wallet.availableBalance):'—';
    if(reservedNode)reservedNode.textContent=wallet?number(wallet.reservedBalance):'—';
    if(wallet)window.dispatchEvent(new CustomEvent('lingframe:credits-updated',{detail:{availableBalance:Number(wallet.availableBalance||0),reservedBalance:Number(wallet.reservedBalance||0),source:wallet.source||'wallet'}}));
    const ordersHost=page.querySelector('[data-credits-orders]');
    if(ordersResult.status==='fulfilled')ordersHost.innerHTML=renderOrders(ordersResult.value.items||[]);else ordersHost.innerHTML=renderCreditsError('充值申请暂时无法读取，可点击刷新重试。');
    const ledgerHost=page.querySelector('[data-credits-ledger]');
    const ledgerMore=page.querySelector('[data-credits-ledger-more]');
    if(ledgerHost){if(ledgerResult.status==='fulfilled'){ledgerHost.innerHTML=renderLedger(ledgerResult.value.items||[]);if(ledgerMore){ledgerMore.hidden=!ledgerResult.value.nextCursor;ledgerMore.onclick=()=>loadMoreLedger(ledgerResult.value.nextCursor);}}else ledgerHost.innerHTML=renderCreditsError('积分流水暂时无法读取，可点击刷新重试。');}
    const packageHost=page.querySelector('[data-credits-packages]');
    const packages=packagesResult.status==='fulfilled'?packagesResult.value:{items:[]};
    if(packagesResult.status!=='fulfilled')packageHost.innerHTML=renderCreditsError('充值套餐暂时无法读取，可点击刷新重试。');
    else packageHost.innerHTML=(packages.items||[]).map(item=>`<button class="credits-package-card" data-open-recharge="${esc(item.id)}" type="button"><span>${esc(item.displayName||item.code)}</span><strong>${money(item.cashAmountCents)}</strong><small>${number(item.creditAmount)} 积分${item.bonusCredits?` + ${number(item.bonusCredits)} 赠送`:''}</small></button>`).join('')||'<div class="credits-empty credits-empty--compact">暂无可用套餐</div>';
    page.querySelectorAll('[data-open-recharge]').forEach(button=>button.onclick=()=>openRechargeModal(packages.items||[]));
    page.querySelectorAll('[data-cancel-order]').forEach(button=>button.onclick=async()=>{if(!confirm('确定取消这笔充值申请吗？'))return;button.disabled=true;try{await window.lingframe.credits.cancelOrder(button.dataset.cancelOrder);toast('充值申请已取消。','success');await loadCredits();}catch(error){toast(String(error?.message||error||'取消失败'),'error');button.disabled=false;}});
    const refreshNode=page.querySelector('[data-credits-refresh]');if(refreshNode)refreshNode.textContent=wallet?`更新于 ${date(wallet.updatedAt)}`:'积分余额待同步';
    return {wallet,packagesOk:packagesResult.status==='fulfilled',ordersOk:ordersResult.status==='fulfilled',ledgerOk:ledgerResult.status==='fulfilled'};
  }
  async function loadMoreLedger(cursor){const page=document.querySelector('[data-credits-page]'),host=page?.querySelector('[data-credits-ledger]'),more=page?.querySelector('[data-credits-ledger-more]');if(!host||!cursor||more?.disabled)return;more.disabled=true;try{const result=await window.lingframe.credits.ledger(20,cursor);const fragment=document.createElement('div');fragment.innerHTML=renderLedger(result.items||[]);const list=host.querySelector('.credits-ledger');if(list&&fragment.firstElementChild)list.insertAdjacentHTML('beforeend',fragment.firstElementChild.innerHTML);if(more){more.hidden=!result.nextCursor;more.disabled=false;more.onclick=()=>loadMoreLedger(result.nextCursor)}}catch(error){toast(String(error?.message||error||'流水加载失败'),'error');if(more)more.disabled=false}}
  window.enhanceCredits=async function(){stopPolling();const page=document.querySelector('[data-credits-page]');if(!page)return;page.querySelector('[data-credits-refresh-button]').onclick=()=>loadCredits().catch(error=>toast(String(error?.message||error),'error'));try{await loadCredits();refreshTimer=setInterval(()=>loadCredits().catch(()=>{}),15000);}catch(error){page.querySelector('[data-credits-orders]').innerHTML=`<div class="credits-error"><b>积分服务暂时不可用</b><span>${esc(error?.message||'请稍后重试')}</span><button class="ghost" data-credits-retry type="button">重新加载</button></div>`;page.querySelector('[data-credits-retry]').onclick=()=>window.enhanceCredits();}};
  window.addEventListener('beforeunload',stopPolling);
})();
