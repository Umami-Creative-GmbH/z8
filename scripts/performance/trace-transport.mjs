/** Context transport including workers; bounded compiled-action semantics stay in RAM, never in evidence. */
import { createHash, randomBytes } from "node:crypto";
import { Agent, createServer, request as forward } from "node:http";
import { createProxyWireObserver } from "./proxy-wire-observer.mjs";
import { createActionResultObserver } from "./action-result-observer.mjs";
import { createProxyHeaderLifecycle } from "./proxy-header-census.mjs";

export const fixtureTraceTransport = "context-loopback-proxy-v1";
const loopback = (url) =>
	url.protocol === "http:" &&
	["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) &&
	!url.username &&
	!url.password;

/** Observe only: the caller retains its original pipe, chunks and backpressure. */
export function tapOwnedRequestBody(request, id, emit, observerError) {
	const observe=(method,...args)=>{try{emit(method,id,...args);}catch{observerError();}};
	request.on("data",chunk=>observe("requestBodyBytes",chunk));
	request.once("end",()=>observe("requestBodyEnd"));
	for(const kind of ["aborted","error","close"])request.on(kind,()=>observe("requestBodyFailure",kind));
}
export async function createFixtureTraceTransport({
	origin,
	getTraceId,
	allowedOrigins = [origin],
}) {
	const target = new URL(origin);
	if (!loopback(target) || target.origin !== origin)
		throw new Error("Fixture trace transport requires a loopback HTTP origin.");
	if (
		!Array.isArray(allowedOrigins) ||
		!allowedOrigins.includes(origin) ||
		allowedOrigins.some((value) => {
			const url = new URL(value);
			return !loopback(url) || url.origin !== value;
		})
	)
		throw new Error(
			"Trace transport requires an explicit owned loopback origin allowlist.",
		);
	const allowed = new Set(allowedOrigins);
	const agent = new Agent({ keepAlive: true, maxSockets: 64 });
	const wire = createProxyWireObserver();
	const application = createActionResultObserver();
	let controlObserver, controlObserverErrors = 0;
	const proxyInstanceId = randomBytes(16).toString("hex");
	let headerLifecycle=null;
	let upstreamRequests = 0, closedUpstreams = 0, serverClosed = false, controlLifetimeClosed = false;
	const finishControlLifetime = () => {
		if (!serverClosed || upstreamRequests !== closedUpstreams || controlLifetimeClosed) return;
		controlLifetimeClosed = true;
		headerLifecycle?.close();
		control("transportClosed",{serverClosed:true,acceptedRequests:counts.requests,upstreamRequests,closedUpstreams,pendingUpstreams:0});
	};
	const controlError = () => {
			controlObserverErrors++;
			headerLifecycle?.observerError();
			try { controlObserver?.observerError(); } catch {}
	};
	const control = (method, ...args) => {
		try { return controlObserver?.[method](...args); }
		catch { controlError(); }
	};
	const counts = {
		requests: 0,
		rewrittenRequests: 0,
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
		responseBodyBytes: 0,
		refusalReasons: {
			unexpectedLoopback: 0,
			nonLoopbackHttp: 0,
			loopbackConnect: 0,
			nonLoopbackConnect: 0,
			malformed: 0,
		},
	};
	const server = createServer((request, response) => {
		let wireId, applicationId, controlId, captureRequestShape=false;
		try {
			const traceId = getTraceId({
				headers: request.headers,
				method: request.method,
			});
			if (!/^[a-f0-9]{32}$/.test(traceId))
				throw new Error("Missing registered context identity");
			wireId = wire.request(
				{ traceId, headers: request.headers },
				performance.now(),
			);
			const url = new URL(request.url, origin);
			if (!loopback(url) || !allowed.has(url.origin)) {
				counts.refusedRequests++;
				counts.refusalReasons[
					loopback(url) ? "unexpectedLoopback" : "nonLoopbackHttp"
				]++;
				wire.end(wireId, { error: true }, performance.now());
				response.writeHead(403).end();
				return;
			}
			counts.requests++;
			applicationId = application.request({ traceId, method: request.method, headers: request.headers, applicationOrigin: url.origin === origin, compiledAsset: url.origin === origin && /^\/_next\/static\/chunks\/[\w./-]+\.js$/.test(url.pathname) });
			if (controlObserver && Number.isSafeInteger(applicationId) && applicationId > 0) {
				controlId = `${traceId}.${applicationId}`;
				headerLifecycle?.accepted(controlId,createHash("sha256").update(url.origin).digest("hex"));
				captureRequestShape=control("request", controlId, { traceId, url: url.href, method: request.method, headers: request.headers })===true;
			}
			else if (controlObserver) control("observerError");
			const headers = { ...request.headers };
			delete headers["proxy-connection"];
			delete headers["proxy-authorization"];
			if (url.origin === origin) {
				headers.traceparent = `00-${traceId}-${randomBytes(8).toString("hex")}-01`;
				counts.rewrittenRequests++;
			}
			let downstreamAborted = false, headersReceived = false,
				failureRecorded = false,
				upstream;
			const failed = (phase, error) => {
				application.abort(applicationId, "upstream-failure");
				if (!downstreamAborted && !failureRecorded) {
					control("failure", controlId);
					failureRecorded = true;
					counts.upstreamFailures++;
					counts[
						phase === "response"
							? "upstreamResponseErrors"
							: "upstreamConnectionErrors"
					]++;
					counts.upstreamReusedSocketErrors += Number(
						upstream?.reusedSocket === true,
					);
					counts[
						request.method === "GET"
							? "upstreamGetErrors"
							: request.method === "POST"
								? "upstreamPostErrors"
								: "upstreamOtherMethodErrors"
					]++;
					counts[
						error?.code === "ECONNRESET"
							? "upstreamResetErrors"
							: error?.code === "ECONNREFUSED"
								? "upstreamRefusedErrors"
								: "upstreamOtherErrors"
					]++;
				}
				wire.end(wireId, { error: true }, performance.now());
			};
			const canceled = () => {
				application.abort(applicationId, "downstream-cancellation");
				// Only an observed downstream abort/close may precede this classification.
				// A genuine upstream error already recorded is never relabeled or subtracted.
				if (!downstreamAborted && !failureRecorded) {
					control("cancel", controlId);
					downstreamAborted = true;
					counts.downstreamCancellations++;
				}
				wire.end(wireId, { error: true }, performance.now());
				upstream.destroy();
			};
			upstream = forward(
				url,
				{ method: request.method, headers, agent },
				(answer) => {
					headersReceived = true;
					if(controlId)headerLifecycle?.headersReceived(controlId);
					control("response", controlId, { status: answer.statusCode, headers: answer.headers });
					application.response(applicationId, { mimeType: answer.headers["content-type"], encoding: answer.headers["content-encoding"], status: answer.statusCode });
					wire.response(
						wireId,
						{
							mimeType: answer.headers["content-type"],
							status: answer.statusCode,
							redirect:
								answer.statusCode >= 300 &&
								answer.statusCode < 400 &&
								answer.headers.location !== undefined,
						},
						performance.now(),
					);
					answer.on("data", (chunk) => {
						control("bytes", controlId, chunk);
						application.bytes(applicationId, chunk);
						counts.responseBodyBytes += chunk.length;
						wire.bytes(wireId, chunk.length, performance.now());
					});
					answer.once("end", () => { wire.end(wireId, {}, performance.now()); application.end(applicationId); control("end", controlId); });
					answer.once("aborted", () => {
						failed("response");
						response.destroy();
					});
					answer.once("error", (error) => {
						failed("response", error);
						response.destroy();
					});
					let forwardedHeaders = answer.headers;
					if (controlId) {
						if (answer.headers["x-z8-fixture-response-id"] !== undefined) control("observerError");
						else forwardedHeaders = { ...answer.headers, "x-z8-fixture-response-id": controlId };
					}
					response.writeHead(answer.statusCode ?? 502, forwardedHeaders);
					// Upstream headers were observed synchronously before this actual forwarding call.
					if(controlId)headerLifecycle?.headersForwarded(controlId);
					answer.pipe(response);
				},
			);
			upstreamRequests++;
			if(controlId)headerLifecycle?.upstreamCreated(controlId);
			upstream.once("close",()=>{
				closedUpstreams++;
				if(controlId)headerLifecycle?.upstreamClosed(controlId);
				if (!headersReceived) control("upstreamClosedBeforeHeaders",controlId,{upstreamClosed:true,headersReceived:false});
				finishControlLifetime();
			});
			upstream.on("error", (error) => {
				failed("connection", error);
				if (!response.destroyed) {
					if (!response.headersSent) response.writeHead(502);
					response.end();
				}
			});
			request.on("aborted", canceled);
			response.on("close", () => {
				if (!response.writableEnded) canceled();
			});
			if(captureRequestShape){
				if(["requestBodyBytes","requestBodyEnd","requestBodyFailure"].every(key=>typeof controlObserver?.[key]==="function"))tapOwnedRequestBody(request,controlId,control,controlError);
				else controlError();
			}
			request.pipe(upstream);
		} catch {
			counts.refusedRequests++;
			counts.refusalReasons.malformed++;
			if (wireId !== undefined)
				wire.end(wireId, { error: true }, performance.now());
			response.writeHead(400).end();
		}
	});
	server.on("connect", (_request, socket) => {
		socket.on("error", () => {}); // Client cancellation must not crash the owning harness.
		counts.refusedRequests++;
		try {
			const destination = new URL(`https://${_request.url}`);
			counts.refusalReasons[
				["localhost", "127.0.0.1", "[::1]"].includes(destination.hostname)
					? "loopbackConnect"
					: "nonLoopbackConnect"
			]++;
		} catch {
			counts.refusalReasons.malformed++;
		}
		try {
			const traceId = getTraceId({
				headers: _request.headers,
				method: _request.method,
			});
			const id = wire.request(
				{ traceId, headers: _request.headers },
				performance.now(),
			);
			wire.end(id, { error: true }, performance.now());
		} catch {}
		socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
	});
	server.on("clientError", (_error, socket) => socket.destroy());
	server.requestTimeout = 0; // Streaming duration belongs to the existing journey deadline.
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	let closed = false;
	let initialization;
	const snapshot = () => ({
		...counts,
		refusalReasons: { ...counts.refusalReasons },
	});
	return {
		wire,
		controlHeaderCut:()=>headerLifecycle?.snapshot() ?? null,
		setControlCancellationObserver(observer,{captureHeaderPrefixes=false}={}) {
			if(typeof captureHeaderPrefixes!=="boolean")throw Error("Known proxy header-prefix scope is required.");

			if (controlObserver || counts.requests !== 0 ||
				!["installed", "request", "response", "bytes", "end", "cancel", "failure", "observerError", "upstreamClosedBeforeHeaders", "transportClosed"].every((key) => typeof observer?.[key] === "function"))
				throw Error("Protocol control observation requires one pre-request owned observer.");
			if(captureHeaderPrefixes)headerLifecycle=createProxyHeaderLifecycle({proxyInstanceId,originSha256:createHash("sha256").update(origin).digest("hex"),allowedOriginSha256:[...allowed].map(value=>createHash("sha256").update(value).digest("hex")).sort()});
			controlObserver = observer;
			const sha = value=>createHash("sha256").update(value).digest("hex");
			control("installed",{protocol:"owned-context-upstream-header-lifetime-v1",proxyInstanceId,originSha256:sha(origin),
				allowedOriginSha256:[...allowed].map(sha).sort(),acceptedRequestsAtInstall:counts.requests});
			return () => controlObserverErrors;
		},
		browserContextOptions: {
			proxyServer: `http://127.0.0.1:${server.address().port}`,
			proxyBypassList: ["<-loopback>"],
		},
		finishBrowserInitialization(evidence) {
			if (
				initialization ||
				evidence.complete !== true ||
				evidence.requests !== 0 ||
				evidence.responseBodyBytes !== 0
			)
				throw Error("Invalid or repeated empty browser initialization.");
			initialization = structuredClone(evidence);
			// Only completed pre-app initialization is reset; no app request may have started.
			wire.begin(performance.now());
		},
		snapshot: () => {
			const total = snapshot();
			if (!initialization) return { ...total, applicationEvidence: application.snapshot() };
			return {
				...total,
				applicationEvidence: application.snapshot(),
				browserInitialization: structuredClone(initialization),
				afterInitialization: Object.fromEntries(
					Object.entries(total).map(([key, value]) => [
						key,
						key === "refusalReasons"
							? Object.fromEntries(
									Object.entries(value).map(([reason, count]) => [
										reason,
										count - initialization.refusalReasons[reason],
									]),
								)
							: value - initialization[key],
					]),
				),
			};
		},
		async close() {
			if (closed) return;
			closed = true;
			agent.destroy();
			server.closeAllConnections();
			await new Promise((resolve) => server.close(resolve));
			serverClosed = true;
			finishControlLifetime();
		},
	};
}
