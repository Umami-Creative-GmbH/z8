import assert from "node:assert/strict";
import test from "node:test";
import { checkTestResults, selectTestScopes } from "./test-scope.mjs";

const all = { webapp: true, workspace: true, docker: true };
const none = { webapp: false, workspace: false, docker: false };

test("desktop-only changes do not launch web-app or PostgreSQL tests", () => {
  assert.deepEqual(selectTestScopes(["apps/desktop/src/App.tsx"]), { ...none, workspace: true });
});
test("web-app changes include Docker import tracing", () => {
  assert.deepEqual(selectTestScopes(["apps/webapp/src/lib/clocking.ts"]), { ...none, webapp: true, docker: true });
});
test("Docker-only changes select only runtime tests", () => {
  assert.deepEqual(selectTestScopes(["docker/Dockerfile.worker", "docker/targets/worker/package.json"]), { ...none, docker: true });
});
test("shared and unknown inputs retain full coverage", () => {
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "turbo.json", "packages/new/src/index.ts", "scripts/test.mjs", ".github/workflows/tests.yml", ".github/scripts/test-scope.mjs", "unknown.ts"]) {
    assert.deepEqual(selectTestScopes([file]), all, file);
  }
});
test("manual runs and truncated PR file lists retain full coverage", () => {
  assert.deepEqual(selectTestScopes([], { full: true }), all);
});
test("documentation does not add test groups and mixed changes are combined", () => {
  assert.deepEqual(selectTestScopes(["apps/webapp/README.md"]), none);
  assert.deepEqual(selectTestScopes(["apps/desktop/src/App.tsx", "apps/webapp/src/lib/clocking.ts"]), all);
});
test("a moved web-app file is covered when its previous filename is included", () => {
  assert.deepEqual(selectTestScopes(["apps/desktop/src/clock.ts", "apps/webapp/src/lib/clock.ts"]), all);
});

function results(scopes = all) {
  return {
    changes: { result: "success", outputs: Object.fromEntries(Object.entries(scopes).map(([name, value]) => [name, String(value)])) },
    "unit-tests": { result: Object.values(scopes).some(Boolean) ? "success" : "skipped" },
    "integration-tests": { result: scopes.webapp ? "success" : "skipped" },
  };
}
test("the required check accepts success and deliberately unselected groups", () => {
  assert.equal(checkTestResults(results()).length, 2);
  assert.equal(checkTestResults(results({ ...none, workspace: true })).length, 2);
  assert.equal(checkTestResults(results(none)).length, 2);
});
test("the required check rejects failed, cancelled, missing or unexpectedly skipped jobs", () => {
  for (const job of ["unit-tests", "integration-tests"]) {
    for (const result of ["failure", "cancelled", "skipped", undefined]) {
      const needs = results();
      needs[job].result = result;
      assert.throws(() => checkTestResults(needs), new RegExp(job));
    }
  }
});
test("the required check rejects unsuccessful detection and missing scope outputs", () => {
  for (const result of ["failure", "cancelled", "skipped", undefined]) {
    const needs = results();
    needs.changes.result = result;
    assert.throws(() => checkTestResults(needs), /scope detection/);
  }
  const needs = results();
  delete needs.changes.outputs.webapp;
  assert.throws(() => checkTestResults(needs), /Missing test scope/);
});

test("desktop API changes also select companion workspace tests", () => {
  assert.deepEqual(selectTestScopes(["apps/webapp/src/app/api/desktop/context/route.ts"]), all);
});

test("the combined shard is required for every selected scope combination", () => {
  for (let mask = 0; mask < 8; mask++) {
    const scopes = { webapp: Boolean(mask & 1), workspace: Boolean(mask & 2), docker: Boolean(mask & 4) };
    assert.equal(checkTestResults(results(scopes)).length, 2);
    if (mask) {
      const needs = results(scopes);
      needs["unit-tests"].result = "skipped";
      assert.throws(() => checkTestResults(needs), /unit-tests/);
    }
  }
});
