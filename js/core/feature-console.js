import { setControlFeedbackState } from './motion.js?release=20261127-aeris-p5-ux-final-r2';

export function createFeatureConsole({ api, apiGet, getAccount, refreshFeatures, document = globalThis.document }) {
  const node = id => document.getElementById(id);
  let available = false, flags = [], generation = 0, loading = false, accountId = '';
  const isAdmin = () => Boolean(getAccount()?.is_admin || getAccount()?.is_super_admin);
  const ownerId = () => String(getAccount()?.id || '');
  const current = () => flags.find(flag => flag.flag_key === node('featureFlagSelect')?.value);
  const message = (text, tone = 'idle') => {
    const el = node('featureConsoleStatus');
    if (!el) return;
    el.textContent = text;
    if (el.dataset) el.dataset.feedbackState = text ? tone : 'idle';
  };
  function persistedForForm() {
    const key = node('featureFlagKey')?.value?.trim();
    const rev = Number(node('featureFlagForm')?.dataset?.revision || 0);
    if (!key || rev <= 0) return null;
    return flags.find(flag => flag.flag_key === key) || null;
  }
  function isDraftDirty(persisted) {
    const key = node('featureFlagKey')?.value?.trim() || '';
    const desc = node('featureFlagDescription')?.value || '';
    const enabled = Boolean(node('featureFlagEnabled')?.checked);
    const killSwitch = Boolean(node('featureFlagKillSwitch')?.checked);
    const pct = Number(node('featureFlagPercentage')?.value ?? 100);
    const channels = ['stable', 'beta', 'experimental'].filter(ch => node(`featureChannel_${ch}`)?.checked);
    if (!persisted) {
      return Boolean(key || desc || enabled || killSwitch || pct !== 100 || channels.join(',') !== 'experimental');
    }
    const serverChannels = ['stable', 'beta', 'experimental'].filter(ch => (persisted.channels || ['experimental']).includes(ch));
    return desc !== (persisted.description || '')
      || enabled !== (persisted.enabled === true)
      || killSwitch !== (persisted.kill_switch === true)
      || pct !== Number(persisted.rollout_percentage ?? 100)
      || channels.join(',') !== serverChannels.join(',');
  }
  function syncCapsules() {
    const stateEl = node('featureFlagStateCapsule');
    const rolloutEl = node('featureFlagRolloutCapsule');
    const channelsEl = node('featureFlagChannelCapsules');
    const revEl = node('featureFlagRevisionCapsule');
    const warnEl = node('featureFlagKillWarning');
    const key = node('featureFlagKey')?.value?.trim();
    const enabled = Boolean(node('featureFlagEnabled')?.checked);
    const killSwitch = Boolean(node('featureFlagKillSwitch')?.checked);
    const rev = Number(node('featureFlagForm')?.dataset?.revision || 0);
    const persisted = persistedForForm();
    const serverKillActive = persisted?.kill_switch === true;
    const dirty = isDraftDirty(persisted);
    const pct = node('featureFlagPercentage')?.value ?? '100';
    const channels = ['stable', 'beta', 'experimental']
      .filter(ch => node(`featureChannel_${ch}`)?.checked)
      .map(ch => ch[0].toUpperCase() + ch.slice(1));
    if (stateEl) {
      if (killSwitch) {
        stateEl.textContent = serverKillActive ? '紧急关闭 · 已生效' : '紧急关闭 · 未保存';
        stateEl.dataset.state = 'kill';
      } else if (serverKillActive) {
        stateEl.textContent = '紧急关闭生效中 · 待保存';
        stateEl.dataset.state = 'kill';
      } else if (!key && rev === 0) {
        stateEl.textContent = '新建草稿';
        stateEl.dataset.state = 'new';
      } else if (enabled) {
        stateEl.textContent = dirty ? '全局 ON · 未保存' : '全局 ON';
        stateEl.dataset.state = 'on';
      } else {
        stateEl.textContent = dirty ? '全局 OFF · 未保存' : '全局 OFF';
        stateEl.dataset.state = 'off';
      }
      if (stateEl.dataset) stateEl.dataset.dirty = dirty ? 'true' : 'false';
    }
    if (rolloutEl) rolloutEl.textContent = `放量 ${pct}%`;
    if (channelsEl) channelsEl.textContent = channels.length ? channels.join(' · ') : '未允许任何通道';
    if (revEl) revEl.textContent = `v${rev}`;
    const formEl = node('featureFlagForm');
    if (formEl) {
      formEl.dataset.killActive = killSwitch ? 'true' : 'false';
      formEl.dataset.serverKillActive = serverKillActive ? 'true' : 'false';
      formEl.dataset.dirty = dirty ? 'true' : 'false';
    }
    if (warnEl) {
      const showWarn = killSwitch || serverKillActive;
      warnEl.classList.toggle('hidden', !showWarn);
      if (showWarn && warnEl.dataset) {
        if (serverKillActive && killSwitch) {
          warnEl.dataset.killMode = 'active';
          warnEl.textContent = '紧急关闭已在服务端生效：当前已强制关闭此功能，优先于放量与用户覆盖。';
        } else if (!serverKillActive && killSwitch) {
          warnEl.dataset.killMode = 'pending-enable';
          warnEl.textContent = '紧急关闭已勾选（未保存）：保存生效前尚不会阻断请求；保存后将立即覆盖放量与用户覆盖，强制关闭此功能。';
        } else {
          warnEl.dataset.killMode = 'pending-clear';
          warnEl.textContent = '服务端紧急关闭仍在生效（本地已取消勾选，尚未保存）：在保存生效前，此功能仍处于强制关闭状态。';
        }
      }
    }
    node('featureFlagSummaryList')?.querySelectorAll('[data-flag-key]').forEach(btn => {
      btn.setAttribute('aria-current', btn.dataset.flagKey === key ? 'true' : 'false');
    });
  }
  function edit(flag = null) {
    node('featureFlagKey').value = flag?.flag_key || ''; node('featureFlagKey').readOnly = Boolean(flag);
    node('featureFlagDescription').value = flag?.description || '';
    node('featureFlagEnabled').checked = flag?.enabled === true; node('featureFlagKillSwitch').checked = flag?.kill_switch === true;
    node('featureFlagPercentage').value = flag?.rollout_percentage ?? 100;
    for (const channel of ['stable', 'beta', 'experimental']) node(`featureChannel_${channel}`).checked = (flag?.channels || ['experimental']).includes(channel);
    node('featureFlagForm').dataset.revision = String(flag?.revision || 0);
    syncCapsules();
  }
  function render() {
    const selected = node('featureFlagSelect').value;
    node('featureFlagSelect').replaceChildren(...flags.map(flag => {
      const option = document.createElement('option'); option.value = flag.flag_key;
      option.textContent = `${flag.flag_key} · ${flag.kill_switch ? '紧急关闭' : flag.enabled ? 'ON' : 'OFF'} · v${flag.revision}`;
      return option;
    }));
    if (flags.some(flag => flag.flag_key === selected)) node('featureFlagSelect').value = selected;
    const summaryList = node('featureFlagSummaryList');
    if (summaryList) {
      summaryList.replaceChildren(...flags.map(flag => {
        const row = document.createElement('li');
        row.className = 'feature-directory-row';
        const item = document.createElement('button');
        item.type = 'button';
        item.className = 'feature-directory-item';
        item.dataset.flagKey = flag.flag_key;
        const state = flag.kill_switch ? 'kill' : flag.enabled ? 'on' : 'off';
        const stateLabel = flag.kill_switch ? '紧急关闭' : flag.enabled ? 'ON' : 'OFF';
        const keySpan = document.createElement('code');
        keySpan.textContent = flag.flag_key;
        const metaSpan = document.createElement('span');
        metaSpan.className = 'feature-directory-meta';
        metaSpan.textContent = `${Number(flag.rollout_percentage ?? 100)}% · v${flag.revision}`;
        const pill = document.createElement('span');
        pill.className = 'feature-capsule';
        pill.dataset.state = state;
        pill.textContent = stateLabel;
        item.append(keySpan, metaSpan, pill);
        item.addEventListener('click', () => {
          const select = node('featureFlagSelect');
          if (select) { select.value = flag.flag_key; }
          edit(flag);
        });
        row.append(item);
        return row;
      }));
    }
    edit(current());
  }
  async function load({ resetDraft = false, refreshButton = null } = {}) {
    if (!available || !isAdmin()) return false;
    const ticket = ++generation, owner = ownerId(); loading = true;
    const priorPersisted = persistedForForm();
    const hadDirtyDraft = !resetDraft && isDraftDirty(priorPersisted);
    if (refreshButton) setControlFeedbackState(refreshButton, 'pending');
    message('正在读取最新配置…', 'pending');
    try {
      const response = await apiGet('/api/admin/feature-flags');
      if (ticket !== generation || owner !== ownerId() || !isAdmin()) return false;
      flags = response.flags || [];
      if (!hadDirtyDraft) render();
      else syncCapsules();
      const rows = response.audit || [];
      node('featureFlagAudit').textContent = rows.map(row =>
        `${row.created_at} · ${row.action} · ${row.flag_key}${row.target_user_id ? ` · ${row.target_user_id}` : ''} · ${row.actor_user_id}`).join('\n') || '暂无修改记录';
      const timeline = node('featureFlagAuditTimeline');
      if (timeline) {
        if (!rows.length) {
          const empty = document.createElement('li');
          empty.className = 'feature-audit-empty';
          empty.textContent = '暂无修改记录';
          timeline.replaceChildren(empty);
        } else {
          timeline.replaceChildren(...rows.map(row => {
            const li = document.createElement('li');
            li.className = 'feature-audit-item';
            const dot = document.createElement('span');
            dot.className = 'feature-audit-dot';
            dot.setAttribute('aria-hidden', 'true');
            const head = document.createElement('div');
            head.className = 'feature-audit-head';
            const actionBadge = document.createElement('span');
            actionBadge.className = 'feature-audit-action';
            actionBadge.textContent = row.action || '';
            const keyCode = document.createElement('code');
            keyCode.textContent = row.flag_key || '';
            const timeEl = document.createElement('time');
            timeEl.textContent = row.created_at || '';
            head.append(actionBadge, keyCode, timeEl);
            const detail = document.createElement('div');
            detail.className = 'feature-audit-detail';
            detail.textContent = [row.target_user_id ? `对象 ${row.target_user_id}` : '', row.actor_user_id ? `操作者 ${row.actor_user_id}` : ''].filter(Boolean).join(' · ');
            li.append(dot, head, detail);
            return li;
          }));
        }
      }
      message(hadDirtyDraft ? '已刷新服务端配置（保留了当前未保存编辑）' : '已读取最新配置', hadDirtyDraft ? 'info' : 'idle');
      if (refreshButton) setControlFeedbackState(refreshButton, 'success');
      return true;
    } catch (error) {
      if (ticket === generation && owner === ownerId()) {
        message(`刷新失败：${error.message || '请稍后重试'}`, 'error');
        syncCapsules();
      }
      if (refreshButton) setControlFeedbackState(refreshButton, 'error');
      return false;
    }
    finally { if (ticket === generation) loading = false; }
  }
  function setAvailable(value) {
    const next = value === true && isAdmin(), nextId = ownerId();
    if (next !== available || nextId !== accountId) {
      generation++; loading = false; flags = []; available = next; accountId = nextId;
      node('featureFlagSelect')?.replaceChildren(); node('featureFlagAudit')?.replaceChildren();
      node('featureFlagSummaryList')?.replaceChildren(); node('featureFlagAuditTimeline')?.replaceChildren();
      node('featureEvaluationResult')?.replaceChildren(); edit(); message('', 'idle');
      node('learningMetrics')?.replaceChildren();
      for (const id of ['featureOverrideUser', 'featureEvaluateUser']) node(id).value = '';
    }
    node('adminFeatureFlagsTab')?.classList.toggle('hidden', !available);
  }
  node('featureFlagForm')?.addEventListener('change', syncCapsules);
  node('featureFlagForm')?.addEventListener('input', syncCapsules);
  async function mutate(path, payload, button) {
    if (!available || !isAdmin() || button.disabled) return;
    const owner = ownerId(); button.disabled = true;
    setControlFeedbackState(button, 'pending');
    message('正在保存配置…', 'pending');
    try {
      await api(path, payload);
      if (owner !== ownerId() || !available || !isAdmin()) return;
      await load({ resetDraft: true }); await refreshFeatures();
      setControlFeedbackState(button, 'success');
      message('设置已保存', 'success');
    } catch (error) {
      if (owner === ownerId()) {
        const cancelled = error?.message === '操作已取消';
        setControlFeedbackState(button, cancelled ? 'idle' : 'error');
        message(
          cancelled
            ? '已取消身份验证，未保存任何更改（当前表单与警示保持不变）。'
            : `${error.message || '保存失败'}（服务端配置未改变，已保留你的修改，可重试）`,
          cancelled ? 'info' : 'error',
        );
        syncCapsules();
      }
    }
    finally { button.disabled = false; }
  }
  node('featureFlagSelect')?.addEventListener('change', () => {
    setControlFeedbackState(node('saveFeatureFlagBtn'), 'idle');
    edit(current());
  });
  node('newFeatureFlagBtn')?.addEventListener('click', () => {
    setControlFeedbackState(node('saveFeatureFlagBtn'), 'idle');
    edit();
  });
  node('refreshFeatureFlagsBtn')?.addEventListener('click', () => void load({ resetDraft: true, refreshButton: node('refreshFeatureFlagsBtn') }));
  node('refreshLearningMetricsBtn')?.addEventListener('click', async () => {
    if (!available || !isAdmin()) return;
    const ticket = generation, owner = ownerId(), button = node('refreshLearningMetricsBtn'); button.disabled = true;
    node('learningMetrics').textContent = '正在读取…';
    try {
      const value = await apiGet('/api/admin/learning/metrics');
      if (ticket !== generation || owner !== ownerId() || !isAdmin()) return;
      node('learningMetrics').textContent = `算法 ${value.algorithm_version}\n待恢复进度 ${value.pending_projections}\n` +
        (value.event_counts || []).map(row => `${row.kind}: ${row.count}`).join('\n') + '\n' +
        (value.score_distribution || []).map(row => `掌握度 ${row.score_band}–${Math.min(100, row.score_band + 19)}: ${row.count}`).join('\n');
    } catch (error) { if (ticket === generation && owner === ownerId()) node('learningMetrics').textContent = error.message; }
    finally { button.disabled = false; }
  });
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
