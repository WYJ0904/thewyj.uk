export function loginReasonLabel(reason) {
  return {
    success: "登录成功",
    invalid_credentials: "用户名或密钥错误",
    account_banned: "账户已封禁",
    login_rate_limited: "请求过于频繁",
  }[reason] || reason || "登录失败";
}

export function loginLocationLabel(log, locale = "zh-CN") {
  let country = String(log?.country || "").toUpperCase();
  if (/^[A-Z]{2}$/.test(country) && typeof Intl.DisplayNames === "function") {
    try {
      country = new Intl.DisplayNames([locale], { type: "region" }).of(country) || country;
    } catch (_) {
      // Older WebViews retain the ISO country code.
    }
  }
  return [...new Set([log?.city, log?.region, country].map((item) => String(item || "").trim()).filter(Boolean))].join(" / ") || "未知网络位置";
}

export function membershipDateValue(value, formatDate) {
  if (!value) return "";
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : formatDate(parsed);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function deliveryStatusBadge(status) {
  const map = {
    sending: ["发送中", "is-queued"],
    delivered: ["服务商报告已投递（未确认收件箱）", "is-success"],
    queued: ["已排队等待投递（非最终送达）", "is-queued"],
    failed: ["发送失败", "is-error"],
    rejected: ["永久拒收/退信", "is-error"],
    suppressed: ["服务商抑制", "is-warn"],
    unknown: ["投递结果未知（禁止自动重发）", "is-warn"],
  };
  const [label, cls] = map[String(status || "")] || [String(status || "未知"), "is-muted"];
  return `<span class="admin-email-badge ${cls}">${escapeHtml(label)}</span>`;
}

function inboundStatusBadge(status) {
  const map = {
    open: ["待处理", "is-warn"],
    replied: ["已回复", "is-success"],
    pending: ["处理中", "is-queued"],
    closed: ["已关闭", "is-muted"],
    archived: ["已归档", "is-muted"],
  };
  const [label, cls] = map[String(status || "")] || [String(status || "待处理"), "is-muted"];
  return `<span class="admin-email-badge ${cls}">${escapeHtml(label)}</span>`;
}

function securityStatusLabel(status) {
  const map = {
    ok: "安全校验通过",
    quarantined: "已隔离可疑内容",
    auto_submitted: "自动回复/系统退信",
    rejected_invalid: "无效发件人已拒绝",
    oversize_rejected: "超大邮件已拒绝",
  };
  return map[String(status || "ok")] || String(status || "ok");
}

function formatTime(iso) {
  if (!iso) return "-";
  try {
    return new Date(iso).toLocaleString("zh-CN", { hour12: false });
  } catch {
    return String(iso);
  }
}

function parseTimelineTimestamp(iso) {
  if (!iso) return 0;
  const ms = Date.parse(String(iso));
  return Number.isFinite(ms) ? ms : 0;
}

export function buildInboundTimeline(inboundMessages = [], outboundReplies = []) {
  const items = [];
  (Array.isArray(inboundMessages) ? inboundMessages : []).forEach((item, index) => {
    items.push({
      kind: "inbound",
      kindOrder: 0,
      index,
      timeMs: parseTimelineTimestamp(item?.received_at),
      item,
    });
  });
  (Array.isArray(outboundReplies) ? outboundReplies : []).forEach((item, index) => {
    items.push({
      kind: "outbound",
      kindOrder: 1,
      index,
      timeMs: parseTimelineTimestamp(item?.created_at || item?.sent_at),
      item,
    });
  });
  items.sort((a, b) => {
    if (a.timeMs !== b.timeMs) return a.timeMs - b.timeMs;
    if (a.kindOrder !== b.kindOrder) return a.kindOrder - b.kindOrder;
    return a.index - b.index;
  });
  return items;
}

export function splitQuotedEmailBody(rawText) {
  const normalized = String(rawText ?? "").replace(/\r\n?/g, "\n");
  if (!normalized.trim()) {
    return { mainText: normalized.trimEnd(), quotedText: "", hasQuote: false };
  }
  const lines = normalized.split("\n");
  let splitIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    const next = i + 1 < lines.length ? lines[i + 1].trim() : "";
    const next2 = i + 2 < lines.length ? lines[i + 2].trim() : "";
    if (!line) continue;

    const isZhAttribution =
      /^.{1,160}(?:于|於)\s*\d{4}\s*年.{0,80}(?:写道|寫道)[:：]\s*$/.test(line)
      || (/^.{1,160}(?:于|於)\s*\d{4}\s*年.{0,80}$/.test(line) && /^.{0,80}(?:写道|寫道)[:：]\s*$/.test(next))
      || /^在\s*\d{4}.{0,120}(?:写道|寫道)[:：]\s*$/.test(line);

    const isEnAttribution =
      /^On\s+.{4,180}\bwrote:\s*$/i.test(line)
      || (/^On\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun|\d{4}|.{0,80}<[^>]+>|.{0,80}\d{1,2}:\d{2}).{0,180}$/i.test(line)
        && /^.{0,120}\bwrote:\s*$/i.test(next));

    const isDividerHeader =
      /^-{2,}\s*(?:Original Message|Forwarded message|原始邮件|转发的邮件)\s*-{2,}\s*$/i.test(line)
      || (/^_{10,}\s*$/.test(line) && /^(?:From|Sent|Date|发件人|发送时间|日期)\s*[:：]/i.test(next || next2))
      || (/^(?:From|发件人)\s*[:：]\s*.+$/i.test(line) && /^(?:Sent|Date|发送时间|日期)\s*[:：]\s*.+$/i.test(next || next2));

    if (isZhAttribution || isEnAttribution || isDividerHeader) {
      if (!lines.slice(0, i).join("\n").trim()) {
        return { mainText: normalized.trimEnd(), quotedText: "", hasQuote: false };
      }
      splitIndex = i;
      break;
    }
  }

  if (splitIndex < 0) {
    let trailingQuoteStart = -1;
    for (let i = lines.length - 1; i >= 1; i -= 1) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      if (/^>/.test(trimmed)) {
        trailingQuoteStart = i;
      } else {
        break;
      }
    }
    if (trailingQuoteStart > 0 && lines.slice(0, trailingQuoteStart).join("\n").trim()) {
      splitIndex = trailingQuoteStart;
    }
  }

  if (splitIndex > 0) {
    const mainText = lines.slice(0, splitIndex).join("\n").trimEnd();
    const quotedText = lines.slice(splitIndex).join("\n").trim();
    if (mainText.trim() && quotedText) {
      return { mainText, quotedText, hasQuote: true };
    }
  }

  return { mainText: normalized.trimEnd(), quotedText: "", hasQuote: false };
}

