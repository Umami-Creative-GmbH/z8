import assert from "node:assert/strict";
import test from "node:test";
import { createActionResultObserver } from "./action-result-observer.mjs";
import { testBrowserEvidence } from "./control-cancellation-test-fixtures.mjs";
import {
	inspectRequiredFlightBody,
	classifyControlCancellations,
	chromiumSWRRevision,
	cleanBrowserFailureEvidence,
} from "./control-cancellation-evidence.mjs";

test("closed Flight iterable and readable rows fulfill repeated values without accepting an unfinished stream", () => {
	for (const tag of ["X", "x", "R"]) {
		const body = `0:{"a":"$1"}\n1:${tag}\n1:{"value":"$2"}\n2:null\n1:C\n`;
		assert.equal(
			inspectRequiredFlightBody(Buffer.from(body), { action: true }).complete,
			true,
			tag,
		);
		for (const invalid of [
			body.replace("1:C\n", ""),
			body + "1:null\n",
			body + "1:C\n",
			body.replace("1:C\n", "1:X\n1:C\n"),
			body.replace("2:null\n", ""),
			body.replace("1:C\n", '1:E{"digest":"private"}\n'),
		])
			assert.equal(
				inspectRequiredFlightBody(Buffer.from(invalid), { action: true })
					.complete,
				false,
			);
	}
	assert.equal(
		inspectRequiredFlightBody(Buffer.from('0:{"a":null}\n0:{"a":null}\n'), {
			action: true,
		}).complete,
		false,
	);
});

test("stream text stays opaque, iterable final values resolve, and unsupported tags expose only technical offsets", () => {
	const text = '$dead\\n1:E{"private":"not a row"}';
	const body = `0:{"a":"$1"}\n1:X\n1:T${Buffer.byteLength(text).toString(16)},${text}1:C"$2"\n2:null\n`;
	assert.equal(
		inspectRequiredFlightBody(Buffer.from(body), { action: true }).complete,
		true,
	);
	assert.equal(
		inspectRequiredFlightBody(Buffer.from(body.replace("2:null\n", "")), {
			action: true,
		}).complete,
		false,
	);
	assert.equal(
		inspectRequiredFlightBody(Buffer.from('0:{"a":"$1"}\n1:r\n1:C\n'), {
			action: true,
		}).complete,
		true,
	);
	assert.equal(
		inspectRequiredFlightBody(
			Buffer.from('0:{"a":"$1"}\n1:r\n1:"bytes"\n1:C\n'),
			{ action: true },
		).complete,
		false,
	);
	assert.equal(
		inspectRequiredFlightBody(
			Buffer.from('0:{"a":null}\n0:E{"digest":"private"}\n'),
			{ action: true },
		).reason,
		"flight-server-error",
	);
	const unsupported = inspectRequiredFlightBody(
		Buffer.from('0:{"a":null}\n1:Z{"private":"payload"}\n'),
		{ action: true },
	);
	assert.deepEqual(unsupported, {
		complete: false,
		reason: "unsupported-record",
		tagByte: 90,
		recordOffset: 13,
	});
	assert.doesNotMatch(JSON.stringify(unsupported), /payload|private/);
});

test("a complete marked Flight representation proves its required payload without retaining values", () => {
	const proof = inspectRequiredFlightBody(
		Buffer.from('#0:{"b":"build","t":{"t":{"s":""}},"l":0,"a":0}\n'),
	);
	assert.equal(proof.complete, true);
	assert.equal(proof.marker, "complete");
	assert.equal(proof.requiredStage, "full");
	assert.equal(proof.serverErrors, 0);
	assert.doesNotMatch(JSON.stringify(proof), /"build"|"f"/);
});

test("partial boundaries resolve promise rows after the byte boundary; pending/unsupported/error data stay unknown", () => {
	const body = '~0:{"b":"b","t":{"t":{"s":""}},"l":"$@1"}\n1:41\n';
	assert.equal(
		inspectRequiredFlightBody(Buffer.from(body)).requiredStage,
		"static",
	);
	for (const value of [
		body.replace("1:41", "1:9999"),
		body.replace("1:41\n", ""),
		body.replace("1:41", "1:-1"),
		'#0:{"b":"b","t":{"t":{"s":""}}}\n1:E{"digest":"secret"}\n',
		'##0:{"b":"b","t":{"t":{"s":""}}}\n',
	])
		assert.equal(inspectRequiredFlightBody(Buffer.from(value)).complete, false);
});

