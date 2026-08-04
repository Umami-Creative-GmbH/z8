import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { type Job, Queue, Worker } from "bullmq";

const OPERATION_TIMEOUT_MS = 20_000;
const CLEANUP_TIMEOUT_MS = 10_000;
// The outer guard includes operation, cleanup, launcher overhead, and forced-close settling.
const OUTER_TIMEOUT_MS = 35_000;
const RETRY_DELAY_MS = 100;
const ALLOWED_CONTAINER_NAME = "z8-bullmq-v6-smoke";

interface CompletionWaiter {
	promise: Promise<void>;
	cancel: (reason: Error) => void;
}

function parsePort(value: string): number {
	assert(
		/^\d+$/.test(value),
		"BULLMQ_SMOKE_PORT must be a decimal integer from 1 to 65535",
	);
	const port = Number(value);
	assert(
		Number.isSafeInteger(port) && port >= 1 && port <= 65_535,
		"BULLMQ_SMOKE_PORT must be a decimal integer from 1 to 65535",
	);
	return port;
}

function parseContainerName(value: string | undefined): string | undefined {
	assert(
		value === undefined || value === ALLOWED_CONTAINER_NAME,
		`BULLMQ_SMOKE_CONTAINER must equal ${ALLOWED_CONTAINER_NAME}`,
	);
	return value;
}

function createCompletionWaiter(
	worker: Worker,
	predicate: (job: Job) => boolean,
	timeoutMs: number,
	label: string,
): CompletionWaiter {
	let settled = false;
	let rejectPromise: (reason: Error) => void = () => undefined;
	let timeout: ReturnType<typeof setTimeout>;
	let onCompleted: (job: Job) => void;

	const promise = new Promise<void>((resolve, reject) => {
		rejectPromise = reject;
		onCompleted = (job) => {
			if (!predicate(job)) return;
			settled = true;
			clearTimeout(timeout);
			worker.off("completed", onCompleted);
			resolve();
		};
		worker.on("completed", onCompleted);

		timeout = setTimeout(() => {
			settled = true;
			worker.off("completed", onCompleted);
			reject(new Error(`Timed out waiting for ${label}`));
		}, timeoutMs);
	});

	// Setup can fail before the caller awaits this promise; mark rejections handled immediately.
	void promise.catch(() => undefined);

	return {
		promise,
		cancel(reason) {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			worker.off("completed", onCompleted);
			rejectPromise(reason);
		},
	};
}

function restartContainer(
	containerName: string,
	timeoutMs: number,
): Promise<void> {
	return new Promise((resolve, reject) => {
		execFile(
			"docker",
			["restart", containerName],
			{ timeout: timeoutMs },
			(error) => (error ? reject(error) : resolve()),
		);
	});
}

