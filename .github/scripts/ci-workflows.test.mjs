import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isMaintenanceProducer } from "./ci-maintenance.mjs";
const workflow = name => readFileSync(new URL(`../workflows/${name}.yml`, import.meta.url), "utf8").replace(/\r\n/g, "\n");
const tests = workflow("tests");
const desktop = workflow("desktop-windows");
const maintenance = workflow("ci-maintenance");
const warm = workflow("ci-cache-warm");

test("actual PostgreSQL condition requires successful combined shards except explicit manual diagnosis", () => {
  const block = tests.split("  integration-tests:\n")[1].split("    runs-on:")[0];
  assert.match(block, /needs: \[changes, unit-tests\]/);
  const expression = block.split("    if: >-\n")[1].trim().replace(/needs\.unit-tests/g, 'needs["unit-tests"]');
  // Evaluate the trusted workflow expression itself so its behavior, not a duplicate
  // policy function, is exercised across failure/selection/override combinations.
  const evaluate = new Function("needs", "github", "inputs", "cancelled", "vars", `return (${expression})`);
  for (const enabled of [undefined, "", "false", "true"]) for (const webapp of ["true", "false"]) for (const unit of ["success", "failure", "cancelled", "skipped", undefined]) for (const changes of ["success", "failure"]) for (const event of ["pull_request", "workflow_dispatch"]) for (const override of [false, true]) for (const cancelled of [false, true]) for (const draft of [false, true]) {
    const needs = { changes: { result: changes, outputs: { webapp } }, "unit-tests": { result: unit } };
    const expected = enabled === "true" && (event !== "pull_request" || !draft) && !cancelled && changes === "success" && webapp === "true" && (unit === "success" || (event === "workflow_dispatch" && override));
    assert.equal(Boolean(evaluate(needs, { event_name: event, event: { pull_request: { draft } } }, { diagnose_integration: override }, () => cancelled, { POSTGRES_INTEGRATION_TESTS_ENABLED: enabled })), expected, JSON.stringify({ enabled, webapp, unit, changes, event, override, cancelled, draft }));
  }
});
test("the required summary receives scope selection and both test results", () => {
  const summary = tests.split("  tests:\n")[1].split("    runs-on:")[0];
  assert.match(summary, /needs: \[changes, unit-tests, integration-tests\]/);
});
test("privileged cleanup executes trusted default-branch code with no producer checkout", () => {
  assert.match(maintenance, /pull_request_target:\s+types: \[closed\]/);
  assert.match(maintenance, /schedule:/);
  assert.match(maintenance, /permissions: \{\}/);
  assert.match(maintenance, /ref: \$\{\{ github.event.repository.default_branch \}\}/);
  assert.match(maintenance, /persist-credentials: false/);
  assert.match(maintenance, /actions: write/);
  assert.match(maintenance, /cancel-in-progress: false/);
  assert.doesNotMatch(maintenance, /download-artifact|workflow_run\.head_(?:sha|branch)|pull_request\.head|secrets: inherit|pnpm install/);
});
test("successful core publishes and desktop completions select apply; only a manual preview selects dry-run", async () => {
  const publisherPath = ".github/workflows/publish-images.yml";
  const desktopPath = ".github/workflows/desktop-windows.yml";
  const publisherName = workflow("publish-images").split("\n")[0].slice("name: ".length);
  const desktopName = desktop.split("\n")[0].slice("name: ".length);
  assert.ok(maintenance.includes("workflows: [" + desktopName + ", " + publisherName + "]\n    types: [completed]"));
  const applyIf = maintenance.match(/  apply:\n    if: >-\n([\s\S]*?)\n    runs-on:/)[1];
  const dryIf = maintenance.match(/  dry-run:\n    if: (.+)/)[1];
  const apply = new Function("github", "inputs", "return (" + applyIf + ")");
  const dryRun = new Function("github", "inputs", "return (" + dryIf + ")");
  const repo = { id: 42 };
  const run = { id: 5, name: publisherName, path: publisherPath, workflow_id: 7,
    event: "push", conclusion: "success", repository: repo, head_repository: repo };
  const api = { workflow: async file => {
    assert.equal(file, "publish-images.yml");
    return { id: 7, path: publisherPath };
  } };
  // The Actions prefilter ignores case and loosely compares IDs. The script reads the original JSON.
  for (const [overrides, queued, verified] of [
    [{ head_branch: "main" }, true, true],
    [{ head_branch: "v1.0.0" }, true, true],
    [{ event: "workflow_dispatch", head_branch: "feature" }, true, true],
    ...["failure", "cancelled", "skipped", "timed_out", "neutral"].map(conclusion => [{ conclusion }, false, false]),
    [{ event: "pull_request" }, false, false],
    [{ head_repository: null }, false, false],
    [{ head_repository: { id: 99 } }, false, false],
    [{ path: ".github/workflows/publish-docs-image.yml" }, false, false],
    [{ path: publisherPath.toUpperCase() }, true, false],
    [{ head_repository: { id: "42" } }, true, false],
    [{ workflow_id: 8 }, true, false],
    [{ id: 0 }, true, false],
    [{ name: desktopName, path: desktopPath, head_repository: null, conclusion: "failure", event: "pull_request" }, true, true],
  ]) {
    const event = { action: "completed", repository: repo, workflow_run: { ...run, ...overrides } };
    const github = { event_name: "workflow_run", event: { ...event,
      workflow_run: { ...event.workflow_run, path: event.workflow_run.path.toLowerCase() } } };
    assert.equal(Boolean(apply(github, {})), queued, JSON.stringify(overrides));
    assert.equal(Boolean(dryRun(github, {})), false);
    assert.equal(await isMaintenanceProducer(event, api), verified, JSON.stringify(overrides));
  }
  await assert.rejects(isMaintenanceProducer({ action: "completed", repository: repo, workflow_run: run }, {
    workflow: async () => { throw new Error("workflow lookup failed"); },
  }), /workflow lookup failed/);
  for (const [event_name, input, expectedApply] of [
    ["schedule", false, true], ["pull_request_target", false, true],
    ["workflow_dispatch", false, false], ["workflow_dispatch", true, true],
  ]) {
    const github = { event_name, event: {} };
    assert.equal(Boolean(apply(github, { apply: input })), expectedApply);
    assert.equal(Boolean(dryRun(github, { apply: input })), !expectedApply);
  }
});
test("installer uploads carry identity and 14-day expiry; signed release remains separate", () => {
  assert.match(desktop, /name: desktop-windows-unsigned-review-only\s+retention-days: 14/);
  assert.match(desktop, /review-build.json/);
  assert.match(desktop, /REVIEW_HEAD_SHA: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/);
  assert.doesNotMatch(workflow("desktop-release"), /desktop-windows-unsigned-review-only|ci-maintenance/);
});
test("base dependency warming cannot execute arbitrary PR refs or repeat an exact-hit install", () => {
  assert.match(warm, /branches: \[dev\]/);
  assert.match(warm, /if: github.ref == 'refs\/heads\/dev'/);
  assert.match(warm, /if: steps.node.outputs.cache-hit != 'true'/);
  assert.match(warm, /cache-dependency-path: pnpm-lock.yaml/);
  assert.match(warm, /pnpm --filter desktop install --frozen-lockfile/);
  assert.doesNotMatch(warm, /schedule:|tauri build|cargo build|actions: write/);
  for (const source of [tests, desktop, warm]) {
    assert.match(source, /setup-node@48b55a011bda9f5d6aeb4c2d9c7362e8dae4041e/);
    assert.match(source, /node-version: 26\s+cache: pnpm/);
  }
});
test("draft PRs skip every validation job, including setup and summary", () => {
  const guardJobs = ["ci-workflow-contracts", "tests", "desktop-windows", "check-package-lock-sync", "react-doctor", "work-records-integration", "next-runtime"];
  for (const name of guardJobs) {
    const source = workflow(name);
    assert.match(source, /types: \[opened, synchronize, reopened, ready_for_review, converted_to_draft\]/);
    assert.match(source, /group: .*github.event.pull_request.number/);
    assert.match(source, /cancel-in-progress: true/);
    const blocks = source.split("\njobs:\n")[1].split(/(?=^  [\w-]+:\s*$)/m).filter(block => /^  [\w-]+:/.test(block));
    assert.ok(blocks.length > 0, name);
    for (const block of blocks) {
      const id = block.split("\n")[0].trim();
      const line = block.match(/^    if: (.+)$/m)?.[1];
      assert.ok(line, name + "/" + id + " must guard draft PRs");
      const condition = line === ">-" ? block.match(/^    if: >-\n((?:      .+\n)+)/m)[1].trim() : line;
      const expression = condition.replace(/^\$\{\{\s*|\s*\}\}$/g, "").replace(/needs\.unit-tests/g, 'needs["unit-tests"]');
      const evaluate = new Function("needs", "github", "inputs", "always", "cancelled", "vars", "return (" + expression + ")");
      const needs = {changes:{result:"success",outputs:{webapp:"true",workspace:"true",docker:"true"}},"unit-tests":{result:"success"}};
      assert.equal(Boolean(evaluate(needs, {event_name:"pull_request",event:{pull_request:{draft:true}}}, {}, ()=>true, ()=>false, {POSTGRES_INTEGRATION_TESTS_ENABLED:"true"})), false, name + "/" + id + " draft");
      assert.equal(Boolean(evaluate(needs, {event_name:"pull_request",event:{pull_request:{draft:false}}}, {}, ()=>true, ()=>false, {POSTGRES_INTEGRATION_TESTS_ENABLED:"true"})), true, name + "/" + id + " ready");
      assert.equal(Boolean(evaluate(needs, {event_name:"workflow_dispatch",event:{}}, {}, ()=>true, ()=>false, {POSTGRES_INTEGRATION_TESTS_ENABLED:"true"})), true, name + "/" + id + " manual");
    }
  }
});

