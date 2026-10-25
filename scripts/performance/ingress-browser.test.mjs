import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import test from "node:test";
import { runInContext } from "node:vm";
import { Worker } from "node:worker_threads";
import * as browserModule from "./ingress-browser.mjs";
import { observeIngress, readDashboardDom } from "./ingress-browser.mjs";

const require = createRequire(
	new URL("../../apps/webapp/package.json", import.meta.url),
);
const { JSDOM } = require("jsdom");
function realDomPage(getDom) {
	return {
		evaluate: async (fn) => {
			const dom = getDom();
			dom.window.performance.getEntriesByType = () => [];
			return runInContext(`(${fn.toString()})()`, dom.getInternalVMContext());
		},
	};
}
test("an actual missing document root stays unknown rather than proving no protected content", async () => {
	const dom = new JSDOM("<html><body></body></html>", {
		url: "http://localhost:50754/en/mfa",
		runScripts: "outside-only",
	});
	dom.window.document.documentElement.remove();
	try {
		const value = await readDashboardDom(realDomPage(() => dom));
		assert.equal(value.documentReady, false);
		assert.equal(value.protectedContent, null);
		assert.equal(value.viewport.documentWidth, null);
		assert.equal(value.pathname, "/en/mfa");
	} finally {
		dom.window.close();
	}
	const noBody = new JSDOM("<html><body></body></html>", {
		url: "http://localhost:50754/en/mfa",
		runScripts: "outside-only",
	});
	noBody.window.document.body.remove();
	try {
		const value = await readDashboardDom(realDomPage(() => noBody));
		assert.equal(value.documentReady, false);
		assert.equal(value.protectedContent, null);
	} finally {
		noBody.window.close();
	}
});
test("admission waits for a rooted challenge and reads its path and protected markup atomically", async () => {
	const empty = new JSDOM("", {
		url: "http://localhost:50754/en",
		runScripts: "outside-only",
	});
	empty.window.document.documentElement.remove();
	const wrong = new JSDOM("<body><main></main></body>", {
		url: "http://localhost:50754/en",
		runScripts: "outside-only",
	});
	const ready = new JSDOM("<body><main>Challenge</main></body>", {
		url: "http://localhost:50754/en/mfa",
		runScripts: "outside-only",
	});
	let dom = empty,
		at = 40,
		sleeps = 0;
	try {
		const value = await browserModule.waitForAdmissionDom(
			realDomPage(() => dom),
			{
				expectedPath: "/en/mfa",
				deadline: 100,
				now: () => at,
				sleep: async (ms) => {
					at += ms;
					dom = ++sleeps === 1 ? wrong : ready;
					await Promise.resolve();
				},
			},
		);
		assert.equal(value.documentReady, true);
		assert.equal(value.pathname, "/en/mfa");
		assert.equal(value.protectedContent, false);
		assert.ok(value.admissionObservation.attempts >= 3);
		assert.ok(at < 100);
		ready.window.document.body.innerHTML =
			'<header data-clock-status="ready"></header><div data-widget-id="quick-stats"></div>';
		assert.equal(
			(await readDashboardDom(realDomPage(() => ready))).protectedContent,
			true,
		);
	} finally {
		for (const item of [empty, wrong, ready]) item.window.close();
	}
});
test("admission root/path wait cannot renew an exhausted navigation deadline", async () => {
	const dom = new JSDOM("", {
		url: "http://localhost:50754/en",
		runScripts: "outside-only",
	});
	dom.window.document.documentElement.remove();
	let at = 44000;
	try {
		await assert.rejects(
			browserModule.waitForAdmissionDom(
				realDomPage(() => dom),
				{
					expectedPath: "/en/mfa",
					deadline: 45000,
					now: () => at,
					sleep: async (ms) => {
						at += ms;
					},
				},
			),
			(error) => {
				assert.equal(error.lastDomSnapshot.documentReady, false);
				assert.equal(error.lastDomSnapshot.protectedContent, null);
				assert.equal(at, 45000);
				return true;
			},
		);
	} finally {
		dom.window.close();
	}
});

const navigationMessage =
	"Execution context was destroyed, most likely because of a navigation.";
