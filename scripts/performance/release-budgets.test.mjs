import { settledPolicy } from "./settled-resource-observer.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "z8-release-budget-"));
  const plan = {
    phase: "baseline",
    samples: 20,
    samplesByMode: {
      "first-document": 20,
      "repeat-link": 20,
      "return-visit": 5,
      "manual-refresh": 5,
      "mutation-refresh": 5,
    },
    concurrency: 1,
    timeoutMs: 30000,
    fixture: { kind: "disposable", journeysVerified: true },
    runtime: {
      mode: "production",
      collectorProtocol: "z8-fixture-otlp-collector-v2",
      browserPermissions: "notifications-denied-for-fixture-origin",
      build: "aaaaaaaaa",
      sourceBuild: "bbbbbbbbb",
      toolingBuild: "ccccccccc",
      poolMax: 10,
    },
    conditions: [
      { name: "small", role: "admin", organization: "small", employees: 8 },
    ],
    ranges: [{ name: "month" }],
    routes: [
      {
        name: "reports",
        path: "/reports",
        ready: "#ready",
        link: "a[href=reports]",
        clockReady: "#clock",
      },
    ],
  };
  const modes = Object.keys(plan.samplesByMode);
  const samples = modes.flatMap((mode) =>
    Array.from({ length: plan.samplesByMode[mode] }, (_, i) => ({
      condition: "small",
      range: "month",
      route: "reports",
      mode,
      iteration: i,
      traceId: `trace-${mode}-${i}`,
      backendTraceId: `trace-${mode}-${i}`,
      failed: false,
      censored: false,
      resourceScope: "measured-visit",
      usableContentMs: 1000,
      clockReadyMs: 100,
      requests: 5,
      failedRequests: 0,
      pendingScriptRequests: 0,
      pendingRscRequests: 0,
      resourcePendingRequests: 0,
      resourceWindowComplete: true,
      javascriptBytes: 10000,
      rscBytes: 2000,
      totalBytes: 12000,
      inlineRscDecodedBytes: mode === "first-document" ? 2000 : null,
      lcpMs: mode === "first-document" ? 800 : null,
      interactionMaxMs: null,
      restored: mode === "mutation-refresh" ? true : null,
      backend: {
        queryCount: 5,
        queryDurationMs: 10,
        rowsRetrieved: 20,
        poolWaitMs: 1,
        cacheHits: 1,
        cacheMisses: 1,
        eventLoopDelayMs: 1,
      },
    })),
  );
  const backend = samples.map((s) => ({
    traceId: s.traceId,
    ...s.backend,
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
  const artifact = {
    phase: "baseline",
    kind: "benchmark",
    planSha256: "",
    runtime: { ...plan.runtime, buildVerified: true },
    hardware: { cpu: "synthetic", cores: 1, memoryBytes: 100 },
    browser: "Synthetic browser",
    samples,
    summaries: [],
    missingMetrics: [],
    evidenceGates: [],
    evidenceComplete: true,
    acceptance: "baseline-recorded",
  };
  const save = (name, value) => {
    writeFileSync(join(dir, name), JSON.stringify(value, null, 2) + "\n");
    return join(dir, name);
  };
  const saveBefore = () => {
    artifact.planSha256 = hash(readFileSync(save("before-plan.json", plan)));
    save("before.json", artifact);
    save("backend.json", backend);
  };
  saveBefore();
  const run = (...args) =>
    spawnSync(
      process.execPath,
      ["scripts/performance/release-budgets.mjs", ...args],
      { encoding: "utf8" },
    );
  const derive = () =>
    run(
      "derive",
      "--before-plan",
      join(dir, "before-plan.json"),
      "--before",
      join(dir, "before.json"),
      "--backend",
      join(dir, "backend.json"),
      "--release-build",
      "ddddddddd",
      "--release-source",
      "eeeeeeeee",
      "--release-tooling",
      "fffffffff",
      "--out",
      join(dir, "derived"),
    );
  return { dir, plan, artifact, backend, save, saveBefore, run, derive };
}
test("derivation emits fresh release budgets without modifying the baseline", () => {
  const f = fixture();
  const old = readFileSync(join(f.dir, "before-plan.json"), "utf8");
  const run = f.derive();
  assert.equal(run.status, 0, run.stderr);
  const budget = JSON.parse(
    readFileSync(join(f.dir, "derived/release-budgets.json")),
  );
  assert.equal(budget.cohorts[0].usableContentMs.beforeP95, 1000);
  assert.equal(budget.cohorts[0].usableContentMs.ceiling, 1250);
  assert.equal(budget.conditions.small.queryCount, 15);
  assert.equal(
    JSON.parse(readFileSync(join(f.dir, "derived/release-plan.json"))).phase,
    "release",
  );
  assert.equal(readFileSync(join(f.dir, "before-plan.json"), "utf8"), old);
});
test("derivation refuses incomplete, changed, uncorrelated and retrospective evidence", () => {
  for (const change of [
    (f) => {
      f.artifact.evidenceComplete = false;
    },
    (f) => {
      f.artifact.samples.pop();
    },
    (f) => {
      f.artifact.samples[1].iteration = 0;
    },
    (f) => {
      f.artifact.samples[0].backend.queryCount = null;
    },
    (f) => {
      f.backend[0].coverage.pg = false;
    },
    (f) => {
      f.backend[0].queryCount = 10;
    },
    (f) => {
      f.artifact.phase = "release";
    },
    (f) => {
      f.artifact.runtime.build = "ddddddddd";
    },
    (f) => {
      f.artifact.missingMetrics = ["rowsRetrieved"];
    },
  ]) {
    const f = fixture();
    change(f);
    f.saveBefore();
    const run = f.derive();
    assert.equal(run.status, 2, run.stdout + run.stderr);
  }
  const f = fixture();
  f.artifact.planSha256 = "0".repeat(64);
  f.save("before.json", f.artifact);
  assert.equal(f.derive().status, 2);
});
test("failed before cohorts retain failure counts and an absolute timeout instead of successful-only latency", () => {
  const f = fixture();
  Object.assign(f.artifact.samples[0], {
    failed: true,
    censored: true,
    elapsedUntilFailureMs: 31000,
    usableContentMs: null,
    clockReadyMs: null,
    resourceScope: "prerequisite-failure",
    javascriptBytes: null,
    rscBytes: null,
    totalBytes: null,
    inlineRscDecodedBytes: null,
    lcpMs: null,
  });
  f.saveBefore();
  const run = f.derive();
  assert.equal(run.status, 0, run.stderr);
  const budget = JSON.parse(
    readFileSync(join(f.dir, "derived/release-budgets.json")),
  );
  assert.equal(budget.cohorts[0].failed, 1);
  assert.equal(budget.cohorts[0].censored, 1);
  assert.deepEqual(budget.cohorts[0].usableContentMs, {
    beforeP95: null,
    ceiling: 30000,
    basis: "censored-before",
  });
  assert.equal(budget.cohorts[0].javascriptBytes.ceiling, null);
});
function candidate(f) {
  const plan = JSON.parse(
      readFileSync(join(f.dir, "derived/release-plan.json")),
    ),
    artifact = structuredClone(f.artifact);
  artifact.phase = "release";
  artifact.planSha256 = hash(
    readFileSync(join(f.dir, "derived/release-plan.json")),
  );
  artifact.runtime = { ...plan.runtime, buildVerified: true };
  artifact.acceptance = "fulfilled";
  f.save("head.json", artifact);
  f.save("head-backend.json", f.backend);
  return {
    artifact,
    plan,
    compare: () =>
      f.run(
        "compare",
        "--before-plan",
        join(f.dir, "before-plan.json"),
        "--before",
        join(f.dir, "before.json"),
        "--backend",
        join(f.dir, "backend.json"),
        "--plan",
        join(f.dir, "derived/release-plan.json"),
        "--budgets",
        join(f.dir, "derived/release-budgets.json"),
        "--head",
        join(f.dir, "head.json"),
        "--head-backend",
        join(f.dir, "head-backend.json"),
        "--out",
        join(f.dir, "comparison.json"),
      ),
  };
}
test("comparison records all cohorts and reports fulfilled numerical gates with explicit whole-release limits", () => {
  const f = fixture();
  assert.equal(f.derive().status, 0);
  const h = candidate(f),
    run = h.compare();
  assert.equal(run.status, 0, run.stderr);
  const report = JSON.parse(readFileSync(join(f.dir, "comparison.json")));
  assert.equal(report.numericalAcceptance, "fulfilled");
  assert.equal(report.releaseAcceptance, "unfulfilled");
  assert.equal(report.cohorts.length, 5);
  assert.equal(report.cohorts[0].head.usableContentMs.p95, 1000);
  assert.match(report.limitations.join(" "), /INP/);
});
test("comparison retains failures, pending scripts and latency regressions as unfulfilled gates", () => {
  for (const change of [
    (h) => {
      h.artifact.samples[0].usableContentMs = 5000;
      h.artifact.samples[1].usableContentMs = 5000;
    },
    (h) => {
      h.artifact.samples[0].pendingScriptRequests = 1;
    },
    (h) => {
      h.artifact.samples[0].failed = true;
      h.artifact.samples[0].elapsedUntilFailureMs = 30000;
    },
    (h) => {
      h.artifact.samples[0].javascriptBytes = null;
    },
    (h) => {
      h.artifact.samples[50].restored = false;
    },
  ]) {
    const f = fixture();
    assert.equal(f.derive().status, 0);
    const h = candidate(f);
    change(h);
    f.save("head.json", h.artifact);
    const run = h.compare();
    assert.equal(run.status, 1, run.stderr);
    const report = JSON.parse(readFileSync(join(f.dir, "comparison.json")));
    assert.equal(report.numericalAcceptance, "unfulfilled");
    assert.ok(report.gates.length > 0);
  }
});
test("comparison rejects changed budgets, missing iterations and mismatched native coverage", () => {
  for (const change of [
    (f, h) => {
      const p = join(f.dir, "derived/release-budgets.json"),
        b = JSON.parse(readFileSync(p));
      b.cohorts[0].usableContentMs.ceiling = 999999;
      writeFileSync(p, JSON.stringify(b));
    },
    (f, h) => {
      h.artifact.samples.pop();
      f.save("head.json", h.artifact);
    },
    (f, h) => {
      f.backend[0].coverage.rows = false;
      f.save("head-backend.json", f.backend);
    },
    (f, h) => {
      h.artifact.hardware.cores = 2;
      f.save("head.json", h.artifact);
    },
  ]) {
    const f = fixture();
    assert.equal(f.derive().status, 0);
    const h = candidate(f);
    change(f, h);
    assert.equal(h.compare().status, 2);
  }
});
test("derive refuses candidate inputs and unknown options rather than consuming head results", () => {
  const f = fixture();
  const run = f.run(
    "derive",
    "--head",
    join(f.dir, "before.json"),
    "--before-plan",
    join(f.dir, "before-plan.json"),
    "--before",
    join(f.dir, "before.json"),
    "--backend",
    join(f.dir, "backend.json"),
    "--release-build",
    "ddddddddd",
    "--release-source",
    "eeeeeeeee",
    "--release-tooling",
    "fffffffff",
    "--out",
    join(f.dir, "derived"),
  );
  assert.equal(run.status, 2);
});

test("before pending transfers censor byte thresholds while finalized journey evidence remains usable", () => {
  const f = fixture();
  Object.assign(f.artifact.samples[0], {
    pendingScriptRequests: 1,
    pendingRscRequests: 1,
    resourcePendingRequests: 3,
    resourceWindowComplete: false,
  });
  f.saveBefore();
  assert.equal(f.derive().status, 0);
  const budget = JSON.parse(
      readFileSync(join(f.dir, "derived/release-budgets.json")),
    ),
    c = budget.cohorts[0];
  assert.equal(c.usableContentMs.beforeP95, 1000);
  assert.equal(c.javascriptBytes.beforeP95, null);
  assert.equal(c.javascriptBytes.ceiling, null);
  assert.equal(c.rscBytes.ceiling, null);
  assert.equal(c.totalBytes.ceiling, null);
  const h = candidate(f);
  Object.assign(h.artifact.samples[0], {
    pendingScriptRequests: 0,
    pendingRscRequests: 0,
    resourcePendingRequests: 0,
    resourceWindowComplete: true,
  });
  f.save("head.json", h.artifact);
  assert.equal(h.compare().status, 1);
  const report = JSON.parse(readFileSync(join(f.dir, "comparison.json")));
  assert.equal(report.cohorts[0].before.pendingScriptRequests, 1);
  assert.equal(report.cohorts[0].before.javascriptBytes, null);
});
test("missing clock readiness cannot become an invented timeout budget", () => {
  const f = fixture();
  f.artifact.samples[0].clockReadyMs = null;
  f.saveBefore();
  assert.equal(f.derive().status, 2);
});
test("unknown native LCP stays unbudgeted and unfulfilled rather than receiving a fabricated latency", () => {
  const f = fixture();
  f.artifact.samples[0].lcpMs = null;
  f.saveBefore();
  assert.equal(f.derive().status, 0);
  const b = JSON.parse(
    readFileSync(join(f.dir, "derived/release-budgets.json")),
  );
  assert.equal(b.cohorts[0].lcpMs.ceiling, null);
  const h = candidate(f);
  assert.equal(h.compare().status, 1);
});
function settledFixture(f, plan, filename) {
  const samples = f.artifact.samples
    .filter((s) => ["first-document", "repeat-link"].includes(s.mode))
    .map((s) => ({
      ...structuredClone(s),
      failed: false,
      censored: false,
      settled: {
        complete: true,
        capped: false,
        mandatoryPending: 0,
        mandatoryErrors: 0,
        bytes: {
          javascript: 10000,
          document: 5000,
          rsc: 2000,
          otherFinite: 1000,
        },
        groups: {
          prefetch: { requests: 1, pending: 1, errors: 0, completedBytes: 0 },
          longLived: { requests: 1, pending: 1, errors: 0, completedBytes: 0 },
        },
      },
      inlineRscDecodedBytes: s.mode === "first-document" ? 2000 : null,
    }));
  const artifact = {
    schema: 1,
    kind: "settled-resource-companion",
    phase: plan.phase,
    planSha256: hash(Buffer.from(JSON.stringify(plan, null, 2) + "\n")),
    policy: settledPolicy,
    protocol: { operator: "fixed-synthetic" },
    runtime: { ...plan.runtime, buildVerified: true },
    hardware: f.artifact.hardware,
    browser: f.artifact.browser,
    samples,
    finalized: true,
    evidenceComplete: true,
    resourceComplete: true,
    nativeSha256: hash(readFileSync(join(f.dir, "backend.json"))),
  };
  f.save(filename, artifact);
  return artifact;
}
test("matched complete companion resolves full-byte gates without relabeling pending primary bytes as passed", () => {
  const f = fixture();
  Object.assign(f.artifact.samples[0], {
    pendingScriptRequests: 1,
    pendingRscRequests: 1,
    resourcePendingRequests: 3,
    resourceWindowComplete: false,
  });
  f.saveBefore();
  settledFixture(f, f.plan, "settled-before.json");
  const args = [
    "--before-settled",
    join(f.dir, "settled-before.json"),
    "--before-settled-backend",
    join(f.dir, "backend.json"),
  ];
  const run = f.run(
    "derive",
    "--before-plan",
    join(f.dir, "before-plan.json"),
    "--before",
    join(f.dir, "before.json"),
    "--backend",
    join(f.dir, "backend.json"),
    "--release-build",
    "ddddddddd",
    "--release-source",
    "eeeeeeeee",
    "--release-tooling",
    "fffffffff",
    "--out",
    join(f.dir, "derived"),
    ...args,
  );
  assert.equal(run.status, 0, run.stderr);
  const h = candidate(f);
  settledFixture(f, h.plan, "settled-head.json");
  const comparison = f.run(
    "compare",
    "--before-plan",
    join(f.dir, "before-plan.json"),
    "--before",
    join(f.dir, "before.json"),
    "--backend",
    join(f.dir, "backend.json"),
    "--plan",
    join(f.dir, "derived/release-plan.json"),
    "--budgets",
    join(f.dir, "derived/release-budgets.json"),
    "--head",
    join(f.dir, "head.json"),
    "--head-backend",
    join(f.dir, "head-backend.json"),
    "--out",
    join(f.dir, "comparison.json"),
    ...args,
    "--head-settled",
    join(f.dir, "settled-head.json"),
    "--head-settled-backend",
    join(f.dir, "head-backend.json"),
  );
  assert.equal(comparison.status, 0, comparison.stderr);
  const report = JSON.parse(readFileSync(join(f.dir, "comparison.json")));
  assert.equal(report.resourceAcceptance, "fulfilled");
  assert.equal(report.cohorts[0].head.pendingScriptRequests, 1);
  assert.equal(report.cohorts[0].budgets.javascriptBytes.passed, null);
  assert.equal(report.settledResources.cohorts.length, 2);
});
test("interrupted ledgers cannot be registered as completed before evidence", () => {
  const f = fixture();
  f.artifact.interrupted = true;
  f.artifact.interruption = { reason: "collector-capacity-exhausted" };
  f.saveBefore();
  assert.equal(f.derive().status, 2);
});
test("legacy, active or unattributed native coverage cannot register numerical budgets", () => {
  for (const change of [
    (e) => {
      delete e.coverage.registration;
    },
    (e) => {
      e.coverage.registration = false;
    },
    (e) => {
      e.coverage.closed = false;
    },
    (e) => {
      e.coverage.unattributedNativeSpans = 1;
    },
    (e) => {
      e.coverage.incomplete = true;
    },
    (e) => {
      e.coverage.rejectedBatches = 1;
    },
  ]) {
    const f = fixture();
    change(f.backend[0]);
    f.saveBefore();
    assert.equal(f.derive().status, 2);
  }
});
test("artifact telemetry identity must match the registered plan protocol", () => {
  const f = fixture();
  f.artifact.runtime.collectorProtocol = "z8-fixture-otlp-collector-v1";
  f.saveBefore();
  assert.equal(f.derive().status, 2);
});
test("registered coverage still requires independent native count proof and zero late spans", () => {
  for (const change of [
    (e) => {
      delete e.coverage.nativeProof;
    },
    (e) => {
      e.coverage.nativeProof = false;
    },
    (e) => {
      e.coverage.lateSpans = 1;
    },
  ]) {
    const f = fixture();
    change(f.backend[0]);
    f.saveBefore();
    assert.equal(f.derive().status, 2);
  }
});
