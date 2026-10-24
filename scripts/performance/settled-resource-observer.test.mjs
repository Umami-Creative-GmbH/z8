import assert from "node:assert/strict";
import test from "node:test";
import {
  createSettledObserver,
  settledPolicy,
} from "./settled-resource-observer.mjs";
test("settling drains mandatory finite traffic and separates explicit prefetch and long-lived traffic", () => {
  const o = createSettledObserver();
  o.begin(0);
  o.request(
    { requestId: "script", type: "Script", request: { headers: {} } },
    0,
  );
  o.request(
    {
      requestId: "prefetch",
      type: "Fetch",
      request: { headers: { RSC: "1", "Next-Router-Prefetch": "1" } },
    },
    0,
  );
  o.request(
    { requestId: "socket", type: "WebSocket", request: { headers: {} } },
    0,
  );
  o.ready(100);
  assert.equal(o.state(1200).complete, false);
  o.finished({ requestId: "script", encodedDataLength: 1000 }, 1500);
  assert.equal(o.state(2499).complete, false);
  const result = o.state(2500);
  assert.equal(result.complete, true);
  assert.equal(result.bytes.javascript, 1000);
  assert.equal(result.groups.prefetch.pending, 1);
  assert.equal(result.groups.longLived.pending, 1);
  assert.equal(settledPolicy.postReadyCapMs, 10000);
});
test("caps, failures, redirects and unknown lengths never become complete zero-byte success", () => {
  const o = createSettledObserver();
  o.begin(0);
  o.request(
    { requestId: "r", type: "Fetch", request: { headers: { RSC: "1" } } },
    1,
  );
  o.ready(10);
  assert.equal(o.state(10010).capped, true);
  assert.equal(o.state(10010).complete, false);
  o.failed({ requestId: "r" }, 20);
  assert.equal(o.state(11000).complete, false);
  const redirected = createSettledObserver();
  redirected.begin(0);
  redirected.request(
    { requestId: "a", type: "Document", request: { headers: {} } },
    1,
  );
  redirected.request(
    {
      requestId: "a",
      type: "Document",
      redirectResponse: { encodedDataLength: 123 },
      request: { headers: {} },
    },
    2,
  );
  redirected.finished({ requestId: "a", encodedDataLength: 100 }, 3);
  redirected.ready(4);
  assert.equal(redirected.state(1004).bytes.document, 223);
});
test("inherited work drains without being charged to measured bytes; event streams stay separate", () => {
  const o = createSettledObserver();
  o.request({ requestId: "old", type: "Script", request: { headers: {} } }, 0);
  o.begin(1);
  o.request(
    { requestId: "stream", type: "Fetch", request: { headers: {} } },
    2,
  );
  o.response(
    {
      requestId: "stream",
      type: "EventSource",
      response: { mimeType: "text/event-stream", status: 200 },
    },
    3,
  );
  o.ready(4);
  o.finished({ requestId: "old", encodedDataLength: 99 }, 5);
  const s = o.state(1005);
  assert.equal(s.complete, true);
  assert.equal(s.bytes.javascript, 0);
  assert.equal(s.groups.javascript.inheritedCompletedBytes, 99);
  assert.equal(s.groups.longLived.pending, 1);
});
test("an inherited redirect chain stays outside measured navigation bytes", () => {
  const o = createSettledObserver();
  o.request(
    { requestId: "old", type: "Document", request: { headers: {} } },
    0,
  );
  o.begin(1);
  o.request(
    {
      requestId: "old",
      type: "Document",
      redirectResponse: { encodedDataLength: 50 },
      request: { headers: {} },
    },
    2,
  );
  o.finished({ requestId: "old", encodedDataLength: 100 }, 3);
  o.ready(4);
  const s = o.state(1004);
  assert.equal(s.bytes.document, 0);
  assert.equal(s.groups.document.inheritedCompletedBytes, 150);
});
test("quiet reached only after the post-ready deadline remains capped", () => {
  const o = createSettledObserver();
  o.begin(0);
  o.request({ requestId: "late", type: "Script", request: { headers: {} } }, 1);
  o.ready(10);
  o.finished({ requestId: "late", encodedDataLength: 100 }, 9600);
  const s = o.state(11000);
  assert.equal(s.complete, false);
  assert.equal(s.capped, true);
});