test("work records PostgreSQL suites run on every ready PR into dev, regardless of the global PostgreSQL switch", () => {
  const source = workflow("work-records-integration");
  assert.match(source, /pull_request:\s+types: \[opened, synchronize, reopened, ready_for_review, converted_to_draft\]\s+branches:\s+- dev\n/);
  assert.match(source, /group: .*github.event.pull_request.number/);
  assert.match(source, /cancel-in-progress: true/);
  assert.doesNotMatch(source, /continue-on-error|\|\| true/);
  const block = source.split("\njobs:\n")[1];
  const condition = block.match(/^    if: (.+)$/m)[1].replace(/^\$\{\{\s*|\s*\}\}$/g, "");
  const evaluate = new Function("github", "vars", `return (${condition})`);
  for (const enabled of [undefined, "", "false", "true"]) {
    const vars = { POSTGRES_INTEGRATION_TESTS_ENABLED: enabled };
    assert.equal(Boolean(evaluate({ event_name: "pull_request", event: { pull_request: { draft: false } } }, vars)), true, `ready ${enabled}`);
    assert.equal(Boolean(evaluate({ event_name: "pull_request", event: { pull_request: { draft: true } } }, vars)), false, `draft ${enabled}`);
    assert.equal(Boolean(evaluate({ event_name: "workflow_dispatch", event: {} }, vars)), true, `manual ${enabled}`);
  }
});
test("the work records job hands the selected suites to the shared runner on a disposable database", () => {
  const source = workflow("work-records-integration");
  assert.match(source, /^        image: postgres:16$/m);
  assert.match(source, /--tmpfs \/var\/lib\/postgresql\/data/);
  assert.match(source, /set -euo pipefail/);
  assert.match(source, /suites="\$\(node \.github\/scripts\/work-records-suites\.mjs\)"/);
  assert.match(source, /create database \\"\$\{database_name\}\\"/);
  assert.match(source, /database_name="approval_workflow_repository_test_/);
  assert.match(source, /bash apps\/webapp\/scripts\/run-postgres-integration-suites\.sh\s+\\\s+"postgresql:\/\/postgres:postgres@127\.0\.0\.1:5432\/\$\{database_name\}" "\$\{suite_paths\[@\]\}"/);
  assert.match(source, /--fsModuleCache --fsModuleCachePath="\$RUNNER_TEMP\/webapp-vitest-cache"/);
});

test("PostgreSQL enablement is shared by runner scheduling and the required summary", () => {
  assert.match(tests, /POSTGRES_INTEGRATION_TESTS_ENABLED: \$\{\{ vars\.POSTGRES_INTEGRATION_TESTS_ENABLED == 'true' \}\}/);
  assert.match(tests, /integrationEnabled: process\.env\.POSTGRES_INTEGRATION_TESTS_ENABLED === 'true'/);
});
