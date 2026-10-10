import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { createGitHubApi } from "./github-api.mjs";

export const REVIEW_ARTIFACT = "desktop-windows-unsigned-review-only";
const maxAgeMs = 14 * 24 * 60 * 60 * 1000;
function outranks(rank, previous) {
  if (!previous) return true;
  const index = rank.findIndex((value, i) => value !== previous[i]);
  return index >= 0 && rank[index] > previous[index];
}
export function cachePullNumber(ref) {
  const match = /^refs\/pull\/([1-9]\d*)\/merge$/.exec(ref ?? "");
  const number = match ? Number(match[1]) : null;
  return Number.isSafeInteger(number) ? number : null;
}
export function hasActiveProducer(pull, runs, ownRunId) {
  return runs.some(run => {
    if (run.id === ownRunId || run.status === "completed") return false;
    if (run.pull_requests?.some(item => item.number === pull.number)) return true;
    if (run.event !== "pull_request") return false;
    // Missing association metadata must not cause deletion while a PR job writes caches.
    if (!run.head_repository?.id || !run.head_branch || !pull.head?.repo?.id || !pull.head?.ref) return true;
    return run.head_repository.id === pull.head?.repo?.id && run.head_branch === pull.head?.ref;
  });
}
export function canDeleteCache(cache, pull, runs, ownRunId) {
  return cachePullNumber(cache.ref) === pull.number && pull.state === "closed" && !hasActiveProducer(pull, runs, ownRunId);
}
export function reviewArtifactPlan({ artifacts, runs, openPulls, workflowId, now, keep = 5 }) {
  if (!Number.isFinite(now) || !Number.isInteger(keep) || keep < 1) throw new Error("Invalid retention policy");
  const byRun = new Map(runs.map(run => [run.id, run]));
  const open = new Map(openPulls.map(pull => [pull.number, pull]));
  const eligible = artifacts.filter(artifact => {
    const run = byRun.get(artifact.workflow_run?.id);
    return artifact.name === REVIEW_ARTIFACT && !artifact.expired && run?.workflow_id === workflowId && run.status === "completed";
  });
  for (const artifact of eligible) {
    if (!Number.isFinite(Date.parse(artifact.created_at))) throw new Error("Invalid artifact timestamp");
  }
  const recent = eligible.filter(artifact => now - Date.parse(artifact.created_at) < maxAgeMs);
  recent.sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at) || b.id - a.id);
  const protectedIds = new Set(recent.slice(0, keep).map(artifact => artifact.id));
  const associated = new Map();
  for (const artifact of recent) {
    const run = byRun.get(artifact.workflow_run.id);
    const numbers = new Set((run.pull_requests ?? []).filter(item => open.has(item.number)).map(item => item.number));
    for (const pull of openPulls) {
      if (artifact.workflow_run.head_sha === pull.head?.sha && artifact.workflow_run.head_repository_id === pull.head?.repo?.id) numbers.add(pull.number);
    }
    for (const number of numbers) {
      const pull = open.get(number);
      const currentHead = artifact.workflow_run.head_sha === pull.head?.sha && artifact.workflow_run.head_repository_id === pull.head?.repo?.id;
      const rank = [Number(currentHead), Date.parse(run.created_at), Date.parse(artifact.created_at), artifact.id];
      if (rank.some(value => !Number.isFinite(value))) throw new Error("Invalid producer timestamp");
      const existing = associated.get(number);
      const newer = outranks(rank, existing?.rank);
      if (newer) associated.set(number, { artifact, rank });
    }
  }
  for (const { artifact } of associated.values()) protectedIds.add(artifact.id);
  return {
    remove: eligible.filter(artifact => !protectedIds.has(artifact.id)),
    protected: recent.filter(artifact => protectedIds.has(artifact.id)),
  };
}
async function artifactSnapshot(api, workflowId, now) {
  const [artifacts, openPulls] = await Promise.all([api.artifacts(), api.openPulls()]);
  const ids = [...new Set(artifacts.map(artifact => artifact.workflow_run?.id))];
  if (ids.some(id => !Number.isSafeInteger(id))) throw new Error("Missing producer identity");
  const runs = [];
  // Bound API concurrency while reading potentially hundreds of historical producers.
  for (let index = 0; index < ids.length; index += 8) runs.push(...await Promise.all(ids.slice(index, index + 8).map(id => api.run(id))));
  return { artifacts, runs, openPulls, workflowId, now };
}
export async function maintainCi({ api, apply = false, now = Date.now(), ownRunId, onDelete = () => {} }) {
  const report = { mode: apply ? "apply" : "dry-run", cacheCandidates: [], artifactCandidates: [], deletedCaches: [], deletedArtifacts: [], skipped: [] };
  const caches = await api.caches();
  const runs = await api.activeRuns();
  const pulls = new Map();
  for (const cache of caches) {
    const number = cachePullNumber(cache.ref);
    if (!number) continue;
    if (!pulls.has(number)) pulls.set(number, await api.pull(number));
    if (!canDeleteCache(cache, pulls.get(number), runs, ownRunId)) continue;
    report.cacheCandidates.push({ id: cache.id, ref: cache.ref, bytes: cache.size_in_bytes });
    if (!apply) continue;
    const [pull, currentRuns, currentCaches] = await Promise.all([api.pull(number), api.activeRuns(), api.caches(cache.ref)]);
    const current = currentCaches.find(item => item.id === cache.id && item.ref === cache.ref);
    if (!current || !canDeleteCache(current, pull, currentRuns, ownRunId)) { report.skipped.push(`cache ${cache.id}: state changed`); continue; }
    if (await api.deleteCache(cache.id)) {
      const deleted = { id: cache.id, bytes: current.size_in_bytes };
      report.deletedCaches.push(deleted);
      onDelete({ storage: "cache", ...deleted });
    }
  }
  const workflow = await api.workflow("desktop-windows.yml");
  if (workflow.path !== ".github/workflows/desktop-windows.yml" || !Number.isSafeInteger(workflow.id)) throw new Error("Unexpected desktop producer workflow");
  const plan = reviewArtifactPlan(await artifactSnapshot(api, workflow.id, now));
  report.artifactCandidates = plan.remove.map(artifact => ({ id: artifact.id, bytes: artifact.size_in_bytes }));
  report.protectedArtifacts = plan.protected.map(artifact => artifact.id);
  for (const artifact of plan.remove) {
    if (!apply) break;
    // Refresh the keep set before every delete to handle uploads, reopened PRs and reruns.
    const currentPlan = reviewArtifactPlan(await artifactSnapshot(api, workflow.id, now));
    const current = currentPlan.remove.find(item => item.id === artifact.id);
    if (!current) { report.skipped.push(`artifact ${artifact.id}: state changed`); continue; }
    if (await api.deleteArtifact(artifact.id)) {
      const deleted = { id: artifact.id, bytes: current.size_in_bytes };
      report.deletedArtifacts.push(deleted);
      onDelete({ storage: "artifact", ...deleted });
    }
  }
  return report;
}
function summary(report) {
  const bytes = items => items.reduce((total, item) => total + item.bytes, 0);
  return `## CI maintenance (${report.mode})\n\n| Storage | Eligible count | Eligible bytes | Deleted count | Deleted bytes |\n| --- | ---: | ---: | ---: | ---: |\n| Caches | ${report.cacheCandidates.length} | ${bytes(report.cacheCandidates)} | ${report.deletedCaches.length} | ${bytes(report.deletedCaches)} |\n| Review installers | ${report.artifactCandidates.length} | ${bytes(report.artifactCandidates)} | ${report.deletedArtifacts.length} | ${bytes(report.deletedArtifacts)} |\n\nProtected artifact IDs: ${report.protectedArtifacts.join(", ") || "none"}\n\nSkipped after recheck: ${report.skipped.length}\n`;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = process.argv.slice(2);
  if (args.some(arg => !["--apply", "--dry-run"].includes(arg)) || args.length > 1) throw new Error("Use --dry-run (default) or --apply");
  const api = createGitHubApi({ repository: process.env.GITHUB_REPOSITORY, token: process.env.GH_TOKEN || process.env.GITHUB_TOKEN });
  const report = await maintainCi({
    api, apply: args.includes("--apply"), ownRunId: Number(process.env.GITHUB_RUN_ID) || undefined,
    // Keep successful deletions observable even if a later API request fails.
    onDelete: entry => console.log(JSON.stringify({ deleted: entry })),
  });
  console.log(JSON.stringify(report, null, 2));
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary(report));
}
