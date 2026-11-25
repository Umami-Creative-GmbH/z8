import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { verifyMaintenanceWorkflow } from "./verify-maintenance-workflows.mjs";

test("the actionlint queue exception rejects invalid configuration and unrelated diagnostics", t => {
  const source = readFileSync(".github/workflows/ci-maintenance.yml", "utf8");
  const dir = mkdtempSync(join(tmpdir(), "z8-workflow-contract-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const file = join(dir, "ci-maintenance.yml");
  writeFileSync(file, source);
  verifyMaintenanceWorkflow(file);
  for (const [before, after] of [
    ["queue: max", "queue: invalid"],
    ["group: ci-storage-maintenance", "group: ${{ github.run_id }}"],
    ["  apply:", "  other:"],
    ["steps: *maintenance_steps", "steps: *missing_steps"],
    ["runs-on: ubuntu-latest", "run-on: ubuntu-latest"],
  ]) {
    const broken = source.replace(before, after);
    assert.notEqual(broken, source);
    writeFileSync(file, broken);
    assert.throws(() => verifyMaintenanceWorkflow(file), before);
  }
});