test("only the observed open-main-frame navigation exception can precede a real settled challenge", async () => {
	const dom = new JSDOM("<body><main>Challenge</main></body>", {
		url: "http://localhost:50754/en/mfa",
		runScripts: "outside-only",
	});
	const real = realDomPage(() => dom);
	let calls = 0,
		at = 0;
	const page = {
		isClosed: () => false,
		mainFrame: () => ({ detached: false }),
		evaluate: async (fn) => {
			if (++calls === 1) throw Error(navigationMessage);
			return real.evaluate(fn);
		},
	};
	try {
		const value = await browserModule.waitForAdmissionDom(page, {
			expectedPath: "/en/mfa",
			deadline: 100,
			now: () => at,
			sleep: async (ms) => {
				at += ms;
				await Promise.resolve();
			},
		});
		assert.equal(value.documentReady, true);
		assert.equal(value.protectedContent, false);
		assert.equal(value.admissionObservation.navigationContextTransitions, 1);
		assert.equal(calls, 2);
	} finally {
		dom.window.close();
	}
});
test("closed pages, detached or unknown frames and arbitrary exceptions cannot be retried as navigation", async (t) => {
	for (const mode of [
		"closed",
		"detached",
		"unknown-frame",
		"arbitrary",
		"similar-message",
	])
		await t.test(mode, async () => {
			const error = Error(
				mode === "arbitrary"
					? "Unexpected DOM failure"
					: mode === "similar-message"
						? "Execution context was destroyed"
						: navigationMessage,
			);
			let calls = 0,
				sleeps = 0;
			const page = {
				isClosed: () => mode === "closed",
				mainFrame: () =>
					mode === "unknown-frame" ? null : { detached: mode === "detached" },
				evaluate: async () => {
					calls++;
					throw error;
				},
			};
			await assert.rejects(
				browserModule.waitForAdmissionDom(page, {
					expectedPath: "/en/mfa",
					deadline: 100,
					now: () => 0,
					sleep: async () => {
						sleeps++;
					},
				}),
				(value) => value === error,
			);
			assert.equal(calls, 1);
			assert.equal(sleeps, 0);
		});
});
test("repeated observed navigation transitions stay unknown and exhaust the original deadline", async () => {
	let at = 40,
		calls = 0;
	const page = {
		isClosed: () => false,
		mainFrame: () => ({ detached: false }),
		evaluate: async () => {
			calls++;
			throw Error(navigationMessage);
		},
	};
	await assert.rejects(
		browserModule.waitForAdmissionDom(page, {
			expectedPath: "/en/mfa",
			deadline: 100,
			now: () => at,
			sleep: async (ms) => {
				at += ms;
			},
		}),
		(error) => {
			assert.equal(error.lastDomSnapshot.documentReady, false);
			assert.equal(error.lastDomSnapshot.protectedContent, null);
			assert.equal(
				error.admissionObservation.navigationContextTransitions,
				calls,
			);
			assert.equal(at, 100);
			return true;
		},
	);
});

async function bufferedDocument(html) {
	const session = new EventEmitter();
	session.detach = async () => {};
	session.send = async (method) =>
		method === "Network.streamResourceContent"
			? { bufferedData: Buffer.from(html).toString("base64") }
			: {};
	const observation = await observeIngress(
		{ createCDPSession: async () => session },
		"http://localhost:1234",
		"first-document",
	);
	session.emit("Network.responseReceived", {
		requestId: "fixture",
		type: "Document",
		response: {
			url: "http://localhost:1234/en",
			status: 200,
			mimeType: "text/html",
			headers: {},
		},
	});
	await new Promise(setImmediate);
	observation.assertAvailable();
	return observation.snapshot()[0];
}

test("consecutive streamed React comments without content cannot block the real CDP observer", async () => {
	const worker = new Worker(
		`
		const {parentPort,workerData}=require('node:worker_threads');
		const {EventEmitter}=require('node:events');
		(async()=>{
			const {observeIngress}=await import(workerData.module);
			const session=new EventEmitter();session.detach=async()=>{};
			session.send=async(method)=>method==='Network.streamResourceContent'?{bufferedData:Buffer.from(workerData.html).toString('base64')}:{};
			const observation=await observeIngress({createCDPSession:async()=>session},'http://localhost:1234','first-document');
			parentPort.postMessage({ready:true});
			session.emit('Network.responseReceived',{requestId:'fixture',type:'Document',response:{url:'http://localhost:1234/en',status:200,mimeType:'text/html',headers:{}}});
			await new Promise(setImmediate);
			parentPort.postMessage({row:observation.snapshot()[0]});
		})().catch(()=>parentPort.postMessage({failed:true}));
	`,
		{
			eval: true,
			workerData: {
				module: new URL("./ingress-browser.mjs", import.meta.url).href,
				html: `<div>${"<!--x-->".repeat(29)}Upcoming Shifts</div>`,
			},
		},
	);
	let timer;
	try {
		const result = await new Promise((resolve, reject) => {
			worker.on("error", reject);
			worker.on("message", (message) => {
				if (message.ready)
					timer = setTimeout(() => resolve({ timedOut: true }), 1000);
				else {
					clearTimeout(timer);
					resolve(message);
				}
			});
		});
		assert.equal(
			result.timedOut,
			undefined,
			"258 bytes of valid comment markup stalled longer than one second",
		);
		assert.equal(result.row.usefulContentMs, null);
	} finally {
		clearTimeout(timer);
		await worker.terminate();
	}
});

test("markup with React comments around visible This Week remains content", async () => {
	const row = await bufferedDocument("<div><!--$-->This Week<!--/$--></div>");
	assert.equal(typeof row.usefulContentMs, "number");
});

for (const [kind, html] of [
	["script", '<script>const value="<div>This Week</div>";</script>'],
	["unfinished script", '<script>const value="<div>This Week</div>";'],
	["comment", "<!-- <div>This Week</div> -->"],
	["unfinished comment", "<!-- <div>This Week</div>"],
])
	test(`${kind} text cannot masquerade as visible content`, async () => {
		assert.equal((await bufferedDocument(html)).usefulContentMs, null);
	});
