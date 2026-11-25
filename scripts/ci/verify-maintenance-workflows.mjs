import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const parser = process.env.YQ || "yq";
const maintenance = ".github/workflows/ci-maintenance.yml";
const queueDiagnostic = 'unexpected key "queue" for "concurrency" section. expected one of "cancel-in-progress", "group"';

function yamlValue(file, expression) {
  return JSON.parse(execFileSync(parser, ["-o=json", expression, file], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
}

function queueCount(value) {
  if (value === null || typeof value !== "object") return 0;
  return Object.entries(value).reduce((sum, [key, child]) => sum + Number(key === "queue") + queueCount(child), 0);
}

export function verifyMaintenanceWorkflow(file) {
  const doc = yamlValue(file, "explode(.)");
  const { apply, "dry-run": dry } = doc.jobs;
  assert.deepEqual(doc.on.workflow_run, { workflows: ["Desktop Windows", "Publish Docker Images"], types: ["completed"] });
  assert.equal(doc.concurrency, undefined);
  assert.deepEqual(doc.permissions, {});
  assert.deepEqual(Object.keys(doc.jobs).sort(), ["apply", "dry-run"]);
  assert.deepEqual(apply.concurrency, { group: "ci-storage-maintenance", queue: "max", "cancel-in-progress": false });
  assert.equal(queueCount(doc), 1);
  assert.equal(dry.concurrency, undefined);
  assert.deepEqual(apply.permissions, { contents: "read", actions: "write", "pull-requests": "read" });
  assert.deepEqual(dry.permissions, { ...apply.permissions, actions: "read" });
  assert.deepEqual(apply.steps, dry.steps);
  assert.equal(apply.env.MAINTENANCE_MODE, "--apply");
  assert.equal(dry.env.MAINTENANCE_MODE, "--dry-run");
  assert.equal(apply.steps.at(-1).run, 'node .github/scripts/ci-maintenance.mjs "$MAINTENANCE_MODE"');
  const checkouts = apply.steps.filter(step => step.uses);
  assert.equal(checkouts.length, 1);
  assert.match(checkouts[0].uses, /^actions\/checkout@[0-9a-f]{40}$/);
  assert.deepEqual(checkouts[0].with, {
    ref: "${{ github.event.repository.default_branch }}",
    "sparse-checkout": ".github/scripts",
    "persist-credentials": false,
  });

  // v1.7.12 parses the original YAML but reports GitHub's queue key as unknown.
  // Check its value above and except only the diagnostic at this exact key.
  const [line, column] = yamlValue(file, ".jobs.apply.concurrency.queue | key | [line, column]");
  lint([file], { file, line, column });
}

function lint(files, queue) {
  const result = spawnSync(process.env.ACTIONLINT || "actionlint",
    ["-shellcheck=", "-pyflakes=", "-format", "{{json .}}", ...files], { encoding: "utf8" });
  if (result.error) throw result.error;
  assert.equal(result.stderr, "");
  const errors = JSON.parse(result.stdout) ?? [];
  if (queue) {
    assert.equal(result.status, 1);
    assert.equal(errors.length, 1, result.stdout);
    const [error] = errors;
    assert.equal(resolve(error.filepath), resolve(queue.file));
    assert.equal(error.line, queue.line);
    assert.equal(error.column, queue.column);
    assert.equal(error.kind, "syntax-check");
    assert.equal(error.message, queueDiagnostic);
  } else {
    assert.equal(result.status, 0, result.stdout);
    assert.deepEqual(errors, []);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  assert.match(execFileSync(parser, ["--version"], { encoding: "utf8" }), /mikefarah\/yq.*version v4\./);
  verifyMaintenanceWorkflow(maintenance);
  lint([".github/workflows/publish-images.yml", ".github/workflows/desktop-windows.yml",
    ".github/workflows/ci-workflow-contracts.yml"]);
  console.log("Maintenance and publisher workflows validated.");
}
