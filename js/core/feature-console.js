export function createFeatureConsole({ api, apiGet, getAccount, refreshFeatures, document = globalThis.document }) {
  const node = id => document.getElementById(id);
  let available = false, flags = [], generation = 0, loading = false, accountId = '';
  const isAdmin = () => Boolean(getAccount()?.is_admin || getAccount()?.is_super_admin);
  const ownerId = () => String(getAccount()?.id || '');
  const current = () => flags.find(flag => flag.flag_key === node('featureFlagSelect')?.value);
  const message = text => { if (node('featureConsoleStatus')) node('featureConsoleStatus').textContent = text; };
  function edit(flag = null) {
    node('featureFlagKey').value = flag?.flag_key || ''; node('featureFlagKey').readOnly = Boolean(flag);
    node('featureFlagDescription').value = flag?.description || '';
    node('featureFlagEnabled').checked = flag?.enabled === true; node('featureFlagKillSwitch').checked = flag?.kill_switch === true;
    node('featureFlagPercentage').value = flag?.rollout_percentage ?? 100;
    for (const channel of ['stable', 'beta', 'experimental']) node(`featureChannel_${channel}`).checked = (flag?.channels || ['experimental']).includes(channel);
    node('featureFlagForm').dataset.revision = String(flag?.revision || 0);
  }
  function render() {
    const selected = node('featureFlagSelect').value;
    node('featureFlagSelect').replaceChildren(...flags.map(flag => {
      const option = document.createElement('option'); option.value = flag.flag_key;
      option.textContent = `${flag.flag_key} · ${flag.kill_switch ? '紧急关闭' : flag.enabled ? 'ON' : 'OFF'} · v${flag.revision}`;
      return option;
    }));
    if (flags.some(flag => flag.flag_key === selected)) node('featureFlagSelect').value = selected;
    edit(current());
  }
  async function load() {
    if (!available || !isAdmin()) return;
    const ticket = ++generation, owner = ownerId(); loading = true; message('正在读取…');
    try {
      const response = await apiGet('/api/admin/feature-flags');
      if (ticket !== generation || owner !== ownerId() || !isAdmin()) return;
      flags = response.flags || []; render();
      node('featureFlagAudit').textContent = (response.audit || []).map(row =>
        `${row.created_at} · ${row.action} · ${row.flag_key}${row.target_user_id ? ` · ${row.target_user_id}` : ''} · ${row.actor_user_id}`).join('\n') || '暂无修改记录';
      message('已读取最新配置');
    } catch (error) { if (ticket === generation && owner === ownerId()) message(error.message); }
    finally { if (ticket === generation) loading = false; }
  }
  function setAvailable(value) {
    const next = value === true && isAdmin(), nextId = ownerId();
    if (next !== available || nextId !== accountId) {
      generation++; loading = false; flags = []; available = next; accountId = nextId;
      node('featureFlagSelect')?.replaceChildren(); node('featureFlagAudit')?.replaceChildren();
      node('featureEvaluationResult')?.replaceChildren(); edit(); message('');
      for (const id of ['featureOverrideUser', 'featureEvaluateUser']) node(id).value = '';
    }
    node('adminFeatureFlagsTab')?.classList.toggle('hidden', !available);
  }
  async function mutate(path, payload, button) {
    if (!available || !isAdmin() || button.disabled) return;
    const owner = ownerId(); button.disabled = true; message('正在保存…');
    try {
      await api(path, payload);
      if (owner !== ownerId() || !available || !isAdmin()) return;
      await load(); await refreshFeatures(); message('设置已保存');
    } catch (error) { if (owner === ownerId()) message(error.message); }
    finally { button.disabled = false; }
  }
  node('featureFlagSelect')?.addEventListener('change', () => edit(current()));
  node('newFeatureFlagBtn')?.addEventListener('click', () => edit());
  node('refreshFeatureFlagsBtn')?.addEventListener('click', () => void load());
  node('featureFlagForm')?.addEventListener('submit', event => {
    event.preventDefault(); if (loading) return;
    void mutate('/api/admin/feature-flags', {
      flag_key: node('featureFlagKey').value, description: node('featureFlagDescription').value,
      enabled: node('featureFlagEnabled').checked, kill_switch: node('featureFlagKillSwitch').checked,
      channels: ['stable', 'beta', 'experimental'].filter(channel => node(`featureChannel_${channel}`).checked),
      rollout_percentage: Number(node('featureFlagPercentage').value), expected_revision: Number(node('featureFlagForm').dataset.revision),
    }, node('saveFeatureFlagBtn'));
  });
  node('featureOverrideForm')?.addEventListener('submit', event => {
    event.preventDefault(); const flag = current(); if (!flag || loading) return;
    const enabled = node('featureOverrideValue').value;
    void mutate('/api/admin/feature-flags/override', { flag_key: flag.flag_key, user_id: node('featureOverrideUser').value,
      enabled: enabled === 'inherit' ? null : enabled === 'on', expected_revision: flag.revision }, node('saveFeatureOverrideBtn'));
  });
  node('featureEvaluateForm')?.addEventListener('submit', async event => {
    event.preventDefault(); if (!available || !isAdmin()) return;
    const ticket = generation, owner = ownerId(), button = node('evaluateFeatureBtn'); button.disabled = true;
    try {
      const response = await api('/api/admin/feature-flags/evaluate', { user_id: node('featureEvaluateUser').value, channel: node('featureEvaluateChannel').value });
      if (ticket === generation && owner === ownerId()) node('featureEvaluationResult').textContent = Object.entries(response.snapshot.flags)
        .map(([key, flag]) => `${key}: ${flag.enabled ? 'ON' : 'OFF'} (${flag.reason}, v${flag.revision})`).join('\n');
    } catch (error) { if (owner === ownerId()) message(error.message); }
    finally { button.disabled = false; }
  });
  return Object.freeze({ load, setAvailable });
}