async function getQueueKeys(
	containerName: string,
	queueName: string,
	timeoutMs: number,
): Promise<string[]> {
	const { stdout } = await new Promise<{ stdout: string }>(
		(resolve, reject) => {
			execFile(
				"docker",
				[
					"exec",
					containerName,
					"valkey-cli",
					"--scan",
					"--pattern",
					`bull:${queueName}:*`,
				],
				{ timeout: timeoutMs },
				(error, commandStdout) =>
					error ? reject(error) : resolve({ stdout: commandStdout }),
			);
		},
	);

	return stdout.trim() ? stdout.trim().split("\n") : [];
}

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function main(): Promise<void> {
	const port = parsePort(process.env.BULLMQ_SMOKE_PORT ?? "6389");
	const containerName = parseContainerName(process.env.BULLMQ_SMOKE_CONTAINER);
	const queueName = `bullmq-v6-smoke-${process.pid}-${randomUUID()}`;
	const startedAt = Date.now();
	const operationDeadlineAt = startedAt + OPERATION_TIMEOUT_MS;
	const outerDeadlineAt = startedAt + OUTER_TIMEOUT_MS;
	const connection = {
		host: "127.0.0.1",
		port,
		connectTimeout: 1_000,
		maxRetriesPerRequest: null,
		retryStrategy: () => (Date.now() < outerDeadlineAt ? RETRY_DELAY_MS : null),
	};
	const queue = new Queue(queueName, { connection });
	const worker = new Worker(queueName, async (job) => job.data, {
		connection,
		runRetryDelay: RETRY_DELAY_MS,
	});
	worker.on("error", () => undefined);
	queue.on("error", () => undefined);

	const timeoutError = new Error(
		`BullMQ v6 scheduler smoke test exceeded its ${OPERATION_TIMEOUT_MS / 1_000}s operation timeout`,
	);
	let rejectDeadline: (reason: Error) => void = () => undefined;
	const deadlinePromise = new Promise<never>((_resolve, reject) => {
		rejectDeadline = reject;
	});
	void deadlinePromise.catch(() => undefined);

	function remainingMs(): number {
		return Math.max(0, operationDeadlineAt - Date.now());
	}

	function forceCloseWorker(): void {
		void worker.close(true).catch(() => undefined);
		void worker.disconnect().catch(() => undefined);
	}

	function forceCloseQueue(): void {
		void queue.close().catch(() => undefined);
		void queue.disconnect().catch(() => undefined);
	}

	function forceDisconnect(): void {
		forceCloseWorker();
		forceCloseQueue();
	}

	const operationTimer = setTimeout(() => {
		rejectDeadline(timeoutError);
	}, OPERATION_TIMEOUT_MS);
	const outerTimer = setTimeout(forceDisconnect, OUTER_TIMEOUT_MS);

	async function beforeDeadline<T>(
		label: string,
		operation: () => Promise<T>,
	): Promise<T> {
		if (remainingMs() === 0) throw timeoutError;
		try {
			return await Promise.race([operation(), deadlinePromise]);
		} catch (error) {
			if (error === timeoutError) throw error;
			throw new Error(`${label} failed`, { cause: error });
		}
	}

	async function waitForQueueConnectivity(): Promise<void> {
		while (remainingMs() > 0) {
			try {
				await beforeDeadline("queue reconnect probe", () =>
					queue.getJobCounts(),
				);
				return;
			} catch (error) {
				if (error === timeoutError || remainingMs() === 0) throw error;
				await beforeDeadline("queue reconnect delay", () =>
					delay(RETRY_DELAY_MS),
				);
			}
		}
		throw timeoutError;
	}

	let activeWaiter: CompletionWaiter | undefined;
	let operationError: unknown;

	try {
		await beforeDeadline("worker readiness", () => worker.waitUntilReady());

		const initialWaiter = createCompletionWaiter(
			worker,
			(job) => job.name === "cron-smoke-job",
			remainingMs(),
			"a scheduled job to complete",
		);
		activeWaiter = initialWaiter;
		try {
			await beforeDeadline("initial scheduler upsert", () =>
				queue.upsertJobScheduler(
					"cron-smoke",
					{ pattern: "*/2 * * * * *" },
					{ name: "cron-smoke-job", data: { smoke: true } },
				),
			);
			await beforeDeadline(
				"scheduled job completion",
				() => initialWaiter.promise,
			);
		} finally {
			initialWaiter.cancel(new Error("Initial scheduler wait cancelled"));
			activeWaiter = undefined;
		}

		const initialSchedulers = await beforeDeadline(
			"initial scheduler inspection",
			() => queue.getJobSchedulers(),
		);
		assert.equal(initialSchedulers.length, 1);
		assert.equal(initialSchedulers[0]?.key, "cron-smoke");
		assert.equal(initialSchedulers[0]?.pattern, "*/2 * * * * *");

		if (containerName) {
			await beforeDeadline("disposable Valkey restart", () =>
				restartContainer(containerName, remainingMs()),
			);
			await waitForQueueConnectivity();

			const postRestartToken = randomUUID();
			const postRestartWaiter = createCompletionWaiter(
				worker,
				(job) =>
					job.name === "post-restart-smoke" &&
					job.data.token === postRestartToken,
				remainingMs(),
				"the existing worker to complete the post-restart job",
			);
			activeWaiter = postRestartWaiter;
			try {
				await beforeDeadline("post-restart job add", () =>
					queue.add("post-restart-smoke", { token: postRestartToken }),
				);
				await beforeDeadline(
					"post-restart job completion",
					() => postRestartWaiter.promise,
				);
			} finally {
				postRestartWaiter.cancel(
					new Error("Post-restart worker wait cancelled"),
				);
				activeWaiter = undefined;
			}
		}

		await beforeDeadline("updated scheduler upsert", () =>
			queue.upsertJobScheduler(
				"cron-smoke",
				{ pattern: "*/3 * * * * *" },
				{ name: "cron-smoke-job", data: { smoke: true } },
			),
		);

		const updatedSchedulers = await beforeDeadline(
			"updated scheduler inspection",
			() => queue.getJobSchedulers(),
		);
		assert.equal(updatedSchedulers.length, 1);
		assert.equal(updatedSchedulers[0]?.key, "cron-smoke");
		assert.equal(updatedSchedulers[0]?.pattern, "*/3 * * * * *");

		assert.equal(
			await beforeDeadline("scheduler removal", () =>
				queue.removeJobScheduler("cron-smoke"),
			),
			true,
		);
		assert.deepEqual(
			await beforeDeadline("scheduler removal inspection", () =>
				queue.getJobSchedulers(),
			),
			[],
		);
	} catch (error) {
		operationError = error;
	} finally {
		activeWaiter?.cancel(
			new Error("Smoke test cleanup cancelled the completion wait"),
		);
	}

	clearTimeout(operationTimer);
	const cleanupDeadlineAt = Math.min(
		Date.now() + CLEANUP_TIMEOUT_MS,
		outerDeadlineAt,
	);
	const cleanupTimeoutError = new Error(
		`BullMQ v6 scheduler smoke cleanup exceeded ${CLEANUP_TIMEOUT_MS / 1_000}s`,
	);
	let rejectCleanupDeadline: (reason: Error) => void = () => undefined;
	const cleanupDeadlinePromise = new Promise<never>((_resolve, reject) => {
		rejectCleanupDeadline = reject;
	});
	void cleanupDeadlinePromise.catch(() => undefined);
	const cleanupTimer = setTimeout(
		() => {
			forceDisconnect();
			rejectCleanupDeadline(cleanupTimeoutError);
		},
		Math.max(1, cleanupDeadlineAt - Date.now()),
	);

	function cleanupRemainingMs(): number {
		return Math.max(0, cleanupDeadlineAt - Date.now());
	}

	async function beforeCleanupDeadline<T>(
		label: string,
		operation: () => Promise<T>,
	): Promise<T> {
		if (cleanupRemainingMs() === 0) throw cleanupTimeoutError;
		try {
			return await Promise.race([operation(), cleanupDeadlinePromise]);
		} catch (error) {
			if (error === cleanupTimeoutError) throw error;
			throw new Error(`${label} failed`, { cause: error });
		}
	}

	async function waitForCleanupConnectivity(): Promise<void> {
		while (cleanupRemainingMs() > 0) {
			try {
				await beforeCleanupDeadline("cleanup queue reconnect probe", () =>
					queue.getJobCounts(),
				);
				return;
			} catch (error) {
				if (error === cleanupTimeoutError || cleanupRemainingMs() === 0) {
					throw error;
				}
				await beforeCleanupDeadline("cleanup queue reconnect delay", () =>
					delay(RETRY_DELAY_MS),
				);
			}
		}
		throw cleanupTimeoutError;
	}

	const cleanupErrors: unknown[] = [];
	try {
		await beforeCleanupDeadline("worker close", () => worker.close(true));
	} catch (error) {
		cleanupErrors.push(error);
		forceCloseWorker();
	}

	try {
		await waitForCleanupConnectivity();
		await beforeCleanupDeadline("queue obliteration", () =>
			queue.obliterate({ force: true }),
		);

		const counts = await beforeCleanupDeadline(
			"empty queue count verification",
			() => queue.getJobCounts(),
		);
		assert(
			Object.values(counts).every((count) => count === 0),
			`Queue still contains jobs after obliteration: ${JSON.stringify(counts)}`,
		);
		assert.deepEqual(
			await beforeCleanupDeadline("empty scheduler verification", () =>
				queue.getJobSchedulers(),
			),
			[],
		);

		if (containerName) {
			assert.deepEqual(
				await beforeCleanupDeadline("empty Redis key verification", () =>
					getQueueKeys(containerName, queueName, cleanupRemainingMs()),
				),
				[],
			);
		}
	} catch (error) {
		cleanupErrors.push(error);
		forceCloseQueue();
	}

	try {
		await beforeCleanupDeadline("queue close", () => queue.close());
	} catch (error) {
		cleanupErrors.push(error);
		forceCloseQueue();
	}

	clearTimeout(cleanupTimer);
	clearTimeout(outerTimer);

	if (operationError || cleanupErrors.length > 0) {
		forceDisconnect();
		throw new AggregateError(
			[...(operationError ? [operationError] : []), ...cleanupErrors],
			"BullMQ v6 scheduler smoke test failed",
		);
	}

	console.log("BullMQ v6 scheduler smoke test passed.");
}

main().catch((error: unknown) => {
	console.error(error);
	process.exitCode = 1;
});
