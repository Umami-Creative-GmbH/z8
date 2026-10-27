import { createHash } from "node:crypto";
import { EventEmitter } from "node:events";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { connect } from "node:net";
import test from "node:test";
import { gzipSync } from "node:zlib";
import { tapOwnedRequestBody, createFixtureTraceTransport } from "./trace-transport.mjs";

const pause = (ms) => new Promise((done) => setTimeout(done, ms));

test("a genuine reset on a reused GET socket stays a forwarding failure before any client cancellation", async () => {
	let requests = 0;
	const backend = createServer((req, res) => {
		if (++requests === 1) res.end("complete");
		else req.socket.destroy();
	});
	await new Promise((done) => backend.listen(0, "127.0.0.1", done));
	const origin = `http://127.0.0.1:${backend.address().port}`;
	const transport = await createFixtureTraceTransport({
		origin,
		getTraceId: () => "a".repeat(32),
	});
	try {
		transport.wire.begin(performance.now());
		const proxy = new URL(transport.browserContextOptions.proxyServer);
		const send = () =>
			new Promise((done, reject) => {
				const call = request(
					{
						hostname: proxy.hostname,
						port: proxy.port,
						path: `${origin}/chunk.js`,
						headers: { connection: "keep-alive" },
					},
					(answer) => {
						answer.resume();
						answer.once("end", () => done(answer.statusCode));
					},
				);
				call.on("error", reject);
				call.end();
			});
		assert.equal(await send(), 200);
		await pause(0);
		assert.equal(await send(), 502);
		const counts = transport.snapshot();
		assert.equal(counts.upstreamFailures, 1);
		assert.equal(counts.upstreamConnectionErrors, 1);
		assert.equal(counts.upstreamReusedSocketErrors, 1);
		assert.equal(counts.upstreamGetErrors, 1);
		assert.equal(counts.upstreamResetErrors, 1);
		assert.equal(counts.downstreamCancellations, 0);
		transport.wire.ready(performance.now());
		assert.equal(
			transport.wire.state(performance.now() + 1001).complete,
			false,
		);
	} finally {
		await transport.close();
		backend.closeAllConnections();
		await new Promise((done) => backend.close(done));
	}
});

test("client cancels an incomplete upload without creating a forwarding failure; finite wire cost stays censored", async () => {
	let received;
	const first = new Promise((done) => {
		received = done;
	});
	const backend = createServer((req, res) => {
		req.on("error", () => {});
		req.once("data", received);
		req.on("aborted", () => res.destroy());
	});
	await new Promise((done) => backend.listen(0, "127.0.0.1", done));
	const origin = `http://127.0.0.1:${backend.address().port}`;
	const transport = await createFixtureTraceTransport({
		origin,
		getTraceId: () => "a".repeat(32),
	});
	try {
		transport.wire.begin(performance.now());
		const proxy = new URL(transport.browserContextOptions.proxyServer);
		const call = request({
			hostname: proxy.hostname,
			port: proxy.port,
			path: `${origin}/upload`,
			method: "POST",
		});
		call.on("error", () => {});
		call.write("incomplete");
		await first;
		call.destroy();
		await pause(100);
		assert.equal(transport.snapshot().upstreamFailures, 0);
		assert.equal(transport.snapshot().downstreamCancellations, 1);
		transport.wire.ready(performance.now());
		const wire = transport.wire.state(performance.now() + 1001);
		assert.equal(wire.mandatoryErrors, 1);
		assert.equal(wire.complete, false);
	} finally {
		await transport.close();
		backend.closeAllConnections();
		await new Promise((done) => backend.close(done));
	}
});

for (const cause of ["client", "upstream"])
	test(`${cause} cancels a streamed response with distinct numerical causality`, {
		timeout: 3000,
	}, async () => {
		let first, call;
		const firstChunk = new Promise((done) => {
			first = done;
		});
		const backend = createServer((_req, res) => {
			res.writeHead(200, { "content-type": "application/javascript" });
			res.write("first");
			if (cause === "upstream") setTimeout(() => res.destroy(), 25);
		});
		await new Promise((done) => backend.listen(0, "127.0.0.1", done));
		const origin = `http://127.0.0.1:${backend.address().port}`;
		const transport = await createFixtureTraceTransport({
			origin,
			getTraceId: () => "a".repeat(32),
		});
		try {
			transport.wire.begin(performance.now());
			const proxy = new URL(transport.browserContextOptions.proxyServer);
			call = request(
				{
					hostname: proxy.hostname,
					port: proxy.port,
					path: `${origin}/chunk.js`,
				},
				(answer) => {
					answer.on("error", () => {});
					answer.once("data", first);
				},
			);
			call.on("error", () => {});
			call.end();
			await firstChunk;
			if (cause === "client") call.destroy();
			await pause(100);
			assert.equal(
				transport.snapshot().upstreamFailures,
				cause === "upstream" ? 1 : 0,
			);
			assert.equal(
				transport.snapshot().downstreamCancellations,
				cause === "client" ? 1 : 0,
			);
			transport.wire.ready(performance.now());
			const wire = transport.wire.state(performance.now() + 1001);
			assert.equal(wire.groups.javascript.errors, 1);
			assert.equal(wire.complete, false);
		} finally {
			call?.destroy();
			await transport.close();
			backend.closeAllConnections();
			await new Promise((done) => backend.close(done));
		}
	});

