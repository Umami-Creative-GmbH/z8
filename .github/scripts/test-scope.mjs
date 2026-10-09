const allScopes = { webapp: true, workspace: true, docker: true };
const sharedFiles = new Set([
  "package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml", "turbo.json",
  ".github/workflows/tests.yml",
]);

export function selectTestScopes(files, { full = false } = {}) {
  if (full) return { ...allScopes };
  const scopes = { webapp: false, workspace: false, docker: false };
  for (const file of files) {
    if (file.endsWith(".md")) continue;
    if (sharedFiles.has(file) || ["packages/", "scripts/", ".github/scripts/"].some((prefix) => file.startsWith(prefix))) {
      return { ...allScopes };
    }
    if (file.startsWith("apps/webapp/")) {
      scopes.webapp = true;
      if (file.startsWith("apps/webapp/src/app/api/desktop/")) scopes.workspace = true;
      // Docker runtime manifests trace web-app imports and dependencies.
      scopes.docker = true;
    } else if (file.startsWith("apps/desktop/")) {
      scopes.workspace = true;
    } else if (file.startsWith("docker/")) {
      scopes.docker = true;
    } else {
      // Unknown inputs must not silently bypass coverage.
      return { ...allScopes };
    }
  }
  return scopes;
}

export function checkTestResults(needs) {
  if (needs.changes?.result !== "success") throw new Error("Test scope detection did not succeed");
  const jobs = {
    "unit-tests": "webapp", "integration-tests": "webapp",
    "workspace-tests": "workspace", "docker-tests": "docker",
  };
  const summary = [];
  for (const [job, scope] of Object.entries(jobs)) {
    const selected = needs.changes.outputs[scope];
    if (selected !== "true" && selected !== "false") throw new Error(`Missing test scope: ${scope}`);
    const expected = selected === "true" ? "success" : "skipped";
    const actual = needs[job]?.result;
    if (actual !== expected) throw new Error(`${job}: expected ${expected}, received ${actual}`);
    summary.push(`${job}: ${actual}`);
  }
  return summary;
}
