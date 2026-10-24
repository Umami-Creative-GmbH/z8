import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Worker } from "node:worker_threads";

test("a background worker cannot publish cache-hook counters over the main server sampler", async () => {
	const directory = await mkdtemp(join(tmpdir(), "z8-multi-worker-probe-"));
	let worker;
	try {
		const artifact = join(directory, "app");
		await mkdir(artifact);
		await writeFile(join(artifact, "package.json"), "{}");
		await writeFile(
			join(directory, "multi-private.json"),
			JSON.stringify({
				kind: "disposable-multi-instance-1472",
				prepared: true,
				artifactApp: artifact,
				sourceBuild: "test",
				env: { POSTGRES_DB: "approval_workflow_repository_test_multi_worker" },
			}),
		);
		worker = new Worker(
			"setTimeout(()=>require('node:worker_threads').parentPort.postMessage('finished'),350)",
			{
				eval: true,
				execArgv: [
					"--require",
					fileURLToPath(
						new URL("./multi-instance-preload.cjs", import.meta.url),
					),
				],
				env: {
					...process.env,
					Z8_MULTI_FIXTURE_DIRECTORY: directory,
					Z8_MULTI_FIXTURE_REPLICA: "a",
					POSTGRES_HOST: "127.0.0.1",
					POSTGRES_DB: "approval_workflow_repository_test_multi_worker",
				},
			},
		);
		await new Promise((done, reject) => {
			worker.once("message", done);
			worker.once("error", reject);
		});
		const published = await access(
			join(directory, "replica-a-metrics.json"),
		).then(
			() => true,
			() => false,
		);
		assert.equal(
			published,
			false,
			"Worker threads share a PID but must not overwrite the real main cache handler counters.",
		);
	} finally {
		await worker?.terminate();
		assert.equal(dirname(directory), resolve(tmpdir()));
		await rm(directory, { recursive: true, force: true });
	}
});