test("context transport preserves streaming, cookies, bodies and phase identity without retaining payloads", async () => {
	let firstChunk;
	const first = new Promise((resolve) => {
		firstChunk = resolve;
	});
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	let seen;
	const backend = createServer(async (req, res) => {
		const chunks = [];
		for await (const chunk of req) chunks.push(chunk);
		seen = {
			parent: req.headers.traceparent,
			cookie: req.headers.cookie,
			body: Buffer.concat(chunks).toString(),
		};
		res.setHeader("Content-Type", "text/x-component");
		res.setHeader("Set-Cookie", "fixture-preserved=1; HttpOnly");
		res.write("first");
		await gate;
		res.end("second");
	});
	await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${backend.address().port}`;
	let traceId = "a".repeat(32);
	const transport = await createFixtureTraceTransport({
		origin,
		getTraceId: () => traceId,
	});
	try {
		transport.wire.begin(performance.now());
		traceId = "b".repeat(32);
		const proxy = new URL(transport.browserContextOptions.proxyServer);
		const done = new Promise((resolve, reject) => {
			const call = request(
				{
					hostname: proxy.hostname,
					port: proxy.port,
					path: `${origin}/stream`,
					method: "POST",
					headers: { cookie: "PRIVATE_COOKIE_CANARY" },
				},
				(answer) => {
					const chunks = [];
					assert.equal(answer.headers["content-type"], "text/x-component");
					assert.deepEqual(answer.headers["set-cookie"], [
						"fixture-preserved=1; HttpOnly",
					]);
					answer.on("data", (chunk) => {
						chunks.push(chunk);
						firstChunk();
					});
					answer.on("end", () => resolve(Buffer.concat(chunks).toString()));
				},
			);
			call.once("error", reject);
			call.end("PRIVATE_BODY_CANARY");
		});
		await first;
		transport.wire.ready(performance.now());
		assert.equal(
			transport.wire.state(performance.now() + 2000).complete,
			false,
			"A live finite response cannot settle before its last chunk",
		);
		assert.equal(seen.cookie, "PRIVATE_COOKIE_CANARY");
		assert.equal(seen.body, "PRIVATE_BODY_CANARY");
		assert.ok(seen.parent.startsWith(`00-${traceId}-`));
		release();
		assert.equal(await done, "firstsecond");
		const { applicationEvidence, ...transportCounts } = transport.snapshot();
		assert.equal(applicationEvidence.complete, true);
		assert.equal(applicationEvidence.outOfScope, 1);
		assert.equal(applicationEvidence.failures, 0);
		assert.deepEqual(transportCounts, {
			requests: 1,
			rewrittenRequests: 1,
			refusedRequests: 0,
			upstreamFailures: 0,
			downstreamCancellations: 0,
			upstreamConnectionErrors: 0,
			upstreamResponseErrors: 0,
			upstreamReusedSocketErrors: 0,
			upstreamGetErrors: 0,
			upstreamPostErrors: 0,
			upstreamOtherMethodErrors: 0,
			upstreamResetErrors: 0,
			upstreamRefusedErrors: 0,
			upstreamOtherErrors: 0,
			responseBodyBytes: 11,
			refusalReasons: {
				unexpectedLoopback: 0,
				nonLoopbackHttp: 0,
				loopbackConnect: 0,
				nonLoopbackConnect: 0,
				malformed: 0,
			},
		});
		const wire = transport.wire.state(performance.now() + 1001);
		assert.equal(wire.complete, true);
		assert.equal(wire.bytes.rsc, 11);
		assert.equal(wire.groups.rsc.observedBodyBytes, 11);
		assert.equal(wire.byTrace[0].traceId, traceId);
		assert.doesNotMatch(
			JSON.stringify(transport.snapshot()),
			/PRIVATE_|127\.0\.0\.1/,
		);
	} finally {
		release();
		await transport.close();
		backend.closeAllConnections();
		await new Promise((resolve) => backend.close(resolve));
	}
});

test("proxy wire oracle preserves gzip and counts encoded body bytes without HTTP headers", async () => {
	const plain = Buffer.from("const fixture = 1;\n".repeat(1000));
	const encoded = gzipSync(plain);
	const backend = createServer((_request, response) => {
		response.writeHead(200, {
			"Content-Type": "application/javascript",
			"Content-Encoding": "gzip",
			"Content-Length": encoded.length,
		});
		response.end(encoded);
	});
	await new Promise((resolve) => backend.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${backend.address().port}`;
	const transport = await createFixtureTraceTransport({
		origin,
		getTraceId: () => "a".repeat(32),
	});
	try {
		transport.wire.begin(performance.now());
		const proxy = new URL(transport.browserContextOptions.proxyServer);
		const actual = await new Promise((resolve, reject) => {
			const call = request(
				{
					hostname: proxy.hostname,
					port: proxy.port,
					path: `${origin}/chunk.js`,
				},
				(response) => {
					assert.equal(response.headers["content-encoding"], "gzip");
					const chunks = [];
					response.on("data", (chunk) => chunks.push(chunk));
					response.on("end", () => resolve(Buffer.concat(chunks)));
				},
			);
			call.on("error", reject);
			call.end();
		});
		assert.deepEqual(actual, encoded);
		transport.wire.ready(performance.now());
		const state = transport.wire.state(performance.now() + 1001);
		assert.equal(state.complete, true);
		assert.equal(state.bytes.javascript, encoded.length);
		assert.ok(state.bytes.javascript < plain.length);
		assert.equal(transport.snapshot().responseBodyBytes, encoded.length);
	} finally {
		await transport.close();
		backend.closeAllConnections();
		await new Promise((resolve) => backend.close(resolve));
	}
});

