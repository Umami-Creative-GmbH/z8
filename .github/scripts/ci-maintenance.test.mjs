import assert from "node:assert/strict";
import test from "node:test";
import { cachePullNumber, canDeleteCache, maintainCi, REVIEW_ARTIFACT, reviewArtifactPlan } from "./ci-maintenance.mjs";

const now = Date.parse("2026-10-10T12:00:00Z");
const day = 86_400_000;
const date = age => new Date(now - age * day).toISOString();
const pull = (number = 1, state = "open") => ({ number, state, head: { sha: `head-${number}`, ref: `branch-${number}`, repo: { id: 42 } } });
const cache = (id = 1, ref = "refs/pull/1/merge") => ({ id, ref, size_in_bytes: 1024 });
const artifact = (id, age = id, extra = {}) => ({ id, name: REVIEW_ARTIFACT, expired: false, size_in_bytes: 100, created_at: date(age), workflow_run: { id, head_sha: `sha-${id}`, head_repository_id: 42 }, ...extra });
const run = (id, extra = {}) => ({ id, workflow_id: 50, status: "completed", event: "pull_request", created_at: date(id), pull_requests: [], ...extra });
function plan(artifacts, { runs = artifacts.map(item => run(item.workflow_run.id)), openPulls = [], keep = 5 } = {}) {
  return reviewArtifactPlan({ artifacts, runs, openPulls, workflowId: 50, now, keep });
}
const ids = items => items.map(item => item.id).sort((a, b) => a - b);

