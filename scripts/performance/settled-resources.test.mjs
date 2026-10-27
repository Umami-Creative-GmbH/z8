import { createProxyWireObserver } from "./proxy-wire-observer.mjs";
import { createActionResultObserver } from "./action-result-observer.mjs";
import { nextStreamCompletionPatch } from "./next-stream-completion-patch.mjs";
import { testBrowserMetadata, testBrowserBinding, testBrowserEvidence } from "./control-cancellation-test-fixtures.mjs";
import { companionProtocolIdentity } from "./protocol-fingerprints.mjs";
const companionProtocol = await companionProtocolIdentity();
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
function registerEmptyScopes(sample, field) {
  sample.browserControlEvidence = testBrowserEvidence(sample.traceId);
  sample.prerequisiteTraceId = `${sample.traceId}-prerequisite`;
  sample.backgroundTraceId = `${sample.traceId}-background`;
  const zero = { queries: 0, acquisitions: 0, cache: 0 };
  sample[field] = { registered: true, closed: true, nativeCloseProof: [sample.prerequisiteTraceId, sample.backgroundTraceId].map((traceId) => ({ traceId, ...zero, started: zero, ended: zero, driverQueries: 0, driverComplete: true, complete: true, drained: true })) };
}
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
  companionCaptureConfiguration,
  parseCompanionCommand,
  settledEvidenceGates,
  runCompanionCapture,
  observeFailedJourneyWire,
  companionPolicy as settledPolicy,
  companionWireContract,
  measureFixtureResources,
} from "./settled-resources.mjs";

test("controlled companion rejects missing browser pins before any collector IO", async () => {
  let calls = 0;
  await assert.rejects(measureFixtureResources({}, {}, { runtime: { traceTransport: "context-loopback-proxy-v1" } },
    {}, {}, {}, "first-document", 0, "private-control", { beginCollectorVisit: async () => { calls++; throw Error("not reached"); } }), /browser.*control|control.*browser/i);
  assert.equal(calls, 0);
});

test("companion retains failed native close proof without making an incomplete visit eligible", async () => {
  let registeredIds;
  const proof = [
    {
      traceId: "opaque",
      complete: false,
      driverComplete: true,
      started: { queries: 6 },
      ended: { queries: 6 },
      active: 1,
    },
  ];
  const sample = await measureFixtureResources(
    {},
    {},
    { runtime: {} },
    { name: "fixture" },
    { name: "year" },
    { name: "analytics" },
    "first-document",
    0,
    "private-control",
    {
      async beginCollectorVisit({ traceIds }) {
        registeredIds = traceIds;
        return { protocol: "z8-fixture-otlp-collector-v2", traceIds };
      },
      async endCollectorVisit() {
        return {
          protocol: "z8-fixture-otlp-collector-v2",
          traces: registeredIds.map((traceId) => ({
            traceId,
            coverage: { incomplete: true, nativeProof: false },
          })),
          nativeCloseProof: proof,
          nativeCloseElapsedMs: 10016.5,
        };
      },
    },
  );
  assert.deepEqual(sample.collectorVisit.nativeCloseProof, proof);
  assert.equal(sample.collectorVisit.nativeCloseElapsedMs, 10016.5);
  assert.equal(sample.collectorVisit.coverage.nativeProof, false);
  assert.equal(sample.failed, true);
  assert.equal(sample.measurementStarted, false);
  assert.equal(sample.readyMs, null);
});

test("companion preserves positive close evidence and represents absent evidence as unknown", async () => {
  for (const present of [true, false]) {
    let registeredIds;
    const proof = [
      {
        traceId: "opaque",
        complete: true,
        driverComplete: true,
        started: { queries: 6 },
        ended: { queries: 6 },
        active: 0,
      },
    ];
    const sample = await measureFixtureResources(
      {},
      {},
      { runtime: {} },
      { name: "fixture" },
      { name: "year" },
      { name: "analytics" },
      "first-document",
      0,
      "private-control",
      {
        async beginCollectorVisit({ traceIds }) {
          registeredIds = traceIds;
          return { protocol: "z8-fixture-otlp-collector-v2", traceIds };
        },
        async endCollectorVisit() {
          return {
            protocol: "z8-fixture-otlp-collector-v2",
            traces: registeredIds.map((traceId) => ({
              traceId,
              coverage: { incomplete: false, nativeProof: true },
            })),
            ...(present
              ? { nativeCloseProof: proof, nativeCloseElapsedMs: 703.25 }
              : {}),
          };
        },
      },
    );
    assert.deepEqual(
      sample.collectorVisit.nativeCloseProof,
      present ? proof : null,
    );
    assert.equal(
      sample.collectorVisit.nativeCloseElapsedMs,
      present ? 703.25 : null,
    );
    assert.equal(sample.collectorVisit.coverage.nativeProof, true);
    assert.equal(
      sample.failed,
      true,
      "Positive closure does not erase a prerequisite failure.",
    );
    assert.equal(sample.readyMs, null);
  }
});

