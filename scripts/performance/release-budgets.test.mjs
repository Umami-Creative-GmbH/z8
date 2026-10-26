import { createProxyWireObserver } from "./proxy-wire-observer.mjs";
import { createActionResultObserver } from "./action-result-observer.mjs";
import { testBrowserEvidence, testBrowserMetadata, testBrowserBinding } from "./control-cancellation-test-fixtures.mjs";
import { nextStreamCompletionPatch } from "./next-stream-completion-patch.mjs";
import {
  primaryProtocolIdentity,
  companionProtocolIdentity,
} from "./protocol-fingerprints.mjs";
const primaryProtocol = await primaryProtocolIdentity();
const companionProtocol = await companionProtocolIdentity();
import {
  companionPolicy as settledPolicy,
  companionWireContract,
} from "./settled-resources.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
function registerEmptyScopes(sample, field) {
  sample.browserControlEvidence = testBrowserEvidence(sample.traceId);
  sample.prerequisiteTraceId = `${sample.traceId}-prerequisite`;
  sample.backgroundTraceId = `${sample.traceId}-background`;
  const zero = { queries: 0, acquisitions: 0, cache: 0 };
  sample[field] = { registered: true, closed: true, nativeCloseProof: [sample.prerequisiteTraceId, sample.backgroundTraceId].map((traceId) => ({ traceId, ...zero, started: zero, ended: zero, driverQueries: 0, driverComplete: true, complete: true, drained: true })) };
}
function cleanupFixture() {
  const wire = createProxyWireObserver();
  wire.begin(0);
  wire.ready(0);
  return {
    ...wire.state(1000),
    policy: "post-snapshot-finite-prefetch-quiet-v1",
    scope: "post-snapshot-context-cleanup",
    usableContentClaim: false,
    quietMs: 1000,
    capMs: 10000,
    elapsedMs: 1000,
    prefetchQuietObservedMs: 1000,
  };
}
function prerequisiteFixture(mode) {
  const phases =
    mode === "first-document"
      ? []
      : [
          "primed-target",
          ...(["repeat-link", "return-visit"].includes(mode)
            ? ["away-navigation"]
            : []),
        ];
  return phases.map((phase) => ({
    ...cleanupFixture(),
    phase,
    policy: "settled-prerequisite-transfers-v1",
    scope: "unmeasured-prerequisite-transfers",
    measurementStarted: false,
    capMs: 90000,
  }));
}
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
    timeoutMs: 90000,
    fixture: { kind: "disposable", journeysVerified: true },
    runtime: {
      mode: "production",
      collectorProtocol: "z8-fixture-otlp-collector-v2",
      traceTransport: "context-loopback-proxy-v1",
      browserPolicy: "isolated-profile-no-prediction-v1",
      nativeCleanupPolicy: "post-snapshot-finite-prefetch-quiet-v1",
      prerequisiteQuiescencePolicy: "settled-prerequisite-transfers-v1",
      operatorReloadQuiescencePolicy: "operator-reload-transfer-quiescence-v1",
      nextStreamCompletionPatch: structuredClone(nextStreamCompletionPatch),
      browserPermissions: "notifications-denied-for-fixture-origin",
      build: "a".repeat(40),
      browserControl: testBrowserMetadata(),
      sourceBuild: "bbbbbbbbb",
      toolingBuild: "ccccccccc",
      poolMax: 10,
      poolAcquisitionTimeoutMs: 60000,
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
      nativeCleanup: cleanupFixture(),
      prerequisiteQuiescence: prerequisiteFixture(mode),
      operatorReloadQuiescence: [],
      traceTransport: {
        kind: "context-loopback-proxy-v1",
        requests: 4,
        rewrittenRequests: 4,
        refusedRequests: 0,
        upstreamFailures: 0,
        responseBodyBytes: 12000,
      },
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
      nativePerformanceObservation: {
        readCompleted: true,
        lcpEntries: mode === "first-document" ? 1 : 0,
        eventEntries: 0,
      },
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
  for (const s of samples) {
    registerEmptyScopes(s, "collector");
    s.traceTransport = initializedTransport(s.traceTransport);
    s.browserInitialization = s.traceTransport.browserInitialization;
  }
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
    protocol: primaryProtocol,
    phase: "baseline",
    kind: "benchmark",
    nativeRunCoverage: {
      driverQueryCount: 275,
      nativeQueryStartedCount: 275,
      nativeQueryEndedCount: 275,
      observedQueryCount: 275,
      pendingNativeQueries: 0,
      activeTraces: 0,
      allReceivedTracesReconciled: true,
      complete: true,
    },
    planSha256: "",
    runtime: { ...plan.runtime, browserControl: testBrowserBinding(plan.runtime.build), buildVerified: true },
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
  save("release-manifest.json", { config: { deploymentId: "d".repeat(40), experimental: { cachedNavigations: true } } });
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
      "d".repeat(40),
      "--release-app-manifest",
      join(dir, "release-manifest.json"),
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
  assert.equal(budget.policy.version, 9);
  assert.deepEqual(budget.policy.latency, { multiplier: 1.25, allowance: 250, floor: 500 });
  assert.deepEqual(budget.policy.bytes, { multiplier: 1.1, allowance: 16384, floor: 16384 });
  assert.deepEqual(budget.policy.resources, {
    multiplier: 1.25,
    floors: { queryCount: 10, queryDurationMs: 100, rowsRetrieved: 100, poolWaitMs: 25, cacheMisses: 5, eventLoopDelayMs: 10 },
  });
  assert.equal(JSON.parse(readFileSync(join(f.dir, "derived/release-plan.json"))).timeoutMs, 30000);
  assert.equal(budget.cohorts[0].usableContentMs.beforeP95, 1000);
  assert.equal(budget.cohorts[0].usableContentMs.ceiling, 1250);
  assert.equal(budget.conditions.small.queryCount, 15);
  assert.match(
    budget.sourceFingerprints["browser-performance.mjs"],
    /^[a-f0-9]{64}$/,
  );
  assert.equal(
    JSON.parse(readFileSync(join(f.dir, "derived/release-plan.json"))).phase,
    "release",
  );
  assert.equal(readFileSync(join(f.dir, "before-plan.json"), "utf8"), old);
});

