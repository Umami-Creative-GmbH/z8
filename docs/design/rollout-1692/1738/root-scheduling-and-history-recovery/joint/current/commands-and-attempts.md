Exact process/package commands used (from repository root; no install/repair/fallback run):

$env:pnpm_config_verify_deps_before_run='false'
pnpm --config.verify-deps-before-run=false --version

Sandbox preflight printed12.21.0 after the engine-lock warning and was not used to run any check. The SAME ordinary command under authorized engine-access escalation returned12.16.1. Every actual pnpm invocation and the nested fixture helper include the environment guard AND explicit --config.verify-deps-before-run=false.

pnpm --config.verify-deps-before-run=false --filter webapp exec vitest run --project unit --maxWorkers 2 'src/test/.tmp/1738-1739-joint-independent-checks/directory-public.test.tsx' 'src/test/.tmp/1738-1739-joint-independent-checks/history-public.test.tsx' 'src/test/.tmp/1738-1739-joint-independent-checks/direct-history-public.test.tsx' 'src/test/.tmp/1738-1739-joint-independent-checks/supporting-public.test.tsx' --reporter=json --outputFile=../../.tmp/1738-1739-joint-independent-checks/public-01.json

pnpm --config.verify-deps-before-run=false exec node .tmp/1738-1739-joint-independent-checks/fixture-driver.mjs prepare .tmp/1738-1739-joint-independent-checks/private-fixture
pnpm --config.verify-deps-before-run=false exec node .tmp/1738-1739-joint-independent-checks/fixture-driver.mjs cleanup .tmp/1738-1739-joint-independent-checks/private-fixture

Canonical helper's nested guarded commands (private own fixture environment only):
pnpm --config.verify-deps-before-run=false exec tsx scripts/verify-approval-migration-recovery.ts
pnpm --config.verify-deps-before-run=false exec tsx scripts/performance-fixture.ts --write-private-manifest <NEW_OWN_PRIVATE_FIXTURE_MANIFEST>

node .tmp/1738-1739-joint-independent-checks/prepare-audit.mjs
node .tmp/1738-1739-joint-independent-checks/audit.mjs start
node .tmp/1738-1739-joint-independent-checks/prepare-tests.mjs
node .tmp/1738-1739-joint-independent-checks/prepare-fixture-driver.mjs
node .tmp/1738-1739-joint-independent-checks/start-next.mjs
node .tmp/1738-1739-joint-independent-checks/start-chrome.mjs
node .tmp/1738-1739-joint-independent-checks/inherited-check.mjs
node .tmp/1738-1739-joint-independent-checks/decode-and-intake.mjs
& ./.tmp/1738-1739-joint-independent-checks/capture-owned.ps1
& ./.tmp/1738-1739-joint-independent-checks/stop-owned.ps1
node .tmp/1738-1739-joint-independent-checks/cleanup-and-summarize.mjs
node .tmp/1738-1739-joint-independent-checks/prepare-finalize.mjs
node .tmp/1738-1739-joint-independent-checks/finalize.mjs
node .tmp/1738-1739-joint-independent-checks/audit.mjs end

start-next invokes the installed own physical app Next CLI with sanitized new fixture env:
node node_modules/next/dist/bin/next dev --turbopack --hostname 127.0.0.1 --port 64335
start-chrome launches the exact standard installed chrome.exe with hidden/headless isolated profile, incognito, no-first-run, no-default-browser-check, disabled AutofillServerCommunication and own remote-debug port64336. It never opens/saves/restores authentication state. Puppeteer-core only connects to this exact owned browser; three independent incognito BrowserContexts deny notifications and use actual widget/form login with generated private inputs kept in memory. No production CAPTCHA bypass. No fixture authenticate command, agent-browser session/restore command or storageState/cookie API is used.

agent-browser skills get core (PowerShell shim failed under execution policy)
agent-browser.cmd skills get core (guide only; no browser/session)

Browser/Next tools: preview_status; preview_open about:blank (invalid URL), documented blank preview_open incognito; preview_navigate local sign-in; preview_snapshot twice (both15s timeout); t3_preview_close. Then owned Chromium fallback. Node REPL loads only own fixture inputs privately, uses native mouse/keyboard/UI, narrowly identifies NextAction headers via connected get_server_action_by_id, aborts/holds only known history/context/supporting reads, and never serializes private response bodies or auth state. Reads Next tools/list, get_page_metadata, get_compilation_issues and get_errors; only safe metadata/counts saved. Scope-qualified SELECT-only digests read shift/time_entry/work_period for both own fixture orgs through one closed pool.

Literal safe native UI sequences: manager /en/team -> balance badge -> Escape -> forced history read failure -> Retry held -> second pointer -> finally release -> same dialog canonical result. Account -> Font size -> Large -> reload; Toggle Sidebar -> reload/hydrated collapse; Table view; visible Toggle theme (phone More actions -> Toggle theme). /en/scheduling?date=2026-11-16 -> supporting Retry -> hold template -> second pointer -> release template -> hold compliance -> second pointer -> finally release. Normal distinct admin form login -> /en/team -> own employee link -> public Set opening balance +2hours with SYNTHETIC JOINT HISTORY CHECK -> team native badge -> canonical nonempty -> failed transport -> one held Retry -> recovered nonempty. Distinct restricted form login -> request /en/team -> /en. Manager Refresh data -> forced /api/auth/context failure -> await initial header RSC requestfinished -> local native Retry held -> second pointer -> finally release -> one RSC refresh/four members.

Failed attempts remain separately qualified in HANDOFF and safe attempts receipt: two Preview timeouts, direct Puppeteer launch timeout with zero matching leftover parents, shim/CIM sandbox failures, menu timing/hidden target, absent employee tab, wrong alert selector, scalar REPL fault controller persisting abort mode, unsettled-header sample, networkidle timeout (background traffic), unsupported Puppeteer finished(), and case-sensitive Docker absence verifier. One body.textContent diagnostic expanded scripts in the tool transcript; excluded from all public artifacts. No failed attempt is counted as acceptance.
