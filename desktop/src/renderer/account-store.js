(() => {
  const api = window.lingframe;
  let tenantId = 'local';
  let registryAccounts = null;
  let registryRefresh = null;
  const safeParse = (value, fallback) => { try { const parsed = JSON.parse(value || ''); return parsed ?? fallback; } catch { return fallback; } };
  const key = type => `lingframe.${type}.${tenantId}`;
  const wait = delay => new Promise(resolve => setTimeout(resolve, delay));
  const normalizeGroups = value => {
    const source = value && typeof value === 'object' ? value : {};
    const groups = Array.isArray(source.groups) ? source.groups : [];
    return {
      version: 1,
      selectedGroupId: String(source.selectedGroupId || 'all'),
      groups: groups.filter(item => item?.id && item?.name).map(item => ({
        id: String(item.id),
        name: String(item.name).slice(0, 30),
        accountIds: [...new Set((Array.isArray(item.accountIds) ? item.accountIds : []).map(String))]
      }))
    };
  };
  async function loadRegistryAccounts(legacyAccounts = [], attempts = 6) {
    if (registryRefresh) return registryRefresh;
    registryRefresh = (async () => {
      let lastResult = null;
      for (let attempt = 0; attempt < Math.max(1, attempts); attempt += 1) {
        lastResult = await api?.doubaoAccounts?.bootstrap?.({legacyAccounts: Array.isArray(legacyAccounts) ? legacyAccounts : []});
        if (!lastResult?.locked) {
          if (Array.isArray(lastResult?.accounts)) registryAccounts = lastResult.accounts;
          return registryAccounts || [];
        }
        if (attempt + 1 < attempts) await wait(120 * (attempt + 1));
      }
      return registryAccounts || [];
    })().finally(() => { registryRefresh = null; });
    return registryRefresh;
  }
  const ready = (async () => {
    try {
      const identity = await api?.identity?.status?.();
      if (identity?.tenantId) tenantId = String(identity.tenantId);
    } catch {}
    try {
      const legacyAccounts = safeParse(localStorage.getItem(key('doubaoAccounts')), []);
      await loadRegistryAccounts(legacyAccounts);
    } catch {}
    window.dispatchEvent(new CustomEvent('lingframe:account-store-ready', {detail:{tenantId}}));
    return tenantId;
  })();
  function profiles() {
    const value = safeParse(localStorage.getItem(key('doubaoProfiles')), {});
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }
  function customAccounts() {
    const value = safeParse(localStorage.getItem(key('doubaoAccounts')), []);
    return Array.isArray(value) ? value : [];
  }
  function accounts() {
    const profileMap = profiles();
    const source = registryAccounts || customAccounts();
    return [...source]
      .filter((item, index, list) => item?.id && list.findIndex(other => other?.id === item.id) === index)
      .map(item => ({...item, ...(profileMap[item.id] || {}), id:String(item.id)}));
  }
  async function upsertAccount(value) {
    const account = await api?.doubaoAccounts?.upsert?.(value) || value;
    registryAccounts = [...(registryAccounts || customAccounts()).filter(item => item?.id !== account?.id), account];
    const merged = customAccounts().filter(item => item?.id !== account?.id); merged.push(account);
    localStorage.setItem(key('doubaoAccounts'), JSON.stringify(merged));
    window.dispatchEvent(new CustomEvent('lingframe:account-profiles-changed', {detail:{account}}));
    return account;
  }
  async function removeAccount(accountId) {
    const result = await api?.doubaoAccounts?.remove?.(accountId) || {ok:true,removed:true,accountId};
    if (result.removed) {
      registryAccounts = (registryAccounts || customAccounts()).filter(item => item?.id !== String(accountId));
      localStorage.setItem(key('doubaoAccounts'), JSON.stringify(customAccounts().filter(item => item?.id !== String(accountId))));
    }
    return result;
  }
  async function refreshAccounts() {
    const accounts = await loadRegistryAccounts([], 4);
    if (Array.isArray(accounts)) {
      localStorage.setItem(key('doubaoAccounts'), JSON.stringify(accounts));
      window.dispatchEvent(new CustomEvent('lingframe:account-profiles-changed', {detail:{accounts}}));
    }
    return registryAccounts || [];
  }
  function groupState() { return normalizeGroups(safeParse(localStorage.getItem(key('doubaoGroups')), {})); }
  function saveGroups(value) {
    const normalized = normalizeGroups(value);
    localStorage.setItem(key('doubaoGroups'), JSON.stringify(normalized));
    window.dispatchEvent(new CustomEvent('lingframe:account-groups-changed', {detail:normalized}));
    return normalized;
  }
  function accountsForGroup(groupId = 'all') {
    const list = accounts();
    if (!groupId || groupId === 'all') return list;
    const group = groupState().groups.find(item => item.id === groupId);
    return group ? list.filter(item => group.accountIds.includes(item.id)) : list;
  }
  window.lingframeAccountStore = {
    ready,
    tenantId: () => tenantId,
    profiles,
    customAccounts,
    accounts,
    groupState,
    groups: () => groupState().groups,
    saveGroups,
    accountsForGroup
    ,upsertAccount
    ,removeAccount
    ,refreshAccounts
  };
  api?.auth?.onChanged?.(status => {
    if (!status?.workspaceReady || !status?.tenantId) return;
    const nextTenantId = String(status.tenantId);
    if (tenantId !== nextTenantId) { tenantId = nextTenantId; registryAccounts = null; }
    refreshAccounts().catch(() => {}).finally(() => {
      window.dispatchEvent(new CustomEvent('lingframe:model-catalog-changed', {detail: {tenantId: nextTenantId}}));
    });
  });
})();
