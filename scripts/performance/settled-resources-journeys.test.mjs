import assert from "node:assert/strict";
import test from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as companion from "./settled-resources.mjs";
import { testBrowserMetadata } from "./control-cancellation-test-fixtures.mjs";
import { nextStreamCompletionPatch } from "./next-stream-completion-patch.mjs";

function planFixture() {
  return {
    phase: "baseline", timeoutMs: 90000, samples: 20, concurrency: 1,
    fixture: { kind: "disposable", journeysVerified: true },
    runtime: { mode: "production", collectorProtocol: "z8-fixture-otlp-collector-v2", traceTransport: "context-loopback-proxy-v1", browserPolicy: "isolated-profile-no-prediction-v1", prerequisiteQuiescencePolicy: "settled-prerequisite-transfers-v1", operatorReloadQuiescencePolicy: "operator-reload-transfer-quiescence-v1", nextStreamCompletionPatch: structuredClone(nextStreamCompletionPatch), browserPermissions: "notifications-denied-for-fixture-origin", poolMax: 10, poolAcquisitionTimeoutMs: 60000, browserControl: testBrowserMetadata() },
    conditions: ["small-admin", "large-admin", "small-manager"].map(name => ({ name, role: "admin" })),
    ranges: ["month", "quarter", "year"].map(name => ({ name })),
    routes: ["dashboard", "directory", "analytics"].map(name => ({ name, path: `/${name}`, ready: "#ready", link: `a[href='/${name}']`, modes: ["first-document", "repeat-link"] })),
  };
}

test("journey verification runs every same cohort once while normal capture retains 1080 visits", () => {
  const plan = planFixture(), original = structuredClone(plan);
  const normal = companion.companionCaptureConfiguration(plan);
  const diagnostic = companion.companionCaptureConfiguration(plan, { verifyJourneys: true });
  assert.equal(normal.cohorts.length, 54);
  assert.equal(normal.cohorts.reduce((sum, row) => sum + row.count, 0), 1080);
  assert.equal(normal.kind, "settled-resource-companion");
  assert.equal(normal.diagnosticOnly, false);
  assert.equal(diagnostic.kind, "settled-resource-journey-verification");
  assert.equal(diagnostic.diagnosticOnly, true);
  assert.equal(diagnostic.cohorts.length, 54);
  assert.ok(diagnostic.cohorts.every(row => row.count === 1));
  assert.deepEqual(diagnostic.cohorts.map(({ count, ...identity }) => identity), normal.cohorts.map(({ count, ...identity }) => identity));
  assert.deepEqual(plan, original);
});

test("verification flag is capture-only, nonduplicate and does not bypass twenty-sample validation", () => {
  assert.deepEqual(companion.parseCompanionCommand(["capture", "--verify-journeys", "--plan", "plan.json"]), { command: "capture", options: { "--verify-journeys": true, "--plan": "plan.json" } });
  for (const args of [["finalize", "--verify-journeys"], ["capture", "--verify-journeys", "--verify-journeys"], ["capture", "--verify-journeys", "true"], ["capture", "--condition", "small"], ["other", "--verify-journeys"]]) assert.throws(() => companion.parseCompanionCommand(args));
  const plan = planFixture(); plan.samples = 19;
  assert.throws(() => companion.companionCaptureConfiguration(plan, { verifyJourneys: true }), /twenty/);
  plan.samples = 20; plan.samplesByMode = { "repeat-link": 1 };
  assert.throws(() => companion.companionCaptureConfiguration(plan, { verifyJourneys: true }), /twenty/);
});

test("diagnostic artifacts cannot be finalized or supply budget evidence even after relabelling", () => {
  const dir = mkdtempSync(join(tmpdir(), "companion-journeys-")), plan = planFixture();
  const planFile = join(dir, "plan.json"), artifactFile = join(dir, "artifact.json"), backend = join(dir, "backend.json");
  writeFileSync(planFile, JSON.stringify(plan)); writeFileSync(backend, "[]");
  for (const artifact of [
    { kind: "settled-resource-journey-verification", diagnosticOnly: true },
    { kind: "settled-resource-journey-verification", diagnosticOnly: false },
    { kind: "settled-resource-companion", diagnosticOnly: true },
    ...["true", 1, null, {}, []].map(diagnosticOnly => ({ kind: "settled-resource-companion", diagnosticOnly })),
  ]) {
    Object.assign(artifact, { samples: [], finalized: true, evidenceComplete: true, resourceComplete: true });
    assert.throws(() => companion.requireSettledEvidence(plan, artifact, [], "hash"), /diagnostic/i);
    const bytes = JSON.stringify(artifact); writeFileSync(artifactFile, bytes);
    const result = spawnSync(process.execPath, ["scripts/performance/settled-resources.mjs", "finalize", "--plan", planFile, "--artifact", artifactFile, "--backend", backend], { encoding: "utf8" });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /diagnostic/i);
    assert.equal(readFileSync(artifactFile, "utf8"), bytes);
  }
});
