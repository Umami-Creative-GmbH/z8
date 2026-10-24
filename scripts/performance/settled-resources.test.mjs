import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
test("companion validates required inputs and sample counts before importing a browser runtime", () => {
  const dir = mkdtempSync(join(tmpdir(), "z8-settled-"));
  const plan = join(dir, "plan.json");
  writeFileSync(plan, JSON.stringify({ samples: 19 }));
  const run = (...args) =>
    spawnSync(
      process.execPath,
      ["scripts/performance/settled-resources.mjs", ...args],
      { encoding: "utf8" },
    );
  assert.equal(run("capture", "--plan", plan).status, 2);
  assert.match(run("capture", "--plan", plan).stderr, /twenty|sample/i);
  assert.equal(
    run("capture", "--plan", plan, "--condition", "small").status,
    2,
  );
});
import { requireSettledEvidence } from "./settled-resources.mjs";
import { settledPolicy } from "./settled-resource-observer.mjs";
test("native correlation, sample coverage and censored outcomes cannot finalize a resource budget", () => {
  const plan = {
    phase: "baseline",
    samples: 20,
    concurrency: 1,
    fixture: { kind: "disposable", journeysVerified: true },
    runtime: {
      mode: "production",
      collectorProtocol: "z8-fixture-otlp-collector-v2",
      browserPermissions: "notifications-denied-for-fixture-origin",
      build: "aaaaaaaaa",
      sourceBuild: "bbbbbbbbb",
      toolingBuild: "ccccccccc",
    },
    conditions: [{ name: "admin", role: "admin" }],
    ranges: [{ name: "month" }],
    routes: [{ name: "reports", path: "/reports", ready: "#ready", link: "a" }],
  };
  const metrics = {
    queryCount: 1,
    queryDurationMs: 1,
    rowsRetrieved: 1,
    poolWaitMs: 1,
    cacheHits: 1,
    cacheMisses: 1,
    eventLoopDelayMs: 1,
  };
  const samples = ["first-document", "repeat-link"].flatMap((mode) =>
    Array.from({ length: 20 }, (_, iteration) => ({
      condition: "admin",
      route: "reports",
      range: "month",
      mode,
      iteration,
      traceId: `${mode}-${iteration}`,
      failed: false,
      censored: false,
      inlineRscDecodedBytes: 100,
      backend: metrics,
      settled: {
        complete: true,
        capped: false,
        mandatoryPending: 0,
        mandatoryErrors: 0,
        bytes: { javascript: 1, document: 1, rsc: 1, otherFinite: 1 },
      },
    })),
  );
  const artifact = {
    kind: "settled-resource-companion",
    phase: "baseline",
    planSha256: "hash",
    policy: settledPolicy,
    runtime: { ...plan.runtime, buildVerified: true },
    samples,
    finalized: true,
    evidenceComplete: true,
    resourceComplete: true,
  };
  const native = samples.map((s) => ({
    traceId: s.traceId,
    ...metrics,
    coverage: {
      observer: true,
      pg: true,
      rows: true,
      cache: true,
      eventLoop: true,
      rejectedBatches: 0,
      registration: true,
      closed: true,
      unattributedNativeSpans: 0,
      incomplete: false,
      nativeProof: true,
      lateSpans: 0,
    },
    observedQueryErrors: 0,
    observedPoolAcquisitionErrors: 0,
  }));
  assert.doesNotThrow(() =>
    requireSettledEvidence(plan, artifact, native, "hash"),
  );
  for (const change of [
    (a) => a.samples.pop(),
    (a) => (a.samples[0].settled.capped = true),
    (a) => (a.samples[0].failed = true),
    (a) => (a.samples[0].settled.bytes.javascript = null),
    (a) => (a.finalized = false),
  ]) {
    const copy = structuredClone(artifact);
    change(copy);
    assert.throws(() => requireSettledEvidence(plan, copy, native, "hash"));
  }
  const incomplete = structuredClone(native);
  incomplete[0].coverage.rows = false;
  assert.throws(() =>
    requireSettledEvidence(plan, artifact, incomplete, "hash"),
  );
});
test("capture requires registered collector control before any runtime or browser request", () => {
  const dir = mkdtempSync(join(tmpdir(), "z8-settled-control-")),
    path = join(dir, "plan.json");
  writeFileSync(
    path,
    JSON.stringify({
      phase: "baseline",
      samples: 20,
      concurrency: 1,
      fixture: { kind: "disposable", journeysVerified: true },
      runtime: {
        mode: "production",
        browserPermissions: "notifications-denied-for-fixture-origin",
        collectorProtocol: "z8-fixture-otlp-collector-v2",
      },
      conditions: [{ name: "admin", role: "admin" }],
      ranges: [{ name: "month" }],
      routes: [
        { name: "reports", path: "/reports", ready: "#ready", link: "a" },
      ],
    }),
  );
  const r = spawnSync(
    process.execPath,
    [
      "scripts/performance/settled-resources.mjs",
      "capture",
      "--plan",
      path,
      "--auth",
      "nonexistent",
      "--chrome",
      "nonexistent",
      "--out",
      join(dir, "out.json"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(r.status, 2);
  assert.match(r.stderr, /collector/i);
});