test("before derivation rejects positive or unknown raw browser failures", () => {
  const f = fixture();
  for (const failedRequests of [1, undefined, null, "0", 0.5]) {
    f.artifact.samples[0].failedRequests = failedRequests;
    f.saveBefore();
    const derived = f.derive();
    assert.equal(derived.status, 2, derived.stdout + derived.stderr);
    assert.match(derived.stderr, /complete browser request proofs/i);
  }
  f.artifact.samples[0].failedRequests = 0;
  f.saveBefore();
  assert.equal(f.derive().status, 0);
});

test("common Next stream patch is mandatory and matched for derivation and head comparison", () => {
  for (const change of [
    (p, a) => {
      delete p.runtime.nextStreamCompletionPatch;
      delete a.runtime.nextStreamCompletionPatch;
    },
    (_p, a) => delete a.runtime.nextStreamCompletionPatch,
    (p, a) => {
      p.runtime.nextStreamCompletionPatch.lockSha256 = "0".repeat(64);
      a.runtime.nextStreamCompletionPatch = structuredClone(
        p.runtime.nextStreamCompletionPatch,
      );
    },
    (_p, a) => (a.runtime.nextStreamCompletionPatch.cjsSha256 = "0".repeat(64)),
  ]) {
    const f = fixture();
    change(f.plan, f.artifact);
    f.saveBefore();
    assert.equal(
      f.derive().status,
      2,
      "Missing, changed or mismatched common runtime must reject before evidence.",
    );
  }
  const f = fixture();
  assert.equal(f.derive().status, 0);
  const h = candidate(f);
  assert.deepEqual(
    h.plan.runtime.nextStreamCompletionPatch,
    nextStreamCompletionPatch,
  );
  delete h.artifact.runtime.nextStreamCompletionPatch;
  f.save("head.json", h.artifact);
  assert.equal(
    h.compare().status,
    2,
    "HEAD cannot omit the registered common runtime.",
  );
  h.artifact.runtime.nextStreamCompletionPatch = {
    ...nextStreamCompletionPatch,
    esmSha256: "0".repeat(64),
  };
  f.save("head.json", h.artifact);
  assert.equal(
    h.compare().status,
    2,
    "HEAD cannot change a registered patch hash.",
  );
});

