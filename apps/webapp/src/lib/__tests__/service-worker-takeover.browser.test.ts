import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import puppeteer, {
	type Browser,
	type BrowserContext,
	type Page,
} from "puppeteer-core";
import {
	afterAll,
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	it,
} from "vitest";
import {
	classifyLegacyClockConsumer,
	fenceLegacyClockConsumerResponse,
} from "@/app/api/time-entries/legacy-consumer-fence";

// Real Chromium service-worker lifecycle and IndexedDB, opt-in on machines with a
// browser. No application DB. The old release is the worker from `66bbc7b5`, the
// desired production core source recorded in z8-infra on 2026-09-24 (#266 dossier).
const executablePath = process.env.Z8_TEST_CHROME_PATH;
const WORKER_FILES = [
	"/sw.js",
	"/lib/offline-queue-db.js",
	"/lib/sync-service.js",
	"/lib/clock-command-dispatch.js",
];
type Release = "pre-preservation" | "preserving" | "preserving-rebuilt";

describe.skipIf(!executablePath)(
	"service-worker old-consumer control",
	{ timeout: 30_000 },
	() => {
		let browser: Browser;
		let context: BrowserContext;
		let page: Page;
		let server: Server;
		let origin: string;
		let release: Release = "pre-preservation";
		let fenceEnabled = false;
		let clockPosts: Array<{ status: number; body: unknown }> = [];

		async function workerFile(pathname: string) {
			const file =
				release === "pre-preservation"
					? resolve("src/lib/__tests__/fixtures/sw-66bbc7b5", `.${pathname}`)
					: resolve("public", `.${pathname}`);
			const source = await readFile(file, "utf8");
			// A rebuilt preserving release differs byte-wise, triggering an update.
			return release === "preserving-rebuilt" && pathname === "/sw.js"
				? `${source}\n// rebuilt\n`
				: source;
		}

		async function readBody(request: IncomingMessage) {
			let raw = "";
			for await (const chunk of request) raw += chunk;
			return JSON.parse(raw);
		}

		/** Current direct-route answer to the old reader's organization assertion. */
		async function answerClockPost(request: IncomingMessage) {
			const body = await readBody(request);
			const routeResponse = Response.json(
				{ error: "organizationId is server-derived" },
				{ status: 400 },
			);
			const requestHeaders = new Headers();
			for (const [name, value] of Object.entries(request.headers)) {
				if (typeof value === "string") requestHeaders.set(name, value);
			}
			const answer = fenceEnabled
				? await fenceLegacyClockConsumerResponse(
						classifyLegacyClockConsumer(requestHeaders, body),
						routeResponse,
					)
				: routeResponse;
			clockPosts.push({ status: answer.status, body });
			return answer;
		}

		beforeAll(async () => {
			server = createServer(async (request, response) => {
				const pathname = new URL(request.url!, "http://localhost").pathname;
				if (WORKER_FILES.includes(pathname)) {
					response.setHeader("Content-Type", "application/javascript");
					response.setHeader("Cache-Control", "no-store");
					response.end(await workerFile(pathname));
				} else if (
					pathname === "/api/time-entries" &&
					request.method === "POST"
				) {
					const answer = await answerClockPost(request);
					response.statusCode = answer.status;
					response.setHeader("Content-Type", "application/json");
					response.end(await answer.text());
				} else {
					response.setHeader("Content-Type", "text/html");
					response.end(
						"<!doctype html><title>Service worker takeover test</title>",
					);
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
			release = "pre-preservation";
			fenceEnabled = false;
			clockPosts = [];
			context = await browser.createBrowserContext();
			page = await context.newPage();
			await page.goto(origin);
		});

		afterEach(async () => {
			await context?.close();
		});

		afterAll(async () => {
			await browser?.close();
			await new Promise<void>((resolve) => server?.close(() => resolve()));
		});

		async function registerControllingWorker() {
			await page.evaluate(`(async () => {
			await navigator.serviceWorker.register('/sw.js', { scope: '/' });
			await navigator.serviceWorker.ready;
			if (!navigator.serviceWorker.controller) {
				await new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
			}
			window.__workerMessages = [];
			navigator.serviceWorker.addEventListener('message', event => window.__workerMessages.push(event.data?.type));
		})()`);
		}

		function askController(message: object) {
			return page.evaluate(`new Promise((resolve, reject) => {
			const channel = new MessageChannel();
			const timer = setTimeout(() => reject(new Error('worker did not answer')), 5000);
			channel.port1.onmessage = event => { clearTimeout(timer); resolve(event.data); };
			navigator.serviceWorker.controller.postMessage(${JSON.stringify(message)}, [channel.port2]);
		})`);
		}

		function queuedRows() {
			return page.evaluate(`new Promise((resolve, reject) => {
			const request = indexedDB.open('z8-offline-queue');
			request.onsuccess = () => {
				const all = request.result.transaction('clock-events').objectStore('clock-events').getAll();
				all.onsuccess = () => { request.result.close(); resolve(all.result); };
				all.onerror = reject;
			};
			request.onerror = reject;
		})`) as Promise<Array<Record<string, unknown>>>;
		}

		/** Queue through the old page protocol; the old worker then syncs by itself. */
		async function queueThroughOldWorkerAndSync() {
			await askController({
				type: "QUEUE_CLOCK_EVENT",
				payload: {
					type: "clock_in",
					timestamp: Date.now(),
					organizationId: "org-1",
					browserTimezone: "Europe/Berlin",
				},
			});
			await page.waitForFunction(
				`window.__workerMessages.includes('SYNC_COMPLETED')`,
				{
					timeout: 10_000,
				},
			);
		}

		it("baseline: the pre-preservation reader deletes its row on the route's 400", async () => {
			await registerControllingWorker();

			await queueThroughOldWorkerAndSync();

			expect(clockPosts).toEqual([
				{
					status: 400,
					body: expect.objectContaining({ organizationId: "org-1" }),
				},
			]);
			expect(await queuedRows()).toEqual([]);
		});

		it("the fenced answer makes the pre-preservation reader keep its row without counting a retry", async () => {
			fenceEnabled = true;
			await registerControllingWorker();

			await queueThroughOldWorkerAndSync();

			expect(clockPosts).toEqual([
				{
					status: 401,
					body: expect.objectContaining({ organizationId: "org-1" }),
				},
			]);
			expect(await queuedRows()).toEqual([
				expect.objectContaining({
					type: "clock_in",
					organizationId: "org-1",
					retryCount: 0,
				}),
			]);
		});

		it("the preserving worker replaces a pre-preservation worker without waiting for the user", async () => {
			fenceEnabled = true;
			await registerControllingWorker();
			expect(await askController({ type: "GET_VERSION" })).not.toHaveProperty(
				"clockQueueMode",
			);
			await queueThroughOldWorkerAndSync();

			release = "preserving";
			const outcome = await page.evaluate(`(async () => {
			const registration = await navigator.serviceWorker.getRegistration();
			const changed = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', () => resolve(true), { once: true }));
			await registration.update();
			return Promise.race([changed, new Promise(resolve => setTimeout(() => resolve(false), 5000))]);
		})()`);

			expect(outcome).toBe(true);
			expect(await askController({ type: "GET_VERSION" })).toMatchObject({
				clockQueueMode: "preservation-only-v1",
			});
			expect(await queuedRows()).toEqual([
				expect.objectContaining({
					type: "clock_in",
					organizationId: "org-1",
					retryCount: 0,
				}),
			]);
		});

		it("a preserving worker update still waits for the user's reload", async () => {
			release = "preserving";
			await registerControllingWorker();

			release = "preserving-rebuilt";
			const outcome = await page.evaluate(`(async () => {
			const registration = await navigator.serviceWorker.getRegistration();
			await registration.update();
			const installing = registration.installing;
			if (installing && installing.state !== 'installed') {
				await new Promise(resolve => installing.addEventListener('statechange', function onChange() {
					if (installing.state === 'installed' || installing.state === 'redundant') resolve();
				}));
			}
			await new Promise(resolve => setTimeout(resolve, 1000));
			return { waiting: Boolean(registration.waiting), activeIsUpdate: registration.active === installing };
		})()`);

			expect(outcome).toEqual({ waiting: true, activeIsUpdate: false });
		});
	},
);

describe.skipIf(!executablePath)(
	"extension queue reader classification",
	{ timeout: 30_000 },
	() => {
		it("an MV3 extension background request carries its extension origin, so X1/X2 bodies are fenced", async () => {
			const answers: Array<{ origin?: string; status: number }> = [];
			const server = createServer(async (request, response) => {
				let raw = "";
				for await (const chunk of request) raw += chunk;
				const requestHeaders = new Headers();
				for (const [name, value] of Object.entries(request.headers)) {
					if (typeof value === "string") requestHeaders.set(name, value);
				}
				const answer = await fenceLegacyClockConsumerResponse(
					classifyLegacyClockConsumer(requestHeaders, JSON.parse(raw)),
					Response.json(
						{ error: "No active work period found" },
						{ status: 400 },
					),
				);
				answers.push({ origin: request.headers.origin, status: answer.status });
				response.statusCode = answer.status;
				response.end(await answer.text());
			});
			await new Promise<void>((resolve) =>
				server.listen(0, "127.0.0.1", resolve),
			);
			const address = server.address();
			if (!address || typeof address === "string")
				throw new Error("Missing test server port");
			const extensionDir = await mkdtemp(join(tmpdir(), "z8-extension-"));
			let extensionBrowser: Browser | undefined;
			try {
				await writeFile(
					join(extensionDir, "manifest.json"),
					JSON.stringify({
						manifest_version: 3,
						name: "Queue reader probe",
						version: "1.0.1",
						host_permissions: ["http://127.0.0.1/*"],
						background: { service_worker: "background.js", type: "module" },
					}),
				);
				// X1/X2 replay body shape: no id, zone, offset or replay flag.
				await writeFile(
					join(extensionDir, "background.js"),
					`fetch("http://127.0.0.1:${address.port}/api/time-entries", {
						method: "POST", credentials: "include",
						headers: { "Content-Type": "application/json" },
						body: JSON.stringify({ type: "clock_out", timestamp: new Date().toISOString() }),
					});`,
				);
				extensionBrowser = await puppeteer.launch({
					executablePath,
					headless: true,
					pipe: true,
					enableExtensions: [extensionDir],
					args: ["--no-sandbox"],
				});
				for (let i = 0; i < 50 && answers.length === 0; i++) {
					await new Promise((resolve) => setTimeout(resolve, 200));
				}

				expect(answers).toEqual([
					{
						origin: expect.stringMatching(/^chrome-extension:\/\//),
						status: 409,
					},
				]);
			} finally {
				await extensionBrowser?.close();
				await new Promise<void>((resolve) => server.close(() => resolve()));
				await rm(extensionDir, { recursive: true, force: true });
			}
		});
	},
);
