import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { gzipSync } from "node:zlib";
import test from "node:test";
import { createFixtureTraceTransport } from "./trace-transport.mjs";
import {
	createActionResultObserver,
	classifyRootActionResult,
} from "./action-result-observer.mjs";

const actionId = "a".repeat(40);
async function throughProxy(
	body,
	{
		gzip = false,
		script = true,
		action = actionId,
		status = 200,
		scriptPath = "/_next/static/chunks/compiled.js",
		method = "POST",
	} = {},
) {
	const bytes = gzip ? gzipSync(body) : Buffer.from(body);
	const backend = createServer((req, res) => {
		if (req.url === scriptPath)
			return res
				.writeHead(200, { "content-type": "application/javascript" })
				.end(
					`(0,r.createServerReference)("${actionId}",r.callServer,void 0,r.findSourceMapURL,"getWorkHoursAnalyticsData")`,
				);
		res.writeHead(status, {
			"content-type": "text/x-component",
			...(gzip ? { "content-encoding": "gzip" } : {}),
		});
		res.end(bytes);
	});
	await new Promise((done) => backend.listen(0, "127.0.0.1", done));
	const origin = `http://127.0.0.1:${backend.address().port}`;
	const transport = await createFixtureTraceTransport({
		origin,
		getTraceId: () => "b".repeat(32),
	});
	const proxy = new URL(transport.browserContextOptions.proxyServer);
	const send = (path, headers = {}) =>
		new Promise((done, reject) => {
			const call = request(
				{
					hostname: proxy.hostname,
					port: proxy.port,
					path: origin + path,
					method: path === "/read" ? method : "GET",
					headers,
				},
				(response) => {
					const chunks = [];
					response.on("data", (chunk) => chunks.push(chunk));
					response.on("end", () => done(Buffer.concat(chunks)));
					response.on("error", reject);
				},
			);
			call.on("error", reject);
			call.end();
		});
	try {
		if (script) await send(scriptPath);
		assert.deepEqual(
			await send("/read", method === "POST" ? { "next-action": action } : {}),
			bytes,
			"forwarded bytes remain exact",
		);
		await new Promise((done) => setImmediate(done));
		return transport.snapshot().applicationEvidence;
	} finally {
		await transport.close();
		backend.closeAllConnections();
		await new Promise((done) => backend.close(done));
	}
}

test("actual HTTP200 known action failure is observed through root Flight references and gzip without changing forwarding", async () => {
	const proof = await throughProxy(
		'0:{"a":"$@1"}\n1:{"success":false,"error":"PRIVATE SQL PERSON","code":"DatabaseError"}\n',
		{ gzip: true },
	);
	assert.equal(proof.failures, 1);
	assert.equal(proof.contracts.getWorkHoursAnalyticsData.observed, 1);
	assert.equal(proof.pending, 0);
	assert.equal(/PRIVATE|PERSON|SQL|a{40}/.test(JSON.stringify(proof)), false);
});

test("root success ignores nested domain false and unmapped actions remain explicitly out of scope", async () => {
	const body =
		'0:{"a":"$@1"}\n1:{"success":true,"data":{"success":false,"error":"legitimate domain state"}}\n';
	const known = await throughProxy(body);
	assert.equal(known.successes, 1);
	assert.equal(known.failures, 0);
	assert.equal(known.complete, true);
	const unrelated = await throughProxy(
		'0:{"a":"$@1"}\n1:{"success":false,"error":"domain"}\n',
		{ action: "c".repeat(40) },
	);
	assert.equal(unrelated.failures, 0);
	assert.equal(unrelated.outOfScope, 1);
	assert.deepEqual(unrelated.contracts, {});
	const missingMapping = await throughProxy(body, { script: false });
	assert.equal(missingMapping.outOfScope, 1);
	assert.deepEqual(missingMapping.mappedContracts, []);
});

