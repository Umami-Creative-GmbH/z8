// pnpm node docs/design/rollout-1692/1745/run-domain-checks.mjs <owned-fixture>
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { spawn, execFileSync } from "node:child_process";
const dir = resolve(process.argv[2]);
const runtime = JSON.parse(await readFile(join(dir, "runtime-private.json")));
const fixture = JSON.parse(await readFile(join(dir, "fixture-private.json")));
const services = JSON.parse(await readFile(join(dir, "services.json")));
if (
	fixture.kind !== "disposable" ||
	runtime.env.POSTGRES_HOST !== "127.0.0.1" ||
	!/^approval_workflow_repository_test_perf_[a-f0-9]{12}$/.test(
		runtime.env.POSTGRES_DB,
	)
)
	throw Error("Disposable fixture required");
for (const c of services.containers)
	if (
		execFileSync(
			"docker",
			["inspect", "--format", '{{ index .Config.Labels "z8.agent-owned" }}', c],
			{ encoding: "utf8", windowsHide: true },
		).trim() !== services.label
	)
		throw Error("Ownership mismatch");
const os =
	/^(PATH|PATHEXT|SYSTEMROOT|WINDIR|COMSPEC|TEMP|TMP|USERPROFILE|APPDATA|LOCALAPPDATA|PNPM_HOME|NUMBER_OF_PROCESSORS|PROCESSOR_ARCHITECTURE)$/i;
const env = {
	...Object.fromEntries(
		Object.entries(process.env).filter(([key]) => os.test(key)),
	),
	...runtime.env,
	APPROVAL_WORKFLOW_REPOSITORY_TEST_SENTINEL:
		"approval-workflow-repository-test",
	APPROVAL_WORKFLOW_REPOSITORY_TEST_DATABASE_URL: `postgresql://${runtime.env.POSTGRES_USER}:${runtime.env.POSTGRES_PASSWORD}@127.0.0.1:${runtime.env.POSTGRES_PORT}/${runtime.env.POSTGRES_DB}`,
	TZ: "UTC",
	CI: "true",
};
const app = resolve("apps/webapp");
const child = spawn(
	process.execPath,
	[
		join(app, "node_modules/vitest/vitest.mjs"),
		"run",
		"--project",
		"integration",
		"--maxWorkers",
		"2",
		"src/lib/time-tracking/clocking/clock-in.integration.test.ts",
		"src/lib/time-tracking/clocking/clock-out.integration.test.ts",
		"src/lib/time-tracking/clocking/frozen.integration.test.ts",
		"--reporter=json",
		"--outputFile=" + join(dir, "1745-domain-results-private.json"),
	],
	{ cwd: app, env, windowsHide: true, stdio: "inherit" },
);
child.once("exit", (code) => (process.exitCode = code ?? 1));
