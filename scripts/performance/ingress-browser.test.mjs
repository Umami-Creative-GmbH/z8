import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import { Worker } from "node:worker_threads";
import { observeIngress } from "./ingress-browser.mjs";

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
