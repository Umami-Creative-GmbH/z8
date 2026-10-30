import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import { createFixtureTraceTransport } from "./trace-transport.mjs";
import { awaitPrerequisiteQuiescence } from "./prerequisite-quiescence.mjs";
import { createProxyWireObserver } from "./proxy-wire-observer.mjs";
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

test("primed target and away transitions wait for actual finite and prefetch responses before goto/click/refresh", async () => {
  for (const phase of ["primed-target", "away-navigation"]) {
    const releases = [];
    const backend = createServer((_req, res) => {
      res.writeHead(200);
      res.write("pending");
      releases.push(() => res.end("done"));
    });
    await new Promise((done) => backend.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${backend.address().port}`;
    const transport = await createFixtureTraceTransport({
      origin,
      getTraceId: () => "a".repeat(32),
    });
    const calls = [];
    try {
      transport.wire.begin(performance.now());
      const proxy = new URL(transport.browserContextOptions.proxyServer);
      for (const headers of [{}, { purpose: "prefetch" }]) {
        const req = request(
          {
            hostname: proxy.hostname,
            port: proxy.port,
            path: origin + "/pending",
            headers,
          },
          (res) => {
            res.resume();
            res.on("error", () => {});
          },
        );
        req.on("error", () => {});
        req.end();
        calls.push(req);
      }
      while (releases.length !== 2) await pause(5);
      const sample = {
        prerequisiteQuiescence: [],
        usableContentMs: null,
        lcpMs: null,
        measurementStarted: false,
      };
      let transition = false;
      const operation = (async () => {
        await awaitPrerequisiteQuiescence({
          transport,
          sample,
          phase,
          timeoutMs: 30000,
        });
        transition = true;
        for (const call of calls) call.destroy();
      })();
      await pause(1100);
      assert.equal(
        transition,
        false,
        "Leaving preparation must not abort pending finite/prefetch requests.",
      );
      releases[0]();
      await pause(100);
      assert.equal(transition, false);
      releases[1]();
      await operation;
      assert.equal(transition, true);
      assert.equal(sample.prerequisiteQuiescence[0].complete, true);
      assert.equal(sample.prerequisiteQuiescence[0].phase, phase);
      assert.equal(transport.snapshot().downstreamCancellations, 0);
      assert.equal(sample.usableContentMs, null);
      assert.equal(sample.lcpMs, null);
      assert.equal(sample.measurementStarted, false);
    } finally {
      for (const call of calls) call.destroy();
      await transport.close();
      backend.closeAllConnections();
      await new Promise((done) => backend.close(done));
    }
  }
});

test("prerequisite HTTP errors retain their scope; explicit prefetch errors stay separate", async () => {
  for (const prefetch of [false, true]) {
    const backend = createServer((_req, res) => {
      res.writeHead(500);
      res.end("failed");
    });
    await new Promise((done) => backend.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${backend.address().port}`;
    const transport = await createFixtureTraceTransport({
      origin,
      getTraceId: () => "b".repeat(32),
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
      const sample = { prerequisiteQuiescence: [] };
      const operation = awaitPrerequisiteQuiescence({
        transport,
        sample,
        phase: "primed-target",
        timeoutMs: 30000,
      });
      if (prefetch) await operation;
      else await assert.rejects(operation);
      assert.equal(sample.prerequisiteQuiescence[0].complete, prefetch);
      assert.equal(
        sample.prerequisiteQuiescence[0].mandatoryErrors,
        prefetch ? 0 : 1,
      );
      assert.equal(
        sample.prerequisiteQuiescence[0].groups.prefetch.errors,
        prefetch ? 1 : 0,
      );
    } finally {
      await transport.close();
      backend.closeAllConnections();
      await new Promise((done) => backend.close(done));
    }
  }
});

test("unmeasured prerequisite cap uses plan timeout without changing the ten-second measured wire window", async () => {
  const wire = createProxyWireObserver();
  wire.begin(0);
  let now = 0;
  const id = wire.request({ traceId: "opaque", headers: {} }, 0);
  const sample = { prerequisiteQuiescence: [] };
  await awaitPrerequisiteQuiescence({
    transport: { wire },
    sample,
    phase: "primed-target",
    timeoutMs: 30000,
    clock: {
      now: () => now,
      sleep: async () => {
        now += 1000;
        if (now === 12000) wire.end(id, {}, now);
      },
    },
  });
  const proof = sample.prerequisiteQuiescence[0];
  assert.equal(proof.complete, true);
  assert.equal(proof.capMs, 30000);
  assert.equal(proof.elapsedMs, 13000);
  assert.equal(proof.wireWindowComplete, false);
  assert.equal(proof.wireWindowCapped, true);
  assert.equal(proof.usableContentClaim, false);
});

test("prerequisite caps and unknown metrics fail without permitting transition", async () => {
  for (const unknown of [false, true]) {
    const wire = createProxyWireObserver();
    wire.begin(0);
    let now = 0;
    if (!unknown)
      wire.request({ traceId: "opaque", headers: { purpose: "prefetch" } }, 0);
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
    const sample = { prerequisiteQuiescence: [] };
    await assert.rejects(
      awaitPrerequisiteQuiescence({
        transport,
        sample,
        phase: "away-navigation",
        timeoutMs: 30000,
        clock: {
          now: () => now,
          sleep: async () => {
            now += 1000;
          },
        },
      }),
    );
    assert.equal(sample.prerequisiteQuiescence[0].complete, false);
    assert.equal(sample.prerequisiteQuiescence[0].capped, !unknown);
    assert.equal(sample.prerequisiteQuiescence[0].measurementStarted, false);
  }
});