export function createAdminEmailCenter({ root, apiGet, apiPost, getAccount }) {
  if (!root) return null;

  const state = {
    tab: "overview",
    overview: null,
    recipients: [],
    recipientSearch: "",
    recipientFilter: "verified",
    selectedRecipients: new Map(),
    targetMode: "single",
    senderKind: "noreply",
    composeTemplateKey: "",
    subject: "",
    body: "",
    draftId: "",
    preview: null,
    sendResult: null,
    deliveries: [],
    deliveryStatusFilter: "",
    deliveryChannelFilter: "",
    deliverySearch: "",
    inboundThreads: [],
    inboundStatusFilter: "",
    inboundSearch: "",
    activeThreadDetail: null,
    replyTemplateKey: "",
    replySubject: "",
    replyBody: "",
    replyFromMode: "auto",
    replyPreviewConfirmed: false,
    templates: [],
    message: "",
    error: "",
    busy: false,
  };

  function isSuperAdmin() {
    return Boolean(getAccount?.()?.is_super_admin);
  }

  function setFeedback({ message = "", error = "" }) {
    state.message = message;
    state.error = error;
    const msgEl = root.querySelector("#adminEmailCenterStatus");
    const errEl = root.querySelector("#adminEmailCenterError");
    if (msgEl) msgEl.textContent = message;
    if (errEl) errEl.textContent = error;
  }

  async function loadOverview() {
    const data = await apiGet("/api/admin/email/overview");
    state.overview = data;
  }

  async function loadRecipients() {
    const qs = new URLSearchParams({
      q: state.recipientSearch,
      verified: state.recipientFilter,
      limit: "40",
    });
    const data = await apiGet(`/api/admin/email/recipients?${qs.toString()}`);
    state.recipients = Array.isArray(data.recipients) ? data.recipients : [];
  }

  async function loadDeliveries() {
    const qs = new URLSearchParams({
      status: state.deliveryStatusFilter,
      channel: state.deliveryChannelFilter,
      q: state.deliverySearch,
      limit: "40",
    });
    const data = await apiGet(`/api/admin/email/deliveries?${qs.toString()}`);
    state.deliveries = Array.isArray(data.deliveries) ? data.deliveries : [];
  }

  async function loadInboundList() {
    const qs = new URLSearchParams({
      status: state.inboundStatusFilter,
      q: state.inboundSearch,
      limit: "40",
    });
    const data = await apiGet(`/api/admin/email/inbound?${qs.toString()}`);
    state.inboundThreads = Array.isArray(data.threads) ? data.threads : [];
  }

  async function loadInboundThread(threadId) {
    if (!threadId) return;
    const data = await apiGet(`/api/admin/email/inbound?thread_id=${encodeURIComponent(threadId)}`);
    state.activeThreadDetail = data;
    state.replyTemplateKey = "";
    state.replySubject = data?.thread?.normalized_subject
      ? `Re: ${data.thread.normalized_subject}`
      : "Re: Aeris 客服回复";
    state.replyPreviewConfirmed = false;
  }

  async function loadTemplates() {
    const data = await apiGet("/api/admin/email/templates");
    state.templates = Array.isArray(data.templates) ? data.templates : [];
  }

  async function refreshCurrentTab() {
    state.busy = true;
    setFeedback({ message: "", error: "" });
    try {
      if (state.tab === "overview") {
        await loadOverview();
      } else if (state.tab === "compose") {
        await Promise.all([
          state.overview ? Promise.resolve() : loadOverview(),
          loadRecipients(),
          state.templates.length ? Promise.resolve() : loadTemplates(),
        ]);
      } else if (state.tab === "deliveries") {
        await loadDeliveries();
      } else if (state.tab === "inbound") {
        await Promise.all([
          loadInboundList(),
          state.templates.length ? Promise.resolve() : loadTemplates(),
        ]);
        if (state.activeThreadDetail?.thread?.thread_id) {
          await loadInboundThread(state.activeThreadDetail.thread.thread_id);
        }
      } else if (state.tab === "templates") {
        await loadTemplates();
      }
    } catch (err) {
      state.error = err?.message || "加载邮件中心数据失败";
    } finally {
      state.busy = false;
      render();
    }
  }

  function normalizeEditorTemplateText(value) {
    return String(value ?? "")
      .replace(/\\r\\n/g, "\n")
      .replace(/\\n/g, "\n")
      .replace(/\r\n/g, "\n");
  }

  function renderOverview() {
    const st = state.overview?.status || {};
    const stats = state.overview?.stats || {};
    const superAdmin = isSuperAdmin();
    const inboundSummary = st.inbound_forwarding_summary
      || (st.inbound_forwarding_configured === true
        ? "已配置保留"
        : st.inbound_forwarding_configured === false
          ? "未验证"
          : "未验证（独立 Worker 托管）");
    return `
      <div class="admin-email-section">
        <div class="admin-email-stats-grid">
          <div class="admin-email-stat-card"><span>发送开关</span><strong>${st.email_sending_enabled ? "已开启" : "已关闭"}</strong></div>
          <div class="admin-email-stat-card"><span>发信传输通道</span><strong>${escapeHtml(st.transport || "unconfigured")}</strong></div>
          <div class="admin-email-stat-card"><span>support@ 授权发信</span><strong>${st.support_sender_authorized ? "已授权" : "未授权（仅 Reply-To）"}</strong></div>
          <div class="admin-email-stat-card"><span>入站路由与转发</span><strong>${escapeHtml(inboundSummary)}</strong></div>
        </div>
        <div class="admin-email-stats-grid">
          <div class="admin-email-stat-card"><span>已送达 (delivered)</span><strong>${Number(stats.delivered || 0)}</strong></div>
          <div class="admin-email-stat-card"><span>排队中 (queued)</span><strong>${Number(stats.queued || 0)}</strong></div>
          <div class="admin-email-stat-card"><span>失败 / 拒收</span><strong>${Number(stats.failed || 0)} / ${Number(stats.rejected || 0)}</strong></div>
          <div class="admin-email-stat-card"><span>客服待处理 / 总会话</span><strong>${Number(stats.inbound_open_threads || 0)} / ${Number(stats.inbound_threads_total || 0)}</strong></div>
        </div>
        <p class="meta-line">投递状态说明：Cloudflare 返回 <code>queued</code> 表示已接收进入异步投递队列，不等同于用户收件箱最终送达；OTP 与安全验证码日志均自动脱敏。</p>
        <p class="meta-line">配置边界说明：发信能力由 Pages 环境管理；客服入站接收、Email Routing 规则与 Gmail 转发目标由独立 Email Worker（<code>thewyj-support-inbound</code>）托管，当前入站观测状态为 <code>${escapeHtml(st.inbound_routing_state || "unverified")}</code> / <code>${escapeHtml(st.inbound_forwarding_state || "unverified")}</code>（Pages 侧无法直接读取外部 Worker 私密转发地址时显示「未验证」，不代表缺失配置）。</p>
        ${superAdmin ? `
          <div class="admin-email-dual-cards">
            <div class="admin-email-card">
              <h3>超级管理员 · 用户邮箱绑定与验证管理</h3>
              <div class="admin-email-form-grid">
                <label class="field-label"><span>用户 ID</span><input id="adminEmailBindUserId" placeholder="user_..." /></label>
                <label class="field-label"><span>绑定邮箱</span><input id="adminEmailBindAddress" type="email" placeholder="name@example.com" /></label>
                <label class="admin-checkbox"><input id="adminEmailBindVerified" type="checkbox" checked /> 标记为已验证绑定邮箱</label>
              </div>
              <div class="action-row"><button class="primary" id="adminEmailBindSaveBtn" type="button">保存绑定状态</button></div>
            </div>
            <div class="admin-email-card">
              <h3>超级管理员 · 受控测试发信</h3>
              <p class="meta-line">白名单测试收件人：${escapeHtml((st.test_recipients || []).join(", ") || "未限制（仅限授权测试地址）")}</p>
              <div class="admin-email-form-grid">
                <label class="field-label"><span>测试收件邮箱</span><input id="adminEmailTestRecipient" type="email" value="${escapeHtml((st.test_recipients || [])[0] || "")}" placeholder="support@thewyj.uk" /></label>
                <label class="field-label"><span>测试主题</span><input id="adminEmailTestSubject" value="Aeris Cloudflare Email 连通性测试" /></label>
              </div>
              <div class="action-row"><button id="adminEmailTestSendBtn" type="button">发送测试邮件</button></div>
            </div>
          </div>
        ` : `<p class="meta-line">普通管理员视图：可管理授权范围内的手写通知与客服会话回复；全站已验证用户群发、测试发信与绑定管理仅限超级管理员。</p>`}
      </div>
    `;
  }

  function renderCompose() {
    const superAdmin = isSuperAdmin();
    const supportAllowed = Boolean(state.overview?.status?.support_sender_authorized && superAdmin);
    const senderEmail = state.senderKind === "support" && supportAllowed ? "support@thewyj.uk" : "noreply@thewyj.uk";
    const selectedList = Array.from(state.selectedRecipients.values());
    const serviceTemplates = state.templates.filter((t) => t.enabled !== 0 && String(t.category || "") === "admin_service");

    return `
      <div class="admin-email-section">
        <div class="admin-email-card">
          <h3>1. 发件身份与收件范围</h3>
          <div class="admin-email-form-grid">
            <label class="field-label">
              <span>发件身份</span>
              <select id="adminEmailSenderKind">
                <option value="noreply" ${state.senderKind === "noreply" ? "selected" : ""}>noreply@thewyj.uk（系统默认，Reply-To: support@thewyj.uk）</option>
                <option value="support" ${state.senderKind === "support" ? "selected" : ""} ${supportAllowed ? "" : "disabled"}>support@thewyj.uk（需超级管理员且 Cloudflare 已授权）</option>
              </select>
            </label>
            <label class="field-label">
              <span>收件对象模式</span>
              <select id="adminEmailTargetMode">
                <option value="single" ${state.targetMode === "single" ? "selected" : ""}>指定单个已验证用户</option>
                <option value="multiple" ${state.targetMode === "multiple" ? "selected" : ""}>指定多个已验证用户（上限 20 人）</option>
                ${superAdmin ? `<option value="all_verified" ${state.targetMode === "all_verified" ? "selected" : ""}>全站已验证用户（高风险·限超级管理员）</option>` : ""}
              </select>
            </label>
          </div>
          <p class="meta-line">当前显示发件人：<strong>${escapeHtml(senderEmail)}</strong> · 回复地址（Reply-To）：<strong>support@thewyj.uk</strong></p>
          ${state.targetMode === "all_verified" ? `
            <div class="admin-email-alert is-warn">高风险操作提醒：全站投递仅发送给已绑定且已验证邮箱、未封禁/未注销的活跃用户（单批上限 50 人，60 分钟冷却一次），预览确认后须输入确认口令与超管密码。</div>
          ` : `
            <div class="admin-email-recipient-picker">
              <div class="admin-toolbar">
                <input id="adminEmailRecipientSearchInput" type="search" value="${escapeHtml(state.recipientSearch)}" placeholder="按用户名或邮箱搜索站内用户" />
                <select id="adminEmailRecipientFilter">
                  <option value="verified" ${state.recipientFilter === "verified" ? "selected" : ""}>仅已验证绑定邮箱</option>
                  <option value="all" ${state.recipientFilter === "all" ? "selected" : ""}>全部用户</option>
                  <option value="unverified" ${state.recipientFilter === "unverified" ? "selected" : ""}>未验证邮箱</option>
                  <option value="unbound" ${state.recipientFilter === "unbound" ? "selected" : ""}>未绑定邮箱</option>
                </select>
                <button id="adminEmailRecipientRefreshBtn" type="button">搜索筛选</button>
              </div>
              <div class="admin-email-recipient-grid" id="adminEmailRecipientList">
                ${state.recipients.length === 0 ? `<p class="meta-line">未找到匹配用户</p>` : state.recipients.map((user) => {
                  const checked = state.selectedRecipients.has(user.user_id);
                  const selectable = Boolean(user.verified && !user.banned);
                  const emailLabel = user.has_email ? escapeHtml(user.email || user.email_masked) : "未绑定邮箱";
                  return `
                    <label class="admin-email-recipient-item ${checked ? "is-selected" : ""} ${selectable ? "" : "is-disabled"}">
                      <input type="checkbox" data-select-recipient="${escapeHtml(user.user_id)}" ${checked ? "checked" : ""} ${selectable ? "" : "disabled"} />
                      <span>
                        <strong>${escapeHtml(user.username)}</strong>
                        <small>${emailLabel} · ${user.verified ? "已验证" : user.has_email ? "未验证（不可发送）" : "未绑定"}${user.banned ? " · 已封禁" : ""}</small>
                      </span>
                    </label>
                  `;
                }).join("")}
              </div>
              <p class="meta-line">已选择收件人（${selectedList.length} 名）：${selectedList.map((u) => escapeHtml(u.username)).join("、") || "尚未选择"}</p>
            </div>
          `}
        </div>

        <div class="admin-email-card">
          <h3>2. 编辑邮件正文与预览</h3>
          <div class="admin-email-form-grid">
            <label class="field-label">
              <span>套用管理员通知模板（仅服务通知类，不含客服回复模板）</span>
              <select id="adminEmailTemplateFill">
                <option value="">-- 自定义正文 --</option>
                ${serviceTemplates.map((t) => `<option value="${escapeHtml(t.template_key)}" ${state.composeTemplateKey === t.template_key ? "selected" : ""}>${escapeHtml(t.title)} (${escapeHtml(t.template_key)})</option>`).join("")}
              </select>
            </label>
            <label class="field-label">
              <span>邮件主题</span>
              <input id="adminEmailSubjectInput" maxlength="180" value="${escapeHtml(state.subject)}" placeholder="请输入简明清晰的邮件主题" />
            </label>
          </div>
          <label class="field-label">
            <span>纯文本正文（系统将自动生成安全转义 HTML 邮件版式，禁止脚本注入）</span>
            <textarea id="adminEmailBodyInput" rows="6" maxlength="20000" placeholder="请输入发送给用户的通知内容...">${escapeHtml(state.body)}</textarea>
          </label>
          <div class="action-row">
            <button id="adminEmailSaveDraftBtn" type="button">保存草稿</button>
            <button class="primary" id="adminEmailPreviewBtn" type="button">生成发送预览</button>
          </div>
        </div>

        ${state.preview ? `
          <div class="admin-email-card admin-email-preview-box" id="adminEmailPreviewCard">
            <h3>3. 发送前预览与确认</h3>
            <dl class="admin-email-meta-dl">
              <dt>发件身份</dt><dd>${escapeHtml(state.preview.from_email)} (${escapeHtml(state.preview.from_name || "Aeris")})</dd>
              <dt>Reply-To</dt><dd>${escapeHtml(state.preview.reply_to)}</dd>
              <dt>实际有效收件人数</dt><dd><strong>${Number(state.preview.effective_recipient_count || 0)}</strong> 人（剔除无效/重复/未验证 ${Number(state.preview.excluded_count || 0)} 条）</dd>
              <dt>预览有效收件对象</dt><dd>${(state.preview.recipients_preview || []).map((r) => `${escapeHtml(r.username)} (${escapeHtml(r.email_masked)})`).join("、") || "-"}</dd>
              <dt>邮件主题</dt><dd>${escapeHtml(state.preview.subject)}</dd>
            </dl>
            <div class="admin-email-body-preview" style="white-space: pre-wrap;">${escapeHtml(state.preview.body).replace(/\n/g, "<br>")}</div>
            ${state.preview.excluded_recipients?.length ? `<p class="meta-line">已过滤收件人原因：${state.preview.excluded_recipients.map((e) => `${escapeHtml(e.username || e.user_id)}:${escapeHtml(e.reason)}`).join(", ")}</p>` : ""}
            <label class="admin-checkbox"><input id="adminEmailConfirmCheckbox" type="checkbox" /> 我已核对发件身份、有效人数与邮件内容，确认立即发送</label>
            ${state.preview.high_risk_all_verified ? `
              <div class="admin-email-form-grid">
                <label class="field-label"><span>输入确认口令（${escapeHtml(state.preview.confirm_phrase_required || "CONFIRM-ALL-VERIFIED")}）</span><input id="adminEmailConfirmPhrase" autocomplete="off" placeholder="CONFIRM-ALL-VERIFIED" /></label>
                <label class="field-label"><span>超级管理员密码复核</span><input id="adminEmailAdminPassword" type="password" autocomplete="current-password" placeholder="输入当前登录密码以授权全站发信" /></label>
              </div>
            ` : ""}
            <div class="action-row"><button class="primary" id="adminEmailConfirmSendBtn" type="button">确认并投递邮件</button></div>
          </div>
        ` : ""}

        ${state.sendResult ? `
          <div class="admin-email-card">
            <h3>最近投递结果回执（批次 ${escapeHtml(state.sendResult.batch_id || "-")}）</h3>
            <p class="meta-line">总计：${Number(state.sendResult.summary?.total || 0)} · 服务商报告已投递（未确认收件箱）：${Number(state.sendResult.summary?.delivered || 0)} · 排队中：${Number(state.sendResult.summary?.queued || 0)} · 拒收/抑制：${Number(state.sendResult.summary?.rejected || 0) + Number(state.sendResult.summary?.suppressed || 0)} · 失败：${Number(state.sendResult.summary?.failed || 0)}</p>
            <div class="admin-email-card-list">
              ${(state.sendResult.results || []).map((r) => `
                <div class="admin-email-row-item">
                  <span><strong>${escapeHtml(r.username || r.user_id)}</strong> (${escapeHtml(r.recipient_masked)})</span>
                  <span>${deliveryStatusBadge(r.delivery_status)} ${r.error_message ? `<small>${escapeHtml(r.error_message)}</small>` : ""}</span>
                </div>
              `).join("")}
            </div>
          </div>
        ` : ""}
      </div>
    `;
  }

  function renderDeliveries() {
    return `
      <div class="admin-email-section">
        <div class="admin-toolbar">
          <input id="adminEmailDeliverySearch" type="search" value="${escapeHtml(state.deliverySearch)}" placeholder="搜索主题、收件人或记录 ID" />
          <select id="adminEmailDeliveryStatusFilter">
            <option value="">全部投递状态</option>
            <option value="delivered" ${state.deliveryStatusFilter === "delivered" ? "selected" : ""}>服务商报告已投递 (delivered)</option>
            <option value="queued" ${state.deliveryStatusFilter === "queued" ? "selected" : ""}>队列中 (queued)</option>
            <option value="sending" ${state.deliveryStatusFilter === "sending" ? "selected" : ""}>发送中 (sending)</option>
            <option value="unknown" ${state.deliveryStatusFilter === "unknown" ? "selected" : ""}>结果未知 (unknown)</option>
            <option value="failed" ${state.deliveryStatusFilter === "failed" ? "selected" : ""}>发送失败 (failed)</option>
            <option value="rejected" ${state.deliveryStatusFilter === "rejected" ? "selected" : ""}>永久拒收 (rejected)</option>
          </select>
          <select id="adminEmailDeliveryChannelFilter">
            <option value="">全部来源通道</option>
            <option value="transactional" ${state.deliveryChannelFilter === "transactional" ? "selected" : ""}>自动事务邮件</option>
            <option value="admin_manual" ${state.deliveryChannelFilter === "admin_manual" ? "selected" : ""}>管理员手动发送</option>
            <option value="support_reply" ${state.deliveryChannelFilter === "support_reply" ? "selected" : ""}>客服回复</option>
          </select>
          <button id="adminEmailDeliveryRefreshBtn" type="button">刷新记录</button>
        </div>
        <div class="admin-email-card-list">
          ${state.deliveries.length === 0 ? `<p class="meta-line">暂无符合权限范围的发信记录。</p>` : state.deliveries.map((d) => `
            <article class="admin-email-card">
              <header class="admin-email-card-header">
                <div>
                  <strong>${escapeHtml(d.subject)}</strong>
                  <p class="meta-line">${escapeHtml(d.kind)} · ${escapeHtml(d.channel)} · ${escapeHtml(d.from_email)} → ${escapeHtml(d.recipient_email || d.recipient_masked)} ${d.body_redacted ? `<span class="admin-email-badge is-muted">敏感码已脱敏</span>` : ""}</p>
                </div>
                <div>${deliveryStatusBadge(d.delivery_status)}</div>
              </header>
              <p class="admin-email-excerpt">${escapeHtml(d.body_preview)}</p>
              <footer class="admin-email-card-footer">
                <small>记录 ${escapeHtml(d.delivery_id)} · ${escapeHtml(formatTime(d.created_at))}${d.error_message ? ` · 错误 [${escapeHtml(d.error_code || "err")}]: ${escapeHtml(d.error_message)}` : ""}</small>
                ${d.retryable ? `<button data-retry-delivery="${escapeHtml(d.delivery_id)}" type="button">安全重试 (${Number(d.retry_count)}/${Number(d.max_retries)})</button>` : ""}
              </footer>
            </article>
          `).join("")}
        </div>
      </div>
    `;
  }

  function renderInbound() {
    const detail = state.activeThreadDetail;
    const thread = detail?.thread;
    return `
      <div class="admin-email-section">
        <div class="admin-toolbar">
          <input id="adminEmailInboundSearch" type="search" value="${escapeHtml(state.inboundSearch)}" placeholder="搜索客服来信主题、发件人或会话 ID" />
          <select id="adminEmailInboundStatusFilter">
            <option value="">全部工单状态</option>
            <option value="open" ${state.inboundStatusFilter === "open" ? "selected" : ""}>待处理 (open)</option>
            <option value="replied" ${state.inboundStatusFilter === "replied" ? "selected" : ""}>已回复 (replied)</option>
            <option value="closed" ${state.inboundStatusFilter === "closed" ? "selected" : ""}>已关闭 (closed)</option>
          </select>
          <button id="adminEmailInboundRefreshBtn" type="button">刷新收件箱</button>
        </div>
        <div class="admin-email-inbound-layout">
          <div class="admin-email-thread-list">
            ${state.inboundThreads.length === 0 ? `<p class="meta-line">暂无发往 support@thewyj.uk 的入站会话。</p>` : state.inboundThreads.map((t) => `
              <button class="admin-email-thread-item ${thread?.thread_id === t.thread_id ? "active" : ""}" data-open-thread="${escapeHtml(t.thread_id)}" type="button">
                <div class="admin-email-thread-top">
                  <strong>${escapeHtml(t.original_subject)}</strong>
                  ${inboundStatusBadge(t.status)}
                </div>
                <small>${escapeHtml(t.sender_email)}${t.matched_username ? ` · 已绑定用户 ${escapeHtml(t.matched_username)}` : " · 未绑定用户"} · ${escapeHtml(formatTime(t.last_message_at))}</small>
              </button>
            `).join("")}
          </div>
          <div class="admin-email-thread-detail">
            ${!thread ? `<p class="meta-line">请在左侧选择一个客服邮件会话以查看往来详情并从正式域名人工回复。</p>` : `
              <div class="admin-email-card">
                <header class="admin-email-card-header">
                  <div>
                    <h3>${escapeHtml(thread.original_subject)}</h3>
                    <p class="meta-line">来信方：${escapeHtml(thread.sender_email)} · 会话：${escapeHtml(thread.thread_id)} · ${thread.matched_username ? `关联站内用户：${escapeHtml(thread.matched_username)}` : "外部或未验证邮箱发件人"}</p>
                  </div>
                  <div class="action-row">
                    ${inboundStatusBadge(thread.status)}
                    <button data-thread-status="closed" data-thread-id="${escapeHtml(thread.thread_id)}" type="button">关闭工单</button>
                    <button data-thread-status="open" data-thread-id="${escapeHtml(thread.thread_id)}" type="button">重开</button>
                    ${isSuperAdmin() ? `<button data-thread-status="delete" data-thread-id="${escapeHtml(thread.thread_id)}" type="button">删除记录</button>` : ""}
                  </div>
                </header>
                <div class="admin-email-timeline">
                  ${buildInboundTimeline(detail.inbound_messages, detail.outbound_replies).map((entry) => {
                    if (entry.kind === "outbound") {
                      const r = entry.item;
                      return `
                    <div class="admin-email-msg is-outbound">
                      <div class="admin-email-msg-meta">
                        <strong>正式回复 · ${escapeHtml(r.from_email)} (Reply-To: ${escapeHtml(r.reply_to || "support@thewyj.uk")})</strong>
                        <span>${deliveryStatusBadge(r.status)} · ${escapeHtml(formatTime(r.created_at || r.sent_at))}</span>
                      </div>
                      <pre class="admin-email-pre">${escapeHtml(r.body_preview)}</pre>
                    </div>`;
                    }
                    const m = entry.item;
                    const parsedBody = splitQuotedEmailBody(m.text_excerpt);
                    return `
                    <div class="admin-email-msg is-inbound">
                      <div class="admin-email-msg-meta">
                        <strong>用户来信 · ${escapeHtml(m.sender_email)}</strong>
                        <span>${escapeHtml(securityStatusLabel(m.security_status))} · Gmail 转发: ${escapeHtml(m.forward_status)}${m.forward_error ? ` (${escapeHtml(m.forward_error)})` : ""} · ${escapeHtml(formatTime(m.received_at))}</span>
                      </div>
                      <pre class="admin-email-pre">${escapeHtml(parsedBody.mainText)}</pre>
                      ${parsedBody.hasQuote ? `
                      <details class="admin-email-quote">
                        <summary>展开历史引用原文</summary>
                        <pre class="admin-email-pre admin-email-pre-quoted">${escapeHtml(parsedBody.quotedText)}</pre>
                      </details>` : ""}
                    </div>`;
                  }).join("")}
                </div>
                <div class="admin-email-reply-box">
                  <h4>正式域名人工回复</h4>
                  ${(() => {
                    const supportTemplates = state.templates.filter((t) => t.enabled !== 0 && String(t.category || "") === "support_reply");
                    return supportTemplates.length ? `
                      <label class="field-label">
                        <span>套用客服回复模板（可选，自动绑定当前会话编号与支持邮箱）</span>
                        <select id="adminEmailReplyTemplateFill">
                          <option value="">-- 手动填写回复 --</option>
                          ${supportTemplates.map((t) => `<option value="${escapeHtml(t.template_key)}" ${state.replyTemplateKey === t.template_key ? "selected" : ""}>${escapeHtml(t.title)} (${escapeHtml(t.template_key)})</option>`).join("")}
                        </select>
                      </label>
                    ` : "";
                  })()}
                  <div class="admin-email-form-grid">
                    <label class="field-label">
                      <span>发件身份策略</span>
                      <select id="adminEmailReplyFromMode">
                        <option value="auto" ${state.replyFromMode === "auto" ? "selected" : ""}>自动策略（已授权用 support@thewyj.uk，否则 noreply@ + Reply-To）</option>
                        <option value="noreply" ${state.replyFromMode === "noreply" ? "selected" : ""}>noreply@thewyj.uk（Reply-To: support@thewyj.uk）</option>
                        <option value="support" ${state.replyFromMode === "support" ? "selected" : ""}>support@thewyj.uk（仅授权时允许）</option>
                      </select>
                    </label>
                    <label class="field-label"><span>回复主题</span><input id="adminEmailReplySubject" value="${escapeHtml(state.replySubject)}" maxlength="180" /></label>
                  </div>
                  <label class="field-label"><span>回复正文</span><textarea id="adminEmailReplyBody" rows="4" maxlength="20000" placeholder="请输入对用户的客服回复内容...">${escapeHtml(state.replyBody)}</textarea></label>
                  <label class="admin-checkbox"><input id="adminEmailReplyConfirmCheck" type="checkbox" ${state.replyPreviewConfirmed ? "checked" : ""} /> 我已确认回复收件人、主题、引用线程和正式域名发信身份</label>
                  <div class="action-row"><button class="primary" id="adminEmailSendReplyBtn" type="button">确认发送客服回复</button></div>
                </div>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  }

  function renderTemplates() {
    const superAdmin = isSuperAdmin();
    return `
      <div class="admin-email-section">
        <div class="admin-email-card-list">
          ${state.templates.map((tpl) => `
            <article class="admin-email-card">
              <header class="admin-email-card-header">
                <div>
                  <strong>${escapeHtml(tpl.title)}</strong>
                  <p class="meta-line">键名：<code>${escapeHtml(tpl.template_key)}</code> · 分类：${escapeHtml(tpl.category)} · ${Number(tpl.is_system) === 1 ? "系统内置事务模板" : "服务通知模板"}</p>
                </div>
                <span class="admin-email-badge ${Number(tpl.enabled) === 1 ? "is-success" : "is-muted"}">${Number(tpl.enabled) === 1 ? "启用" : "停用"}</span>
              </header>
              <p class="meta-line">主题模板：${escapeHtml(tpl.subject_template)}</p>
              <pre class="admin-email-pre">${escapeHtml(tpl.body_template)}</pre>
            </article>
          `).join("")}
        </div>
        ${superAdmin ? `
          <div class="admin-email-card">
            <h3>新增或更新服务模板（超级管理员）</h3>
            <div class="admin-email-form-grid">
              <label class="field-label"><span>模板键名 (template_key)</span><input id="adminEmailTplKey" placeholder="service_maintenance_v2" /></label>
              <label class="field-label"><span>模板名称</span><input id="adminEmailTplTitle" placeholder="系统维护通知模板" /></label>
              <label class="field-label"><span>分类</span><input id="adminEmailTplCategory" value="admin_service" /></label>
              <label class="field-label"><span>主题模板</span><input id="adminEmailTplSubject" placeholder="Aeris 服务维护通知" /></label>
            </div>
            <label class="field-label"><span>正文模板</span><textarea id="adminEmailTplBody" rows="4" placeholder="您好，\n\n请填写通知模板内容。"></textarea></label>
            <div class="action-row"><button class="primary" id="adminEmailTplSaveBtn" type="button">保存模板</button></div>
          </div>
        ` : ""}
      </div>
    `;
  }

  function bindEvents() {
    root.querySelectorAll("[data-email-subtab]").forEach((btn) => {
      btn.addEventListener("click", () => {
        state.tab = btn.dataset.emailSubtab;
        state.sendResult = null;
        refreshCurrentTab();
      });
    });

    if (state.tab === "overview") {
      root.querySelector("#adminEmailBindSaveBtn")?.addEventListener("click", async () => {
        try {
          const res = await apiPost("/api/admin/email/user-binding", {
            user_id: root.querySelector("#adminEmailBindUserId")?.value || "",
            email: root.querySelector("#adminEmailBindAddress")?.value || "",
            verified: Boolean(root.querySelector("#adminEmailBindVerified")?.checked),
          });
          setFeedback({ message: `已更新用户 ${res.username} 的绑定邮箱状态`, error: "" });
          await loadOverview();
          render();
        } catch (err) {
          setFeedback({ message: "", error: err?.message || "更新绑定失败" });
        }
      });

      root.querySelector("#adminEmailTestSendBtn")?.addEventListener("click", async () => {
        try {
          const res = await apiPost("/api/admin/email/test-send", {
            recipient: root.querySelector("#adminEmailTestRecipient")?.value || "",
            subject: root.querySelector("#adminEmailTestSubject")?.value || "",
          });
          setFeedback({
            message: `测试邮件状态：${res.result?.delivery_status || "unknown"}（队列投递不等同最终送达）`,
            error: "",
          });
          await loadOverview();
          render();
        } catch (err) {
          setFeedback({ message: "", error: err?.message || "测试发信失败" });
        }
      });
    }

    if (state.tab === "compose") {
      root.querySelector("#adminEmailSenderKind")?.addEventListener("change", (e) => {
        state.senderKind = e.target.value;
        state.preview = null;
        render();
      });
      root.querySelector("#adminEmailTargetMode")?.addEventListener("change", (e) => {
        state.targetMode = e.target.value;
        state.preview = null;
        render();
      });
      root.querySelector("#adminEmailRecipientSearchInput")?.addEventListener("input", (e) => {
        state.recipientSearch = e.target.value;
      });
      root.querySelector("#adminEmailRecipientFilter")?.addEventListener("change", (e) => {
        state.recipientFilter = e.target.value;
        loadRecipients().then(render).catch((err) => setFeedback({ error: err?.message || "筛选失败" }));
      });
      root.querySelector("#adminEmailRecipientRefreshBtn")?.addEventListener("click", () => {
        loadRecipients().then(render).catch((err) => setFeedback({ error: err?.message || "搜索失败" }));
      });
      root.querySelectorAll("[data-select-recipient]").forEach((cb) => {
        cb.addEventListener("change", () => {
          const uid = cb.dataset.selectRecipient;
          const user = state.recipients.find((u) => u.user_id === uid);
          if (state.targetMode === "single") {
            state.selectedRecipients.clear();
          }
          if (cb.checked && user) {
            state.selectedRecipients.set(uid, user);
          } else {
            state.selectedRecipients.delete(uid);
          }
          state.preview = null;
          render();
        });
      });
      root.querySelector("#adminEmailTemplateFill")?.addEventListener("change", (e) => {
        const key = e.target.value;
        state.composeTemplateKey = key || "";
        const tpl = state.templates.find((t) => t.template_key === key && String(t.category || "") === "admin_service");
        if (tpl) {
          const existingBody = normalizeEditorTemplateText(state.body || "").trim();
          const rawSub = normalizeEditorTemplateText(tpl.subject_template || state.subject || "");
          const rawBody = normalizeEditorTemplateText(tpl.body_template || state.body || "");
          state.subject = rawSub.replace(/\{\{\s*support_email\s*\}\}/gi, "support@thewyj.uk");
          state.body = rawBody
            .replace(/\{\{\s*support_email\s*\}\}/gi, "support@thewyj.uk")
            .replace(/\{\{\s*body\s*\}\}/gi, existingBody || "请在此填写通知正文内容。");
          state.preview = null;
          render();
        }
      });
      root.querySelector("#adminEmailSubjectInput")?.addEventListener("input", (e) => {
        state.subject = e.target.value;
        state.preview = null;
      });
      root.querySelector("#adminEmailBodyInput")?.addEventListener("input", (e) => {
        state.body = e.target.value;
        state.preview = null;
      });
      root.querySelector("#adminEmailSaveDraftBtn")?.addEventListener("click", async () => {
        try {
          const res = await apiPost("/api/admin/email/drafts", {
            draft_id: state.draftId || undefined,
            target_mode: state.targetMode,
            recipient_user_ids: Array.from(state.selectedRecipients.keys()),
            subject: state.subject,
            body: state.body,
            sender_kind: state.senderKind,
          });
          state.draftId = res.draft_id;
          setFeedback({ message: `草稿 ${res.draft_id} 已保存`, error: "" });
        } catch (err) {
          setFeedback({ error: err?.message || "草稿保存失败" });
        }
      });
      root.querySelector("#adminEmailPreviewBtn")?.addEventListener("click", async () => {
        try {
          const preview = await apiPost("/api/admin/email/preview", {
            draft_id: state.draftId || undefined,
            template_key: state.composeTemplateKey || undefined,
            target_mode: state.targetMode,
            recipient_user_ids: Array.from(state.selectedRecipients.keys()),
            sender_kind: state.senderKind,
            subject: state.subject,
            body: state.body,
          });
          state.preview = preview;
          state.sendResult = null;
          setFeedback({ message: "已生成发送前预览，请核对有效人数后确认发送。", error: "" });
          render();
        } catch (err) {
          setFeedback({ error: err?.message || "生成预览失败" });
        }
      });
      root.querySelector("#adminEmailConfirmSendBtn")?.addEventListener("click", async () => {
        const confirmed = Boolean(root.querySelector("#adminEmailConfirmCheckbox")?.checked);
        if (!confirmed) {
          setFeedback({ error: "请先勾选确认复选框再提交发送" });
          return;
        }
        try {
          const res = await apiPost("/api/admin/email/send", {
            preview_token: state.preview.preview_token,
            template_key: state.composeTemplateKey || undefined,
            confirmed: true,
            subject: state.preview.subject,
            body: state.preview.body,
            confirm_phrase: root.querySelector("#adminEmailConfirmPhrase")?.value || undefined,
            admin_password: root.querySelector("#adminEmailAdminPassword")?.value || undefined,
          });
          state.sendResult = res;
          state.preview = null;
          setFeedback({ message: `发送请求已执行：送达 ${res.summary?.delivered || 0}，排队 ${res.summary?.queued || 0}`, error: "" });
          render();
        } catch (err) {
          setFeedback({ error: err?.message || "发送失败" });
        }
      });
    }

    if (state.tab === "deliveries") {
      root.querySelector("#adminEmailDeliverySearch")?.addEventListener("input", (e) => {
        state.deliverySearch = e.target.value;
      });
      root.querySelector("#adminEmailDeliveryStatusFilter")?.addEventListener("change", (e) => {
        state.deliveryStatusFilter = e.target.value;
        loadDeliveries().then(render).catch((err) => setFeedback({ error: err?.message || "刷新失败" }));
      });
      root.querySelector("#adminEmailDeliveryChannelFilter")?.addEventListener("change", (e) => {
        state.deliveryChannelFilter = e.target.value;
        loadDeliveries().then(render).catch((err) => setFeedback({ error: err?.message || "刷新失败" }));
      });
      root.querySelector("#adminEmailDeliveryRefreshBtn")?.addEventListener("click", () => {
        loadDeliveries().then(render).catch((err) => setFeedback({ error: err?.message || "刷新失败" }));
      });
      root.querySelectorAll("[data-retry-delivery]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            const res = await apiPost("/api/admin/email/deliveries/retry", {
              delivery_id: btn.dataset.retryDelivery,
            });
            setFeedback({
              message: `重试结果：${res.retry_result?.delivery_status || "unknown"}`,
              error: "",
            });
            await loadDeliveries();
            render();
          } catch (err) {
            setFeedback({ error: err?.message || "重试失败" });
          }
        });
      });
    }

    if (state.tab === "inbound") {
      root.querySelector("#adminEmailInboundSearch")?.addEventListener("input", (e) => {
        state.inboundSearch = e.target.value;
      });
      root.querySelector("#adminEmailInboundStatusFilter")?.addEventListener("change", (e) => {
        state.inboundStatusFilter = e.target.value;
        loadInboundList().then(render).catch((err) => setFeedback({ error: err?.message || "加载失败" }));
      });
      root.querySelector("#adminEmailInboundRefreshBtn")?.addEventListener("click", () => {
        refreshCurrentTab();
      });
      root.querySelectorAll("[data-open-thread]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            await loadInboundThread(btn.dataset.openThread);
            render();
          } catch (err) {
            setFeedback({ error: err?.message || "加载会话失败" });
          }
        });
      });
      root.querySelectorAll("[data-thread-status]").forEach((btn) => {
        btn.addEventListener("click", async () => {
          try {
            const action = btn.dataset.threadStatus;
            await apiPost("/api/admin/email/inbound/status", {
              thread_id: btn.dataset.threadId,
              action,
            });
            if (action === "delete") state.activeThreadDetail = null;
            else await loadInboundThread(btn.dataset.threadId);
            await loadInboundList();
            setFeedback({ message: `工单状态已更新 (${action})`, error: "" });
            render();
          } catch (err) {
            setFeedback({ error: err?.message || "更新工单状态失败" });
          }
        });
      });
      root.querySelector("#adminEmailReplyTemplateFill")?.addEventListener("change", (e) => {
        const key = e.target.value;
        state.replyTemplateKey = key || "";
        const thread = state.activeThreadDetail?.thread;
        const tpl = state.templates.find((t) => t.template_key === key && String(t.category || "") === "support_reply");
        if (tpl && thread) {
          const existingReply = normalizeEditorTemplateText(state.replyBody || "").trim();
          const baseSubject = thread.original_subject || thread.normalized_subject || "Aeris 客服回复";
          state.replySubject = normalizeEditorTemplateText(tpl.subject_template || "Re: {{subject}}")
            .replace(/\{\{\s*subject\s*\}\}/gi, baseSubject)
            .replace(/\{\{\s*thread_id\s*\}\}/gi, thread.thread_id || "")
            .replace(/\{\{\s*support_email\s*\}\}/gi, "support@thewyj.uk");
          state.replyBody = normalizeEditorTemplateText(tpl.body_template || "{{body}}")
            .replace(/\{\{\s*thread_id\s*\}\}/gi, thread.thread_id || "")
            .replace(/\{\{\s*subject\s*\}\}/gi, baseSubject)
            .replace(/\{\{\s*support_email\s*\}\}/gi, "support@thewyj.uk")
            .replace(/\{\{\s*body\s*\}\}/gi, existingReply || "您好，感谢联系 Aeris。");
          state.replyPreviewConfirmed = false;
          render();
        }
      });
      root.querySelector("#adminEmailReplyFromMode")?.addEventListener("change", (e) => {
        state.replyFromMode = e.target.value;
      });
      root.querySelector("#adminEmailReplySubject")?.addEventListener("input", (e) => {
        state.replySubject = e.target.value;
      });
      root.querySelector("#adminEmailReplyBody")?.addEventListener("input", (e) => {
        state.replyBody = e.target.value;
      });
      root.querySelector("#adminEmailReplyConfirmCheck")?.addEventListener("change", (e) => {
        state.replyPreviewConfirmed = Boolean(e.target.checked);
      });
      root.querySelector("#adminEmailSendReplyBtn")?.addEventListener("click", async () => {
        const threadId = state.activeThreadDetail?.thread?.thread_id;
        if (!threadId) return;
        if (!state.replyPreviewConfirmed) {
          setFeedback({ error: "发送客服回复前请勾选确认发件身份与引用线程" });
          return;
        }
        try {
          const res = await apiPost("/api/admin/email/inbound/reply", {
            thread_id: threadId,
            from_mode: state.replyFromMode,
            subject: state.replySubject,
            body: state.replyBody,
            confirmed: true,
          });
          state.replyBody = "";
          state.replyPreviewConfirmed = false;
          setFeedback({ message: `客服回复状态：${res.delivery?.delivery_status || "sent"}`, error: "" });
          await Promise.all([loadInboundList(), loadInboundThread(threadId)]);
          render();
        } catch (err) {
          setFeedback({ error: err?.message || "发送客服回复失败" });
        }
      });
    }

    if (state.tab === "templates") {
      root.querySelector("#adminEmailTplSaveBtn")?.addEventListener("click", async () => {
        try {
          const res = await apiPost("/api/admin/email/templates", {
            template_key: root.querySelector("#adminEmailTplKey")?.value || "",
            title: root.querySelector("#adminEmailTplTitle")?.value || "",
            category: root.querySelector("#adminEmailTplCategory")?.value || "admin_service",
            subject_template: root.querySelector("#adminEmailTplSubject")?.value || "",
            body_template: root.querySelector("#adminEmailTplBody")?.value || "",
          });
          setFeedback({ message: `模板 ${res.template?.template_key} 已保存`, error: "" });
          await loadTemplates();
          render();
        } catch (err) {
          setFeedback({ error: err?.message || "保存模板失败" });
        }
      });
    }
  }

  function render() {
    const subtabs = [
      ["overview", "邮件概览"],
      ["compose", "新建邮件"],
      ["deliveries", "已发送记录"],
      ["inbound", "客服邮件及回复"],
      ["templates", "模板管理"],
    ];

    let bodyHtml = "";
    if (state.tab === "overview") bodyHtml = renderOverview();
    else if (state.tab === "compose") bodyHtml = renderCompose();
    else if (state.tab === "deliveries") bodyHtml = renderDeliveries();
    else if (state.tab === "inbound") bodyHtml = renderInbound();
    else bodyHtml = renderTemplates();

    root.innerHTML = `
      <div class="admin-email-subtabs" role="tablist" aria-label="邮件中心子模块">
        ${subtabs.map(([key, label]) => `
          <button class="${state.tab === key ? "active" : ""}" data-email-subtab="${key}" type="button" role="tab" aria-selected="${state.tab === key}">${label}</button>
        `).join("")}
      </div>
      <p class="meta-line" id="adminEmailCenterStatus" aria-live="polite">${escapeHtml(state.message)}</p>
      <p class="error" id="adminEmailCenterError" aria-live="polite">${escapeHtml(state.error)}</p>
      ${bodyHtml}
    `;
    bindEvents();
  }

  return {
    async load(tab = null) {
      if (tab) state.tab = tab;
      await refreshCurrentTab();
    },
    render,
  };
}
