// pnpm node docs/design/rollout-1692/1701/compare-consumers.mjs
// Captures the same fixture twice. It replaces only this ticket's seven consumer files,
// and restores exact bytes in finally. No database writes or app build/cache resets.
import { readFile, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
const base = "6e0efe8a9a065672cac4ddb21351382a9638245d";
const paths = [
	"src/app/[locale]/(app)/absences/page.tsx",
	"src/components/absences/vacation-balance-card.tsx",
	"src/components/absences/absences-view-container.tsx",
	"src/components/absences/absence-year-calendar.tsx",
	"src/components/absences/absence-entries-table.tsx",
	"src/components/absences/absence-entry-actions.tsx",
	"src/lib/navigation/route-metadata.ts",
].map((p) => "apps/webapp/" + p);
const saved = new Map(),
	baseline = new Map();
for (const path of paths) {
	saved.set(path, await readFile(path));
	baseline.set(path, execFileSync("git", ["show", base + ":" + path]));
}
const capture = (mode) =>
	execFileSync(
		process.env.npm_execpath,
		["node", "docs/design/rollout-1692/1701/capture.mjs", process.argv[2], mode],
		{ cwd: resolve("."), windowsHide: true, stdio: "inherit" },
	);
try {
	for (const path of paths) await writeFile(path, baseline.get(path));
	capture("before-final");
} finally {
	for (const path of paths) {
		const current = await readFile(path);
		if (!current.equals(baseline.get(path)))
			throw Error("Concurrent modification detected; preserving " + path);
		await writeFile(path, saved.get(path));
	}
}
capture("after-final");
