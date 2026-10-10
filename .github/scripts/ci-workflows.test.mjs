import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
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
  const evaluate = new Function("needs", "github", "inputs", "cancelled", `return (${expression})`);
  for (const webapp of ["true", "false"]) for (const unit of ["success", "failure", "cancelled", "skipped", undefined]) for (const changes of ["success", "failure"]) for (const event of ["pull_request", "workflow_dispatch"]) for (const override of [false, true]) for (const cancelled of [false, true]) for (const draft of [false, true]) {
    const needs = { changes: { result: changes, outputs: { webapp } }, "unit-tests": { result: unit } };
    const expected = (event !== "pull_request" || !draft) && !cancelled && changes === "success" && webapp === "true" && (unit === "success" || (event === "workflow_dispatch" && override));
    assert.equal(Boolean(evaluate(needs, { event_name: event, event: { pull_request: { draft } } }, { diagnose_integration: override }, () => cancelled)), expected, JSON.stringify({ webapp, unit, changes, event, override, cancelled, draft }));
  }
});
test("expensive PR jobs wait on shared Linux debounce once, with independent cancellation", () => {
  const debounce = workflow("ci-debounce");
  assert.match(debounce, /runs-on: ubuntu-latest/);
  assert.match(debounce, /if: github.event_name == 'pull_request'\s+run: sleep 90/);
  assert.doesNotMatch(debounce, /concurrency:/);
  for (const source of [tests, desktop]) {
    assert.match(source, /uses: \.\/\.github\/workflows\/ci-debounce.yml/);
    assert.match(source, /cancel-in-progress: true/);
  }
  assert.match(tests, /needs: \[changes, debounce\]/);
  assert.match(desktop.split("  windows:\n")[1].split("    runs-on:")[0], /needs: debounce/);
  assert.match(tests, /needs: \[changes, debounce, unit-tests, integration-tests\]/);
});
test("privileged cleanup executes trusted default-branch code with no producer checkout", () => {
  assert.match(maintenance, /pull_request_target:\s+types: \[closed\]/);
  assert.match(maintenance, /schedule:/);
  assert.match(maintenance, /permissions: \{\}/);
  assert.match(maintenance, /ref: \$\{\{ github.event.repository.default_branch \}\}/);
  assert.match(maintenance, /persist-credentials: false/);
  assert.match(maintenance, /actions: write/);
  assert.match(maintenance, /cancel-in-progress: false/);
  assert.doesNotMatch(maintenance, /download-artifact|workflow_run.head|pull_request.head|secrets: inherit|pnpm install/);
});
test("installer uploads carry identity and 14-day expiry; signed release remains separate", () => {
  assert.match(desktop, /name: desktop-windows-unsigned-review-only\s+retention-days: 14/);
  assert.match(desktop, /review-build.json/);
  assert.match(desktop, /REVIEW_HEAD_SHA: \$\{\{ github.event.pull_request.head.sha \|\| github.sha \}\}/);
  assert.doesNotMatch(workflow("desktop-release"), /desktop-windows-unsigned-review-only|ci-debounce|ci-maintenance/);
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
    assert.match(source, /node-version: 24\s+cache: pnpm/);
  }
});
test("draft PRs skip every validation job, including setup, summary and reusable debounce", () => {
  const guardJobs = ["tests", "desktop-windows", "check-package-lock-sync", "react-doctor", "ci-debounce"];
  for (const name of guardJobs) {
    const source = workflow(name);
    if (name !== "ci-debounce") {
      assert.match(source, /types: \[opened, synchronize, reopened, ready_for_review, converted_to_draft\]/);
      assert.match(source, /group: .*github.event.pull_request.number/);
      assert.match(source, /cancel-in-progress: true/);
    }
    const blocks = source.split("\njobs:\n")[1].split(/(?=^  [\w-]+:\s*$)/m).filter(block => /^  [\w-]+:/.test(block));
    assert.ok(blocks.length > 0, name);
    for (const block of blocks) {
      const id = block.split("\n")[0].trim();
      const line = block.match(/^    if: (.+)$/m)?.[1];
      assert.ok(line, name + "/" + id + " must guard draft PRs");
      const condition = line === ">-" ? block.match(/^    if: >-\n((?:      .+\n)+)/m)[1].trim() : line;
      const expression = condition.replace(/^\$\{\{\s*|\s*\}\}$/g, "").replace(/needs\.unit-tests/g, 'needs["unit-tests"]');
      const evaluate = new Function("needs", "github", "inputs", "always", "cancelled", "return (" + expression + ")");
      const needs = {changes:{result:"success",outputs:{webapp:"true",workspace:"true",docker:"true"}},"unit-tests":{result:"success"}};
      assert.equal(Boolean(evaluate(needs, {event_name:"pull_request",event:{pull_request:{draft:true}}}, {}, ()=>true, ()=>false)), false, name + "/" + id + " draft");
      assert.equal(Boolean(evaluate(needs, {event_name:"pull_request",event:{pull_request:{draft:false}}}, {}, ()=>true, ()=>false)), true, name + "/" + id + " ready");
      assert.equal(Boolean(evaluate(needs, {event_name:"workflow_dispatch",event:{}}, {}, ()=>true, ()=>false)), true, name + "/" + id + " manual");
    }
  }
});