function cancellationFixture() {
	const identity = {
		contextId: "context",
		fullUrlSha256: "a".repeat(64),
		requestHeadersSha256: "b".repeat(64),
		documentGeneration: "context:2",
		method: "GET",
		requestKind: "navigation",
	};
	const failure = {
		...identity,
		requestId: "background",
		loaderId: "loader",
		error: "net::ERR_ABORTED",
		canceled: true,
		status: 200,
		proxyResponseId: "proxy-2",
		action: false,
		prefetch: true,
		type: "Other",
		initiator: "other",
		initiatorStackKnownAbsent: true,
		priority: "VeryLow",
		startedAt: 20,
	};
	const foreground = {
		...identity,
		requestId: "foreground",
		loaderId: "loader",
		fromDiskCache: true,
		fromServiceWorker: false,
		status: 200,
		loadingFinished: true,
		failed: false,
		finishedAt: 10,
		action: false,
		flight: true,
		staleWhileRevalidateSeconds: 100,
		bodyReadbackComplete: true,
		bodyProof: inspectRequiredFlightBody(
			Buffer.from('#0:{"b":"build","t":{"t":{"s":""}}}\n'),
		),
	};
	const packet = {
		...identity,
		id: "proxy-2",
		status: 200,
		action: false,
		upstreamError: false,
		canceled: true,
		complete: false,
		flight: true,
		staleWhileRevalidateSeconds: 100,
	};
	return {
		failures: [failure],
		responses: [foreground],
		proxy: [packet],
		browserRevision: chromiumSWRRevision,
		coverage: {
			installed: true,
			scopeClosed: true,
			missing: 0,
			overflow: 0,
			errors: 0,
			pendingBodies: 0,
		},
	};
}

test("prototype cache evidence stays unknown without semantic Vary and stable principal proof", () => {
	const proof = classifyControlCancellations(cancellationFixture());
	assert.equal(proof.complete, true);
	assert.equal(proof.rawFailedRequests, 1);
	assert.equal(proof.provenControls, 0);
	assert.equal(proof.realFailures, 0);
	assert.equal(proof.unknownFailures, 1);
});

test("cache shape, aborted/prefetch labels or ambiguous identity alone cannot exempt a failure", () => {
	for (const change of [
		(v) => {
			v.responses[0].bodyReadbackComplete = false;
		},
		(v) => {
			v.responses[0].bodyProof.complete = false;
		},
		(v) => {
			v.responses.push({ ...v.responses[0], requestId: "another" });
		},
		(v) => {
			v.proxy.push({ ...v.proxy[0] });
		},
		(v) => {
			v.proxy[0].id = "wrong";
		},
		(v) => {
			v.responses[0].documentGeneration = "other";
		},
		(v) => {
			v.browserRevision = "other";
		},
		(v) => {
			v.failures[0].action = true;
		},
		(v) => {
			v.responses[0].bodyProof.isPartial = true;
		},
		(v) => {
			v.responses[0].bodyProof.requiredStage = "route-tree-structure";
		},
	]) {
		const value = cancellationFixture();
		change(value);
		const proof = classifyControlCancellations(value);
		assert.equal(proof.provenControls, 0);
		assert.equal(proof.unknownFailures, 1);
	}
});

test("real browser and HTTP errors remain real and incomplete observer coverage never passes", () => {
	for (const change of [
		(v) => {
			v.failures[0].status = 500;
		},
		(v) => {
			v.failures[0].error = "net::ERR_CONNECTION_RESET";
		},
		(v) => {
			v.proxy[0].upstreamError = true;
		},
		(v) => {
			v.proxy[0].status = 500;
		},
	]) {
		const value = cancellationFixture();
		change(value);
		assert.equal(classifyControlCancellations(value).realFailures, 1);
	}
	for (const field of ["missing", "overflow", "errors", "pendingBodies"]) {
		const value = cancellationFixture();
		value.coverage[field] = 1;
		assert.equal(classifyControlCancellations(value).complete, false);
	}
});

