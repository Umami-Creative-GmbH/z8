import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { resolve } from "node:path";
import puppeteer, { type Browser, type Page } from "puppeteer-core";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

// Real Chromium/IndexedDB, opt-in on machines with a browser. No application DB.
const executablePath = process.env.Z8_TEST_CHROME_PATH;
describe.skipIf(!executablePath)("browser clock queue persistence", () => {
	let browser: Browser;
	let page: Page;
	let server: Server;
	let origin: string;
	let recoveryContext = {
		userId: "user-1",
		organizationId: "org-1",
		canReviewLegacy: false,
	};
	let contextStatus = 200;
	let clockPosts = 0;

	beforeAll(async () => {
		server = createServer(async (request, response) => {
			const pathname = new URL(request.url!, "http://localhost").pathname;
			if (
				["/sw.js", "/lib/offline-queue-db.js", "/lib/sync-service.js"].includes(
					pathname,
				)
			) {
				response.setHeader("Content-Type", "application/javascript");
				response.end(await readFile(resolve("public", `.${pathname}`)));
			} else if (pathname === "/api/time-entries/offline-context") {
				response.statusCode = contextStatus;
				response.setHeader("Content-Type", "application/json");
				response.end(JSON.stringify(recoveryContext));
			} else if (
				pathname === "/api/time-entries" &&
				request.method === "POST"
			) {
				clockPosts++;
				request.socket.destroy();
			} else {
				response.setHeader("Content-Type", "text/html");
				response.end("<!doctype html><title>Clock queue storage test</title>");
			}
		});
		await new Promise<void>((resolve) =>
			server.listen(0, "127.0.0.1", resolve),
		);
		const address = server.address();
		if (!address || typeof address === "string")
			throw new Error("Missing test server port");
		origin = `http://127.0.0.1:${address.port}`;
		browser = await puppeteer.launch({
			executablePath,
			headless: true,
			args: ["--no-sandbox"],
		});
	}, 60_000);

	beforeEach(async () => {
		await page?.close();
		page = await browser.newPage();
		await page.goto(origin);
		contextStatus = 200;
		recoveryContext = {
			userId: "user-1",
			organizationId: "org-1",
			canReviewLegacy: false,
		};
		clockPosts = 0;
		await page.evaluate(`new Promise((resolve, reject) => {
			const request = indexedDB.deleteDatabase('z8-offline-queue');
			request.onsuccess = resolve; request.onerror = reject;
		})`);
		await page.addScriptTag({ url: `${origin}/lib/offline-queue-db.js` });
	});

	afterAll(async () => {
		await browser?.close();
		await new Promise<void>((resolve) => server?.close(() => resolve()));
	});

	it("does not acknowledge local acceptance when the IndexedDB transaction aborts after add succeeds", async () => {
		const result = await page.evaluate(`(async () => {
			const add = IDBObjectStore.prototype.add;
			IDBObjectStore.prototype.add = function (...args) {
				const request = add.apply(this, args);
				request.addEventListener('success', () => this.transaction.abort());
				return request;
			};
			let outcome;
			try {
				await OfflineQueueDB.enqueue({ type: 'clock_in', timestamp: 123, organizationId: 'org-1' });
				outcome = 'accepted';
			} catch { outcome = 'rejected'; }
			IDBObjectStore.prototype.add = add;
			return { outcome, count: await OfflineQueueDB.getCount() };
		})()`);
		expect(result).toEqual({ outcome: "rejected", count: 0 });
	});

	it("retains original old/exhausted legacy evidence across cleanup, processing and restart", async () => {
		await page.evaluate(`(async () => {
			await OfflineQueueDB.enqueue({ type: 'clock_in', timestamp: 123, organizationId: 'org-1' });
			await new Promise((resolve, reject) => {
				const request = indexedDB.open('z8-offline-queue', 1);
				request.onsuccess = () => {
					const db = request.result, tx = db.transaction('clock-events', 'readwrite');
					const store = tx.objectStore('clock-events'); store.clear();
					store.put({ id: 'legacy-local-id', type: 'clock_out', timestamp: '2020-01-01T01:00:00+01:00',
						organizationId: 'original-org', retryCount: 5, createdAt: 1, notes: '',
						workLocationType: 'field', unknownLegacyField: { evidence: true } });
					tx.oncomplete = () => { db.close(); resolve(); }; tx.onabort = reject;
				};
			});
			await OfflineQueueDB.cleanOldEntries();
		})()`);
		await page.addScriptTag({ url: `${origin}/lib/sync-service.js` });
		await page.evaluate(`SyncService.processQueue()`);
		await page.reload();
		await page.addScriptTag({ url: `${origin}/lib/offline-queue-db.js` });
		const records = await page.evaluate(`OfflineQueueDB.getPending()`);
		expect(records).toEqual([
			expect.objectContaining({
				id: "legacy-local-id",
				type: "clock_out",
				timestamp: "2020-01-01T01:00:00+01:00",
				organizationId: "original-org",
				retryCount: 5,
				createdAt: 1,
				notes: "",
				workLocationType: "field",
				unknownLegacyField: { evidence: true },
				recovery: expect.objectContaining({
					state: "review_required",
					reason: "exhausted",
					commitment: "unknown",
				}),
			}),
		]);
		expect(records).not.toEqual([
			expect.objectContaining({ browserTimezone: expect.anything() }),
		]);
	});

	it("rejects aborted recovery updates without changing the legacy row", async () => {
		const result = await page.evaluate(`(async () => {
			await OfflineQueueDB.enqueue({ type: 'clock_in', organizationId: 'org-1' });
			const record = (await OfflineQueueDB.getRecords())[0];
			const update = IDBCursor.prototype.update;
			// Simulate an existing version-1 row without new lifecycle fields.
			await new Promise((resolve) => {
				const req = indexedDB.open('z8-offline-queue'); req.onsuccess = () => {
					const db = req.result, tx = db.transaction('clock-events', 'readwrite');
					delete record.recovery; tx.objectStore('clock-events').put(record);
					tx.oncomplete = () => { db.close(); resolve(); };
				};
			});
			IDBCursor.prototype.update = function (...args) {
				const request = update.apply(this, args);
				request.addEventListener('success', () => request.transaction.abort());
				return request;
			};
			let rejected = false;
			try { await OfflineQueueDB.retainForReview(); } catch { rejected = true; }
			IDBCursor.prototype.update = update;
			return { rejected, records: await OfflineQueueDB.getRecords(), original: record };
		})()`);
		expect(result).toMatchObject({ rejected: true });
		expect(result).toHaveProperty("records", [
			expect.not.objectContaining({ recovery: expect.anything() }),
		]);
	});

	async function startWorker() {
		await page.evaluate(`(async () => {
			await navigator.serviceWorker.register('/sw.js');
			await navigator.serviceWorker.ready;
			if (!navigator.serviceWorker.controller) await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
			window.sendWorker = data => new Promise((resolve, reject) => {
				const channel = new MessageChannel();
				const timeout = setTimeout(() => reject(new Error('worker reply timed out')), 3000);
				channel.port1.onmessage = event => { clearTimeout(timeout); channel.port1.close(); resolve(event.data); };
				navigator.serviceWorker.controller.postMessage(data, [channel.port2]);
			});
		})()`);
	}

	it("uses real worker replies, scopes inspection, and preserves archived evidence after worker restart", async () => {
		await startWorker();
		const accepted =
			await page.evaluate(`sendWorker({ type: 'QUEUE_CLOCK_EVENT', payload: {
			type: 'clock_out', timestamp: 123, organizationId: 'org-1', userId: 'user-1', serverOrigin: location.origin
		} })`);
		expect(accepted).toMatchObject({
			success: true,
			commitment: "unknown",
			reviewRequired: true,
		});
		expect(await page.evaluate(`sendWorker({ type: 'TRIGGER_SYNC' })`)).toEqual(
			{ success: true, accepted: true },
		);
		expect(clockPosts).toBe(0);
		const records = await page.evaluate(`(async () => {
			const response = await sendWorker({ type: 'GET_QUEUE_RECORDS', context: { userId: 'user-1', organizationId: 'org-1' } });
			return response.records;
		})()`);
		expect(records).toHaveLength(1);
		recoveryContext = {
			userId: "user-2",
			organizationId: "org-1",
			canReviewLegacy: false,
		};
		expect(
			await page.evaluate(
				`sendWorker({ type: 'GET_QUEUE_RECORDS', context: { userId: 'user-2', organizationId: 'org-1' } })`,
			),
		).toMatchObject({ records: [] });
		expect(
			await page.evaluate(
				`sendWorker({ type: 'GET_QUEUE_RECORDS', context: { userId: 'user-1', organizationId: 'org-1' } })`,
			),
		).toMatchObject({ success: false });
		recoveryContext = {
			userId: "user-1",
			organizationId: "org-1",
			canReviewLegacy: false,
		};
		await page.evaluate(`(async () => {
			const context = { userId: 'user-1', organizationId: 'org-1' };
			const { records } = await sendWorker({ type: 'GET_QUEUE_RECORDS', context });
			await sendWorker({ type: 'ARCHIVE_QUEUE_RECORD', eventId: records[0].id, context });
		})()`);
		const cdp = await page.createCDPSession();
		await cdp.send("ServiceWorker.enable");
		await cdp.send("ServiceWorker.stopAllWorkers");
		await cdp.detach();
		await page.reload();
		await startWorker();
		expect(
			await page.evaluate(
				`sendWorker({ type: 'GET_QUEUE_COUNT', context: { userId: 'user-1', organizationId: 'org-1' } })`,
			),
		).toEqual({ count: 0, reviewCount: 0, savedCount: 1 });
		expect(
			await page.evaluate(
				`sendWorker({ type: 'GET_QUEUE_RECORDS', context: { userId: 'user-1', organizationId: 'org-1' } })`,
			),
		).toMatchObject({
			records: [
				expect.objectContaining({
					recovery: expect.objectContaining({
						state: "archived",
						commitment: "unknown",
					}),
				}),
			],
		});
		contextStatus = 401;
		expect(
			await page.evaluate(
				`sendWorker({ type: 'GET_QUEUE_RECORDS', context: { userId: 'user-1', organizationId: 'org-1' } })`,
			),
		).toMatchObject({ success: false });
	});

	it("retains exact intercepted request bytes and incoming identity without inventing event context", async () => {
		await startWorker();
		const outcome = await page.evaluate(`(async () => {
			const raw = '{ "id": "original-action-id", "type": "clock_out", "browserTimezone": null, "notes": "" }';
			const response = await fetch('/api/time-entries', { method: 'POST', body: raw });
			const result = await response.json();
			return { status: response.status, result, raw };
		})()`);
		expect(outcome).toMatchObject({
			status: 202,
			result: { queued: true, commitment: "unknown", reviewRequired: true },
		});
		const evidence = await page.evaluate(`OfflineQueueDB.getRecords()`);
		expect(evidence).toEqual([
			expect.objectContaining({
				browserTimezone: null,
				notes: "",
				recovery: expect.objectContaining({
					original: expect.objectContaining({ id: "original-action-id" }),
				}),
				interceptedRequest: expect.objectContaining({
					rawBody:
						'{ "id": "original-action-id", "type": "clock_out", "browserTimezone": null, "notes": "" }',
				}),
			}),
		]);
		expect(evidence).toEqual([
			expect.not.objectContaining({ timestamp: expect.anything() }),
		]);
		expect(evidence).toEqual([
			expect.not.objectContaining({ organizationId: expect.anything() }),
		]);
	});

	it("erases the complete inline recovery lifecycle with authorized origin-data cleanup without resurrection", async () => {
		await startWorker();
		await page.evaluate(`(async () => {
			const context = { userId: 'user-1', organizationId: 'org-1' };
			for (const type of ['clock_in', 'clock_out']) await sendWorker({ type: 'QUEUE_CLOCK_EVENT', payload: {
				...context, type, timestamp: 123, serverOrigin: location.origin,
			} });
			const { records } = await sendWorker({ type: 'GET_QUEUE_RECORDS', context });
			await sendWorker({ type: 'ARCHIVE_QUEUE_RECORD', context, eventId: records[0].id });
		})()`);
		const cdp = await page.createCDPSession();
		await cdp.send("Storage.clearDataForOrigin", {
			origin,
			storageTypes: "indexeddb",
		});
		await cdp.send("ServiceWorker.enable");
		await cdp.send("ServiceWorker.stopAllWorkers");
		await cdp.detach();
		await page.reload();
		await startWorker();
		await page.evaluate(`sendWorker({ type: 'TRIGGER_SYNC' })`);
		expect(
			await page.evaluate(
				`sendWorker({ type: 'GET_QUEUE_RECORDS', context: { userId: 'user-1', organizationId: 'org-1' } })`,
			),
		).toMatchObject({ records: [] });
	});
});