test("a clean longer original observation cannot relax the optimized thirty-second ceiling", () => {
  const f = fixture();
  for (const s of f.artifact.samples) s.usableContentMs = 40000;
  f.saveBefore();
  const run = f.derive();
  assert.equal(run.status, 0, run.stderr);
  const budget = JSON.parse(readFileSync(join(f.dir, "derived/release-budgets.json")));
  assert.equal(budget.cohorts[0].usableContentMs.beforeP95, 40000);
  assert.equal(budget.cohorts[0].usableContentMs.ceiling, 30000);
  assert.equal(JSON.parse(readFileSync(join(f.dir, "derived/release-plan.json"))).timeoutMs, 30000);
});

test("unfinalized, missing or capped native cleanup cannot register a numerical budget", () => {
  for (const change of [
    (s) => delete s.nativeCleanup,
    (s) => (s.nativeCleanup.complete = false),
    (s) => (s.nativeCleanup.capped = true),
    (s) => (s.nativeCleanup.mandatoryErrors = 1),
    (s) => delete s.nativeCleanup.prefetchQuietObservedMs,
  ]) {
    const f = fixture();
    change(f.artifact.samples[0]);
    f.saveBefore();
    assert.equal(f.derive().status, 2);
  }
});

test("successful UI cannot register budgets with failed prerequisite or cleanup backend work", () => {
  for (const scope of ["prerequisiteTraceId", "backgroundTraceId"])
    for (const field of ["observedQueryErrors", "observedPoolAcquisitionErrors"]) {
      const f = fixture();
      f.backend.push({
        traceId: f.artifact.samples[0][scope],
        coverage: { registration: true, closed: true, nativeProof: true, incomplete: false },
        observedQueryErrors: 0,
        observedPoolAcquisitionErrors: 0,
        [field]: 1,
      });
      f.saveBefore();
      assert.equal(f.derive().status, 2, `${scope} ${field}`);
    }
});

test("missing warm prerequisite phases and errors cannot register a numerical budget", () => {
  for (const change of [
    (s) => delete s.prerequisiteQuiescence,
    (s) => s.prerequisiteQuiescence.pop(),
    (s) => (s.prerequisiteQuiescence[0].mandatoryErrors = 1),
    (s) => (s.prerequisiteQuiescence[0].capped = true),
  ]) {
    const f = fixture();
    change(f.artifact.samples.find((s) => s.mode === "repeat-link"));
    f.saveBefore();
    assert.equal(f.derive().status, 2);
  }
});