test("unnamed POST late termination needs exact complete browser/proxy bodies and rejects explicit root failure", () => {
	for (const failureBody of [false, true]) {
		const value = cancellationFixture();
		const body = Buffer.from(
			`0:{"b":"b","a":"$@1"}\n1:${failureBody ? '{"success":false,"error":"PRIVATE"}' : '{"unrelated":42}'}\n`,
		);
		const proof = inspectRequiredFlightBody(body, { action: true });
		Object.assign(value.failures[0], {
			method: "POST",
			requestKind: "action",
			action: true,
			bodyProof: proof,
			bodyReadbackComplete: true,
		});
		Object.assign(value.proxy[0], {
			method: "POST",
			requestKind: "action",
			action: true,
			bodyProof: proof,
			complete: true,
			canceled: false,
		});
		const result = classifyControlCancellations(value);
		assert.equal(result.provenControls, failureBody ? 0 : 1);
		if (failureBody) assert.equal(result.realFailures, 1);
		if (!failureBody) {
			value.proxy[0].bodyProof = { ...proof, bodySha256: "d".repeat(64) };
			assert.equal(classifyControlCancellations(value).provenControls, 0);
		}
		assert.doesNotMatch(JSON.stringify(proof), /PRIVATE|unrelated|42/);
	}
});

test("cached HTTP completion cannot hide unresolved required Flight dependencies", () => {
	const proof = inspectRequiredFlightBody(
		Buffer.from('#0:{"b":"build","t":{"t":{"s":"$@4"}}}\n'),
	);
	assert.equal(proof.complete, false);
	assert.equal(proof.reason, "unresolved-model-reference");
});

test("outlined Map Set and array iterator dependencies require their actual typed backing rows", () => {
	for (const [prefix, model] of [
		["Q", '[["key","$2"]]'],
		["W", '["$2"]'],
		["i", '["$2"]'],
	]) {
		const body = `0:{"a":{"value":"$${prefix}1"}}\n1:${model}\n2:null\n`;
		assert.equal(
			inspectRequiredFlightBody(Buffer.from(body), { action: true }).complete,
			true,
			prefix,
		);
		for (const invalid of [
			body.replace("2:null\n", ""),
			body.replace(`1:${model}`, "1:{}"),
			body.replace("$2", "$dead"),
		])
			assert.equal(
				inspectRequiredFlightBody(Buffer.from(invalid), { action: true })
					.complete,
				false,
			);
	}
	assert.equal(
		inspectRequiredFlightBody(Buffer.from('0:{"a":"$Q1"}\n1:[[]]\n'), {
			action: true,
		}).complete,
		false,
	);
});

test("unsupported reference diagnostics retain a fixed prefix and shape without model paths or values", () => {
	const proof = inspectRequiredFlightBody(
		Buffer.from('0:{"a":"$K1:private-organization-value"}\n1:{}\n'),
		{ action: true },
	);
	assert.deepEqual(proof, {
		complete: false,
		reason: "unsupported-model-reference",
		modelReference: {
			prefix: "K",
			length: 30,
			form: "typed-outlined-path",
		},
	});
	assert.doesNotMatch(JSON.stringify(proof), /organization|private|value|\$K1/);
	assert.equal(
		inspectRequiredFlightBody(Buffer.from('0:{"a":"$F1"}\n1:null\n'), {
			action: true,
		}).complete,
		false,
	);
});

test("Flight symbol and canonical Date scalars do not invent model dependencies", () => {
	const body =
		'0:{"a":{"type":"$Sreact.fragment","when":"$D2025-01-01T00:00:00.000Z"}}\n';
	assert.equal(
		inspectRequiredFlightBody(Buffer.from(body), { action: true }).complete,
		true,
	);
	for (const invalid of [
		body.replace("$Sreact.fragment", "$S"),
		body.replace("2025-01-01", "2025-02-31"),
		body.replace("$D2025-01-01T00:00:00.000Z", "$Dprivate-value"),
	])
		assert.equal(
			inspectRequiredFlightBody(Buffer.from(invalid), { action: true })
				.complete,
			false,
		);
});

test("unsupported model reference forms and malformed UTF8 remain unknown", () => {
	for (const reference of ["$1:path", "$Q1", "$W1", "$K1", "$unknown"]) {
		assert.equal(
			inspectRequiredFlightBody(
				Buffer.from(`#0:{"b":"b","t":{"t":{"s":"${reference}"}}}\n1:{}\n`),
			).complete,
			false,
		);
	}
	const bytes = Buffer.concat([
		Buffer.from('#0:{"b":"'),
		Buffer.from([0xff]),
		Buffer.from('","t":{"t":{"s":""}}}\n'),
	]);
	assert.equal(inspectRequiredFlightBody(bytes).complete, false);
});

