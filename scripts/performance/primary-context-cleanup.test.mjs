import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { createRequire } from "node:module";
import test from "node:test";
import { FixtureNativeCoverage } from "../../apps/webapp/src/lib/performance-fixture-native-coverage.ts";
import { createFixtureTraceTransport } from "./trace-transport.mjs";
import {
  closePrimaryContext,
  waitForPrimaryContextDrain,
} from "./primary-context-cleanup.mjs";
import { createProxyWireObserver } from "./proxy-wire-observer.mjs";
const require = createRequire(
  new URL("../../apps/webapp/package.json", import.meta.url),
);
const { BasicTracerProvider } = require("@opentelemetry/sdk-trace-base");
const { SpanKind, ROOT_CONTEXT, trace } = require("@opentelemetry/api");
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

test("primary closes after pending HTTP finishes and a real SDK SERVER span ends, preserving fixed snapshots", async () => {
  const id = "d".repeat(32),
    coverage = new FixtureNativeCoverage();
  coverage.register([id]);
  coverage.enableDriverCounter();
  const provider = new BasicTracerProvider({
    spanProcessors: [
      {
        onStart: (span) => coverage.onStart(span),
        onEnd: (span) => coverage.onEnd(span),
        forceFlush: async () => {},
        shutdown: async () => {},
      },
    ],
  });
  const tracer = provider.getTracer("@opentelemetry/instrumentation-http");
  let release,
    finished = false;
  const backend = createServer((_req, res) => {
    const span = tracer.startSpan(
      "fixed-http-fixture",
      { kind: SpanKind.SERVER },
      trace.setSpanContext(ROOT_CONTEXT, {
        traceId: id,
        spanId: "1".repeat(16),
        traceFlags: 1,
      }),
    );
    res.on("finish", () => {
      span.end();
      finished = true;
    });
    res.writeHead(200, { "content-type": "application/javascript" });
    res.write("early");
    release = () => res.end("late");
  });
  await new Promise((done) => backend.listen(0, "127.0.0.1", done));
  const origin = `http://127.0.0.1:${backend.address().port}`;
  const transport = await createFixtureTraceTransport({
    origin,
    getTraceId: () => id,
  });
  try {
    transport.wire.begin(performance.now());
    const proxy = new URL(transport.browserContextOptions.proxyServer);
    const response = new Promise((done, reject) => {
      const call = request(
        {
          hostname: proxy.hostname,
          port: proxy.port,
          path: origin + "/finite",
        },
        (answer) => {
          answer.resume();
          answer.on("end", done);
          answer.on("error", reject);
        },
      );
      call.on("error", reject);
      call.end();
    });
    response.catch(() => {});
    while (!release) await pause(5);
    const sample = {
      usableContentMs: 42,
      lcpMs: 30,
      clockReadyMs: 40,
      javascriptBytes: 5,
      totalBytes: 5,
      resourceWindowComplete: false,
      resourcePendingRequests: 1,
      pendingScriptRequests: 1,
    };
    const fixed = structuredClone(sample);
    let closed = false;
    const closing = closePrimaryContext({
      context: {
        async close() {
          closed = true;
        },
      },
      transport,
      sample,
    });
    await pause(1100);
    assert.equal(
      closed,
      false,
      "Readiness must not close an unfinished finite response.",
    );
    assert.equal(finished, false);
    release();
    await response;
    await closing;
    assert.equal(closed, true);
    assert.equal(finished, true);
    assert.deepEqual(
      Object.fromEntries(Object.keys(fixed).map((k) => [k, sample[k]])),
      fixed,
    );
    assert.equal(sample.nativeCleanup.complete, true);
    assert.equal(sample.nativeCleanup.groups.javascript.completedBytes, 9);
    assert.equal(coverage.close([id])[0].complete, true);
  } finally {
    await transport.close();
    backend.closeAllConnections();
    await new Promise((done) => backend.close(done));
    await provider.shutdown();
  }
});