test("unexpected loopback origins are refused before forwarding and explicit owned storage stays measured", async () => {
	let unownedRequests = 0,
		storageTrace;
	const app = createServer((_req, res) => res.end("app"));
	const unowned = createServer((_req, res) => {
		unownedRequests++;
		res.end("unowned");
	});
	const storage = createServer((req, res) => {
		storageTrace = req.headers.traceparent;
		res.end("store");
	});
	for (const server of [app, unowned, storage])
		await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const origin = `http://127.0.0.1:${app.address().port}`,
		other = `http://127.0.0.1:${unowned.address().port}`,
		owned = `http://127.0.0.1:${storage.address().port}`;
	const transport = await createFixtureTraceTransport({
		origin,
		getTraceId: () => "a".repeat(32),
		allowedOrigins: [origin, owned],
	});
	try {
		transport.wire.begin(performance.now());
		const proxy = new URL(transport.browserContextOptions.proxyServer);
		const send = (url) =>
			new Promise((resolve, reject) => {
				const call = request(
					{ hostname: proxy.hostname, port: proxy.port, path: url },
					(answer) => {
						answer.resume();
						answer.on("end", () => resolve(answer.statusCode));
					},
				);
				call.on("error", reject);
				call.end();
			});
		assert.equal(await send(other), 403);
		assert.equal(unownedRequests, 0);
		assert.equal(await send(owned), 200);
		assert.equal(
			storageTrace,
			undefined,
			"Additional owned origins do not receive the application trace header",
		);
		transport.wire.ready(performance.now());
		const state = transport.wire.state(performance.now() + 1001);
		assert.equal(state.complete, false);
		assert.equal(state.mandatoryErrors, 1);
		assert.equal(state.bytes.otherFinite, 5);
		assert.equal(transport.snapshot().refusedRequests, 1);
		assert.equal(transport.snapshot().refusalReasons.unexpectedLoopback, 1);
	} finally {
		await transport.close();
		for (const server of [app, unowned, storage]) {
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
		}
	}
});

test("CONNECT refusal contains client aborts and keeps numeric reason evidence", async () => {
	const transport = await createFixtureTraceTransport({
		origin: "http://127.0.0.1:1",
		getTraceId: () => "a".repeat(32),
	});
	try {
		transport.wire.begin(performance.now());
		const proxy = new URL(transport.browserContextOptions.proxyServer);
		for (const authority of ["127.0.0.1:2", "example.invalid:443"]) {
			await new Promise((resolve, reject) => {
				const socket = connect(Number(proxy.port), proxy.hostname, () =>
					socket.write(
						`CONNECT ${authority} HTTP/1.1\r\nHost: ${authority}\r\n\r\n`,
					),
				);
				socket.on("error", reject);
				socket.once("data", () => {
					socket.destroy();
					resolve();
				});
			});
		}
		assert.equal(transport.snapshot().refusalReasons.loopbackConnect, 1);
		assert.equal(transport.snapshot().refusalReasons.nonLoopbackConnect, 1);
		assert.equal(transport.snapshot().refusedRequests, 2);
		assert.equal(
			transport.wire.state(performance.now() + 1001).mandatoryErrors,
			2,
		);
	} finally {
		await transport.close();
	}
});