test("supported hints and framed text never mistake text containing E for a Flight error", () => {
	const bytes = Buffer.from(
		'#:HL["/technical.css","style"]\n0:{"b":"b","t":{"t":{"s":"","d":{"r":["$1","$$literal","$undefined"]}}}}\n1:T6,2:E{}\n',
	);
	assert.equal(inspectRequiredFlightBody(bytes).complete, true);
});

test("serialized measured receipts require exact raw partition, scope and complete coverage", () => {
	const proof = testBrowserEvidence("context", true).measured;
	assert.equal(cleanBrowserFailureEvidence(proof, 1), true);
	assert.equal(cleanBrowserFailureEvidence(proof, 0), false);
	for (const change of [
		(v) => {
			delete v.coverage.pendingBodies;
		},
		(v) => {
			v.scope = "all-phase-semantic-correlation";
		},
		(v) => {
			v.unknownFailures = 1;
		},
		(v) => {
			v.records.push(v.records[0]);
		},
		(v) => {
			v.records[0].outcome = "unknown";
		},
		(v) => {
			delete v.rawFailedRequests;
		},
		(v) => {
			v.provenControls = "1";
		},
		(v) => {
			v.complete = false;
		},
	]) {
		const altered = structuredClone(proof);
		change(altered);
		assert.equal(cleanBrowserFailureEvidence(altered, 1), false);
	}
});

test("installed Next action root permits absent build ID and navigation uses t transport data", () => {
	assert.equal(
		inspectRequiredFlightBody(
			Buffer.from('0:{"a":"$@1","q":"","i":false}\n1:{"count":0}\n'),
			{ action: true },
		).complete,
		true,
	);
	assert.equal(
		inspectRequiredFlightBody(Buffer.from('#0:{"t":{"t":{"s":""}}}\n'))
			.complete,
		true,
	);
});

test("unmarked navigation requires the actual compiled default and partial boundary proof", () => {
	const partial = Buffer.from('0:{"t":{"t":{"s":""}},"l":"$@1"}\n1:33\n');
	assert.equal(inspectRequiredFlightBody(partial).complete, false);
	const proof = inspectRequiredFlightBody(partial, { cachedNavigations: true });
	assert.equal(proof.complete, true);
	assert.equal(proof.requiredStage, "static");
	assert.equal(proof.isPartial, true);
	assert.equal(
		inspectRequiredFlightBody(Buffer.from('0:{"t":{"t":{"s":""}}}\n'), {
			cachedNavigations: true,
		}).complete,
		false,
	);
	assert.equal(
		inspectRequiredFlightBody(Buffer.from('0:{"t":{"t":{"s":""}}}\n'), {
			cachedNavigations: false,
		}).isPartial,
		false,
	);
});

test("a complete represented navigation patch needs typed outputs and all dependencies, without inventing a static boundary", () => {
	const body =
		'0:{"q":"","i":false,"t":{"t":{"s":"","c":"$Q1"}},"r":"$2","s":"$4"}\n1:[["children","$3"]]\n2:X\n2:C\n3:{"s":"en","d":{"r":["$","div",null,{"children":"private-rendered-value"}],"p":true,"v":null}}\n4:X\n4:300\n4:C\n';
	const proof = inspectRequiredFlightBody(Buffer.from(body), {
		cachedNavigations: true,
	});
	assert.equal(proof.complete, true);
	assert.equal(proof.requiredStage, "navigation-patch");
	assert.equal(proof.isPartial, true);
	assert.equal(proof.representedOutputs, 1);
	assert.equal(proof.treeNodes, 2);
	assert.doesNotMatch(JSON.stringify(proof), /private-rendered|children|div/);
	const evidence = cancellationFixture();
	evidence.failures[0].bodyProof = proof;
	evidence.failures[0].bodyReadbackComplete = true;
	evidence.proxy[0].bodyProof = proof;
	evidence.proxy[0].complete = true;
	evidence.proxy[0].canceled = false;
	const receipt = classifyControlCancellations(evidence);
	assert.equal(cleanBrowserFailureEvidence(receipt, 1), true);
	assert.equal(receipt.rawFailedRequests, 1);
	const tampered = structuredClone(receipt);
	tampered.records[0].proof.failure.bodyProof.representedOutputs = 0;
	assert.equal(cleanBrowserFailureEvidence(tampered, 1), false);
	for (const invalid of [
		body.replace('"p":true', '"p":"true"'),
		body.replace('"c":"$Q1"', '"c":{}'),
		body.replace('[["children","$3"]]', '[[42,"$3"]]'),
		body.replace(
			'"r":["$","div",null,{"children":"private-rendered-value"}]',
			'"r":"$dead"',
		),
		body.replace(
			'"r":["$","div",null,{"children":"private-rendered-value"}]',
			'"r":"$5"',
		) + "5:null\n",
		body.replace(
			'"d":{"r":["$","div",null,{"children":"private-rendered-value"}],"p":true,"v":null}',
			'"d":{"r":null,"p":true,"v":null}',
		),
		body.replace("4:C\n", ""),
		body.replace('"i":false', '"i":"false"'),
		body.replace('"v":null', '"v":{}'),
		body.replace('"r":"$2"', '"r":{}'),
		body.replace("4:300", '4:"not-a-number"'),
		body.replace('"s":"en"', '"s":{"n":"id","t":"d","k":null,"s":false}'),
		body.replace('"q":""', '"q":[],"n":"/private"'),
	])
		assert.equal(
			inspectRequiredFlightBody(Buffer.from(invalid), {
				cachedNavigations: true,
			}).complete,
			false,
		);
});

