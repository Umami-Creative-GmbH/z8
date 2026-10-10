// Built-in Node client: maintenance never installs dependencies or executes producer code.
export function createGitHubApi({ repository, token, fetchImpl = fetch }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? "")) throw new Error("Invalid repository");
  if (!token) throw new Error("Missing GitHub token");
  const root = `https://api.github.com/repos/${repository}/`;
  async function request(path, method = "GET") {
    const response = await fetchImpl(root + path, {
      method, headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404 && method === "DELETE") return false;
    if (!response.ok) throw new Error(`GitHub ${method} ${path.split("?")[0]}: HTTP ${response.status}`);
    return method === "DELETE" ? true : response.json();
  }
  async function list(path, field) {
    const rows = [];
    let expected;
    for (let page = 1; page <= 100; page++) {
      const data = await request(`${path}${path.includes("?") ? "&" : "?"}per_page=100&page=${page}`);
      const batch = field ? data[field] : data;
      if (!Array.isArray(batch)) throw new Error("Incomplete GitHub inventory");
      if (field) {
        if (!Number.isInteger(data.total_count) || data.total_count < 0) throw new Error("Missing inventory count");
        expected ??= data.total_count;
        if (expected !== data.total_count) throw new Error("Inventory changed during pagination; retry later");
      }
      if (batch.some(row => !Number.isSafeInteger(row?.id) || row.id < 1)) throw new Error("Missing inventory identity");
      rows.push(...batch);
      if (batch.length < 100) {
        if (expected !== undefined && rows.length !== expected) throw new Error("Truncated GitHub inventory");
        if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Duplicate inventory entries");
        return rows;
      }
    }
    throw new Error("Inventory exceeded pagination bound");
  }
  function identity(value) {
    if (!Number.isSafeInteger(value) || value < 1) throw new Error("Invalid GitHub identity");
    return value;
  }
  return {
    caches: (ref) => list(`actions/caches${ref ? `?ref=${encodeURIComponent(ref)}` : ""}`, "actions_caches"),
    artifacts: () => list("actions/artifacts?name=desktop-windows-unsigned-review-only", "artifacts"),
    openPulls: () => list("pulls?state=open"),
    pull: (number) => request(`pulls/${identity(number)}`),
    run: (id) => request(`actions/runs/${identity(id)}`),
    workflow: (filename) => request(`actions/workflows/${encodeURIComponent(filename)}`),
    activeRuns: async () => {
      const runs = (await Promise.all(["queued", "in_progress", "requested", "waiting", "pending"].map(status => list(`actions/runs?status=${status}`, "workflow_runs")))).flat();
      return [...new Map(runs.map(run => [run.id, run])).values()];
    },
    deleteCache: (id) => request(`actions/caches/${identity(id)}`, "DELETE"),
    deleteArtifact: (id) => request(`actions/artifacts/${identity(id)}`, "DELETE"),
  };
}
