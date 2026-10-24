import { createProxyWireObserver } from "./proxy-wire-observer.mjs";
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
  companionPolicy as settledPolicy,
  companionWireContract,
} from "./settled-resources.mjs";

test("native correlation, sample coverage and censored outcomes cannot finalize a resource budget", () => {
  const plan = {
    phase: "baseline",
    samples: 20,
    concurrency: 1,
    fixture: { kind: "disposable", journeysVerified: true },
    runtime: {
      mode: "production",
      collectorProtocol: "z8-fixture-otlp-collector-v2",
      traceTransport: "context-loopback-proxy-v1",
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
  for (const s of samples) s.wireSettled = wireFixture(s);
  const artifact = {
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
  for (const change of [
    (a) => a.samples.pop(),
    (a) => (a.samples[0].wireSettled.capped = true),
    (a) => (a.samples[0].failed = true),
    (a) => (a.samples[0].wireSettled.bytes.javascript = null),
    (a) => (a.finalized = false),
    (a) => (a.samples[0].wireSettled = null),
    (a) => (a.nativeRunCoverage.complete = false),
    (a) => delete a.nativeRunCoverage,
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