test("semantic abort identity preserves raw unknown and distinguishes genuine upstream failures", () => {
	for (const cause of [
		"downstream-cancellation",
		"upstream-failure",
		"untrusted",
	]) {
		const observer = createActionResultObserver();
		const id = observer.request({
			traceId: "a".repeat(32),
			method: "GET",
			headers: {},
			applicationOrigin: true,
			compiledAsset: false,
		});
		observer.response(id, {
			mimeType: "text/x-component",
			encoding: "gzip",
			status: 200,
		});
		observer.bytes(id, Buffer.from("PRIVATE_BODY"));
		observer.abort(id, cause);
		observer.abort(id, cause);
		const raw = observer.snapshot();
		assert.equal(raw.unknown, 1);
		assert.equal(raw.complete, false);
		assert.deepEqual(raw.aborts, [
			{
				id,
				traceId: "a".repeat(32),
				cause: cause === "untrusted" ? "unknown" : cause,
				action: false,
				flight: true,
				knownContract: null,
				status: 200,
			},
		]);
		assert.doesNotMatch(JSON.stringify(raw), /PRIVATE_BODY/);
	}
});

test("actual /_tree header contract proves a complete structure-only tree with resolved Map children", () => {
	const body = Buffer.from(
		'0:{"t":{"t":"$1"}}\n1:{"s":"","c":"$Q2"}\n2:[["children","$3"]]\n3:{"s":"en"}\n',
	);
	const proof = inspectRequiredFlightBody(body, {
		requestKind: "route-tree",
		cachedNavigations: true,
	});
	assert.equal(proof.complete, true);
	assert.equal(proof.requiredStage, "route-tree-structure");
	assert.equal(
		proof.isPartial,
		true,
		"The response does not become a complete route payload.",
	);
	assert.equal(
		inspectRequiredFlightBody(body, {
			requestKind: "segment-prefetch",
			cachedNavigations: true,
		}).complete,
		false,
	);
	for (const invalid of [
		body.toString().replace('2:[["children","$3"]]\n', ""),
		body.toString().replace('{"s":"en"}', '{"s":false}'),
		`${body}4:E{"digest":"PRIVATE"}\n`,
	])
		assert.equal(
			inspectRequiredFlightBody(Buffer.from(invalid), {
				requestKind: "route-tree",
				cachedNavigations: true,
			}).complete,
			false,
		);
});

test("unresolved lazy dependencies retain bounded technical provenance without exposing the reference", () => {
	for (const [reference, prefix, form] of [["$Labcdef", "L", "lazy-reference"], ["$@abcdef", "@", "promise-reference"], ["$abcdef", "plain", "model-reference"]]) {
		const body = Buffer.from(`~0:{"t":{"t":{"s":"","d":{"r":"${reference}"}}}}\n`);
		const result = inspectRequiredFlightBody(body, { cachedNavigations: true });
		assert.equal(result.complete, false);
		assert.equal(result.reason, "unresolved-model-reference");
		assert.deepEqual(result.modelReference, { prefix, form, length: reference.length });
		assert.equal(result.marker, "partial");
		assert.equal(result.isPartial, true);
		assert.equal(result.requestKind, "navigation");
		assert.equal(result.decodedBytes, body.length);
		assert.match(result.bodySha256, /^[a-f0-9]{64}$/);
		assert.doesNotMatch(JSON.stringify(result), /abcdef/);
	}
});