test("only linked root result or explicit Flight error is classified; raw text and malformed references stay safe", () => {
	const parse = (text, known = true) =>
		classifyRootActionResult(Buffer.from(text), known);
	assert.equal(
		parse('0:{"a":"$@1"}\n1:"$2"\n2:{"success":false,"error":"failure"}\n')
			.outcome,
		"application-failure",
	);
	assert.equal(parse('0:{"a":"$@1"}\n1:"$1"\n').outcome, "unknown");
	assert.equal(parse('0:{"a":"$@1"}\n').outcome, "unknown");
	assert.equal(
		parse('0:{"a":"$@1"}\n1:E{"digest":"private"}\n', false).outcome,
		"server-error",
	);
	assert.equal(
		parse(':HL["/technical.js","script"]\n0:{"a":"$@1"}\n1:{"success":true}\n')
			.outcome,
		"success",
	);
	assert.equal(
		parse(':HLnot-json\n0:{"a":"$@1"}\n1:{"success":true}\n').outcome,
		"unknown",
	);
	const fake = '9:E{"digest":"domain text"}\n';
	assert.equal(
		parse(
			`3:T${Buffer.byteLength(fake).toString(16)},${fake}0:{"a":"$@1"}\n1:{"success":true}\n`,
		).outcome,
		"success",
	);
});

test("unknown completed known contract and genuine Flight server errors remain rejecting observations", async () => {
	const unknown = await throughProxy('0:{"a":"$@1"}\n');
	assert.equal(unknown.unknown, 1);
	assert.equal(unknown.complete, false);
	const error = await throughProxy('0:{"a":"$@1"}\n1:E{"digest":"PRIVATE"}\n');
	assert.equal(error.serverErrors, 1);
	assert.equal(error.complete, true);
	assert.equal(JSON.stringify(error).includes("PRIVATE"), false);
	const malformed = await throughProxy('0:{"a":"$@1"}\n1:{"success":true}\n', {
		action: "not-an-action-id",
	});
	assert.equal(malformed.unknown, 1);
	assert.equal(malformed.complete, false);
});

test("HTTP failures remain failures and uploaded JavaScript cannot declare a known action contract", async () => {
	const failed = await throughProxy('0:{"a":"$@1"}\n1:{"success":true}\n', {
		status: 500,
	});
	assert.equal(failed.httpErrors, 1);
	assert.equal(failed.contracts.getWorkHoursAnalyticsData.httpErrors, 1);
	const untrusted = await throughProxy(
		'0:{"a":"$@1"}\n1:{"success":false,"error":"domain"}\n',
		{ scriptPath: "/uploads/untrusted.js" },
	);
	assert.deepEqual(untrusted.mappedContracts, []);
	assert.equal(untrusted.outOfScope, 1);
	assert.equal(untrusted.failures, 0);
});

test("actual RSC GET errors are explicit server failures while unrelated root models stay out of scope", async () => {
	const failed = await throughProxy(
		'0:["technical-model"]\n1:E{"digest":"PRIVATE"}\n',
		{ method: "GET" },
	);
	assert.equal(failed.serverErrors, 1);
	assert.equal(failed.observed, 1);
	const ordinary = await throughProxy(
		'0:["model",{"success":false,"error":"domain state"}]\n',
		{ method: "GET" },
	);
	assert.equal(ordinary.failures, 0);
	assert.equal(ordinary.outOfScope, 1);
});

test("pending aborted and bounded compressed/decompressed observations never become a zero error proof", async () => {
	for (const mode of ["pending", "aborted", "encoded", "decoded"]) {
		const observer = createActionResultObserver(
			mode === "encoded"
				? { encodedLimit: 8 }
				: mode === "decoded"
					? { decodedLimit: 8 }
					: {},
		);
		const id = observer.request({
			traceId: "d".repeat(32),
			method: "POST",
			headers: { "next-action": actionId },
			applicationOrigin: true,
		});
		observer.response(id, {
			status: 200,
			mimeType: "text/x-component",
			encoding: mode === "decoded" ? "gzip" : "identity",
		});
		if (mode === "aborted") observer.abort(id);
		else if (mode !== "pending") {
			observer.bytes(
				id,
				mode === "decoded"
					? gzipSync("x".repeat(500))
					: Buffer.from("x".repeat(100)),
			);
			observer.end(id);
		}
		await new Promise((done) => setImmediate(done));
		assert.equal(observer.snapshot().complete, false, mode);
		assert.ok(
			observer.snapshot().pending > 0 ||
				observer.snapshot().unknown > 0 ||
				observer.snapshot().overflows > 0,
		);
	}
});