test("cache cleanup accepts only exact merge refs for closed PRs", () => {
  assert.equal(canDeleteCache(cache(), pull(1, "closed"), []), true);
  for (const ref of ["refs/heads/dev", "refs/tags/v1", "refs/pull/1/head", "refs/pull/01/merge", "refs/pull/2/merge", "refs/pull/1/merge/extra"]) {
    assert.equal(canDeleteCache(cache(1, ref), pull(1, "closed"), []), false, ref);
  }
  assert.equal(cachePullNumber("refs/pull/9007199254740993/merge"), null);
  assert.equal(canDeleteCache(cache(), pull(), []), false);
});
test("every active producer state defers deletion; completed and own runs do not", () => {
  for (const status of ["queued", "in_progress", "requested", "waiting", "pending"]) {
    assert.equal(canDeleteCache(cache(), pull(1, "closed"), [run(9, { status, pull_requests: [{ number: 1 }] })]), false, status);
  }
  assert.equal(canDeleteCache(cache(), pull(1, "closed"), [run(9, { pull_requests: [{ number: 1 }] })]), true);
  assert.equal(canDeleteCache(cache(), pull(1, "closed"), [run(9, { status: "in_progress", pull_requests: [{ number: 1 }] })], 9), true);
});
test("missing PR association falls back to repository identity or conservatively defers", () => {
  const producer = run(9, { status: "queued", head_repository: { id: 42 }, head_branch: "branch-1" });
  assert.equal(canDeleteCache(cache(), pull(1, "closed"), [producer]), false);
  assert.equal(canDeleteCache(cache(), pull(1, "closed"), [{ ...producer, head_repository: { id: 99 } }]), true);
  assert.equal(canDeleteCache(cache(), pull(1, "closed"), [{ ...producer, head_repository: null }]), false);
});
test("keeps newest five regardless of inventory order, excludes signed/foreign/in-progress producers", () => {
  const artifacts = [artifact(8), artifact(1), artifact(7), artifact(2), artifact(6), artifact(3), artifact(5), artifact(4), artifact(9, 0, { name: "desktop-signed-candidate" }), artifact(10), artifact(11)];
  const runs = artifacts.map(item => run(item.id));
  runs.find(item => item.id === 10).workflow_id = 51;
  runs.find(item => item.id === 11).status = "in_progress";
  const result = plan(artifacts, { runs });
  assert.deepEqual(ids(result.protected), [1, 2, 3, 4, 5]);
  assert.deepEqual(ids(result.remove), [6, 7, 8]);
});
test("soft cap protects one extra completed installer per open PR", () => {
  const artifacts = Array.from({ length: 9 }, (_, index) => artifact(index + 1));
  const runs = artifacts.map(item => run(item.id, { pull_requests: item.id >= 6 ? [{ number: item.id === 6 || item.id === 8 ? 1 : 2 }] : [] }));
  const result = plan(artifacts, { runs, openPulls: [pull(1), pull(2)] });
  assert.deepEqual(ids(result.protected), [1, 2, 3, 4, 5, 6, 7]);
  assert.deepEqual(ids(result.remove), [8, 9]);
});
test("a rerun of an older head cannot displace the current-head installer", () => {
  const current = artifact(8, 8, { workflow_run: { id: 8, head_sha: "head-1", head_repository_id: 42 } });
  const old = artifact(9, 1);
  const result = plan([current, old, artifact(1, 0)], {
    keep: 1, openPulls: [pull()], runs: [run(8, { pull_requests: [{ number: 1 }] }), run(9, { created_at: date(9), pull_requests: [{ number: 1 }] }), run(1)],
  });
  assert.deepEqual(ids(result.protected), [1, 8]);
  assert.deepEqual(ids(result.remove), [9]);
});
test("without a current-head build, producer creation wins over old-head rerun upload time", () => {
  const result = plan([artifact(6, 6), artifact(7, 1), artifact(1, 0)], {
    keep: 1, openPulls: [pull()], runs: [run(6, { created_at: date(2), pull_requests: [{ number: 1 }] }), run(7, { created_at: date(7), pull_requests: [{ number: 1 }] }), run(1)],
  });
  assert.deepEqual(ids(result.protected), [1, 6]);
});
test("manual builds receive PR protection only with verified repository/SHA association", () => {
  const manual = artifact(8, 8, { workflow_run: { id: 8, head_sha: "head-1", head_repository_id: 42 } });
  assert.deepEqual(ids(plan([manual, artifact(1)], { keep: 1, openPulls: [pull()], runs: [run(8, { event: "workflow_dispatch" }), run(1)] }).protected), [1, 8]);
  const uncertain = artifact(9, 9);
  assert.deepEqual(ids(plan([uncertain, artifact(1)], { keep: 1, openPulls: [pull()], runs: [run(9, { event: "workflow_dispatch" }), run(1)] }).protected), [1]);
  assert.deepEqual(ids(plan([uncertain, artifact(1)], { keep: 1, runs: [run(9, { event: "workflow_dispatch" }), run(1)] }).remove), [9]);
});
test("14-day age expiry overrides global/per-PR/manual protection, ignores already expired entries", () => {
  const artifacts = [artifact(1, 14), artifact(2, 15), artifact(3, 20, { expired: true })];
  const result = plan(artifacts, { openPulls: [pull()], runs: [run(1, { pull_requests: [{ number: 1 }] }), run(2, { event: "workflow_dispatch" }), run(3)] });
  assert.deepEqual(ids(result.remove), [1, 2]);
  assert.deepEqual(result.protected, []);
});
test("malformed eligible timestamps fail closed", () => {
  assert.throws(() => plan([artifact(1, 1, { created_at: "bad" })]), /timestamp/);
});

