import hashlib
import json
import re
import sqlite3
import unittest
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


class IdCollector(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.ids = []

    def handle_starttag(self, _tag, attrs):
        attributes = dict(attrs)
        if attributes.get("id"):
            self.ids.append(attributes["id"])


class StaticSiteTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.html = (ROOT / "index.html").read_text(encoding="utf-8")
        cls.app = (ROOT / "app.js").read_text(encoding="utf-8")
        cls.core = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted((ROOT / "js" / "core").glob("*.js"))
        )
        cls.membership = "\n".join(
            path.read_text(encoding="utf-8")
            for path in sorted((ROOT / "js" / "membership").glob("*.js"))
        )
        cls.frontend = cls.app + "\n" + cls.core + "\n" + cls.membership
        cls.tools = (ROOT / "tools.js").read_text(encoding="utf-8")
        cls.tool_modules = {
            path.stem: path.read_text(encoding="utf-8")
            for path in sorted((ROOT / "js" / "tools").glob("*.js"))
        }
        cls.tools_bundle = cls.tools + "\n" + "\n".join(cls.tool_modules.values())
        cls.tool_catalog = cls.tool_modules["catalog"]
        cls.workflows = (ROOT / "workflows.js").read_text(encoding="utf-8")
        cls.styles = (ROOT / "styles.css").read_text(encoding="utf-8")
        cls.product_styles = (ROOT / "product-ui.css").read_text(encoding="utf-8")
        cls.design_styles = (ROOT / "design-system.css").read_text(encoding="utf-8")
        cls.public_styles = (ROOT / "public-experience.css").read_text(encoding="utf-8")
        cls.workspace_styles = (ROOT / "workspace-experience.css").read_text(encoding="utf-8")
        cls.worker = (ROOT / "sw.js").read_text(encoding="utf-8")
        cls.changelog = (ROOT / "changelog.js").read_text(encoding="utf-8")
        cls.learning_sync = (ROOT / "learning-sync.js").read_text(encoding="utf-8")
        cls.finance = (ROOT / "js" / "finance" / "app.js").read_text(encoding="utf-8")

    def test_html_ids_are_unique_and_app_references_exist(self):
        parser = IdCollector()
        parser.feed(self.html)
        duplicates = sorted({item for item in parser.ids if parser.ids.count(item) > 1})
        self.assertEqual(duplicates, [])
        html_ids = set(parser.ids)
        direct_references = set(re.findall(r'\$\("([A-Za-z0-9_-]+)"\)', self.app))
        self.assertEqual(sorted(direct_references - html_ids), [])
        required = {
            "entryScreen", "authPanel", "modulePicker", "projectPicker",
            "projectApp", "toolsPanel", "membershipModal", "adminPanel",
            "shareViewer", "toolWorkbenchDescription", "paymentLanguage", "wrongActionMessage",
            "moduleAccessMessage", "paymentMethodList", "paymentMethod",
            "paymentQrWrap", "paymentQrImage", "paymentQrMessage", "aiSearchInput",
            "aiSearchResults", "cancelPaymentOrderBtn",
            "membershipGoalField", "membershipGoalList", "membershipGoalHint",
            "membershipPlanStep", "membershipPlanHeading",
            "navGuestActions", "navLoginBtn", "navRegisterBtn", "accountMenu",
            "dashboardGreeting", "dashboardMembershipName", "dashboardEntitlements",
            "dashboardStreak", "dashboardWrongCount", "dashboardLatestResult",
            "dashboardFavoriteTools", "dashboardRecentTools", "dashboardAccountStatus",
            "publicHome", "changelogPage", "trialPage", "trialQuizPanel",
            "trialTextPanel", "trialJsonPanel", "trialImagePanel",
            "siteVersionLabel", "versionNotice", "versionNoticeTitle", "versionNoticeMessage",
            "changelogList", "changelogCurrentVersion", "feedbackBtn", "feedbackModal",
            "feedbackForm", "feedbackType", "feedbackTitleInput", "feedbackContent",
            "feedbackToolId", "feedbackErrorCode", "myFeedbackList", "featureVotingList",
            "adminFeedbackTab", "adminFeedbackView", "adminFeedbackSearch",
            "adminFeedbackType", "adminFeedbackStatus", "adminFeedbackList",
            "openWorkflowBtn", "workflowWorkspace", "workflowAccessBadge", "workflowList",
            "workflowTemplateList", "workflowEditor", "workflowNameInput", "workflowStepList",
            "workflowToolSelect", "workflowFileInput", "workflowBatchToggle", "workflowRunState",
            "runWorkflowBtn", "cancelWorkflowBtn", "downloadWorkflowResultBtn", "copyWorkflowResultBtn",
            "financePage", "financeLocked", "financeWorkspace", "financeTransactionList",
            "financeTransactionModal", "financeCategoryModal", "financeBudgetModal",
            "financeSyncStatus", "financeSyncBtn", "financeUndoBar", "financeUndoBtn",
        }
        self.assertEqual(sorted(required - html_ids), [])

    def test_manifest_and_service_worker_shell_are_deployable(self):
        manifest = json.loads((ROOT / "manifest.webmanifest").read_text(encoding="utf-8"))
        self.assertEqual(manifest["name"], "thewyj")
        self.assertEqual(manifest["short_name"], "WYJ")
        self.assertEqual(manifest["start_url"], "/")
        self.assertEqual(manifest["background_color"], "#f6f8fb")
        self.assertEqual(manifest["theme_color"], "#ffffff")
        cache_source = self.worker.split("const CORE_SHELL = [", 1)[1].split("];", 1)[0]
        cache_source += self.worker.split("const OPTIONAL_BRAND_ASSETS = [", 1)[1].split("];", 1)[0]
        cached_paths = re.findall(r'"(/[^"?]+)(?:\?[^\"]+)?"', cache_source)
        for path in cached_paths:
            if path == "/":
                continue
            self.assertTrue((ROOT / path.lstrip("/")).exists(), path)
        self.assertIn("/assets/logo.png", self.worker)
        self.assertNotIn("/assets/splash-screen.png", self.worker)
        self.assertRegex(self.worker, r'const CACHE = "wyj-shell-[^"]+"')
        release_token = "20260901-task19-remediation-r4"
        for asset in ("manifest.webmanifest", "styles.css", "product-ui.css", "design-system.css", "public-experience.css", "workspace-experience.css", "changelog.js", "tools.js", "workflows.js", "learning-sync.js", "app.js"):
            self.assertIn(f'/{asset}?v={release_token}', self.html)
            self.assertIn(f'/{asset}?v={release_token}', self.worker)
        self.assertIn(f'const CACHE = "wyj-shell-{release_token}-es-modules"', self.worker)
        self.assertIn('export const APP_VERSION = "2026-09-01-task19-production-final"', self.core)
        self.assertIn(f'export const ASSET_RELEASE = "{release_token}"', self.core)
        self.assertIn('navigator.serviceWorker.register(`/sw.js?v=${ASSET_RELEASE}`)', self.app)
        for module in ("api", "config", "router", "session", "storage", "ui", "design-system"):
            self.assertIn(f'/js/core/{module}.js?v={release_token}', self.worker)
        self.assertIn('type="module" src="/app.js?v=20260901-task19-remediation-r4"', self.html)
        stage_script = (ROOT / "scripts" / "stage_pages_deploy.mjs").read_text(encoding="utf-8")
        self.assertIn('const ROOT_DIRECTORIES = Object.freeze(["assets", "functions", "js", "vendor"]);', stage_script)
        for asset in ("design-system.css", "public-experience.css", "workspace-experience.css"):
            self.assertIn(f'  "{asset}",', stage_script)
        self.assertNotIn('.tool-e2e', stage_script)
        self.assertIn('"pages:stage": "node scripts/stage_pages_deploy.mjs"', (ROOT / "package.json").read_text(encoding="utf-8"))
        server = (ROOT / "local-backend" / "server.py").read_text(encoding="utf-8")
        self.assertIn('APP_BUILD = "2026-08-22-learning-sync-record-id"', server)
        self.assertIn('"/trial", "/changelog"', server)
        self.assertFalse((ROOT / "_redirects").exists())
        self.assertFalse((ROOT / "404.html").exists())

    def test_browser_module_graph_uses_one_release_version(self):
        release_token = "20260901-task19-remediation-r4"
        import_pattern = re.compile(
            r'(?:from\s+|import\s+)["\'](\.{1,2}/[^"\']+\.js(?:\?[^"\']*)?)["\']'
        )
        source_paths = [ROOT / "app.js", ROOT / "tools.js", *sorted((ROOT / "js").rglob("*.js"))]
        imports_found = 0
        for source_path in source_paths:
            source = source_path.read_text(encoding="utf-8")
            for specifier in import_pattern.findall(source):
                imports_found += 1
                self.assertTrue(
                    specifier.endswith(f"?v={release_token}"),
                    f"unversioned browser module import in {source_path.relative_to(ROOT)}: {specifier}",
                )
                relative_target = specifier.split("?", 1)[0]
                target_path = (source_path.parent / relative_target).resolve()
                self.assertTrue(target_path.is_file(), str(target_path))
                public_url = f"/{target_path.relative_to(ROOT).as_posix()}?v={release_token}"
                self.assertIn(f'"{public_url}"', self.worker)
        self.assertGreater(imports_found, 20)
        self.assertEqual(re.findall(r'"/js/[^"?]+\.js"', self.worker), [])

    def test_public_share_routes_do_not_probe_the_legacy_backend(self):
        self.assertIn(
            'const shouldProbeCloudBackend = () => !location.pathname.startsWith("/share/");',
            self.app,
        )
        self.assertIn(
            'const backendPromise = initialPath.startsWith("/share/") ? Promise.resolve() : refreshBackendState();',
            self.app,
        )

    def test_public_home_and_trial_are_explicitly_limited(self):
        for route in ('href="/"', 'href="/changelog"'):
            self.assertIn(route, self.html)
        self.assertIn('const register = path === "/register";', self.app)
        self.assertIn('path: register ? "/register" : "/login"', self.app)
        for trial_tool in ("quiz", "text", "json", "image-compress", "image-format"):
            self.assertIn(f'data-trial-tool="{trial_tool}"', self.html)
        self.assertIn('id="trialQuizCount" type="number" min="1" max="10"', self.html)
        self.assertRegex(self.html, r'id="trialImageInput" type="file"(?![^>]*\bmultiple\b)')
        self.assertIn("const TRIAL_MAX_QUESTIONS = 10;", self.app)
        self.assertIn("const TRIAL_TOOL_IDS = new Set", self.app)
        self.assertIn("function showPublicHome(", self.app)
        self.assertIn("function showChangelog(", self.app)
        self.assertIn("function showTrial(", self.app)
        self.assertIn("function processTrialImage(", self.app)
        self.assertNotIn('data-trial-tool="temporary', self.html)
        self.assertNotIn('data-trial-tool="batch', self.html)
        self.assertIn("匿名试用不保存服务器学习记录，也不能创建临时分享", self.html)

    def test_changelog_feedback_and_voting_contract(self):
        self.assertIn("globalThis.WYJ_CHANGELOG", self.changelog)
        for field in ("version", "build", "date", "features", "improvements", "fixes", "security"):
            self.assertRegex(self.changelog, rf"\b{field}:\s*")
        self.assertIn("2026-08-22-learning-sync-record-id", self.changelog)
        self.assertIn("function renderChangelog()", self.app)
        self.assertIn("function maybeShowVersionNotice()", self.app)
        self.assertIn("function submitFeedback(", self.app)
        self.assertIn("function voteForFeature(", self.app)
        self.assertIn('api("/api/feedback"', self.app)
        self.assertIn('apiGet("/api/feedback/mine")', self.app)
        self.assertIn('apiGet("/api/feedback/voting")', self.app)
        self.assertIn('/api/admin/feedback', self.app)
        self.assertIn("反馈正文和提交者不会公开", self.html)
        self.assertIn("不会上传你在工具中处理的原始文本", self.html)

    def test_tool_workflow_contract_is_explicit_and_local_first(self):
        self.assertIn("const SCHEMA_VERSION = 1;", self.workflows)
        self.assertIn("const CAPABILITY_REGISTRY = Object.freeze", self.workflows)
        self.assertIn("const TEMPLATE_DEFINITIONS = Object.freeze", self.workflows)
        self.assertIn('requirePermission("tools_access"', self.workflows)
        self.assertIn('requirePermission("tools_batch_access"', self.workflows)
        self.assertIn('hasEntitlement("save_tool_config")', self.workflows)
        self.assertIn("tool_id: WORKFLOW_TOOL_ID", self.workflows)
        self.assertIn("new AbortController()", self.workflows)
        self.assertIn("MAX_IMAGES = 20", self.workflows)
        self.assertIn("MAX_TOTAL_BYTES = 50 * 1024 * 1024", self.workflows)
        self.assertNotIn("eval(", self.workflows)
        self.assertNotIn("new Function", self.workflows)

    def test_learning_sync_is_incremental_local_first_and_excludes_active_questions(self):
        for element_id in (
            "dashboardSyncStatus",
            "learningSyncNowBtn",
            "learningSyncExportBtn",
            "learningSyncImportBtn",
            "learningSyncFileInput",
            "learningSyncDetail",
        ):
            self.assertIn(f'id="{element_id}"', self.html)
        self.assertIn('api("/api/learning/sync"', self.app)
        self.assertIn("base_server_version", self.learning_sync)
        self.assertIn("server_version", self.learning_sync)
        self.assertIn("deleted", self.learning_sync)
        self.assertIn("validateBackup", self.learning_sync)
        self.assertNotIn("vocabRuntime", self.learning_sync)
        self.assertNotIn("sessionStorage", self.learning_sync)
        self.assertNotIn("rubricCache", self.learning_sync)

    def test_clean_product_design_contract(self):
        for legacy_markup in ("splash-door", "77 79 6A", "lock-mark", ">WORKSPACE<", ">LANGUAGE<"):
            self.assertNotIn(legacy_markup, self.html)
        for token in (
            "--color-background", "--color-surface", "--color-text", "--color-text-muted",
            "--color-border", "--color-primary", "--color-success", "--color-warning",
            "--color-error", "--radius-control", "--radius-card", "--shadow-card",
            "--space-4", "--font-md", "--duration-normal",
        ):
            self.assertIn(token, self.product_styles)
        self.assertIn('id="accountBar" aria-label="主导航"', self.html)
        self.assertIn('data-site-nav="language"', self.html)
        self.assertIn('data-site-nav="tools"', self.html)
        self.assertIn('class="auth-logo"', self.html)
        self.assertNotRegex(self.html, r">\s*[文+×↕]\s*<")

    def test_task19_design_system_two_contract(self):
        self.assertIn('href="/design-system.css?v=20260901-task19-remediation-r4"', self.html)
        self.assertIn('href="/public-experience.css?v=20260901-task19-remediation-r4"', self.html)
        self.assertIn('href="/workspace-experience.css?v=20260901-task19-remediation-r4"', self.html)
        self.assertIn('id="siteNavToggle"', self.html)
        self.assertIn('id="siteNavPanel"', self.html)
        self.assertIn('id="themeToggleBtn"', self.html)
        self.assertIn('id="themeToggleLabel"', self.html)
        self.assertIn('data-theme="dark"', self.design_styles)
        self.assertEqual(self.html.count('data-capability-panel='), 5)
        self.assertIn('id="publicSplitFlap"', self.html)
        self.assertIn('data-phrases="学习|工具|财务|分享"', self.html)
        self.assertIn('一个账户，日常所需', self.html)
        self.assertNotIn('One account. Everyday work.', self.html)
        self.assertIn('.capability-body[hidden]', self.public_styles)
        self.assertIn('@media (prefers-reduced-motion: reduce)', self.design_styles)
        self.assertIn('@media (prefers-reduced-motion: reduce)', self.workspace_styles)
        self.assertIn('--ds-container-wide: 1440px', self.design_styles)
        self.assertIn('--ds-touch-min: 44px', self.design_styles)
        modal_motion = re.search(
            r"@keyframes dsModalPanelIn\s*\{(.*?)\}\s*@keyframes dsModalPanelOut\s*\{(.*?)\}",
            self.design_styles,
            re.S,
        )
        self.assertIsNotNone(modal_motion)
        self.assertNotIn("opacity", "".join(modal_motion.groups()))
        self.assertIn('.dashboard-launchpad-grid', self.workspace_styles)
        self.assertIn('.dashboard-learning-lane', self.workspace_styles)
        self.assertIn('.dashboard-quick-lane .module-card', self.workspace_styles)
        self.assertIn('data-dashboard-project="english"', self.html)
        self.assertIn('data-dashboard-project="japanese"', self.html)
        self.assertIn('data-module="tools"', self.html)
        self.assertIn('data-module="finance"', self.html)
        self.assertIn('id="adminUserMatch"', self.html)
        self.assertIn('id="adminUserLoadMoreBtn"', self.html)
        self.assertIn('id="adminRoleUserSearch"', self.html)
        self.assertIn('.tools-panel,\n.finance-page,\n.admin-panel', self.workspace_styles)
        self.assertRegex(
            self.workspace_styles,
            r"\.admin-tabs\s*\{[^}]*grid-template-columns:\s*repeat\(2,\s*minmax\(0,\s*1fr\)\)",
        )
        combined = self.html + self.design_styles + self.public_styles + self.workspace_styles
        for forbidden in ('fonts.googleapis.com', 'cdnjs.cloudflare.com/ajax/libs/gsap', 'react.production.min.js'):
            self.assertNotIn(forbidden, combined)
        audit = (ROOT / "qa" / "TASK19_DESIGN_AUDIT.md").read_text(encoding="utf-8")
        android = (ROOT / "docs" / "DESIGN_SYSTEM_2.md").read_text(encoding="utf-8")
        for reference in ("Vesper", "Superr", "CardNav", "SplitFlapText", "AccordionGallery"):
            self.assertIn(reference, audit)
        self.assertIn("Android", android)

    def test_dashboard_rejudge_and_readability_contract(self):
        self.assertIn('data-dashboard-project="english"', self.html)
        self.assertIn('data-dashboard-project="japanese"', self.html)
        self.assertIn('class="wrong-rejudge-button"', self.html)
        self.assertIn('class="wrong-rejudge-form hidden"', self.html)
        self.assertIn('class="wrong-rejudge-input"', self.html)
        self.assertIn("function renderDashboard()", self.app)
        self.assertIn("function rejudgeWrongAnswer(", self.app)
        self.assertIn('id="rejudgeResultModal" data-confirm-only', self.html)
        self.assertIn('role="alertdialog"', self.html)
        self.assertIn("function showRejudgeResultModal(", self.app)
        rejudge_source = self.app.split("async function rejudgeWrongAnswer(", 1)[1].split("\n}\n\nfunction renderWrongBook", 1)[0]
        self.assertEqual(rejudge_source.count("showRejudgeResultModal("), 3)
        self.assertNotIn("showWrongActionMessage(", rejudge_source)
        self.assertNotIn("controls.status.textContent = `重新判定失败", rejudge_source)
        self.assertIn('api("/api/quiz/start"', self.app)
        self.assertIn('api("/api/judge"', self.app)
        self.assertIn("wrongRejudgeLog:v1", self.app)
        self.assertIn("const QUESTION_TRANSITION_MS = Math.round(PREVIOUS_QUESTION_TRANSITION_MS * 2 / 3);", self.app)
        self.assertIn("pendingAdvance: state.pendingAdvance", self.app)
        self.assertEqual(self.app.count("state.index += 1;"), 1)
        self.assertNotIn("if (state.answerLocked && state.index < state.words.length - 1) state.index += 1", self.app)
        self.assertIn("getSummary", self.tools)
        self.assertIn("toolPreferences:v", self.tools)

        required_colors = {
            "--ds-text": "#18212f",
            "--ds-text-secondary": "#475569",
            "--ds-text-muted": "#5b687a",
        }
        for token, color in required_colors.items():
            self.assertRegex(self.design_styles, rf"{re.escape(token)}:\s*{color}")
        self.assertIn("--color-text: var(--ds-text)", self.design_styles)
        combined_styles = self.product_styles + "\n" + self.design_styles
        disabled = re.search(r"button:disabled(?:,\s*[^\{]+)?\s*\{([^}]*)\}", combined_styles, re.S)
        self.assertIsNotNone(disabled)
        self.assertRegex(disabled.group(1), r"opacity:\s*1")
        self.assertRegex(self.product_styles, r"\.plan-option:disabled\s*\{[^}]*opacity:\s*1")
        self.assertIn(".admin-login-location", self.product_styles)
        self.assertIn(".admin-user-facts strong", self.product_styles)
        self.assertIn(".admin-current-memberships > article small", self.product_styles)
        self.assertIn(".plan-option small", self.product_styles)

        def relative_luminance(color):
            values = [int(color[index:index + 2], 16) / 255 for index in (1, 3, 5)]
            channels = [value / 12.92 if value <= 0.04045 else ((value + 0.055) / 1.055) ** 2.4 for value in values]
            return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]

        background = relative_luminance("#ffffff")
        for color in required_colors.values():
            foreground = relative_luminance(color)
            ratio = (max(background, foreground) + 0.05) / (min(background, foreground) + 0.05)
            self.assertGreaterEqual(ratio, 4.5, color)

    def test_tool_catalog_is_complete_and_unique(self):
        source = self.tool_catalog.split("const toolRows = {", 1)[1].split("const TOOLS =", 1)[0]
        expected_counts = {"text": 29, "file": 17, "image": 30, "random": 22, "temporary": 5}
        all_ids = []
        for category, expected_count in expected_counts.items():
            match = re.search(rf"\n\s+{category}: \[(.*?)\n\s+\],", source, re.S)
            self.assertIsNotNone(match, category)
            rows = re.findall(
                r'\["([a-z0-9-]+)",\s*"([^"]+)",\s*"([^"]+)"(?:,\s*"([^"]*)")?\]',
                match.group(1),
            )
            ids = [row[0] for row in rows]
            self.assertEqual(len(ids), expected_count, category)
            self.assertTrue(all(row[1].strip() and row[2].strip() for row in rows), category)
            all_ids.extend(ids)
        self.assertEqual(len(all_ids), 103)
        self.assertEqual(len(set(all_ids)), 103)
        self.assertIn("function fuzzyToolScore", self.tool_catalog)
        self.assertIn("function boundedEditDistance", self.tool_catalog)
        self.assertIn("searchTools", self.tool_catalog)
        self.assertIn("isAdjacentTransposition(compactToken, word)", self.tool_catalog)
        self.assertNotIn('category?.description || ""', self.tool_catalog)

    def test_tool_edge_cases_have_production_guards(self):
        self.assertIn('new TextDecoder(encoding || "utf-8", { fatal: true })', self.tools_bundle)
        self.assertIn("function validateCsvTable", self.tools_bundle)
        self.assertIn("const rows = validateCsvTable(parseCsv(text), file.name)", self.tools)
        self.assertIn("的表头与第一个 CSV 文件不一致", self.tools)
        self.assertIn("CSV 表头存在重复字段", self.tools)
        self.assertIn("csvString([header, ...rows.slice(index, index + size)])", self.tools)
        self.assertIn('value="vertical">垂直翻转', self.tools)
        self.assertIn("function parseColorValue", self.tools_bundle)
        self.assertIn("function stripJpegMetadata", self.tools_bundle)
        self.assertIn("相机型号", self.tools_bundle)
        self.assertIn("function temporaryQrContent", self.tools)
        self.assertIn("BEGIN:VCARD", self.tools_bundle)
        self.assertIn("WIFI:T:", self.tools_bundle)
        self.assertIn("请至少选择一种密码字符", self.tools_bundle)
        self.assertIn("const matrix = new Uint16Array(cells)", self.tools_bundle)

    def test_temporary_file_limit_is_consistent_across_the_full_request_chain(self):
        task14_api = (ROOT / "functions" / "_lib" / "task14-api.mjs").read_text(encoding="utf-8")
        task14_model = (ROOT / "functions" / "_lib" / "task14-model.mjs").read_text(encoding="utf-8")
        task14_service = (ROOT / "functions" / "_lib" / "task14-service.mjs").read_text(encoding="utf-8")
        self.assertIn("const TEMP_FILE_MAX_BYTES = 20 * 1024 * 1024", self.tools)
        self.assertIn("const TEMP_VIDEO_MAX_BYTES = 30 * 1024 * 1024", self.tools)
        self.assertIn('".mp4": "video/mp4"', self.tools)
        self.assertIn('bridge.api("/api/temporary/file/init"', self.tools)
        self.assertIn('bridge.uploadBinaryApi(initialized.upload.upload_url', self.tools)
        self.assertIn('bridge.api("/api/temporary/file/cancel"', self.tools)
        self.assertIn("requestJsonGet,", self.app)
        self.assertIn("uploadBinaryApi,", self.app)
        self.assertIn("MAX_TEMP_FILE_BYTES = 20 * 1024 * 1024", task14_model)
        self.assertIn("MAX_TEMP_VIDEO_BYTES = 30 * 1024 * 1024", task14_model)
        self.assertIn('["POST /api/temporary/file/init"', task14_api)
        self.assertIn('["PUT /api/temporary/file/upload"', task14_api)
        self.assertIn("raw: true", task14_api)
        self.assertIn('upload_url: `/api/temporary/file/upload?id=', task14_service)
        for extension in (".mp4", ".m4v", ".mov", ".webm"):
            self.assertIn(f'"{extension}"', task14_model)

    def test_opencc_character_dictionaries_are_local_and_cached(self):
        expected = {
            "opencc-st-characters.txt": "81c27e6364fd164181276197b9215cf95f7f12a050aa207375248a5badf8d6fc",
            "opencc-ts-characters.txt": "737c21c66f55a419dd6956cb3089476cdefc5a36877452631617696df1e5d925",
        }
        for name, checksum in expected.items():
            path = ROOT / "vendor" / name
            content = path.read_bytes()
            self.assertGreater(len(content.splitlines()), 3000)
            self.assertEqual(hashlib.sha256(content).hexdigest(), checksum)
            self.assertIn(f'fetchStaticText("/vendor/{name}")', self.tools_bundle)
            self.assertIn(f'"/vendor/{name}"', self.worker)
        self.assertIn("OpenCC 1.4.1", (ROOT / "THIRD_PARTY_NOTICES.md").read_text(encoding="utf-8"))

    def test_initial_flow_and_security_headers_are_present(self):
        self.assertRegex(self.html, r'id="entryScreen"[^>]*aria-hidden="false"')
        self.assertRegex(self.html, r'id="appShell"[^>]*aria-hidden="true"')
        headers = (ROOT / "_headers").read_text(encoding="utf-8")
        self.assertIn("Content-Security-Policy:", headers)
        self.assertIn("frame-ancestors 'none'", headers)
        self.assertIn("Permissions-Policy:", headers)
        self.assertIn("img-src 'self' data: blob:", headers)
        server = (ROOT / "local-backend" / "server.py").read_text(encoding="utf-8")
        self.assertIn('handler.send_header("Permissions-Policy"', server)
        self.assertIn("img-src 'self' data: blob:", server)
        self.assertIn('server_version = "WYJ"', server)
        self.assertIn('sys_version = ""', server)
        self.assertNotIn('server_version = "VocabQwenWeb', server)
        self.assertFalse((ROOT / "_redirects").exists())

    def test_branding_and_launcher_contract(self):
        combined = self.html + self.app + self.worker
        self.assertNotIn("\u5916\u8bed\u8bcd\u6d4b", combined)
        self.assertNotIn("\u5355\u8bcd\u6d4b", combined)
        launcher = (ROOT / "desktop-tools" / "start-wyj.ps1").read_text(encoding="utf-8-sig")
        launcher_cmd = (ROOT / "desktop-tools" / "\u542f\u52a8WYJ\u7f51\u7ad9.cmd").read_text(encoding="utf-8")
        watchdog = (ROOT / "desktop-tools" / "watch-wyj.ps1").read_text(encoding="utf-8-sig")
        backend_runner = (ROOT / "local-backend" / "run.ps1").read_text(encoding="utf-8-sig")
        self.assertIn("membership.py", launcher)
        sync_backend = re.search(r"function Sync-BackendSource \{(.*?)\n\}", launcher, re.S)
        self.assertIsNotNone(sync_backend)
        self.assertIn('"cloud_identity.py"', sync_backend.group(1))
        self.assertIn("payment_assets.py", launcher)
        self.assertIn("temporary_store.py", launcher)
        self.assertIn("vocabulary_index.py", launcher)
        self.assertIn("run.ps1", launcher)
        self.assertIn("002_single_language_orders_up.sql", launcher)
        self.assertIn("003_login_audit_up.sql", launcher)
        self.assertIn("004_payment_flow_up.sql", launcher)
        self.assertIn("005_payment_method_consistency_up.sql", launcher)
        self.assertIn("006_feedback_voting_up.sql", launcher)
        self.assertIn('$LauncherVersion = "11.0.0"', launcher)
        self.assertIn("WYJ Website Launcher 11.0.0", launcher_cmd)
        self.assertIn("Repair-TunnelOriginAddress", launcher)
        self.assertIn("'${1}http://127.0.0.1:8765${2}'", launcher)
        self.assertIn("Get-TunnelHaConnections", launcher)
        self.assertNotIn("-AcceptHealthyConnector", launcher)
        self.assertIn('return "auto"', launcher)
        self.assertIn('"--retries", "8"', launcher)
        self.assertIn("Test-UrlWithPython", launcher)
        self.assertIn("urllib.request", launcher)
        self.assertIn('"--metrics", "127.0.0.1:20241"', launcher)
        self.assertIn("[string]$SourceRoot", launcher)
        self.assertIn("Find-SourceRoot", launcher)
        self.assertIn("$env:VOCAB_SOURCE_ROOT", launcher)
        self.assertIn("$env:VOCAB_BACKEND_ROOT", launcher)
        self.assertIn("launcher.json", launcher)
        self.assertIn("Find-LegacyRuntimeRoot", launcher)
        self.assertIn("Sync-PrivatePaymentAssets", launcher)
        self.assertIn("Copy-FileIfChanged", launcher)
        self.assertIn("$CheckOnly", launcher)
        self.assertIn("$Unattended", launcher)
        self.assertIn("VOCAB_CLOUDFLARED_EXE", launcher)
        self.assertIn("VOCAB_TUNNEL_CONFIG", launcher)
        self.assertIn("VOCAB_PYTHON_EXE", launcher)
        self.assertIn("ConvertTo-QuotedNativePath", launcher)
        self.assertIn("Get-ManagedTunnelProcesses", launcher)
        self.assertIn('set "LAUNCHER=%SCRIPT_DIR%start-wyj.ps1"', launcher_cmd)
        self.assertIn('set "LAUNCHER=%SCRIPT_DIR%_wyj-tools\\start-wyj.ps1"', launcher_cmd)
        self.assertIn('set "WYJ_LAUNCHER_ENTRY_DIR=%SCRIPT_DIR%"', launcher_cmd)
        self.assertIn("启动错误报告.txt", launcher_cmd)
        self.assertNotIn("-NonInteractive", launcher_cmd)
        self.assertIn('"Local\\WYJWebsiteWatchdogV2"', watchdog)
        self.assertIn("-Unattended", watchdog)
        self.assertIn("$RepairTimeoutMilliseconds = 480000", watchdog)
        self.assertIn("$RepairFailureLimit = 3", watchdog)
        self.assertIn("$RepairSuspendSeconds = 1800", watchdog)
        self.assertIn("Update-RepairBackoff", watchdog)
        self.assertIn('$WatchdogVersion = "4.0.0"', watchdog)
        self.assertIn("Get-TunnelHaConnections", watchdog)
        self.assertIn("connector metrics are not accepted as public availability", watchdog)
        self.assertNotIn("$publicOk -or $connectorOk", watchdog)
        self.assertIn("Test-EndpointWithPython", watchdog)
        self.assertIn("VOCAB_PYTHON_EXE", watchdog)
        self.assertIn("Repair-DuplicatePathEnvironment", launcher)
        self.assertIn("Repair-DuplicatePathEnvironment", watchdog)
        self.assertIn("Test-LauncherBusy", watchdog)
        self.assertIn("已保留 ", launcher)
        self.assertIn("$quotedLauncher", watchdog)
        self.assertIn("$websiteFailures", watchdog)
        self.assertIn("$aiFailures", watchdog)
        self.assertIn("VOCAB_PYTHON_EXE", backend_runner)
        self.assertIn('& $python $serverPath --host 0.0.0.0 --port 8765', backend_runner)
        self.assertIn("VOCAB_BACKEND_FAILURE_LOG", backend_runner)
        self.assertIn("$CapturedOutputLimit = 120", backend_runner)
        self.assertIn("Write-BackendFailureLog", backend_runner)
        self.assertNotIn("Wait-ForBackendStartup", launcher)
        self.assertIn("$BackendStartupProbeDelayMilliseconds = 2000", launcher)
        self.assertIn("-RedirectStandardInput $BackendStandardInputPath", launcher)
        self.assertIn("-RedirectStandardOutput $BackendStandardOutputPath", launcher)
        self.assertIn("-RedirectStandardError $BackendStandardErrorPath", launcher)
        self.assertIn("-RedirectStandardInput $TunnelStandardInputPath", launcher)
        self.assertIn("-RedirectStandardOutput $TunnelStandardOutputPath", launcher)
        self.assertIn("-RedirectStandardError $TunnelStandardErrorPath", launcher)
        self.assertIn("Write-LauncherErrorReport", launcher)
        self.assertIn("启动错误报告.txt", launcher)
        self.assertIn("Wait-ForStablePublicBackend", launcher)
        self.assertLess(
            launcher.index("        Repair-TunnelOriginAddress"),
            launcher.index("        Ensure-Tunnel"),
        )
        self.assertIn("launcher_probe=", launcher)
        self.assertIn("watchdog_probe=", watchdog)
        self.assertIn("Ensure-Backend -RestartRequired:$sourceChanged", launcher)
        self.assertNotRegex(
            "\n".join((launcher, launcher_cmd, watchdog, backend_runner)),
            r"[A-Za-z]:\\Users\\",
        )
        self.assertNotIn("WScript.Shell", launcher)
        self.assertNotIn("CreateShortcut", launcher)
        self.assertNotIn("Register-ScheduledTask", launcher)
        self.assertIn("Disable-LegacyAutoStart", launcher)

    def test_quality_regressions_have_explicit_guards(self):
        self.assertIn("function markBackendReachable", self.app)
        self.assertGreaterEqual(self.core.count("markBackendReachable(data)"), 3)
        skip_source = self.app.split("function skipWord()", 1)[1].split("async function submitAnswer", 1)[0]
        self.assertLess(skip_source.index("clearAnswerValidation();"), skip_source.index("markWrong("))
        self.assertLess(skip_source.index("markWrong("), skip_source.index("beginQuestionTransition("))
        self.assertIn("resolveCurrentQuestionRubric(word)", skip_source)
        self.assertIn('showWrongActionMessage("PDF 已生成并开始下载。', self.app)
        self.assertIn('showModulePicker(false, "当前账户没有管理员权限，已返回功能选择。")', self.app)
        self.assertNotIn('alert("无管理员权限")', self.app)
        self.assertIn('setAttribute("aria-valuetext"', self.app)
        self.assertIn('const source = `来源：${item.source || "系统"}`;', self.app)
        self.assertIn(".admin-current-memberships > article", self.styles)
        self.assertIn("membershipModalLoadSequence", self.app)
        self.assertIn("if (sequence !== membershipModalLoadSequence)", self.app)
        self.assertIn("function ensureJapaneseQuestionForms", self.app)
        self.assertIn('$("wordReading").textContent = reading;', self.app)
        self.assertIn('id="wordReading"', self.html)
        question_forms = self.app.split("async function ensureJapaneseQuestionForms", 1)[1].split("async function startQuiz", 1)[0]
        self.assertIn("if (!dictation) return hasJapaneseKanji(word) && !hasReading;", question_forms)
        self.assertIn('$("navGuestActions")?.classList.toggle("hidden", Boolean(account));', self.app)
        self.assertIn('$("accountMenu")?.classList.toggle("hidden", !account);', self.app)
        boot_source = self.app.split("async function boot()", 1)[1]
        self.assertIn("const shouldResumeWorkspace = Boolean(state.session && state.account);", boot_source)
        self.assertIn('if (shouldResumeWorkspace && state.session && state.account) pendingScreen = "workspace";', boot_source)
        membership_source = self.app.split("async function saveAdminMembership()", 1)[1].split("function updateAdminToolsOverride", 1)[0]
        self.assertLess(membership_source.index("await loadAdminData();"), membership_source.index("会员设置已保存并立即生效"))
        admin_action_source = self.app.split("function adminUserAction(kind)", 1)[1].split("function wordDraftKey", 1)[0]
        self.assertLess(admin_action_source.index("await loadAdminData();"), admin_action_source.index('closeModal("adminEditModal")'))
        text_tool_source = self.tools.split('byId("runTextToolBtn").addEventListener', 1)[1].split('byId("copyTextToolBtn")', 1)[0]
        self.assertIn("button.disabled = true;", text_tool_source)
        self.assertIn("button.disabled = false;", text_tool_source)

    def test_cloudflare_foundation_config_is_safe_and_complete(self):
        config_text = (ROOT / "wrangler.jsonc").read_text(encoding="utf-8")
        config = json.loads(config_text)
        self.assertEqual(config["name"], "thewyj-uk")
        self.assertEqual(config["pages_build_output_dir"], ".")
        self.assertEqual(config["compatibility_date"], "2026-08-06")
        self.assertNotIn("compatibility_flags", config)
        self.assertNotIn("account_id", config)
        self.assertNotIn("d1_databases", config)
        self.assertNotIn("r2_buckets", config)

        for environment, settings in (
            ("development", config),
            ("preview", config["env"]["preview"]),
            ("production", config["env"]["production"]),
        ):
            self.assertEqual(settings["vars"]["WYJ_ENVIRONMENT"], environment)
            self.assertEqual(settings["vars"]["CLOUD_STATUS_MODE"], "cloud")
            self.assertEqual(settings["vars"]["LEGACY_API_FALLBACK_ENABLED"], "false")

        self.assertEqual(config["vars"]["CLOUD_READS_ENABLED"], "true")
        self.assertEqual(config["vars"]["CLOUD_WRITES_ENABLED"], "true")
        self.assertEqual(config["vars"]["WORKERS_AI_ENABLED"], "false")
        self.assertEqual(config["vars"]["TASK15_CLOUD_ONLY_ENABLED"], "true")
        for environment in ("preview", "production"):
            settings = config["env"][environment]
            self.assertEqual(settings["vars"]["CLOUD_READS_ENABLED"], "true")
            self.assertEqual(settings["vars"]["CLOUD_WRITES_ENABLED"], "true")
            self.assertEqual(settings["vars"]["WORKERS_AI_ENABLED"], "true")
            self.assertEqual(settings["vars"]["TASK15_CLOUD_ONLY_ENABLED"], "true")

        self.assertEqual(config["vars"]["TASK11_CLOUD_READS_ENABLED"], "true")
        self.assertEqual(config["vars"]["TASK11_CLOUD_WRITES_ENABLED"], "true")
        self.assertEqual(config["vars"]["TASK11_IMPORT_ENABLED"], "false")
        self.assertEqual(config["env"]["preview"]["vars"]["TASK11_CLOUD_READS_ENABLED"], "true")
        self.assertEqual(config["env"]["preview"]["vars"]["TASK11_CLOUD_WRITES_ENABLED"], "true")
        self.assertEqual(config["env"]["preview"]["vars"]["TASK11_IMPORT_ENABLED"], "true")
        self.assertEqual(config["env"]["production"]["vars"]["TASK11_CLOUD_READS_ENABLED"], "true")
        self.assertEqual(config["env"]["production"]["vars"]["TASK11_CLOUD_WRITES_ENABLED"], "true")
        self.assertEqual(config["env"]["production"]["vars"]["TASK11_IMPORT_ENABLED"], "false")

        for variable in (
            "TASK16_CLOUD_READS_ENABLED",
            "TASK16_CLOUD_WRITES_ENABLED",
            "TASK16_IMPORT_ENABLED",
            "TASK16_PRODUCTION_IMPORT_ENABLED",
        ):
            self.assertEqual(config["vars"][variable], "false")
        self.assertEqual(config["env"]["preview"]["vars"]["TASK16_CLOUD_READS_ENABLED"], "true")
        self.assertEqual(config["env"]["preview"]["vars"]["TASK16_CLOUD_WRITES_ENABLED"], "true")
        self.assertEqual(config["env"]["preview"]["vars"]["TASK16_IMPORT_ENABLED"], "true")
        self.assertEqual(config["env"]["preview"]["vars"]["TASK16_PRODUCTION_IMPORT_ENABLED"], "false")
        self.assertEqual(config["env"]["production"]["vars"]["TASK16_CLOUD_READS_ENABLED"], "true")
        self.assertEqual(config["env"]["production"]["vars"]["TASK16_CLOUD_WRITES_ENABLED"], "true")
        self.assertEqual(config["env"]["production"]["vars"]["TASK16_IMPORT_ENABLED"], "false")
        self.assertEqual(config["env"]["production"]["vars"]["TASK16_PRODUCTION_IMPORT_ENABLED"], "false")

        preview = config["env"]["preview"]
        self.assertEqual(preview["d1_databases"][0]["binding"], "WYJ_DB")
        self.assertEqual(preview["d1_databases"][0]["database_name"], "wyj-cloud-preview")
        self.assertRegex(
            preview["d1_databases"][0]["database_id"],
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        )
        self.assertEqual(preview["d1_databases"][0]["migrations_dir"], "cloudflare/migrations")
        self.assertEqual(preview["r2_buckets"][0]["binding"], "WYJ_STORAGE")
        self.assertEqual(preview["r2_buckets"][0]["bucket_name"], "wyj-cloud-preview")
        self.assertEqual(preview["ai"]["binding"], "AI")

        production = config["env"]["production"]
        self.assertEqual(production["d1_databases"][0]["binding"], "WYJ_DB")
        self.assertEqual(production["d1_databases"][0]["database_name"], "wyj-cloud-production")
        self.assertRegex(
            production["d1_databases"][0]["database_id"],
            r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$",
        )
        self.assertNotEqual(
            production["d1_databases"][0]["database_id"],
            preview["d1_databases"][0]["database_id"],
        )
        self.assertEqual(production["d1_databases"][0]["migrations_dir"], "cloudflare/migrations")
        self.assertEqual(production["r2_buckets"][0]["binding"], "WYJ_STORAGE")
        self.assertEqual(production["r2_buckets"][0]["bucket_name"], "wyj-cloud-production")
        self.assertNotEqual(
            production["r2_buckets"][0]["bucket_name"],
            preview["r2_buckets"][0]["bucket_name"],
        )
        self.assertEqual(production["ai"]["binding"], "AI")

        local_config = json.loads((ROOT / "wrangler.local.jsonc").read_text(encoding="utf-8"))
        self.assertNotIn("database_id", local_config["d1_databases"][0])
        self.assertEqual(local_config["d1_databases"][0]["binding"], "WYJ_DB")
        self.assertEqual(local_config["d1_databases"][0]["database_name"], "wyj-cloud-development")
        self.assertEqual(local_config["r2_buckets"][0]["binding"], "WYJ_STORAGE")
        self.assertEqual(local_config["r2_buckets"][0]["bucket_name"], "wyj-cloud-development")

        migration = (ROOT / "cloudflare" / "migrations" / "0001_foundation.sql").read_text(encoding="utf-8")
        self.assertIn("CREATE TABLE IF NOT EXISTS cloud_runtime_metadata", migration)
        self.assertIn("CREATE TABLE IF NOT EXISTS cloud_rate_limit_windows", migration)
        self.assertIn("INSERT OR IGNORE", migration)
        self.assertNotRegex(migration, r"\b(?:DROP|DELETE\s+FROM\s+users|ALTER\s+TABLE\s+users)\b")

        task11_migration = (
            ROOT / "cloudflare" / "migrations" / "0002_low_risk_cloud_services.sql"
        ).read_text(encoding="utf-8")
        for table in (
            "task11_changelog_entries",
            "task11_feedback_items",
            "task11_feedback_votes",
            "task11_feedback_audit_logs",
            "task11_learning_sync_records",
            "task11_learning_sync_heads",
            "task11_learning_sync_changes",
            "task11_usage_buckets",
        ):
            self.assertIn(f"CREATE TABLE IF NOT EXISTS {table}", task11_migration)
        self.assertNotRegex(
            task11_migration,
            r"CREATE TABLE IF NOT EXISTS\s+(?:users|sessions|memberships|payment_requests)\b",
        )
        self.assertNotRegex(task11_migration, r"\b(?:DROP|ALTER\s+TABLE\s+users)\b")

        task12_session_limit = (
            ROOT / "cloudflare" / "migrations" / "0004_session_limit_trigger.sql"
        ).read_text(encoding="utf-8")
        self.assertIn("CREATE TRIGGER IF NOT EXISTS task12_sessions_limit_after_insert", task12_session_limit)
        self.assertIn("WHERE user_id = NEW.user_id AND revoked = 0", task12_session_limit)
        self.assertIn("LIMIT -1 OFFSET 12", task12_session_limit)
        self.assertNotRegex(task12_session_limit, r"\bDROP\b")

        task12_session_ordering = (
            ROOT / "cloudflare" / "migrations" / "0005_session_limit_ordering.sql"
        ).read_text(encoding="utf-8")
        self.assertIn("DROP TRIGGER IF EXISTS task12_sessions_limit_after_insert", task12_session_ordering)
        self.assertIn("ORDER BY rowid DESC", task12_session_ordering)
        self.assertIn("LIMIT -1 OFFSET 12", task12_session_ordering)

        task16_migration = (
            ROOT / "cloudflare" / "migrations" / "0012_finance_core.sql"
        ).read_text(encoding="utf-8")
        for table in (
            "task16_finance_devices",
            "task16_finance_user_versions",
            "task16_finance_categories",
            "task16_finance_budgets",
            "task16_finance_transactions",
            "task16_finance_raw_events",
            "task16_finance_transaction_events",
            "task16_finance_audit_logs",
            "task16_finance_changes",
            "task16_finance_sync_operations",
            "task16_import_batches",
            "task16_import_receipts",
            "task16_import_record_receipts",
        ):
            self.assertIn(f"CREATE TABLE IF NOT EXISTS {table}", task16_migration)
        self.assertIn("text_fingerprint_sha256", task16_migration)
        self.assertNotIn("raw_text", task16_migration)
        self.assertNotRegex(task16_migration, r"\b(?:DROP|ALTER\s+TABLE\s+task12_users)\b")

        task17_migration = (
            ROOT / "cloudflare" / "migrations" / "0013_finance_web_membership.sql"
        ).read_text(encoding="utf-8")
        self.assertIn("finance_monthly", task17_migration)
        self.assertIn("finance_access", task17_migration)
        self.assertIn("800", task17_migration)
        self.assertNotRegex(task17_migration, r"\b(?:DROP|DELETE|ALTER\s+TABLE)\b")

        middleware = (ROOT / "functions" / "_lib" / "cloudflare-foundation.mjs").read_text(encoding="utf-8")
        status = (ROOT / "functions" / "api" / "status.js").read_text(encoding="utf-8")
        self.assertIn("crypto.randomUUID()", middleware)
        self.assertIn('"X-Request-ID"', middleware)
        self.assertIn("function sameOriginResult", middleware)
        self.assertIn("function apiError", middleware)
        self.assertIn("function enforceCloudRateLimit", middleware)
        self.assertIn("payment_cloud_migration: flags.task13PaymentPrimary", middleware)
        wrangler = json.loads((ROOT / "wrangler.jsonc").read_text(encoding="utf-8"))
        production_vars = wrangler["env"]["production"]["vars"]
        for variable in (
            "TASK13_CLOUD_READS_ENABLED",
            "TASK13_CLOUD_WRITES_ENABLED",
            "TASK13_PAYMENT_PRIMARY_ENABLED",
        ):
            self.assertEqual(production_vars[variable], "true")
        for variable in (
            "TASK13_IMPORT_ENABLED",
            "TASK13_PRODUCTION_IMPORT_ENABLED",
        ):
            self.assertEqual(production_vars[variable], "false")
        self.assertIn("statusRouteResponse(context)", status)
        self.assertNotIn("proxyToLegacy", status)
        self.assertIn('statusSourceFor(context.request, context.env) === "legacy"', middleware)
        self.assertIn('apiError("legacy_status_retired"', middleware)

        package = json.loads((ROOT / "package.json").read_text(encoding="utf-8"))
        self.assertEqual(package["devDependencies"]["wrangler"], "4.118.0")
        self.assertIn("wrangler types", package["scripts"]["cf:types"])
        self.assertIn("--env preview", package["scripts"]["cf:types"])
        self.assertIn("wrangler d1 migrations apply WYJ_DB --local", package["scripts"]["cf:migrate:local"])
        self.assertIn("--config wrangler.local.jsonc", package["scripts"]["cf:migrate:local"])
        self.assertIn("wrangler pages dev", package["scripts"]["cf:dev"])
        self.assertIn("--d1 WYJ_DB", package["scripts"]["cf:dev"])
        self.assertIn("--r2 WYJ_STORAGE", package["scripts"]["cf:dev"])
        self.assertIn("test_task16_d1_js.mjs", package["scripts"]["test:task16"])
        self.assertIn("test_migrate_dailypayguard_finance", package["scripts"]["test:task16"])
        self.assertIn("test_finance_js.mjs", package["scripts"]["test:task17"])
        self.assertIn("test_task17_d1_js.mjs", package["scripts"]["test:task17"])

    def test_remote_data_loading_has_retry_and_partial_recovery(self):
        self.assertIn('id="membershipPlanRecovery"', self.html)
        self.assertIn('id="retryMembershipPlansBtn"', self.html)
        self.assertIn("GET_RETRYABLE_STATUS", self.core)
        self.assertIn("requestJsonGet", self.core)
        self.assertIn("Promise.allSettled(requests.map", self.app)
        self.assertIn("已加载的内容会保留，请点击刷新重试", self.app)
        self.assertNotIn("loadMembershipPlans().catch(() => {});", self.app)
        self.assertIn("membershipModalController?.abort()", self.app)
        self.assertIn("Promise.allSettled([", self.app)
        self.assertIn("function retryDelayWithJitter", self.core)
        self.assertIn('window.addEventListener("offline"', self.app)
        self.assertIn('window.addEventListener("pageshow"', self.app)
        self.assertIn("async function fetchWithDeadline", self.worker)
        self.assertIn("Promise.allSettled(", self.worker)
        self.assertNotIn("cache.addAll(CORE_SHELL)", self.worker)
        proxy = (ROOT / "functions" / "api" / "[[path]].js").read_text(encoding="utf-8")
        self.assertIn("handleTask11Request(context)", proxy)
        self.assertIn("handleTask15Request(context)", proxy)
        self.assertNotIn("proxyToLegacy", proxy)
        self.assertNotIn("legacy-api.mjs", proxy)
        launcher = (ROOT / "desktop-tools" / "start-wyj.ps1").read_text(encoding="utf-8-sig")
        startup = launcher[launcher.index("        $sourceChanged = Sync-BackendSource"):]
        self.assertLess(startup.index("        Ensure-Backend"), startup.index("        Ensure-Tunnel"))
        self.assertLess(startup.index("        Ensure-Tunnel"), startup.index("            Ensure-Ollama"))

    def test_admin_secret_reset_ui_is_one_time_and_cryptographically_random(self):
        for element_id in (
            "adminNewSecretInput",
            "toggleAdminSecretBtn",
            "generateAdminSecretBtn",
            "saveAdminSecretBtn",
            "adminSecretResult",
            "adminSecretResultValue",
            "copyAdminSecretBtn",
        ):
            self.assertIn(f'id="{element_id}"', self.html)
        self.assertIn("function generateSecureSecret", self.app)
        self.assertIn("globalThis.crypto.getRandomValues", self.app)
        self.assertIn('if (id === "adminEditModal") clearAdminSecretEditor();', self.app)
        self.assertIn('$("adminSecretResultValue").textContent = secret;', self.app)
        account_store = (ROOT / "local-backend" / "account_store.py").read_text(encoding="utf-8")
        self.assertNotIn("include_secret", account_store)

    def test_payment_ui_uses_protected_blob_qr_and_releases_object_urls(self):
        self.assertNotIn("W2009", self.html + self.app)
        self.assertIn("付款后不会立即自动开通会员", self.html)
        self.assertIn("管理员将在 24 小时内核对付款并确认订单", self.html)
        self.assertIn("管理员确认到账后，会员权益才会生效", self.html)
        self.assertNotRegex(
            self.html,
            r'<img[^>]+src="[^"]*(?:wechat|alipay|qrcode|qr-code)',
        )
        self.assertIn("/api/recharge/qr?request_id=", self.app)
        self.assertIn('"X-Session-Token": state.session', self.app)
        self.assertIn("const blob = await response.blob();", self.app)
        self.assertIn("URL.createObjectURL(blob)", self.app)
        self.assertIn("URL.revokeObjectURL(paymentQrObjectUrl)", self.app)
        self.assertIn("paymentQrController.abort()", self.app)
        self.assertIn('await api("/api/recharge/cancel"', self.app)
        self.assertIn('await api("/api/recharge/confirm"', self.app)
        self.assertRegex(
            self.styles,
            r"\.payment-qr-wrap img\s*\{[^}]*max-width:\s*100%",
        )
        self.assertIn("overflow-x: hidden", self.styles)

    def test_share_viewer_uses_semantic_result_tones(self):
        self.assertNotIn('class="error" id="shareViewerMessage"', self.html)
        self.assertIn('setShareViewerMessage("\\u6253\\u5f00\\u6210\\u529f", "success")', self.tools)
        self.assertIn('setShareViewerMessage(error.message, "error")', self.tools)
        self.assertIn('#shareViewerMessage[data-tone="success"]', self.workspace_styles)
        self.assertIn('#shareViewerMessage[data-tone="error"]', self.workspace_styles)

    def test_dark_workspace_statuses_do_not_use_legacy_low_contrast_colors(self):
        self.assertNotIn("color: #315a98;", self.product_styles)
        self.assertNotIn("color: #7f1d1d;", self.product_styles)
        self.assertNotIn("color: #344054;", self.product_styles)
        self.assertRegex(
            self.product_styles,
            r"(?s)\.module-card em\s*\{.*?color:\s*var\(--color-primary\)",
        )
        self.assertRegex(
            self.product_styles,
            r"(?s)\.danger-zone,\s*\.admin-danger-section\s*\{.*?color:\s*var\(--color-error\)",
        )
        self.assertRegex(
            self.product_styles,
            r"(?s)\.danger-zone button,\s*\.admin-danger-section button\s*\{.*?color:\s*var\(--color-error\)",
        )
        self.assertRegex(
            self.product_styles,
            r"(?s)\.tool-chip-list button\s*\{.*?color:\s*var\(--color-text\)",
        )
        self.assertRegex(
            self.product_styles,
            r"(?s)\.secret-value,\s*code\s*\{.*?background:\s*var\(--color-surface-subtle\)",
        )

    def test_membership_ui_filters_plans_by_purpose_without_replacing_server_checks(self):
        goal_values = re.findall(r'data-membership-goal="([^"]+)"', self.html)
        self.assertEqual(goal_values, ["english", "japanese", "bilingual", "tools", "finance", "all"])
        self.assertIn("const MEMBERSHIP_GOALS = Object.freeze", self.membership)
        self.assertIn("function membershipGoalAllowsPlan", self.membership)
        self.assertIn("function membershipGoalForPlan", self.membership)
        self.assertIn('openMembershipModal({ goal: "tools" })', self.app)
        self.assertIn('openRecharge("finance")', self.finance)
        self.assertGreaterEqual(
            self.app.count("membershipGoalAllowsPlan(selectedMembershipGoal"), 3
        )
        self.assertIn('trial_language: selectedRechargePlan === "trial_single_language"', self.app)
        self.assertIn('await api("/api/recharge/request"', self.app)

    def test_vocabulary_search_is_debounced_abortable_and_local_first(self):
        self.assertIn("function scheduleVocabularySearch()", self.app)
        self.assertRegex(
            self.app,
            r"(?s)vocabularySearchTimer = window\.setTimeout\(\(\) => \{.*?\}, 200\);",
        )
        self.assertIn("vocabularySearchController.abort()", self.app)
        self.assertIn("const controller = new AbortController();", self.app)
        self.assertIn("LOCAL_VOCABULARY_INDEX.search(", (ROOT / "local-backend" / "server.py").read_text(encoding="utf-8"))
        source = (ROOT / "local-backend" / "server.py").read_text(encoding="utf-8")
        local_position = source.index("local_matches = LOCAL_VOCABULARY_INDEX.search(")
        remote_position = source.index("source_data = search_vocabulary_sources(", local_position)
        self.assertLess(local_position, remote_position)

    def test_login_audit_and_proxy_context_do_not_leak_credentials_or_backend_details(self):
        proxy = (ROOT / "functions" / "_lib" / "legacy-api.mjs").read_text(encoding="utf-8")
        server = (ROOT / "local-backend" / "server.py").read_text(encoding="utf-8")
        self.assertIn('id="adminLoginView"', self.html)
        self.assertIn('id="adminLoginList"', self.html)
        self.assertIn('path: "/api/admin/login-logs"', self.app)
        self.assertIn('path == "/api/admin/login-logs"', server)
        self.assertIn('headers.set("X-WYJ-Client-City"', proxy)
        self.assertNotIn("detail: lastError", proxy)
        client_key = server.split("def request_client_key", 1)[1].split("def decoded_context_header", 1)[0]
        self.assertNotIn('X-Forwarded-For', client_key)
        audit_source = (ROOT / "local-backend" / "account_store.py").read_text(encoding="utf-8")
        audit_source = audit_source.split("def record_login_event", 1)[1].split("def list_login_audit_logs", 1)[0]
        self.assertNotIn("secret", audit_source)

    def test_migration_is_idempotent_and_rollback_preserves_legacy_tables(self):
        migrations = ROOT / "local-backend" / "migrations"
        before = (migrations / "pre-001-schema.sql").read_text(encoding="utf-8")
        upgrade = (migrations / "001_entitlements_up.sql").read_text(encoding="utf-8")
        downgrade = (migrations / "001_entitlements_down.sql").read_text(encoding="utf-8")
        upgrade_two = (migrations / "002_single_language_orders_up.sql").read_text(encoding="utf-8")
        downgrade_two = (migrations / "002_single_language_orders_down.sql").read_text(encoding="utf-8")
        upgrade_three = (migrations / "003_login_audit_up.sql").read_text(encoding="utf-8")
        downgrade_three = (migrations / "003_login_audit_down.sql").read_text(encoding="utf-8")
        upgrade_four = (migrations / "004_payment_flow_up.sql").read_text(encoding="utf-8")
        downgrade_four = (migrations / "004_payment_flow_down.sql").read_text(encoding="utf-8")
        upgrade_five = (migrations / "005_payment_method_consistency_up.sql").read_text(encoding="utf-8")
        downgrade_five = (migrations / "005_payment_method_consistency_down.sql").read_text(encoding="utf-8")
        upgrade_six = (migrations / "006_feedback_voting_up.sql").read_text(encoding="utf-8")
        downgrade_six = (migrations / "006_feedback_voting_down.sql").read_text(encoding="utf-8")
        upgrade_seven = (migrations / "007_learning_sync_up.sql").read_text(encoding="utf-8")
        downgrade_seven = (migrations / "007_learning_sync_down.sql").read_text(encoding="utf-8")
        connection = sqlite3.connect(":memory:")
        try:
            connection.executescript(before)
            connection.executescript(upgrade)
            connection.executescript(upgrade)
            applied = connection.execute(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = '001_entitlements'"
            ).fetchone()[0]
            self.assertEqual(applied, 1)
            connection.executescript(upgrade_two)
            trial_language_column = {
                row[1] for row in connection.execute("PRAGMA table_info(payment_requests)")
            }
            self.assertIn("trial_language", trial_language_column)
            connection.executescript(upgrade_three)
            connection.executescript(upgrade_three)
            login_audit_applied = connection.execute(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = '003_login_audit'"
            ).fetchone()[0]
            self.assertEqual(login_audit_applied, 1)
            tables = {
                row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
            self.assertIn("login_audit_logs", tables)
            connection.executescript(upgrade_four)
            payment_columns = {
                row[1] for row in connection.execute("PRAGMA table_info(payment_requests)")
            }
            self.assertIn("payment_method", payment_columns)
            self.assertIn("qr_resource_id", payment_columns)
            tables = {
                row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
            self.assertIn("payment_request_events", tables)
            self.assertIn("payment_fulfillments", tables)
            connection.executescript(upgrade_five)
            connection.executescript(upgrade_five)
            payment_consistency_applied = connection.execute(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = '005_payment_method_consistency'"
            ).fetchone()[0]
            self.assertEqual(payment_consistency_applied, 1)
            connection.executescript(upgrade_six)
            connection.executescript(upgrade_six)
            feedback_applied = connection.execute(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = '006_feedback_voting'"
            ).fetchone()[0]
            self.assertEqual(feedback_applied, 1)
            feedback_tables = {
                row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
            self.assertTrue({"feedback_items", "feedback_votes"}.issubset(feedback_tables))
            feedback_columns = {
                row[1] for row in connection.execute("PRAGMA table_info(feedback_items)")
            }
            self.assertTrue(
                {"feedback_type", "title", "content", "status", "admin_note", "merged_into_id"}
                .issubset(feedback_columns)
            )
            connection.executescript(upgrade_seven)
            connection.executescript(upgrade_seven)
            learning_sync_applied = connection.execute(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = '007_learning_sync'"
            ).fetchone()[0]
            self.assertEqual(learning_sync_applied, 1)
            learning_tables = {
                row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
            self.assertTrue(
                {"learning_sync_records", "learning_sync_heads", "learning_sync_changes"}
                .issubset(learning_tables)
            )
            connection.executescript(downgrade_seven)
            learning_tables = {
                row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
            self.assertNotIn("learning_sync_records", learning_tables)
            self.assertNotIn("learning_sync_heads", learning_tables)
            self.assertNotIn("learning_sync_changes", learning_tables)
            connection.executescript(downgrade_six)
            feedback_tables = {
                row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
            self.assertNotIn("feedback_items", feedback_tables)
            self.assertNotIn("feedback_votes", feedback_tables)
            connection.executescript(downgrade_five)
            connection.executescript(downgrade_four)
            payment_columns = {
                row[1] for row in connection.execute("PRAGMA table_info(payment_requests)")
            }
            self.assertNotIn("payment_method", payment_columns)
            connection.executescript(downgrade_three)
            tables = {
                row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
            self.assertNotIn("login_audit_logs", tables)
            connection.executescript(downgrade_two)
            trial_language_column = {
                row[1] for row in connection.execute("PRAGMA table_info(payment_requests)")
            }
            self.assertNotIn("trial_language", trial_language_column)
            connection.executescript(downgrade)
            tables = {
                row[0]
                for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")
            }
            self.assertTrue({"users", "sessions", "recharge_requests"}.issubset(tables))
            self.assertNotIn("user_memberships", tables)
            self.assertNotIn("payment_requests", tables)
            self.assertNotIn("temporary_files", tables)
        finally:
            connection.close()


if __name__ == "__main__":
    unittest.main()
