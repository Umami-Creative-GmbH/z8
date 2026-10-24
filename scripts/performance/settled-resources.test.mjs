import { createProxyWireObserver } from "./proxy-wire-observer.mjs";
import { companionProtocolIdentity } from "./protocol-fingerprints.mjs";
const companionProtocol = await companionProtocolIdentity();
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
import {
  requireSettledEvidence,
  runCompanionCapture,
  observeFailedJourneyWire,
  companionPolicy as settledPolicy,
  companionWireContract,
} from "./settled-resources.mjs";

test("resource eligibility distinguishes proven failed baseline behavior from missing coverage and failing head behavior", () => {
  const plan = {
    phase: "baseline",
    samples: 20,
    concurrency: 1,
    fixture: { kind: "disposable", journeysVerified: true },
    runtime: {
      mode: "production",
      collectorProtocol: "z8-fixture-otlp-collector-v2",
      traceTransport: "context-loopback-proxy-v1",
      browserPolicy: "isolated-profile-no-prediction-v1",
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
  for (const s of samples) {
    s.traceTransport = initializedTransport(s.traceTransport);
    s.browserInitialization = s.traceTransport.browserInitialization;
    s.wireSettled = wireFixture(s);
  }
  const artifact = {
    protocol: companionProtocol,
    kind: "settled-resource-companion",
    nativeRunCoverage: {
      driverQueryCount: 40,
      nativeQueryStartedCount: 40,
      nativeQueryEndedCount: 40,
      observedQueryCount: 40,
      pendingNativeQueries: 0,
      activeTraces: 0,
      allReceivedTracesReconciled: true,
      complete: true,
    },
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
  // The original annual pool saturation is failed behavior with observable traffic.
  const annualPlan = structuredClone(plan),
    failedBefore = structuredClone(artifact),
    failedNative = structuredClone(native);
  annualPlan.timeoutMs = 30000;
  annualPlan.runtime.poolMax = 10;
  annualPlan.runtime.build = "d5550e35c3bd9adf584e9731ade31d6420abf545";
  annualPlan.runtime.sourceBuild = "39a08d0bbe77e00ceb5b204b9f9100ab2cfb86be";
  Object.assign(failedBefore.runtime, annualPlan.runtime);
  annualPlan.conditions[0].employees = 200;
  annualPlan.ranges = [{ name: "year" }];
  Object.assign(annualPlan.routes[0], {
    name: "analytics",
    result: "work-hours",
    rangeRecipe: "fixture-2025",
  });
  for (const s of failedBefore.samples) {
    s.range = "year";
    s.route = "analytics";
  }
  const failed = failedBefore.samples[0];
  Object.assign(failed, {
    failed: true,
    censored: true,
    failureStage: "verify-expected-content",
    failureKind: "timeout",
    elapsedUntilFailureMs: 31000,
    measurementStarted: true,
    prerequisiteComplete: true,
    targetRangePrepared: true,
    readyMs: null,
    wireFailureDrain: {
      ...structuredClone(failed.wireSettled),
      scope: "post-failed-journey-diagnostic",
      usableContentClaim: false,
    },
    wireSettled: null,
  });
  failedNative[0].observedPoolAcquisitionErrors = 69;
  failedNative[0].observedPoolAcquisitions = 70;
  failedNative[0].observedQueryCount = 1;
  assert.doesNotThrow(() =>
    requireSettledEvidence(annualPlan, failedBefore, failedNative, "hash"),
  );
  assert.equal(failed.readyMs, null);
  assert.equal(failed.failed, true);
  for (const change of [
    (p, a) => {
      p.phase = "release";
      a.phase = "release";
    },
    (_p, a) => (a.samples[0].prerequisiteComplete = false),
    (_p, a) => (a.samples[0].measurementStarted = false),
    (_p, a) => (a.samples[0].targetRangePrepared = false),
    (_p, a) => (a.samples[0].failureStage = "prepare-range"),
    (_p, a) => (a.samples[0].failureKind = "journey-error"),
    (_p, a) => (a.samples[0].wireFailureDrain.capped = true),
    (_p, a) => (a.samples[0].wireFailureDrain.mandatoryErrors = 1),
    (_p, a) => (a.samples[0].wireFailureDrain.bytes.javascript = null),
    (_p, a) =>
      (a.samples[0].secondaryFailures = [{ failureStage: "collector-close" }]),
    (_p, _a, n) => (n[0].observedQueryErrors = 1),
    (_p, _a, n) => (n[0].observedPoolAcquisitionErrors = 0),
    (_p, _a, n) => delete n[0].observedPoolAcquisitionErrors,
    (_p, _a, n) => delete n[0].observedPoolAcquisitions,
    (_p, _a, n) => n[0].observedPoolAcquisitions++,
    (_p, a) => (a.samples[0].wireFailureDrain.postReadyMs = 10001),
    (p) => (p.runtime.poolMax = 20),
    (p, a) => {
      p.runtime.build = "ddddddddd";
      a.runtime.build = p.runtime.build;
    },
    (p, a) => {
      p.runtime.sourceBuild = "eeeeeeeee";
      a.runtime.sourceBuild = p.runtime.sourceBuild;
    },
    (_p, a) => (a.policy.beforeFailure.proofSha256 = "0".repeat(64)),
  ]) {
    const p = structuredClone(annualPlan),
      a = structuredClone(failedBefore),
      n = structuredClone(failedNative);
    change(p, a, n);
    assert.throws(() => requireSettledEvidence(p, a, n, "hash"));
  }
  for (const change of [
    (a) => a.samples.pop(),
    (a) => (a.samples[0].wireSettled.capped = true),
    (a) => (a.samples[0].failed = true),
    (a) => (a.protocol["browser-performance.mjs"] = "0".repeat(64)),
    (a) => delete a.samples[0].failed,
    (a) => delete a.samples[0].readyMs,
    (a) => (a.samples[0].wireSettled.bytes.javascript = null),
    (a) => (a.finalized = false),
    (a) => (a.samples[0].wireSettled = null),
    (a) => (a.nativeRunCoverage.complete = false),
    (a) => delete a.nativeRunCoverage,
    (a) => {
      const t = a.samples[0].traceTransport;
      t.afterInitialization.refusedRequests = 1;
      t.afterInitialization.refusalReasons.nonLoopbackConnect = 1;
      t.refusedRequests = 2;
      t.refusalReasons.nonLoopbackConnect = 2;
    },
    (a) => {
      const t = a.samples[0].traceTransport;
      t.afterInitialization.upstreamFailures = 1;
      t.upstreamFailures = 1;
    },
    (a) => a.samples[0].traceTransport.responseBodyBytes++,
    (a) => {
      a.samples[0].browserInitialization.launch.arguments = [];
    },
    (a) => {
      a.samples[0].browserInitialization.capped = true;
    },
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
        traceTransport: "context-loopback-proxy-v1",
        browserPolicy: "isolated-profile-no-prediction-v1",
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
test("whole-run proof includes browser closure and rejects a late query whose export is entirely lost", async () => {
  const ledger = {
      samples: [
        {
          traceId: "measured",
          prerequisiteTraceId: "prerequisite",
          backgroundTraceId: "background",
        },
      ],
    },
    calls = [];
  const collector = {
    async readCollectorCounters(control) {
      assert.equal(control, "private-control");
      calls.push("before");
      return {
        activeTraces: 0,
        started: { queries: 0 },
        ended: { queries: 0 },
      };
    },
    async reconcileCollectorRun({ control, before, traceIds }) {
      assert.equal(control, "private-control");
      assert.equal(before.started.queries, 0);
      assert.deepEqual(traceIds, ["measured", "prerequisite", "background"]);
      assert.deepEqual(calls, ["before", "open", "capture", "close"]);
      return {
        driverQueryCount: 2,
        nativeQueryStartedCount: 2,
        nativeQueryEndedCount: 2,
        observedQueryCount: 1,
        pendingNativeQueries: 0,
        activeTraces: 0,
        allReceivedTracesReconciled: true,
        complete: false,
      };
    },
  };
  await runCompanionCapture({
    collector,
    control: "private-control",
    artifact: ledger,
    openBrowser: async () => {
      calls.push("open");
      return {
        async close() {
          calls.push("close");
        },
      };
    },
    capture: async () => {
      calls.push("capture");
    },
    checkpoint: async () => {},
  });
  assert.equal(ledger.nativeRunCoverage.complete, false);
  assert.equal(ledger.nativeRunCoverage.driverQueryCount, 2);
  assert.equal(ledger.nativeRunCoverage.observedQueryCount, 1);
  assert.equal(ledger.samples.length, 1);
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
    refusedRequests: 1,
    refusalReasons: { ...init.refusalReasons },
    browserInitialization: init,
    afterInitialization: after,
  };
}
test("failed UI can have a separately complete bounded wire observation without becoming usable", async () => {
  const wire = createProxyWireObserver();
  wire.begin(0);
  const id = wire.request(
    { traceId: "measured", headers: { "sec-fetch-dest": "script" } },
    1,
  );
  wire.bytes(id, 42, 2);
  wire.end(id, {}, 3);
  let now = 31842;
  const result = await observeFailedJourneyWire(wire, {
    now: () => now,
    pause: async () => {
      now += 1000;
    },
  });
  assert.equal(result.scope, "post-failed-journey-diagnostic");
  assert.equal(result.complete, true);
  assert.equal(result.bytes.javascript, 42);
  assert.equal(result.postReadyMs, 1000);
  const pending = createProxyWireObserver();
  pending.begin(0);
  pending.request({ traceId: "pending", headers: {} }, 1);
  now = 31842;
  const capped = await observeFailedJourneyWire(pending, {
    now: () => now,
    pause: async () => {
      now += 1000;
    },
  });
  assert.equal(capped.complete, false);
  assert.equal(capped.capped, true);
  assert.equal(capped.mandatoryPending, 1);
});