function fakeApi({ caches = [], artifacts = [], pulls = [], runs = artifacts.map(item => run(item.workflow_run.id)) } = {}) {
  const deleted = [];
  return {
    deleted,
    caches: async ref => caches.filter(item => !ref || item.ref === ref),
    activeRuns: async () => [],
    pull: async number => pulls.find(item => item.number === number),
    artifacts: async () => artifacts,
    openPulls: async () => pulls.filter(item => item.state === "open"),
    run: async id => runs.find(item => item.id === id),
    workflow: async () => ({ id: 50, path: ".github/workflows/desktop-windows.yml" }),
    deleteCache: async id => { deleted.push(["cache", id]); return true; },
    deleteArtifact: async id => { deleted.push(["artifact", id]); return true; },
  };
}
test("dry run reports both storage candidates without issuing any deletes", async () => {
  const api = fakeApi({ caches: [cache()], pulls: [pull(1, "closed")], artifacts: [artifact(20, 20)] });
  const result = await maintainCi({ api, now });
  assert.deepEqual(api.deleted, []);
  assert.equal(result.cacheCandidates.length, 1);
  assert.equal(result.artifactCandidates.length, 1);
});
test("apply rechecks exact cache IDs and skips reopened PRs or late producers", async () => {
  for (const change of ["reopened", "active", "removed"]) {
    const api = fakeApi({ caches: [cache()], pulls: [pull(1, "closed")] });
    let reads = 0;
    if (change === "reopened") api.pull = async () => pull(1, ++reads > 1 ? "open" : "closed");
    if (change === "active") api.activeRuns = async () => ++reads > 1 ? [run(9, { status: "queued", pull_requests: [{ number: 1 }] })] : [];
    if (change === "removed") api.caches = async ref => ref ? [] : [cache()];
    const result = await maintainCi({ api, now, apply: true });
    assert.deepEqual(api.deleted, [], change);
    assert.equal(result.skipped.length, 1, change);
  }
});
test("artifact recheck protects a candidate newly associated with a reopened PR", async () => {
  const artifacts = Array.from({ length: 6 }, (_, index) => artifact(index + 1));
  const api = fakeApi({ artifacts, runs: artifacts.map(item => run(item.id, { pull_requests: item.id === 6 ? [{ number: 1 }] : [] })) });
  let reads = 0;
  api.openPulls = async () => ++reads === 1 ? [] : [pull()];
  const result = await maintainCi({ api, now, apply: true });
  assert.deepEqual(api.deleted, []);
  assert.equal(result.skipped.length, 1);
});
test("fresh uploads are included in the recheck, never deleted from an older plan", async () => {
  const artifacts = Array.from({ length: 6 }, (_, index) => artifact(index + 1));
  const fresh = artifact(99, 0);
  const api = fakeApi({ artifacts, runs: [...artifacts.map(item => run(item.id)), run(99, { created_at: date(0) })] });
  let reads = 0;
  api.artifacts = async () => ++reads === 1 ? artifacts : [fresh, ...artifacts];
  await maintainCi({ api, now, apply: true });
  assert.deepEqual(api.deleted, [["artifact", 6]]);
});
test("apply records exact IDs and bytes, with immediate visibility of partial success", async () => {
  const api = fakeApi({ caches: [cache()], pulls: [pull(1, "closed")], artifacts: [artifact(20, 20)] });
  const observed = [];
  const result = await maintainCi({ api, now, apply: true, onDelete: entry => observed.push(entry) });
  assert.deepEqual(api.deleted, [["cache", 1], ["artifact", 20]]);
  assert.deepEqual(observed, [{ storage: "cache", id: 1, bytes: 1024 }, { storage: "artifact", id: 20, bytes: 100 }]);
  assert.equal(result.deletedCaches.length, 1);
  api.workflow = async () => { throw new Error("rate limit"); };
  await assert.rejects(maintainCi({ api, now, apply: true, onDelete: entry => observed.push(entry) }), /rate limit/);
  assert.equal(observed.length, 3);
});
test("unexpected producer workflow or incomplete inventory never permits artifact deletion", async () => {
  const api = fakeApi({ artifacts: [artifact(20, 20)] });
  api.workflow = async () => ({ id: 50, path: ".github/workflows/desktop-release.yml" });
  await assert.rejects(maintainCi({ api, now, apply: true }), /Unexpected desktop/);
  api.workflow = async () => ({ id: 50, path: ".github/workflows/desktop-windows.yml" });
  api.artifacts = async () => { throw new Error("Truncated GitHub inventory"); };
  await assert.rejects(maintainCi({ api, now, apply: true }), /Truncated/);
  assert.deepEqual(api.deleted, []);
});
test("deleted fork metadata cannot allow deletion during an ambiguous active producer", () => {
  const closed = pull(1, "closed");
  closed.head.repo = null;
  const producer = run(9, { status: "in_progress", head_repository: { id: 42 }, head_branch: "branch-1" });
  assert.equal(canDeleteCache(cache(), closed, [producer]), false);
});