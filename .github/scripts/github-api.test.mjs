import assert from "node:assert/strict";
import test from "node:test";
import { createGitHubApi } from "./github-api.mjs";
const rows = (start, count) => Array.from({ length: count }, (_, index) => ({ id: start + index }));
function client(handle) {
  const requests = [];
  const api = createGitHubApi({ repository: "owner/repo", token: "test-only-token", fetchImpl: async (url, options) => {
    requests.push({ url: new URL(url), method: options.method });
    assert.equal(options.headers.Authorization, "Bearer test-only-token");
    assert.equal(options.headers["X-GitHub-Api-Version"], "2022-11-28");
    assert.ok(options.signal instanceof AbortSignal);
    const data = await handle(new URL(url), options);
    return { ok: data.status === undefined || data.status < 400, status: data.status ?? 200, json: async () => data.body ?? data };
  } });
  return { api, requests };
}
test("paginates full cache inventories and preserves exact merge-ref scope", async () => {
  const { api, requests } = client(url => ({ total_count: 101, actions_caches: url.searchParams.get("page") === "1" ? rows(1, 100) : rows(101, 1) }));
  assert.equal((await api.caches("refs/pull/12/merge")).length, 101);
  assert.equal(requests.length, 2);
  for (const request of requests) assert.equal(request.url.searchParams.get("ref"), "refs/pull/12/merge");
});
test("rejects truncated, changed, duplicate or malformed inventories", async () => {
  const cases = [
    () => ({ total_count: 2, actions_caches: rows(1, 1) }),
    url => ({ total_count: url.searchParams.get("page") === "1" ? 101 : 102, actions_caches: url.searchParams.get("page") === "1" ? rows(1, 100) : rows(101, 1) }),
    () => ({ total_count: 2, actions_caches: [{ id: 1 }, { id: 1 }] }),
    () => ({ total_count: 1, actions_caches: [{}] }),
    () => ({ actions_caches: [] }),
    () => ({ total_count: 0 }),
  ];
  for (const handle of cases) await assert.rejects(client(handle).api.caches(), /inventory|Inventory/);
});
test("enumerates all five active statuses and deduplicates state transitions", async () => {
  const statuses = [];
  const { api } = client(url => { statuses.push(url.searchParams.get("status")); return { total_count: 1, workflow_runs: [{ id: 1 }] }; });
  assert.deepEqual(await api.activeRuns(), [{ id: 1 }]);
  assert.deepEqual(statuses.sort(), ["in_progress", "pending", "queued", "requested", "waiting"]);
});
test("retention reads only exact named artifact inventory and open PR metadata", async () => {
  const { api, requests } = client(url => url.pathname.endsWith("/pulls") ? [{ id: 2, number: 4 }] : { total_count: 0, artifacts: [] });
  await api.artifacts();
  await api.openPulls();
  assert.equal(requests[0].url.searchParams.get("name"), "desktop-windows-unsigned-review-only");
  assert.equal(requests[1].url.searchParams.get("state"), "open");
});
test("deletes individual IDs, accepts already gone entries and surfaces API errors without tokens", async () => {
  const { api, requests } = client(url => ({ status: url.pathname.endsWith("/7") ? 404 : 204 }));
  assert.equal(await api.deleteCache(5), true);
  assert.equal(await api.deleteArtifact(7), false);
  assert.deepEqual(requests.map(request => [request.method, request.url.pathname]), [["DELETE", "/repos/owner/repo/actions/caches/5"], ["DELETE", "/repos/owner/repo/actions/artifacts/7"]]);
  const failed = client(() => ({ status: 403, body: { token: "test-only-token" } }));
  await assert.rejects(failed.api.caches(), error => error.message.includes("HTTP 403") && !error.message.includes("test-only-token"));
});
test("rejects unsafe identities before they can become delete or read paths", () => {
  const { api, requests } = client(() => ({}));
  for (const id of [0, -1, "../caches", 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    for (const method of ["deleteArtifact", "deleteCache", "run", "pull"]) assert.throws(() => api[method](id), /identity/);
  }
  assert.equal(requests.length, 0);
  assert.throws(() => createGitHubApi({ repository: "owner/repo/extra", token: "test" }), /repository/);
  assert.throws(() => createGitHubApi({ repository: "owner/repo" }), /token/);
});
test("an API-capped inventory fails closed instead of silently accepting the first thousand", async () => {
  const { api } = client(url => ({ total_count: 1001, actions_caches: Number(url.searchParams.get("page")) <= 10 ? rows((Number(url.searchParams.get("page")) - 1) * 100 + 1, 100) : [] }));
  await assert.rejects(api.caches(), /Truncated/);
});