test("request-shape tap observes the original chunks and actual end without taking over forwarding",()=>{
 const request=new EventEmitter(),calls=[],chunks=[Buffer.from("first"),Buffer.from("second")];let forwardingCalls=0;
 for(const name of ["read","resume","setEncoding","pause"])request[name]=()=>{throw Error("No stream control");};
 request.pipe=destination=>{forwardingCalls++;for(const chunk of chunks){request.emit("data",chunk);destination.write(chunk);}request.emit("end");destination.end();return destination;};
 tapOwnedRequestBody(request,"technical.1",(method,id,value)=>calls.push({method,id,value}),()=>assert.fail("unexpected observer exception"));
 const received=[],destination={write:chunk=>received.push(chunk),end:()=>{}};assert.equal(request.pipe(destination),destination);
 assert.equal(forwardingCalls,1);assert.equal(received[0],chunks[0]);assert.equal(received[1],chunks[1]);
 assert.deepEqual(calls.map(row=>row.method),["requestBodyBytes","requestBodyBytes","requestBodyEnd"]);assert.equal(calls[0].value,chunks[0]);
 request.emit("close");assert.equal(calls.at(-1).value,"close");assert.equal(calls.at(-1).method,"requestBodyFailure");
});

test("request-shape tap contains callback exceptions and records safe failure enums",()=>{
 const request=new EventEmitter(),events=[];let errors=0;
 tapOwnedRequestBody(request,"technical.2",(method,id,value)=>{events.push({method,id,value});if(method==="requestBodyBytes")throw Error("PRIVATE");},()=>{errors++;});
 assert.doesNotThrow(()=>request.emit("data",Buffer.from("PRIVATE_BYTES")));request.emit("aborted");request.emit("error",Error("PRIVATE_ERROR"));request.emit("close");
 assert.equal(errors,1);assert.deepEqual(events.slice(1).map(row=>row.value),["aborted","error","close"]);
 assert.equal(events.every(row=>row.id==="technical.2"),true);
});


// Root owns this socket test; agent-only verification selects the two mock cases above.
test("request-shape tap real loopback forwarding stays byte header and status equivalent",{timeout:5000},async()=>{
 const bodies=[],upload=Buffer.from('[{"synthetic":"é"}]');let headersSeen,observedEnd=0,observerErrors=0,throwObserver=false;
 const backend=createServer((req,res)=>{const chunks=[];headersSeen=req.headers;req.on("data",chunk=>chunks.push(chunk));req.on("end",()=>{bodies.push(Buffer.concat(chunks));res.writeHead(201,{"content-type":"text/plain","x-technical-test":"preserved"});res.end("complete");});});
 await new Promise(done=>backend.listen(0,"127.0.0.1",done));const origin='http://127.0.0.1:'+backend.address().port,transport=await createFixtureTraceTransport({origin,getTraceId:()=>"a".repeat(32)}),captured=[];
 const observer={installed(){},request(){return true;},response(){},bytes(){},end(){},cancel(){},failure(){},upstreamClosedBeforeHeaders(){},transportClosed(){},observerError(){observerErrors++;},
  requestBodyBytes(id,chunk){captured.push(Buffer.from(chunk));if(throwObserver)throw Error("synthetic observer failure");},requestBodyEnd(){observedEnd++;},requestBodyFailure(){}};
 const errors=transport.setControlCancellationObserver(observer);
 try{
  const proxy=new URL(transport.browserContextOptions.proxyServer);
  const send=()=>new Promise((done,reject)=>{const call=request({hostname:proxy.hostname,port:proxy.port,path:origin+'/upload',method:"POST",headers:{host:new URL(origin).host,origin,"content-type":"text/plain;charset=UTF-8","next-action":"synthetic"}},res=>{const chunks=[];res.on("data",chunk=>chunks.push(chunk));res.on("end",()=>done({status:res.statusCode,header:res.headers['x-technical-test'],bytes:Buffer.concat(chunks)}));});call.on("error",reject);call.write(upload.subarray(0,5));call.end(upload.subarray(5));});
  const first=await send();assert.equal(first.status,201);assert.equal(first.header,"preserved");assert.equal(first.bytes.toString(),"complete");assert.deepEqual(bodies[0],upload);assert.equal(headersSeen.host,new URL(origin).host);assert.equal(headersSeen.origin,origin);assert.equal(headersSeen['content-type'],"text/plain;charset=UTF-8");assert.equal(observedEnd,1);assert.equal(createHash("sha256").update(Buffer.concat(captured)).digest("hex"),createHash("sha256").update(upload).digest("hex"));assert.equal(errors(),0);
  throwObserver=true;const second=await send();assert.equal(second.status,201);assert.deepEqual(bodies[1],upload);assert.equal(observedEnd,2);assert.ok(errors()>0);assert.ok(observerErrors>0);
 }finally{await transport.close();backend.closeAllConnections();await new Promise(done=>backend.close(done));}
});