test("unknown operator reload applicability cannot register a numerical budget", () => {
  const f = fixture();
  delete f.artifact.samples[0].operatorReloadQuiescence;
  f.saveBefore();
  assert.equal(f.derive().status, 2);
});
test("native paint budgets require all twenty raw first-document observations even when finite paint values were supplied", () => {
  for (const change of [
    (s) => {
      s.lcpMs = null;
    },
    (s) => {
      s.nativePerformanceObservation.lcpEntries = 0;
    },
    (s) => {
      s.nativePerformanceObservation.readCompleted = false;
    },
    (s) => {
      delete s.nativePerformanceObservation;
    },
    (s) => {
      s.resourceScope = "prerequisite-failure";
    },
  ]) {
    const f = fixture();
    change(f.artifact.samples[0]);
    f.saveBefore();
    const derived = f.derive();
    assert.equal(derived.status, 0, derived.stderr);
    const b = JSON.parse(
      readFileSync(join(f.dir, "derived/release-budgets.json")),
    );
    assert.equal(b.cohorts[0].lcpMs.beforeP95, null);
    assert.equal(b.cohorts[0].lcpMs.ceiling, null);
    const h = candidate(f);
    assert.equal(h.compare().status, 1);
  }
});
test("changed transitive primary observer fingerprints cannot register budgets", () => {
  const f = fixture();
  f.artifact.protocol = {
    ...primaryProtocol,
    "browser-performance.mjs": "0".repeat(64),
  };
  f.saveBefore();
  assert.equal(f.derive().status, 2);
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
test("failed before cohorts cannot register a timeout fallback budget", () => {
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
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /clean|failed|censored/i);
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
  artifact.runtime = { ...plan.runtime, browserControl: { ...plan.runtime.browserControl, compiledBuild: plan.runtime.build, manifestVerified: true, browserVerified: true }, buildVerified: true };
  for (const s of artifact.samples)
    for (const proof of s.prerequisiteQuiescence) proof.capMs = plan.timeoutMs;
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

test("before derivation and independent HEAD comparison accept proven controls without hiding raw counts", () => {
  const f = fixture();
  f.artifact.samples[0].failedRequests = 1;
  f.artifact.samples[0].browserControlEvidence = testBrowserEvidence(f.artifact.samples[0].traceId, true);
  f.saveBefore();
  assert.equal(f.derive().status, 0);
  const h = candidate(f);
  const result = h.compare();
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(h.artifact.samples[0].failedRequests, 1);
  delete h.artifact.samples[0].browserControlEvidence;
  f.save("head.json", h.artifact);
  assert.notEqual(h.compare().status, 0);
});
test("comparison retains numerical regressions and rejects failed or unrestored HEAD evidence", () => {
  for (const [expectedExit, change] of [
    [1, (h) => {
      h.artifact.samples[0].usableContentMs = 5000;
      h.artifact.samples[1].usableContentMs = 5000;
    }],
    [1, (h) => { h.artifact.samples[0].pendingScriptRequests = 1; }],
    [2, (h) => {
      h.artifact.samples[0].failed = true;
      h.artifact.samples[0].elapsedUntilFailureMs = 30000;
    }],
    [1, (h) => { h.artifact.samples[0].javascriptBytes = null; }],
    [2, (h) => { h.artifact.samples[50].restored = false; }],
  ]) {
    const f = fixture();
    assert.equal(f.derive().status, 0);
    const h = candidate(f);
    change(h);
    f.save("head.json", h.artifact);
    const run = h.compare();
    assert.equal(run.status, expectedExit, run.stderr);
    if (expectedExit === 2) assert.match(run.stderr, /clean/i);
    else {
      const report = JSON.parse(readFileSync(join(f.dir, "comparison.json")));
      assert.equal(report.numericalAcceptance, "unfulfilled");
      assert.ok(report.gates.length > 0);
    }
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
    "d".repeat(40),
    "--release-app-manifest",
    join(f.dir, "release-manifest.json"),
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
      readyMs: 1000,
      traceTransport: {
        kind: "context-loopback-proxy-v1",
        requests: 4,
        rewrittenRequests: 4,
        refusedRequests: 0,
        upstreamFailures: 0,
        responseBodyBytes: 12000,
      },
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
  for (const s of samples) {
    for (const proof of s.prerequisiteQuiescence) proof.capMs = plan.timeoutMs;
    s.traceTransport = initializedTransport(s.traceTransport);
    s.browserInitialization = s.traceTransport.browserInitialization;
    s.wireSettled = wireFixture(s);
  }
  const artifact = {
    schema: 1,
    kind: "settled-resource-companion",
    nativeRunCoverage: {
      driverQueryCount: 200,
      nativeQueryStartedCount: 200,
      nativeQueryEndedCount: 200,
      observedQueryCount: 200,
      pendingNativeQueries: 0,
      activeTraces: 0,
      allReceivedTracesReconciled: true,
      complete: true,
    },
    phase: plan.phase,
    planSha256: hash(Buffer.from(JSON.stringify(plan, null, 2) + "\n")),
    policy: settledPolicy,
    protocol: companionProtocol,
    runtime: { ...plan.runtime, buildVerified: true, browserControl: testBrowserBinding(plan.runtime.build, plan.runtime.browserControl) },
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
test("failed original annual traffic cannot derive latency or resource budgets", () => {
  const f = fixture();
  Object.assign(f.plan.runtime, {
    build: "bda468856728844f8172f6832c4deb9ad34a3bb0",
    sourceBuild: "39a08d0bbe77e00ceb5b204b9f9100ab2cfb86be",
  });
  f.plan.conditions[0].employees = 200;
  f.plan.ranges = [{ name: "year" }];
  Object.assign(f.plan.routes[0], {
    name: "analytics",
    result: "work-hours",
    rangeRecipe: "fixture-2025",
  });
  Object.assign(f.artifact.runtime, f.plan.runtime);
  for (const s of f.artifact.samples) {
    s.route = "analytics";
    s.range = "year";
  }
  Object.assign(f.artifact.samples[0], {
    failed: true,
    censored: true,
    usableContentMs: null,
    clockReadyMs: null,
    elapsedUntilFailureMs: 31000,
    failureStage: "verify-expected-content",
    failureKind: "timeout",
  });
  Object.assign(f.backend[0], {
    observedPoolAcquisitionErrors: 69,
    observedPoolAcquisitions: 74,
    observedQueryCount: 5,
  });
  f.saveBefore();
  const derived = f.derive();
  assert.equal(derived.status, 2, derived.stdout + derived.stderr);
  assert.match(derived.stderr, /clean|failed|censored/i);
});
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
    "d".repeat(40),
    "--release-app-manifest",
    join(f.dir, "release-manifest.json"),
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
test("complete per-trace evidence cannot register a budget when whole-run wire reconciliation failed", () => {
  const f = fixture();
  f.artifact.nativeRunCoverage = {
    driverQueryCount: 276,
    nativeQueryStartedCount: 276,
    nativeQueryEndedCount: 276,
    observedQueryCount: 275,
    pendingNativeQueries: 0,
    activeTraces: 0,
    allReceivedTracesReconciled: true,
    complete: false,
  };
  f.saveBefore();
  assert.equal(f.derive().status, 2);
});
test("full byte ceilings use proxy body units while primary CDP budgets keep their separate unit", () => {
  const f = fixture(),
    s = settledFixture(f, f.plan, "settled-before.json");
  for (const sample of s.samples)
    sample.wireSettled = wireFixture(sample, { javascript: 500000 });
  f.save("settled-before.json", s);
  const run = f.run(
    "derive",
    "--before-plan",
    join(f.dir, "before-plan.json"),
    "--before",
    join(f.dir, "before.json"),
    "--backend",
    join(f.dir, "backend.json"),
    "--release-build",
    "d".repeat(40),
    "--release-app-manifest",
    join(f.dir, "release-manifest.json"),
    "--release-source",
    "eeeeeeeee",
    "--release-tooling",
    "fffffffff",
    "--out",
    join(f.dir, "derived"),
    "--before-settled",
    join(f.dir, "settled-before.json"),
    "--before-settled-backend",
    join(f.dir, "backend.json"),
  );
  assert.equal(run.status, 0, run.stderr);
  const budgets = JSON.parse(
      readFileSync(join(f.dir, "derived/release-budgets.json")),
    ),
    plan = JSON.parse(readFileSync(join(f.dir, "derived/release-plan.json")));
  assert.equal(budgets.settled.cohorts[0].metrics.javascript.beforeP95, 500000);
  assert.equal(budgets.settled.byteUnits, companionWireContract.byteUnits);
  assert.equal(plan.conditions[0].budgets.javascriptP95Bytes, 26384);
});

function wireFixture(sample, overrides = {}) {
  const wire = createProxyWireObserver();
  wire.begin(0);
  const mime = {
    javascript: "application/javascript",
    document: "text/html",
    rsc: "text/x-component",
    otherFinite: "application/octet-stream",
  };
  for (const [name, length] of Object.entries({
    ...sample.settled.bytes,
    ...overrides,
  })) {
    const id = wire.request({ traceId: sample.traceId, headers: {} }, 1);
    wire.response(id, { mimeType: mime[name], status: 200 }, 2);
    wire.bytes(id, length, 3);
    wire.end(id, {}, 4);
  }
  wire.ready(10);
  return wire.state(1010);
}
test("main finalizer CDP overage remains diagnostic when censored before bytes have matched complete wire proof", () => {
  const f = fixture(),
    template = structuredClone(f.artifact.samples),
    nativeTemplate = structuredClone(f.backend[0]);
  Object.assign(f.plan, {
    origin: "http://localhost:34123",
    ranges: [{ name: "month" }, { name: "quarter" }, { name: "year" }],
  });
  f.plan.conditions = ["employee", "manager", "admin", "restricted"].map(
    (role, i) => ({
      name: role,
      role,
      organization: i % 2 ? "large" : "small",
      size: i % 2 ? "large" : "small",
      employees: i % 2 ? 200 : 8,
      timezone: "Europe/Berlin",
      locale: "en",
      viewport: { width: 1280, height: 900 },
    }),
  );
  const owners = [
    "employee",
    "employee",
    "manager",
    "manager",
    "restricted",
    "admin",
  ];
  f.plan.routes = [
    "dashboard",
    "time-tracking",
    "employee-directory",
    "employee-detail",
    "reports",
    "analytics",
  ].map((name, i) => ({
    name,
    path: "/en",
    ready: "main",
    clockReady: "button",
    link: "a",
    refresh: "button",
    conditions: [owners[i]],
    ranges: ["month"],
    mutation: {
      steps: [{ click: "button" }],
      ready: "main",
      reset: [{ click: "button" }],
    },
  }));
  f.artifact.samples = f.plan.routes.flatMap((route, r) =>
    template.map((s, i) => ({
      ...structuredClone(s),
      condition: owners[r],
      route: route.name,
      traceId: (r * 55 + i + 1).toString(16).padStart(32, "0"),
      backendTraceId: (r * 55 + i + 1).toString(16).padStart(32, "0"),
      pendingScriptRequests: 1,
      resourcePendingRequests: 1,
      resourceWindowComplete: false,
    })),
  );
  assert.equal(f.artifact.samples.length, 330);
  for (const s of f.artifact.samples) registerEmptyScopes(s, "collector");
  f.artifact.nativeRunCoverage = {
    driverQueryCount: 1650,
    nativeQueryStartedCount: 1650,
    nativeQueryEndedCount: 1650,
    observedQueryCount: 1650,
    pendingNativeQueries: 0,
    activeTraces: 0,
    allReceivedTracesReconciled: true,
    complete: true,
  };
  f.artifact.summaries = f.plan.routes.flatMap((route, r) =>
    Object.entries(f.plan.samplesByMode).map(([mode, count]) => ({
      condition: owners[r],
      route: route.name,
      range: "month",
      mode,
      samples: count,
      failed: 0,
      usableContentMs: { p95: 1000 },
      clockReadyMs: { p95: 100 },
      javascriptBytes: { p95: 10000 },
    })),
  );
  f.backend.splice(
    0,
    f.backend.length,
    ...f.artifact.samples.map((s) => ({
      ...structuredClone(nativeTemplate),
      traceId: s.traceId,
    })),
  );
  f.saveBefore();
  const original = settledFixture(f, f.plan, "settled-before.json");
  for (const s of original.samples)
    s.wireSettled = wireFixture(s, { javascript: 500000 });
  f.save("settled-before.json", original);
  const originalArgs = [
    "--before-plan",
    join(f.dir, "before-plan.json"),
    "--before",
    join(f.dir, "before.json"),
    "--backend",
    join(f.dir, "backend.json"),
    "--before-settled",
    join(f.dir, "settled-before.json"),
    "--before-settled-backend",
    join(f.dir, "backend.json"),
  ];
  const derived = f.run(
    "derive",
    ...originalArgs,
    "--release-build",
    "d".repeat(40),
    "--release-app-manifest",
    join(f.dir, "release-manifest.json"),
    "--release-source",
    "eeeeeeeee",
    "--release-tooling",
    "fffffffff",
    "--out",
    join(f.dir, "derived"),
  );
  assert.equal(derived.status, 0, derived.stderr);
  const h = candidate(f);
  for (const s of h.artifact.samples)
    Object.assign(s, {
      pendingScriptRequests: 0,
      resourcePendingRequests: 0,
      resourceWindowComplete: true,
      javascriptBytes: 100000,
      totalBytes: 102000,
    });
  for (const s of h.artifact.summaries) s.javascriptBytes = { p95: 100000 };
  f.save("head.json", h.artifact);
  const finalized = spawnSync(
    process.execPath,
    [
      "scripts/performance/run-baseline.mjs",
      "--plan",
      join(f.dir, "derived/release-plan.json"),
      "--finalize",
      join(f.dir, "head.json"),
      "--backend",
      join(f.dir, "head-backend.json"),
    ],
    { encoding: "utf8" },
  );
  assert.equal(finalized.status, 1, finalized.stderr);
  const finalizedHead = JSON.parse(readFileSync(join(f.dir, "head.json")));
  assert.equal(finalizedHead.evidenceComplete, true);
  assert.match(
    finalizedHead.releaseGates.join(" "),
    /Exceeded javascriptP95Bytes/,
  );
  const headWire = settledFixture(f, h.plan, "settled-head.json");
  for (const s of headWire.samples)
    s.wireSettled = wireFixture(s, { javascript: 500000 });
  f.save("settled-head.json", headWire);
  const compared = f.run(
    "compare",
    ...originalArgs,
    "--plan",
    join(f.dir, "derived/release-plan.json"),
    "--budgets",
    join(f.dir, "derived/release-budgets.json"),
    "--head",
    join(f.dir, "head.json"),
    "--head-backend",
    join(f.dir, "head-backend.json"),
    "--head-settled",
    join(f.dir, "settled-head.json"),
    "--head-settled-backend",
    join(f.dir, "head-backend.json"),
    "--out",
    join(f.dir, "comparison.json"),
  );
  assert.equal(compared.status, 0, compared.stderr);
  const report = JSON.parse(readFileSync(join(f.dir, "comparison.json"))),
    budget = JSON.parse(
      readFileSync(join(f.dir, "derived/release-budgets.json")),
    );
  assert.equal(report.resourceAcceptance, "fulfilled");
  assert.equal(h.plan.conditions[0].budgets.javascriptP95Bytes, 26384);
  assert.equal(
    budget.primaryResourceBudgetProvenance.employee.javascriptP95Bytes
      .diagnosticOnly,
    true,
  );
  assert.match(
    report.retainedPrimaryGates.join(" "),
    /Exceeded javascriptP95Bytes/,
  );
  assert.equal(report.cohorts[0].budgets.javascriptBytes.passed, null);
  assert.equal(report.cohorts[0].before.javascriptBytes, null);
  assert.equal(report.cohorts[0].head.javascriptBytes.p95, 100000);
});

function initializedTransport(snapshot) {
  const reasons = {
    unexpectedLoopback: 0,
    nonLoopbackHttp: 0,
    loopbackConnect: 0,
    nonLoopbackConnect: 0,
    malformed: 0,
  };
  const after = {
    requests: snapshot.requests,
    rewrittenRequests: snapshot.rewrittenRequests,
    refusedRequests: 0,
    upstreamFailures: 0,
    responseBodyBytes: snapshot.responseBodyBytes,
    refusalReasons: { ...reasons },
  };
  const init = {
    policy: "isolated-profile-no-prediction-v1",
    launch: {
      policy: "isolated-profile-no-prediction-v1",
      headless: true,
      preferences: {
        net: { network_prediction_options: 2 },
        search: { suggest_enabled: false },
        default_search_provider: { enabled: false },
      },
      arguments: ["--disable-features=AutofillServerCommunication"],
      browserVersion: "Chrome/131.0",
    },
    emptyContext: true,
    quietMs: 2000,
    capMs: 10000,
    quietObservedMs: 2000,
    elapsedMs: 2000,
    pending: 0,
    requests: 0,
    rewrittenRequests: 0,
    refusedRequests: 1,
    upstreamFailures: 0,
    responseBodyBytes: 0,
    refusalReasons: { ...reasons, nonLoopbackConnect: 1 },
    complete: true,
    capped: false,
  };
  return {
    ...snapshot,
    applicationEvidence: createActionResultObserver().snapshot(),
    refusedRequests: 1,
    refusalReasons: { ...init.refusalReasons },
    browserInitialization: init,
    afterInitialization: after,
  };
}