test("runtime-shell scope permits only postponed lazy output beneath a known Suspense fallback", () => {
	const body = '~0:{"q":"","i":false,"t":{"t":{"s":"","c":"$Q1"}}}\n1:[["children","$2"]]\n2:{"s":"en","d":{"r":"$3","p":true,"v":null}}\n3:["$","$Sreact.suspense",null,{"fallback":["$","span",null,{"children":"KNOWN_FALLBACK"}],"children":"$Ldead"}]\n';
	const options = { requestKind: "runtime-shell", cachedNavigations: true };
	const proof = inspectRequiredFlightBody(Buffer.from(body), options);
	assert.equal(proof.complete, true);
	assert.equal(proof.requiredStage, "runtime-shell-output");
	assert.equal(proof.isPartial, true);
	assert.equal(proof.postponedOutputReferences, 1);
	assert.equal(proof.knownSuspenseBoundaries, 1);
	assert.equal(proof.representedOutputs, 1);
	assert.doesNotMatch(JSON.stringify(proof), /KNOWN_FALLBACK|dead/);
	const input = cancellationFixture();
	Object.assign(input.failures[0], { requestKind: "runtime-shell", bodyProof: proof, bodyReadbackComplete: true });
	Object.assign(input.proxy[0], { requestKind: "runtime-shell", bodyProof: proof, complete: true, canceled: false });
	const receipt = classifyControlCancellations(input);
	assert.equal(cleanBrowserFailureEvidence(receipt, 1), true);
	const corrupted = structuredClone(receipt);
	corrupted.records[0].proof.failure.bodyProof.knownSuspenseBoundaries = 0;
	assert.equal(cleanBrowserFailureEvidence(corrupted, 1), false);
	for (const invalid of [
		body.replace('"children":"$Ldead"', '"children":"$dead"'),
		body.replace('"children":"$Ldead"', '"children":"$@dead"'),
		body.replace('"fallback":["$","span",null,{"children":"KNOWN_FALLBACK"}]', '"fallback":"$dead"'),
		body.replace('"fallback":["$","span",null,{"children":"KNOWN_FALLBACK"}]', '"fallback":"$Ldead"'),
		body.replace('"fallback":["$","span",null,{"children":"KNOWN_FALLBACK"}]', '"fallback":"$0"'),
		body.replace('"fallback":["$","span",null,{"children":"KNOWN_FALLBACK"}]', '"fallback":{"private":"not-renderable"}'),
		body.replace('"$Sreact.suspense"', '"section"'),
		body.replace('"$Sreact.suspense"', '"$Ldead"'),
		body.replace('"children":"$Ldead"', '"children":"$Ldead","required":"$Ldead"'),
		body.replace('"q":""', '"q":"","required":"$3"'),
		body.replace('"q":""', '"q":"","required":"$2"'),
		body.replace('"q":""', '"q":"","required":"$0"'),
		body.replace('["$","span",null,{"children":"KNOWN_FALLBACK"}]', '["$","span",null]'),
		body.replace('["$","span",null,{"children":"KNOWN_FALLBACK"}]', '"$4"') + '4:["$","span",null,{"children":"$4"}]\n',
		body.replace('"c":"$Q1"', '"c":"$Qdead"'),
		body.replace('"v":null', '"v":"$dead"'),
		body.replace('"p":true', '"p":"true"'),
		body.replace('"r":"$3"', '"r":"$dead"'),
		body.replace('"children":"$Ldead"', '"children":["$","$4",null,{"children":"$Ldead"}]') + '4:I["module",[],"export"]\n',
		body + 'dead:E{"digest":"PRIVATE"}\n',
		body.replace(/^~/, '#'),
	]) assert.equal(inspectRequiredFlightBody(Buffer.from(invalid), options).complete, false);
	assert.equal(inspectRequiredFlightBody(Buffer.from(body), { cachedNavigations: true }).complete, false,
		"A normal navigation cannot acquire shell-only permissions from a partial marker.");
	const missingType = inspectRequiredFlightBody(Buffer.from(body.replace('"$Sreact.suspense"', '"$Ldead"')), options);
	assert.equal(missingType.semanticRole, "element-type");
	assert.doesNotMatch(JSON.stringify(missingType), /dead|KNOWN_FALLBACK/);
});