test("resource eligibility rejects failed original and HEAD behavior even with complete observed traffic", () => {
  const plan = {
    phase: "baseline",
    timeoutMs: 90000,
    samples: 20,
    concurrency: 1,
    fixture: { kind: "disposable", journeysVerified: true },
    runtime: {
      mode: "production",
      collectorProtocol: "z8-fixture-otlp-collector-v2",
      traceTransport: "context-loopback-proxy-v1",
      browserPolicy: "isolated-profile-no-prediction-v1",
      prerequisiteQuiescencePolicy: "settled-prerequisite-transfers-v1",
      operatorReloadQuiescencePolicy: "operator-reload-transfer-quiescence-v1",
      nextStreamCompletionPatch: structuredClone(nextStreamCompletionPatch),
      browserPermissions: "notifications-denied-for-fixture-origin",
      poolMax: 10,
      poolAcquisitionTimeoutMs: 60000,
      build: "aaaaaaaaa",
      sourceBuild: "bbbbbbbbb",
      toolingBuild: "ccccccccc",
      browserControl: testBrowserMetadata(),
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
      prerequisiteQuiescence: prerequisiteFixture(mode),
      operatorReloadQuiescence: [],
      iteration,
      traceId: `${mode}-${iteration}`,
      failed: false,
      failedRequests: 0,
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
    registerEmptyScopes(s, "collectorVisit");
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
    runtime: { ...plan.runtime, buildVerified: true, browserControl: testBrowserBinding(plan.runtime.build) },
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
  const explicitNormal = { ...artifact, diagnosticOnly: false };
  assert.doesNotThrow(() => requireSettledEvidence(plan, explicitNormal, native, "hash"));
  assert.deepEqual(settledEvidenceGates(plan, explicitNormal, native, "hash"), []);
  for (const diagnosticOnly of [true, "true", 1, null, undefined, {}, []]) {
    const malformed = { ...artifact, diagnosticOnly };
    assert.ok(settledEvidenceGates(plan, malformed, native, "hash").includes("Companion plan, policy or actual build identity differs."));
    assert.throws(() => requireSettledEvidence(plan, malformed, native, "hash"), /diagnostic/i);
  }
  for (const phase of ["baseline", "release"])
    for (const failedRequests of [1, undefined, null, "0", 0.5]) {
      const candidatePlan = { ...plan, phase, timeoutMs: phase === "baseline" ? 90000 : 30000 };
      const candidate = structuredClone(artifact);
      candidate.phase = phase;
      for (const sample of candidate.samples)
        for (const proof of sample.prerequisiteQuiescence)
          proof.capMs = candidatePlan.timeoutMs;
      assert.doesNotThrow(() => requireSettledEvidence(candidatePlan, candidate, native, "hash"));
      candidate.samples[0].failedRequests = failedRequests;
      assert.throws(() => requireSettledEvidence(candidatePlan, candidate, native, "hash"), /complete settled-resource/i);
    }
  // The original annual pool saturation is failed behavior with observable traffic.
  const annualPlan = structuredClone(plan),
    failedBefore = structuredClone(artifact),
    failedNative = structuredClone(native);
  annualPlan.timeoutMs = 90000;
  annualPlan.runtime.poolMax = 10;
  annualPlan.runtime.build = "bda468856728844f8172f6832c4deb9ad34a3bb0";
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
  assert.throws(() =>
    requireSettledEvidence(annualPlan, failedBefore, failedNative, "hash"),
  );
  assert.equal(failed.readyMs, null);
  assert.equal(failed.failed, true);
  for (const change of [
    (a) => delete a.runtime.nextStreamCompletionPatch,
    (a) => (a.runtime.nextStreamCompletionPatch.lockSha256 = "0".repeat(64)),
    (a) => a.samples.pop(),
    (a) => (a.samples[0].wireSettled.capped = true),
    (a) => (a.samples[0].failed = true),
	(a) => { const proof = a.samples[0].traceTransport.applicationEvidence; proof.observed = 1; proof.failures = 1; },
	(a) => delete a.samples[0].traceTransport.applicationEvidence,
    (a) => delete a.samples[0].traceTransport.upstreamSocketPolicy,
    (a) => (a.samples[0].traceTransport.upstreamSocketPolicy.keepAlive = true),
    (a) => (a.samples[0].traceTransport.browserInitialization.upstreamSocketPolicy.maxSockets = 65),
    (a) => (a.samples[0].traceTransport.upstreamSocketPolicy.retries = 1),
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
	for (const scope of ["prerequisiteTraceId", "backgroundTraceId"]) {
		const failedScope = { traceId: samples[0][scope], coverage: { registration: true, closed: true, nativeProof: true, incomplete: false }, observedQueryErrors: 0, observedPoolAcquisitionErrors: 1 };
		assert.throws(() => requireSettledEvidence(plan, artifact, [...native, failedScope], "hash"));
	}
});
test("capture requires registered collector control before any runtime or browser request", () => {
  const dir = mkdtempSync(join(tmpdir(), "z8-settled-control-")),
    path = join(dir, "plan.json");
  writeFileSync(
    path,
    JSON.stringify({
      phase: "baseline",
      timeoutMs: 90000,
      samples: 20,
      concurrency: 1,
      fixture: { kind: "disposable", journeysVerified: true },
      runtime: {
        mode: "production",
        browserControl: testBrowserMetadata(),
        browserPermissions: "notifications-denied-for-fixture-origin",
        collectorProtocol: "z8-fixture-otlp-collector-v2",
        traceTransport: "context-loopback-proxy-v1",
        poolMax: 10,
        poolAcquisitionTimeoutMs: 60000,
        browserPolicy: "isolated-profile-no-prediction-v1",
        prerequisiteQuiescencePolicy: "settled-prerequisite-transfers-v1",
        operatorReloadQuiescencePolicy:
          "operator-reload-transfer-quiescence-v1",
        nextStreamCompletionPatch: structuredClone(nextStreamCompletionPatch),
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
function prerequisiteFixture(mode) {
  const wire = createProxyWireObserver();
  wire.begin(0);
  wire.ready(0);
  return (
    mode === "first-document" ? [] : ["primed-target", "away-navigation"]
  ).map((phase) => ({
    ...wire.state(1000),
    phase,
    policy: "settled-prerequisite-transfers-v1",
    scope: "unmeasured-prerequisite-transfers",
    measurementStarted: false,
    usableContentClaim: false,
    quietMs: 1000,
    capMs: 90000,
    elapsedMs: 1000,
    prefetchQuietObservedMs: 1000,
  }));
}

function initializedTransport(snapshot) {
  const upstreamSocketPolicy = { protocol: "no-idle-upstream-sockets-v1", keepAlive: false, maxSockets: 64, retries: 0 };
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
    upstreamSocketPolicy: { ...upstreamSocketPolicy },
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
    upstreamSocketPolicy,
    applicationEvidence: createActionResultObserver().snapshot(),
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
  const normal = companionCaptureConfiguration(plan);
  const diagnostic = companionCaptureConfiguration(plan, { verifyJourneys: true });
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
  assert.deepEqual(parseCompanionCommand(["capture", "--verify-journeys", "--plan", "plan.json"]), { command: "capture", options: { "--verify-journeys": true, "--plan": "plan.json" } });
  for (const args of [["finalize", "--verify-journeys"], ["capture", "--verify-journeys", "--verify-journeys"], ["capture", "--verify-journeys", "true"], ["capture", "--condition", "small"], ["other", "--verify-journeys"]]) assert.throws(() => parseCompanionCommand(args));
  const plan = planFixture(); plan.samples = 19;
  assert.throws(() => companionCaptureConfiguration(plan, { verifyJourneys: true }), /twenty/);
  plan.samples = 20; plan.samplesByMode = { "repeat-link": 1 };
  assert.throws(() => companionCaptureConfiguration(plan, { verifyJourneys: true }), /twenty/);
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
    assert.throws(() => requireSettledEvidence(plan, artifact, [], "hash"), /diagnostic/i);
    const bytes = JSON.stringify(artifact); writeFileSync(artifactFile, bytes);
    const result = spawnSync(process.execPath, ["scripts/performance/settled-resources.mjs", "finalize", "--plan", planFile, "--artifact", artifactFile, "--backend", backend], { encoding: "utf8" });
    assert.equal(result.status, 2, result.stdout + result.stderr);
    assert.match(result.stderr, /diagnostic/i);
    assert.equal(readFileSync(artifactFile, "utf8"), bytes);
  }
});
