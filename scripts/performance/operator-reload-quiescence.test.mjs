import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import { createFixtureTraceTransport } from "./trace-transport.mjs";
import { performSteps } from "./journey-steps.mjs";
import {
  beforeOperatorReload,
  operatorReloadQuiescenceComplete,
} from "./operator-reload-quiescence.mjs";
import { createProxyWireObserver } from "./proxy-wire-observer.mjs";
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
test("mutation and first reset reload wait for real finite and prefetch transfers without changing fixed snapshots", async () => {
  for (const phase of ["measured-mutation", "unmeasured-restoration"]) {
    const releases = [],
      calls = [];
    const backend = createServer((_req, res) => {
      res.writeHead(200);
      res.write("pending");
      releases.push(() => res.end("done"));
    });
    await new Promise((done) => backend.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${backend.address().port}`,
      transport = await createFixtureTraceTransport({
        origin,
        getTraceId: () => "a".repeat(32),
      });
    try {
      transport.wire.begin(performance.now());
      const proxy = new URL(transport.browserContextOptions.proxyServer);
      for (const headers of [{}, { purpose: "prefetch" }]) {
        const call = request(
          {
            hostname: proxy.hostname,
            port: proxy.port,
            path: origin + "/held",
            headers,
          },
          (res) => {
            res.resume();
            res.on("error", () => {});
          },
        );
        call.on("error", () => {});
        call.end();
        calls.push(call);
      }
      while (releases.length !== 2) await pause(5);
      let reloaded = false;
      const sample = {
        operatorReloadQuiescence: [],
        usableContentMs: phase === "measured-mutation" ? null : 42,
        resourceWindowComplete: false,
        javascriptBytes: 5,
      };
      const fixed = {
        usableContentMs: sample.usableContentMs,
        resourceWindowComplete: false,
        javascriptBytes: 5,
      };
      const page = {
        async reload() {
          reloaded = true;
          for (const call of calls) call.destroy();
        },
      };
      const operation = performSteps(page, [{ reload: true }], {}, 30000, {
        beforeReload: ({ stepIndex }) =>
          beforeOperatorReload({
            transport,
            sample,
            phase,
            stepIndex,
            timeoutMs: 30000,
          }),
      });
      await pause(1100);
      assert.equal(
        reloaded,
        false,
        "The operator must not reload into a pending response.",
      );
      releases[0]();
      await pause(100);
      assert.equal(reloaded, false);
      releases[1]();
      await operation;
      assert.equal(reloaded, true);
      assert.equal(sample.operatorReloadQuiescence[0].complete, true);
      assert.equal(
        sample.operatorReloadQuiescence[0].measurementStarted,
        phase === "measured-mutation",
      );
      assert.deepEqual(
        Object.fromEntries(Object.keys(fixed).map((k) => [k, sample[k]])),
        fixed,
      );
      assert.equal(transport.snapshot().downstreamCancellations, 0);
    } finally {
      for (const call of calls) call.destroy();
      await transport.close();
      backend.closeAllConnections();
      await new Promise((done) => backend.close(done));
    }
  }
});

test("reload hook keeps mandatory HTTP errors failed and optional prefetch errors separate", async () => {
  for (const prefetch of [false, true]) {
    const backend = createServer((_req, res) => {
      res.writeHead(500);
      res.end("failed");
    });
    await new Promise((done) => backend.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${backend.address().port}`,
      transport = await createFixtureTraceTransport({
        origin,
        getTraceId: () => "c".repeat(32),
      });
    try {
      transport.wire.begin(performance.now());
      const proxy = new URL(transport.browserContextOptions.proxyServer);
      await new Promise((done, reject) => {
        const call = request(
          {
            hostname: proxy.hostname,
            port: proxy.port,
            path: origin + "/error",
            headers: prefetch ? { purpose: "prefetch" } : {},
          },
          (res) => {
            res.resume();
            res.on("end", done);
          },
        );
        call.on("error", reject);
        call.end();
      });
      const sample = { operatorReloadQuiescence: [] };
      let reloaded = false;
      const operation = performSteps(
        {
          async reload() {
            reloaded = true;
          },
        },
        [{ reload: true }],
        {},
        30000,
        {
          beforeReload: ({ stepIndex }) =>
            beforeOperatorReload({
              transport,
              sample,
              phase: "unmeasured-restoration",
              stepIndex,
              timeoutMs: 30000,
            }),
        },
      );
      if (prefetch) await operation;
      else await assert.rejects(operation);
      assert.equal(reloaded, prefetch);
      assert.equal(sample.operatorReloadQuiescence[0].complete, prefetch);
      assert.equal(
        sample.operatorReloadQuiescence[0].groups.prefetch.errors,
        prefetch ? 1 : 0,
      );
    } finally {
      await transport.close();
      backend.closeAllConnections();
      await new Promise((done) => backend.close(done));
    }
  }
});

test("cap and unknown reload proof stop before reload, while callers without a hook retain normal behavior", async () => {
  for (const unknown of [false, true]) {
    const wire = createProxyWireObserver();
    wire.begin(0);
    let now = 0;
    if (!unknown) wire.request({ traceId: "opaque", headers: {} }, 0);
    const transport = {
      wire: {
        ready: (at) => wire.ready(at),
        state: (at) => {
          const s = wire.state(at);
          if (unknown) delete s.mandatoryErrors;
          return s;
        },
      },
    };
    const sample = { operatorReloadQuiescence: [] };
    let reloaded = false;
    await assert.rejects(
      performSteps(
        {
          async reload() {
            reloaded = true;
          },
        },
        [{ reload: true }],
        {},
        30000,
        {
          beforeReload: ({ stepIndex }) =>
            beforeOperatorReload({
              transport,
              sample,
              phase: "measured-mutation",
              stepIndex,
              timeoutMs: 30000,
              clock: {
                now: () => now,
                sleep: async () => {
                  now += 1000;
                },
              },
            }),
        },
      ),
    );
    assert.equal(reloaded, false);
    assert.equal(sample.operatorReloadQuiescence[0].complete, false);
    assert.equal(sample.operatorReloadQuiescence[0].capped, !unknown);
  }
  let plainReload = false;
  await performSteps(
    {
      async reload() {
        plainReload = true;
      },
    },
    [{ reload: true }],
    {},
  );
  assert.equal(plainReload, true);
});

test("reload evidence requires all measured and restoration reloads at their original recipe positions", () => {
  const wire = createProxyWireObserver();
  wire.begin(0);
  wire.ready(0);
  const make = (phase, stepIndex) => ({
    ...wire.state(1000),
    policy: "operator-reload-transfer-quiescence-v1",
    scope: "operator-forced-reload",
    phase,
    stepIndex,
    measurementStarted: phase === "measured-mutation",
    usableContentClaim: false,
    quietMs: 1000,
    capMs: 30000,
    elapsedMs: 1000,
    prefetchQuietObservedMs: 1000,
  });
  const plan = {
    timeoutMs: 30000,
    routes: [
      {
        name: "dashboard",
        mutation: {
          steps: [{ reload: true }],
          reset: [{ reload: true }, { key: "Escape" }, { reload: true }],
        },
      },
    ],
  };
  const sample = {
    route: "dashboard",
    mode: "mutation-refresh",
    operatorReloadQuiescence: [
      make("measured-mutation", 0),
      make("unmeasured-restoration", 0),
      make("unmeasured-restoration", 2),
    ],
  };
  assert.equal(operatorReloadQuiescenceComplete(plan, sample), true);
  for (const mutate of [
    (s) => s.operatorReloadQuiescence.pop(),
    (s) => (s.operatorReloadQuiescence[1].measurementStarted = true),
    (s) => (s.operatorReloadQuiescence[0].stepIndex = 1),
    (s) => (s.operatorReloadQuiescence[2].mandatoryErrors = 1),
  ]) {
    const changed = structuredClone(sample);
    mutate(changed);
    assert.equal(operatorReloadQuiescenceComplete(plan, changed), false);
  }
});
