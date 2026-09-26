import { mkdtemp, readFile, rm } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Real Chromium, real IndexedDB and the real service worker (#279). The HTTP side is a
// stand-in with the v2 contract's replay rule: the same identity with the same bytes
// replays the stored receipt, different bytes collide. Opt-in via Z8_TEST_CHROME_PATH.
const executablePath = process.env.Z8_TEST_CHROME_PATH;

const context = {
	userId: "user-1",
	organizationId: "org-1",
	employeeId: "5f0c6a52-58a4-4d5c-9b0e-5f7b8c1d2e3f",
	server: "",
};
const OP_IN = "0f8fad5b-d9cb-469f-a165-70867728950e";
const OP_OUT = "1b4e28ba-2fa1-41d2-883f-0016d3cca427";
const OP_OTHER = "6fa459ea-ee8a-4ca4-894e-db77e160355e";

type Mode = "commit" | "commit_then_drop" | "commit_then_hang" | { reject: string; status: number };

describe.skipIf(!executablePath)("browser frozen clock commands", () => {
	let browser: Browser;
	let page: Page;
	let server: Server;
	let origin: string;
	let capabilitiesContext = { ...context };
	let submit = "available";
	let mode: Mode = "commit";
	const modeFor = new Map<string, Mode>();
	let posts: string[] = [];
	let lookups: string[] = [];
	const commits = new Map<string, { body: string; receipt: unknown }>();
	const hanging: ServerResponse[] = [];
	let postArrived: (operationId: string) => void = () => {};

	function json(response: ServerResponse, status: number, body: unknown) {
		response.statusCode = status;
		response.setHeader("Content-Type", "application/json");
		response.end(JSON.stringify(body));
	}

	async function readBody(request: IncomingMessage) {
		const chunks: Buffer[] = [];
		for await (const chunk of request) chunks.push(chunk as Buffer);
		return Buffer.concat(chunks).toString("utf8");
	}

	function receiptFor(command: { operationId: string; kind: string }) {
		return command.kind === "clock_in"
			? {
					kind: "start_live_work",
					result: {
						operationId: command.operationId,
						workPeriodId: `period-${command.operationId}`,
						clockInEntryId: command.operationId,
					},
				}
			: {
					kind: "close_active_work",
					result: { operationId: command.operationId, clockOutEntryId: command.operationId },
				};
	}

	beforeAll(async () => {
		server = createServer(async (request, response) => {
			const pathname = new URL(request.url!, "http://localhost").pathname;
			if (
				[
					"/sw.js",
					"/lib/offline-queue-db.js",
					"/lib/sync-service.js",
					"/lib/clock-command-dispatch.js",
				].includes(pathname)
			) {
				response.setHeader("Content-Type", "application/javascript");
				response.end(await readFile(resolve("public", `.${pathname}`)));
			} else if (pathname === "/api/time-entries/offline-context") {
				json(response, 200, {
					userId: capabilitiesContext.userId,
					organizationId: capabilitiesContext.organizationId,
				});
			} else if (pathname === "/api/time-entries/commands" && request.method === "GET") {
				json(response, 200, {
					commandVersions: [2],
					kinds: ["clock_in", "clock_out"],
					submit,
					lookup: "available",
					context: capabilitiesContext,
				});
			} else if (pathname === "/api/time-entries/commands" && request.method === "POST") {
				const body = await readBody(request);
				posts.push(body);
				const command = JSON.parse(body);
				postArrived(command.operationId);
				const committed = commits.get(command.operationId);
				if (committed) {
					if (committed.body !== body) {
						json(response, 409, {
							outcome: "rejected",
							operationId: command.operationId,
							code: "collision",
						});
					} else {
						json(response, 200, {
							outcome: "replayed",
							operationId: command.operationId,
							receipt: committed.receipt,
						});
					}
					return;
				}
				const current = modeFor.get(command.operationId) ?? mode;
				if (typeof current === "object") {
					json(response, current.status, {
						outcome: "rejected",
						operationId: command.operationId,
						code: current.reject,
					});
					return;
				}
				const receipt = receiptFor(command);
				commits.set(command.operationId, { body, receipt });
				if (current === "commit_then_drop") {
					// Cut the response after its first bytes. Chromium transparently resends a
					// POST whose reused connection resets before any response byte arrives.
					response.socket?.write(
						'HTTP/1.1 201 Created\r\nContent-Type: application/json\r\nContent-Length: 500\r\n\r\n{"outcome"',
					);
					response.socket?.destroy();
				} else if (current === "commit_then_hang") hanging.push(response);
				else
					json(response, 201, { outcome: "executed", operationId: command.operationId, receipt });
			} else if (pathname.startsWith("/api/time-entries/commands/")) {
				const operationId = pathname.split("/").pop()!;
				lookups.push(operationId);
				const committed = commits.get(operationId);
				json(
					response,
					200,
					committed
						? {
								outcome: "committed",
								operationId,
								receipt: committed.receipt,
								command: JSON.parse(committed.body),
								evidence: "standing",
							}
						: { outcome: "not_committed", operationId },
				);
			} else {
				response.setHeader("Content-Type", "text/html");
				response.end("<!doctype html><title>Clock command test</title>");
			}
		});
		await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
		const address = server.address();
		if (!address || typeof address === "string") throw new Error("Missing test server port");
		origin = `http://127.0.0.1:${address.port}`;
		context.server = origin;
		browser = await puppeteer.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
	}, 60_000);

	beforeEach(async () => {
		capabilitiesContext = { ...context };
		submit = "available";
		mode = "commit";
		modeFor.clear();
		posts = [];
		lookups = [];
		commits.clear();
		page = await browser.newPage();
		await page.goto(origin);
		await page.evaluate(`(async () => {
			for (const registration of await navigator.serviceWorker.getRegistrations()) await registration.unregister();
			await new Promise((resolve, reject) => {
				const request = indexedDB.deleteDatabase('z8-offline-queue');
				request.onsuccess = resolve; request.onerror = reject; request.onblocked = resolve;
			});
		})()`);
	});

	afterEach(async () => {
		for (const response of hanging.splice(0)) response.destroy();
		await page?.close();
	});

	afterAll(async () => {
		await browser?.close();
		await new Promise<void>((done) => server?.close(() => done()));
	});

	function request(
		operationId: string,
		kind: "clock_in" | "clock_out",
		extra: Record<string, unknown> = {},
	) {
		return {
			operationId,
			kind,
			admission: "delayed",
			occurredAt: kind === "clock_in" ? "2026-09-25T08:00:00.000Z" : "2026-09-25T16:00:00.000Z",
			timezone: "Europe/Berlin",
			context,
			...(kind === "clock_in"
				? { workLocationType: "office" }
				: {
						knownWorkPeriodId: null,
						project: { kind: "preserve" },
						workCategory: { kind: "clear" },
					}),
			...extra,
		};
	}

	async function loadLibraries(target: Page = page) {
		await target.addScriptTag({ url: `${origin}/lib/clock-command-dispatch.js` });
		await target.addScriptTag({ url: `${origin}/lib/offline-queue-db.js` });
	}

	async function startWorker(target: Page = page) {
		await target.evaluate(`(async () => {
			await navigator.serviceWorker.register('/sw.js');
			await navigator.serviceWorker.ready;
			if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
			window.sendWorker = (data, timeout = 10000) => new Promise((resolve, reject) => {
				const channel = new MessageChannel();
				const timer = setTimeout(() => reject(new Error('worker reply timed out')), timeout);
				channel.port1.onmessage = event => { clearTimeout(timer); channel.port1.close(); resolve(event.data); };
				navigator.serviceWorker.controller.postMessage(data, [channel.port2]);
			});
		})()`);
	}

	async function stopWorkers(target: Page = page) {
		const cdp = await target.createCDPSession();
		await cdp.send("ServiceWorker.enable");
		await cdp.send("ServiceWorker.stopAllWorkers");
		await cdp.detach();
	}

	async function storedCommands(target: Page = page) {
		await loadLibraries(target);
		return target.evaluate(`ClockCommandStore.list()`) as Promise<Record<string, unknown>[]>;
	}

	it("upgrades a version 1 database atomically and keeps legacy rows with their original evidence", async () => {
		const createV1 = `new Promise((resolve, reject) => {
			const request = indexedDB.open('z8-offline-queue', 1);
			request.onupgradeneeded = () => {
				const store = request.result.createObjectStore('clock-events', { keyPath: 'id' });
				store.createIndex('createdAt', 'createdAt'); store.createIndex('organizationId', 'organizationId');
				store.put({ id: 'legacy-1', type: 'clock_in', timestamp: 123, organizationId: 'org-1', retryCount: 5, createdAt: 1, extra: { kept: true } });
			};
			request.onsuccess = () => { request.result.close(); resolve(); };
			request.onerror = reject;
		})`;
		await page.evaluate(createV1);
		await loadLibraries();

		// An interrupted upgrade leaves version 1 and the row exactly as it was.
		const aborted = await page.evaluate(`(async () => {
			const create = IDBDatabase.prototype.createObjectStore;
			IDBDatabase.prototype.createObjectStore = function (name, options) {
				if (name === 'clock-commands') throw new Error('simulated crash during upgrade');
				return create.call(this, name, options);
			};
			let failed = false;
			try { await ClockCommandStore.list(); } catch { failed = true; }
			IDBDatabase.prototype.createObjectStore = create;
			const version = (await indexedDB.databases()).find(db => db.name === 'z8-offline-queue').version;
			const row = await new Promise((resolve) => {
				const request = indexedDB.open('z8-offline-queue', 1);
				request.onsuccess = () => {
					const db = request.result;
					db.transaction('clock-events').objectStore('clock-events').get('legacy-1').onsuccess = e => { db.close(); resolve(e.target.result); };
				};
			});
			return { failed, version, row };
		})()`);
		expect(aborted).toEqual({
			failed: true,
			version: 1,
			row: {
				id: "legacy-1",
				type: "clock_in",
				timestamp: 123,
				organizationId: "org-1",
				retryCount: 5,
				createdAt: 1,
				extra: { kept: true },
			},
		});

		const upgraded = await page.evaluate(`(async () => {
			const commands = await ClockCommandStore.list();
			const legacy = await OfflineQueueDB.getRecords();
			const version = (await indexedDB.databases()).find(db => db.name === 'z8-offline-queue').version;
			return { commands, legacy, version };
		})()`);
		expect(upgraded).toEqual({
			commands: [],
			version: 2,
			legacy: [
				expect.objectContaining({
					id: "legacy-1",
					extra: { kept: true },
					recovery: expect.objectContaining({
						state: "review_required",
						reason: "exhausted",
						commitment: "unknown",
						original: {
							id: "legacy-1",
							type: "clock_in",
							timestamp: 123,
							organizationId: "org-1",
							retryCount: 5,
							createdAt: 1,
							extra: { kept: true },
						},
					}),
				}),
			],
		});
	});

	it("reports an aborted capture as a failure and leaves no record", async () => {
		await loadLibraries();
		const result = await page.evaluate(`(async () => {
			const add = IDBObjectStore.prototype.add;
			IDBObjectStore.prototype.add = function (...args) {
				const request = add.apply(this, args);
				request.addEventListener('success', () => this.transaction.abort());
				return request;
			};
			let outcome;
			try { await ClockCommandStore.capture(${JSON.stringify(request(OP_IN, "clock_in"))}); outcome = 'accepted'; }
			catch { outcome = 'rejected'; }
			IDBObjectStore.prototype.add = add;
			return { outcome, commands: await ClockCommandStore.list() };
		})()`);
		expect(result).toEqual({ outcome: "rejected", commands: [] });
	});

	it("binds a clock-out to the queued clock-in, refuses duplicates and keeps one identity per capture", async () => {
		await loadLibraries();
		const result = await page.evaluate(`(async () => {
			const clockIn = ${JSON.stringify(request(OP_IN, "clock_in"))};
			const first = await ClockCommandStore.capture(clockIn);
			const again = await ClockCommandStore.capture(clockIn);
			const errors = [];
			for (const attempt of [
				{ ...clockIn, occurredAt: '2026-09-25T08:01:00.000Z' },
				{ ...clockIn, operationId: '${OP_OTHER}' },
			]) {
				try { await ClockCommandStore.capture(attempt); } catch (error) { errors.push(error.code); }
			}
			const clockOut = await ClockCommandStore.capture(${JSON.stringify(request(OP_OUT, "clock_out", { knownWorkPeriodId: "a3bb189e-8bf9-3888-9912-ace4e6543002" }))});
			return { first: first.created, again: again.created, sameRecovery: first.record.recoveryId === again.record.recoveryId, errors, clockOut: clockOut.record };
		})()`);
		expect(result).toMatchObject({
			first: true,
			again: false,
			sameRecovery: true,
			errors: ["identity_conflict", "clock_in_pending"],
			clockOut: {
				dependsOn: OP_IN,
				sequence: 2,
				command: {
					target: { clockInOperationId: OP_IN },
					project: { kind: "preserve" },
					workCategory: { kind: "clear" },
				},
			},
		});
	});

	it("orders a clock-in behind an unconfirmed clock-out and keeps archived uncertain work blocking", async () => {
		await loadLibraries();
		const result = await page.evaluate(`(async () => {
			await ClockCommandStore.capture(${JSON.stringify(request(OP_IN, "clock_in"))});
			await ClockCommandStore.capture(${JSON.stringify(request(OP_OUT, "clock_out"))});
			const next = await ClockCommandStore.capture(${JSON.stringify(request(OP_OTHER, "clock_in"))});
			return next.record;
		})()`);
		expect(result).toMatchObject({ operationId: OP_OTHER, dependsOn: OP_OUT });

		await page.evaluate(`indexedDB.deleteDatabase('z8-offline-queue')`);
		const archived = await page.evaluate(`(async () => {
			const { record } = await ClockCommandStore.capture(${JSON.stringify(request(OP_IN, "clock_in"))});
			await ClockCommandStore.update(record.recoveryId, record.revision, { uncertain: true, attemptCount: 1 });
			await ClockCommandStore.archive(record.recoveryId, { userId: 'user-1', organizationId: 'org-1', serverOrigin: location.origin });
			try { await ClockCommandStore.capture(${JSON.stringify(request(OP_OTHER, "clock_in"))}); return 'captured'; }
			catch (error) { return error.code; }
		})()`);
		expect(archived).toBe("clock_in_pending");
	});

	it("prunes only acknowledged or committed resolutions that nothing still depends on", async () => {
		await loadLibraries();
		const remaining = await page.evaluate(`(async () => {
			const clockIn = (await ClockCommandStore.capture(${JSON.stringify(request(OP_IN, "clock_in"))})).record;
			await ClockCommandStore.capture(${JSON.stringify(request(OP_OUT, "clock_out"))});
			await ClockCommandStore.update(clockIn.recoveryId, clockIn.revision, { state: 'rejected', lastOutcome: { kind: 'rejected', code: 'occupancy_conflict' } });
			await ClockCommandStore.acknowledge('${OP_IN}');
			const afterAck = (await ClockCommandStore.list()).find(r => r.operationId === '${OP_IN}');
			await ClockCommandStore.prune(Date.now() + 1);
			return { resolved: typeof afterAck.resolvedAt, operations: (await ClockCommandStore.list()).map(r => r.operationId) };
		})()`);
		// The refused clock-in stays: its clock-out is still blocked by it.
		expect(remaining).toEqual({ resolved: "number", operations: [OP_IN, OP_OUT] });
	});

	it("keeps the command active when the receipt write aborts, then records the replayed receipt", async () => {
		await loadLibraries();
		const first = await page.evaluate(`(async () => {
			await ClockCommandStore.capture(${JSON.stringify(request(OP_IN, "clock_in"))});
			const put = IDBObjectStore.prototype.put;
			IDBObjectStore.prototype.put = function (value, ...rest) {
				const request = put.call(this, value, ...rest);
				if (value && value.state === 'committed') request.addEventListener('success', () => this.transaction.abort());
				return request;
			};
			let failed = false;
			try { await ClockCommandDispatch.process({ store: ClockCommandStore, fetch: (url, init) => fetch(url, init), origin: location.origin }); }
			catch { failed = true; }
			IDBObjectStore.prototype.put = put;
			return { failed, commands: await ClockCommandStore.list() };
		})()`);
		expect(first).toMatchObject({
			failed: true,
			commands: [
				{ operationId: OP_IN, state: "pending", uncertain: true, attemptCount: 1, receipt: null },
			],
		});
		expect(commits.size).toBe(1);

		const second = await page.evaluate(
			`ClockCommandDispatch.process({ store: ClockCommandStore, fetch: (url, init) => fetch(url, init), origin: location.origin }).then(() => ClockCommandStore.list())`,
		);
		expect(second).toMatchObject([
			{ state: "committed", uncertain: false, receipt: commits.get(OP_IN)!.receipt },
		]);
		expect(posts).toHaveLength(2);
		expect(posts[1]).toBe(posts[0]);
	});

	it("recovers a commit whose response was lost and a worker stopped mid-request with the same bytes", async () => {
		await startWorker();
		expect(
			await page.evaluate(
				`sendWorker({ type: 'CAPTURE_CLOCK_COMMAND', payload: ${JSON.stringify(request(OP_IN, "clock_in"))} })`,
			),
		).toMatchObject({ success: true, operationId: OP_IN, state: "pending" });

		mode = "commit_then_drop";
		const dropped = await page.evaluate(
			`sendWorker({ type: 'DISPATCH_CLOCK_COMMANDS', operationId: '${OP_IN}', context: { userId: 'user-1', organizationId: 'org-1' } }, 30000)`,
		);
		// Committed on the server, unknown here: saved and pending, never a failure.
		expect(dropped).toMatchObject({ success: true, record: { state: "pending" } });
		expect(commits.has(OP_IN)).toBe(true);

		// A second command is in flight when the worker stops.
		mode = "commit_then_hang";
		await page.evaluate(
			`sendWorker({ type: 'CAPTURE_CLOCK_COMMAND', payload: ${JSON.stringify(request(OP_OUT, "clock_out"))} })`,
		);
		const arrived = new Promise<void>((done) => {
			postArrived = (operationId) => {
				if (operationId === OP_OUT) done();
			};
		});
		void page
			.evaluate(`sendWorker({ type: 'DISPATCH_CLOCK_COMMANDS' }, 30000).catch(() => null)`)
			.catch(() => {});
		await arrived;
		await new Promise((done) => setTimeout(done, 200));
		await stopWorkers();
		for (const response of hanging.splice(0)) response.destroy();

		mode = "commit";
		await page.reload();
		await startWorker();
		const recovered = await page.evaluate(
			`sendWorker({ type: 'DISPATCH_CLOCK_COMMANDS', operationId: '${OP_OUT}', context: { userId: 'user-1', organizationId: 'org-1' } }, 30000)`,
		);
		expect(recovered).toMatchObject({ success: true, record: { state: "committed" } });
		const stored = await storedCommands();
		expect(stored).toMatchObject([
			{ operationId: OP_IN, state: "committed", receipt: commits.get(OP_IN)!.receipt },
			{
				operationId: OP_OUT,
				state: "committed",
				receipt: commits.get(OP_OUT)!.receipt,
				dependsOn: OP_IN,
			},
		]);
		const inBodies = posts.filter((body) => body.includes(OP_IN) && !body.includes(OP_OUT));
		const outBodies = posts.filter((body) => JSON.parse(body).operationId === OP_OUT);
		expect(new Set(inBodies)).toEqual(new Set([stored[0].body]));
		expect(new Set(outBodies)).toEqual(new Set([stored[1].body]));
		expect(outBodies.length).toBeGreaterThanOrEqual(2);
		expect(commits.size).toBe(2);
	}, 60_000);

	it("keeps identity and bytes across a killed browser process and resends after restart", async () => {
		const userDataDir = await mkdtemp(join(tmpdir(), "z8-clock-commands-"));
		try {
			const first = await puppeteer.launch({
				executablePath,
				headless: true,
				args: ["--no-sandbox"],
				userDataDir,
			});
			const firstPage = await first.newPage();
			await firstPage.goto(origin);
			await startWorker(firstPage);
			await firstPage.evaluate(
				`sendWorker({ type: 'CAPTURE_CLOCK_COMMAND', payload: ${JSON.stringify(request(OP_IN, "clock_in"))} })`,
			);
			mode = "commit_then_hang";
			const arrived = new Promise<void>((done) => {
				postArrived = () => done();
			});
			void firstPage
				.evaluate(`sendWorker({ type: 'DISPATCH_CLOCK_COMMANDS' }, 30000).catch(() => null)`)
				.catch(() => {});
			await arrived;
			first.process()?.kill("SIGKILL");
			await new Promise((done) => setTimeout(done, 500));
			for (const response of hanging.splice(0)) response.destroy();

			mode = "commit";
			const second = await puppeteer.launch({
				executablePath,
				headless: true,
				args: ["--no-sandbox"],
				userDataDir,
			});
			try {
				const secondPage = await second.newPage();
				await secondPage.goto(origin);
				const beforeRestartSend = await storedCommands(secondPage);
				expect(beforeRestartSend).toMatchObject([
					{ operationId: OP_IN, state: "pending", uncertain: true, attemptCount: 1 },
				]);
				await startWorker(secondPage);
				expect(
					await secondPage.evaluate(
						`sendWorker({ type: 'DISPATCH_CLOCK_COMMANDS', operationId: '${OP_IN}', context: { userId: 'user-1', organizationId: 'org-1' } }, 30000)`,
					),
				).toMatchObject({ record: { state: "committed", receipt: commits.get(OP_IN)!.receipt } });
				expect(posts).toEqual([beforeRestartSend[0].body, beforeRestartSend[0].body]);
				expect(commits.size).toBe(1);
			} finally {
				await second.close();
			}
		} finally {
			await rm(userDataDir, { recursive: true, force: true, maxRetries: 5 }).catch(() => {});
		}
	}, 90_000);

	it("pauses in another account or organization without sending and resumes in the captured one", async () => {
		await startWorker();
		await page.evaluate(
			`sendWorker({ type: 'CAPTURE_CLOCK_COMMAND', payload: ${JSON.stringify(request(OP_IN, "clock_in"))} })`,
		);
		capabilitiesContext = { ...context, organizationId: "org-2" };
		expect(
			await page.evaluate(
				`sendWorker({ type: 'DISPATCH_CLOCK_COMMANDS', operationId: '${OP_IN}', context: { userId: 'user-1', organizationId: 'org-1' } }, 30000)`,
			),
		).toMatchObject({
			record: {
				state: "pending",
				hold: { reason: "context_mismatch", fields: ["organizationId"] },
			},
		});
		expect(posts).toHaveLength(0);
		// A caller in another account never reads this record's outcome.
		expect(
			await page.evaluate(
				`sendWorker({ type: 'DISPATCH_CLOCK_COMMANDS', operationId: '${OP_IN}', context: { userId: 'user-2', organizationId: 'org-1' } }, 30000)`,
			),
		).toMatchObject({ success: true, record: null });

		capabilitiesContext = { ...context };
		expect(
			await page.evaluate(
				`sendWorker({ type: 'DISPATCH_CLOCK_COMMANDS', operationId: '${OP_IN}', context: { userId: 'user-1', organizationId: 'org-1' } }, 30000)`,
			),
		).toMatchObject({ record: { state: "committed", hold: null } });
		expect(posts).toHaveLength(1);
	});

	it("does not send dependants of a refused clock-in and lets inspection, export and archive keep the evidence", async () => {
		await startWorker();
		await page.evaluate(`(async () => {
			await sendWorker({ type: 'CAPTURE_CLOCK_COMMAND', payload: ${JSON.stringify(request(OP_IN, "clock_in"))} });
			await sendWorker({ type: 'CAPTURE_CLOCK_COMMAND', payload: ${JSON.stringify(request(OP_OUT, "clock_out"))} });
		})()`);
		modeFor.set(OP_IN, { reject: "occupancy_conflict", status: 409 });
		await page.evaluate(`sendWorker({ type: 'DISPATCH_CLOCK_COMMANDS' }, 30000)`);
		expect(posts.map((body) => JSON.parse(body).operationId)).toEqual([OP_IN]);

		const scope = `{ userId: 'user-1', organizationId: 'org-1' }`;
		expect(
			await page.evaluate(`sendWorker({ type: 'GET_QUEUE_COUNT', context: ${scope} })`),
		).toEqual({
			count: 2,
			reviewCount: 1,
			waitingCount: 1,
			savedCount: 2,
		});
		const { records } = (await page.evaluate(
			`sendWorker({ type: 'GET_QUEUE_RECORDS', context: ${scope} })`,
		)) as { records: { id: string; operationId: string; state: string; hold: unknown }[] };
		expect(records).toMatchObject([
			{ operationId: OP_IN, state: "review_required", lastOutcome: { code: "occupancy_conflict" } },
			{
				operationId: OP_OUT,
				state: "pending",
				hold: { reason: "predecessor_blocked", operationId: OP_IN },
			},
		]);

		await page.evaluate(
			`sendWorker({ type: 'ARCHIVE_QUEUE_RECORD', context: ${scope}, eventId: '${records[0].id}' })`,
		);
		await page.evaluate(`sendWorker({ type: 'DISPATCH_CLOCK_COMMANDS' }, 30000)`);
		expect(posts).toHaveLength(1);
		expect(await storedCommands()).toMatchObject([
			{ operationId: OP_IN, state: "archived", archivedFrom: "review_required" },
			{ operationId: OP_OUT, state: "pending", hold: { reason: "predecessor_blocked" } },
		]);

		capabilitiesContext = { ...context, userId: "user-2" };
		expect(
			await page.evaluate(
				`sendWorker({ type: 'GET_QUEUE_RECORDS', context: { userId: 'user-2', organizationId: 'org-1' } })`,
			),
		).toMatchObject({ records: [] });
	});

	it("looks up an uncertain command while fresh submission is unavailable instead of sending it", async () => {
		await loadLibraries();
		await page.evaluate(`ClockCommandStore.capture(${JSON.stringify(request(OP_IN, "clock_in"))})`);
		mode = "commit_then_drop";
		await page.evaluate(
			`ClockCommandDispatch.process({ store: ClockCommandStore, fetch: (url, init) => fetch(url, init), origin: location.origin })`,
		);
		submit = "unavailable";
		const stored = await page.evaluate(
			`ClockCommandDispatch.process({ store: ClockCommandStore, fetch: (url, init) => fetch(url, init), origin: location.origin }).then(() => ClockCommandStore.list())`,
		);
		expect(posts).toHaveLength(1);
		expect(lookups).toEqual([OP_IN]);
		expect(stored).toMatchObject([{ state: "committed", receipt: commits.get(OP_IN)!.receipt }]);
	});
});
