import subprocess, json, pathlib, hashlib, re, collections, datetime
ROOT=pathlib.Path.cwd()
BASE='3eb268b748a6e7a1aaa7369059db474810bb59d4'
RC='482580b0855e14a61b3f6b51e9d91ae7855296cb'
OUT=ROOT/'docs/p07/release-evidence'
OUT.mkdir(parents=True,exist_ok=True)
def git(*args, raw=False):
    b=subprocess.check_output(['git',*args],cwd=ROOT)
    return b if raw else b.decode('utf-8').strip()
def domains(p):
    if p.startswith('docs/'):return ['EVIDENCE']
    result=[]
    if p=='app.js':return ['P07_UI','BOOT_AUTH_POLICY','ACCOUNT_MEMBERSHIP_ADMIN_UI','LEARNING_UI']
    if p=='index.html' or p.endswith('.css') or p.startswith(('js/tools/','tools.js','js/core/design-system','js/core/public-experience','js/core/home-widgets','js/core/dashboard','js/core/motion')): result+=['P07_UI']
    if p.startswith(('js/core/api.','js/core/session.','js/core/feature-flags.','js/core/public-ui-policy.','js/core/startup.','js/core/router.','functions/_lib/p07-ui')):result+=['BOOT_AUTH_POLICY']
    if p.startswith(('functions/_lib/task11-service','functions/_lib/task12-api')):result+=['ADMIN_AUDIT_READ']
    if p.startswith('js/finance/'):result+=['FINANCE_PRESENTATION']
    if p.startswith('js/language/'):result+=['LEARNING_UI']
    if p.startswith('js/transfer/'):result+=['TRANSFER_PRESENTATION']
    if p.startswith('functions/'):result+=['FUNCTIONS_API']
    if p.startswith('cloudflare/') or p.startswith('wrangler'):result+=['D1_R2_CONFIG']
    if p.startswith('android/'):result+=['ANDROID']
    if p=='sw.js' or p in ['js/core/config.js','js/core/changelog.js'] or p=='scripts/update_asset_release.mjs':result+=['SW_ASSET_RELEASE']
    if p.startswith(('qa/','local-backend/test','scripts/test')):result+=['QA']
    if p.startswith('.github/') or p.startswith('scripts/'):result+=['BUILD_CI_TOOLING']
    return result or ['MODULE_PRESENTATION_OR_VERSION']
commits=[]
for sha in git('rev-list','--reverse','--topo-order',f'{BASE}..{RC}').splitlines():
    info=git('show','-s','--format=%P%n%s',sha).splitlines()
    ps=git('diff','--name-only',info[0].split()[0],sha).splitlines()
    commits.append({'sha':sha,'parents':info[0].split(),'subject':info[1],'categories':sorted(set(x for p in ps for x in domains(p))),'files':ps})
net=[]
for p in git('diff','--name-only',BASE,RC).splitlines():
    entry={'path':p,'categories':domains(p)}
    if not p.startswith('docs/'):
        old=subprocess.run(['git','show',f'{BASE}:{p}'],capture_output=True).stdout
        new=git('show',f'{RC}:{p}',raw=True)
        def norm(s):
            return re.sub(rb'(?:(?:v|release)=)?20\d{6}-aeris-[a-zA-Z0-9-]+',b'ASSET_RELEASE',s)
        entry.update({'base_sha256':hashlib.sha256(old).hexdigest() if old else None,'rc5_sha256':hashlib.sha256(new).hexdigest(),'only_asset_release_changed':bool(old) and norm(old)==norm(new)})
    net.append(entry)
migrations=[]
for p in git('ls-tree','-r','--name-only',RC,'--','cloudflare/migrations').splitlines():
    old=git('show',f'{BASE}:{p}',raw=True);new=git('show',f'{RC}:{p}',raw=True)
    migrations.append({'path':p,'base_sha256':hashlib.sha256(old).hexdigest(),'rc5_sha256':hashlib.sha256(new).hexdigest(),'identical':old==new})
protected=['android','cloudflare/migrations','wrangler.jsonc','wrangler.local.jsonc','package.json','package-lock.json','learning-sync.js','functions/_lib/task11-model.mjs','functions/_lib/task13-api.mjs','functions/_lib/task13-service.mjs','functions/_lib/task16-api.mjs','functions/_lib/task16-model.mjs','functions/_lib/task16-service.mjs','functions/_lib/task21-api.mjs','functions/_lib/task22-api.mjs','functions/_lib/task25-api.mjs','functions/_lib/task25-model.mjs','functions/_lib/task25-service.mjs','functions/_lib/task26-api.mjs','functions/_lib/task26-model.mjs','functions/_lib/task26-service.mjs','js/core/storage.js','assets','vendor','manifest.webmanifest']
protected_results={p:git('diff','--name-only',BASE,RC,'--',p).splitlines() for p in protected}
report={'base':BASE,'rc5':RC,'merge_base':git('merge-base',BASE,RC),'commit_count':len(commits),'commits':commits,'net_files':net,'migration_files':migrations,'protected_diff':protected_results}
(OUT/'scope-inventory.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
lines=['# P07 Release 完整提交和文件分类',f'\nmain `{BASE}` → RC5 `{RC}`。共 {len(commits)} 提交，{len(net)} 个净变更文件。', '\n同一个提交可有多个类别；合并提交以第一父提交比较，保留全部父 SHA 和文件名于 JSON。类别描述涉及路径，不把 QA/文档变更算作运行时代码。', '\n| # | 完整 SHA | 分类 | 提交 |', '| --- | --- | --- | --- |']
for i,c in enumerate(commits,1):lines.append(f"| {i} | `{c['sha']}` | {', '.join(c['categories'])} | {c['subject'].replace('|','/')} |")
lines+=['\n## 全部净变更文件','\n| 路径 | 分类 | 仅资源版本变化 |','| --- | --- | --- |']
for n in net:lines.append(f"| `{n['path']}` | {', '.join(n['categories'])} | {'YES' if n.get('only_asset_release_changed') else 'NO' if not n['path'].startswith('docs/') else 'EVIDENCE'} |")
lines+=['\n## D1 迁移逐文件校验','\n| 迁移 | SHA-256（两端相同） | 相同 |','| --- | --- | --- |']
for m in migrations:lines.append(f"| `{m['path']}` | `{m['rc5_sha256']}` | {m['identical']} |")
(OUT/'COMMIT_AND_FILE_CLASSIFICATION.md').write_text('\n'.join(lines)+'\n',encoding='utf-8')
print(json.dumps({'commits':len(commits),'net_files':len(net),'non_doc':len([n for n in net if not n['path'].startswith('docs/')]),'migrations':len(migrations),'migrations_identical':all(m['identical'] for m in migrations),'protected_diff':protected_results,'logic_or_new_files':[n['path'] for n in net if not n['path'].startswith('docs/') and not n.get('only_asset_release_changed')]},ensure_ascii=False))