test("cleanup drains remaining real HTTP before failing a mandatory error; explicit prefetch errors stay separate", async () => {
  for (const prefetch of [false, true]) {
    let release;
    const backend = createServer((req, res) => {
      if (req.url === "/error") {
        res.writeHead(500);
        res.end("failed");
      } else {
        res.writeHead(200);
        res.write("pending");
        release = () => res.end("done");
      }
    });
    await new Promise((done) => backend.listen(0, "127.0.0.1", done));
    const origin = `http://127.0.0.1:${backend.address().port}`;
    const transport = await createFixtureTraceTransport({
      origin,
      getTraceId: () => "c".repeat(32),
    });
    try {
      transport.wire.begin(performance.now());
      const proxy = new URL(transport.browserContextOptions.proxyServer);
      const call = (path, headers = {}) =>
        new Promise((done, reject) => {
          const req = request(
            {
              hostname: proxy.hostname,
              port: proxy.port,
              path: origin + path,
              headers,
            },
            (res) => {
              res.resume();
              res.on("end", done);
              res.on("error", reject);
            },
          );
          req.on("error", reject);
          req.end();
        });
      await call("/error", prefetch ? { purpose: "prefetch" } : {});
      const pending = call("/pending");
      pending.catch(() => {});
      while (!release) await pause(5);
      const sample = { failed: false },
        context = {
          closed: false,
          async close() {
            this.closed = true;
          },
        };
      const closing = closePrimaryContext({ context, transport, sample });
      await pause(1100);
      assert.equal(
        context.closed,
        false,
        "Even recorded errors cannot skip the pending-response drain.",
      );
      release();
      await pending;
      await closing;
      assert.equal(context.closed, true);
      assert.equal(sample.nativeCleanup.complete, prefetch);
      assert.equal(sample.failed, !prefetch);
      assert.equal(sample.nativeCleanup.mandatoryPending, 0);
      assert.equal(
        sample.nativeCleanup.groups.prefetch.errors,
        prefetch ? 1 : 0,
      );
      assert.equal(sample.nativeCleanup.mandatoryErrors, prefetch ? 0 : 1);
    } finally {
      await transport.close();
      backend.closeAllConnections();
      await new Promise((done) => backend.close(done));
    }
  }
});

test(
  "an unfinished actual HTTP prefetch caps cleanup and stays a failed observation",
  { timeout: 15000 },
  async () => {
    let received = false;
    const backend = createServer((_req, res) => {
      received = true;
      res.writeHead(200);
      res.write("pending");
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
      const req = request(
        {
          hostname: proxy.hostname,
          port: proxy.port,
          path: origin + "/pending",
          headers: { "next-router-prefetch": "1" },
        },
        (res) => {
          res.resume();
          res.on("error", () => {});
        },
      );
      req.on("error", () => {});
      req.end();
      while (!received) await pause(5);
      const sample = { failed: false },
        context = {
          closed: false,
          async close() {
            this.closed = true;
          },
        };
      await closePrimaryContext({ context, transport, sample });
      assert.equal(context.closed, true);
      assert.equal(sample.failed, true);
      assert.equal(sample.nativeCleanup.capped, true);
      assert.equal(sample.nativeCleanup.groups.prefetch.pending, 1);
      assert.equal(sample.nativeCleanup.mandatoryPending, 0);
      assert.ok(sample.nativeCleanup.elapsedMs >= 10000);
    } finally {
      await transport.close();
      backend.closeAllConnections();
      await new Promise((done) => backend.close(done));
    }
  },
);

test("unknown wire metadata is rejected rather than becoming zero-work cleanup", async () => {
  for (const missing of ["mandatoryErrors", "observationOverflows", "groups"]) {
    const wire = createProxyWireObserver();
    wire.begin(0);
    let now = 0;
    const transport = {
      wire: {
        ready: (at) => wire.ready(at),
        state: (at) => {
          const state = wire.state(at);
          delete state[missing];
          return state;
        },
      },
    };
    await assert.rejects(
      waitForPrimaryContextDrain(transport, {
        now: () => now,
        sleep: async () => {
          now += 1000;
        },
      }),
      (error) => {
        assert.equal(error.cleanupProof.complete, false);
        return true;
      },
    );
  }
});
