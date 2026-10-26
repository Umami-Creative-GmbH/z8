import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { createActionResultObserver } from "./action-result-observer.mjs";
import { testBrowserEvidence } from "./control-cancellation-test-fixtures.mjs";
import {
	inspectRequiredFlightBody,
	classifyControlCancellations,
	chromiumSWRRevision,
	cleanBrowserFailureEvidence,
	knownNativePublicSources,
} from "./control-cancellation-evidence.mjs";

test("Native public-source authority binds exact reviewed paths, compiled source and manifest without an eligibility flag",()=>{
	const source={protocol:"qualified-serving-worker-sources-v1",compiledBuild:"b".repeat(40),compiledManifestSha256:"c".repeat(64),
		files:["sw.js","lib/offline-queue-db.js","lib/sync-service.js","lib/clock-command-dispatch.js"].map(file=>({file,bytes:12,sha256:"d".repeat(64),gitBlob:"e".repeat(40)}))};
	assert.equal(knownNativePublicSources(source,"b".repeat(40),"c".repeat(64)),true);
	for(const mutate of [s=>s.compiledBuild="a".repeat(40),s=>s.compiledManifestSha256="a".repeat(64),s=>s.files.pop(),s=>s.files[0].file="unreviewed.js",s=>delete s.files[0].gitBlob,s=>s.files[0].bytes=4*1024*1024+1,s=>s.eligible=true]){
		const invalid=structuredClone(source);mutate(invalid);assert.equal(knownNativePublicSources(invalid,"b".repeat(40),"c".repeat(64)),false);
	}
});

const segmentDigest = value => createHash("sha256").update(value).digest("hex");
const segmentBinding = key => ({method:"GET",status:200,flight:true,rsc:true,prefetch:true,postponed:true,
	requestHeadersSha256:"d".repeat(64),requestKeySha256:segmentDigest(key),responseDeploymentSha256:segmentDigest("b".repeat(40)),
	compiledBuild:"b".repeat(40),compiledManifestSha256:"c".repeat(64),manifestVerified:true});
function segmentBody({head=false,pending=true,key="page",output="$L9",rows=""}={}) {
	const data={r:output,p:"$@3",v:null,s:"$4"};
	const terminal={s:key,d:data};
	const root={t:head?{t:{s:""},h:data}:{t:{s:"",c:"$Q2"}},a:"$@5",u:"$@6"};
	return Buffer.from(`0:${JSON.stringify(root)}\n${head?"":`2:${JSON.stringify([["children",terminal]])}\n`}4:X\n4:60\n4:C\n5:null\n6:false\n${pending?"":'3:"$undefined"\n'}${rows}`);
}
test("segment/head full-buffer claims bind the actual request key and deployment, without rendering partial outputs",()=>{
	for(const head of [false,true]) {
		const key=head?"/_head":"/page", bytes=segmentBody({head});
		const proof=inspectRequiredFlightBody(bytes,{requestKind:"segment-prefetch",segmentBinding:segmentBinding(key)});
		assert.equal(proof.complete,true,JSON.stringify(proof));
		assert.equal(proof.requiredStage,"segment-prefetch-representation");
		assert.equal(proof.renderableOutputClaim,false);
		assert.equal(proof.segmentBinding.derivedRequestKeySha256,segmentDigest(key));
		assert.equal(proof.partialNodes,1);
		for(const field of ["method","status","flight","rsc","prefetch","postponed","requestHeadersSha256","requestKeySha256","compiledBuild","compiledManifestSha256","manifestVerified"]){
			const binding=segmentBinding(key); delete binding[field];
			assert.equal(inspectRequiredFlightBody(bytes,{requestKind:"segment-prefetch",segmentBinding:binding}).complete,false,field);
		}
		assert.equal(inspectRequiredFlightBody(bytes,{requestKind:"segment-prefetch",segmentBinding:segmentBinding("/wrong")}).complete,false);
		assert.equal(inspectRequiredFlightBody(segmentBody({head,pending:false}),{requestKind:"segment-prefetch",segmentBinding:segmentBinding(key)}).complete,false,"fulfilled p does not permit missing output");
		assert.equal(inspectRequiredFlightBody(Buffer.concat([bytes,Buffer.from('a:E{"digest":"synthetic"}\n')]),{requestKind:"segment-prefetch",segmentBinding:segmentBinding(key)}).serverErrors,1);
	}
});

test("segment staged partiality cannot leak across shared complete output aliases in either node order",()=>{
	for(const alias of ["$8","$a:out"]) for(const completeHead of [false,true]) {
		const staged = p => ({r:alias,p,v:null,s:"$4"});
		const root={t:{t:{s:"",d:staged(completeHead?"$@7":"$@3")},h:staged(completeHead?"$@3":"$@7")},a:"$@5",u:"$@6"};
		const bytes=Buffer.from(`0:${JSON.stringify(root)}\n3:"$undefined"\n4:X\n4:60\n4:C\n5:null\n6:false\n8:["$L9"]\na:{"out":"$8"}\n`);
		assert.equal(inspectRequiredFlightBody(bytes,{requestKind:"segment-prefetch",segmentBinding:segmentBinding("/_index")}).complete,false,`${alias}/${completeHead}`);
		assert.equal(inspectRequiredFlightBody(Buffer.concat([bytes,Buffer.from('9:null\n')]),{requestKind:"segment-prefetch",segmentBinding:segmentBinding("/_index")}).complete,true);
	}
});

test("segment deployment uses actual response-header precedence and keys follow the encoder's child/slot identity",()=>{
	const options=key=>({requestKind:"segment-prefetch",segmentBinding:segmentBinding(key)});
	const withBodyBuild=Buffer.from(segmentBody({pending:false,output:null}).toString().replace('0:{','0:{"b":"different-build",'));
	assert.equal(inspectRequiredFlightBody(withBodyBuild,options("/page")).complete,true);
	const bodyBuild=Buffer.from(withBodyBuild.toString().replace("different-build","b".repeat(40)));
	const absent=options("/page"); absent.segmentBinding.responseDeploymentSha256=null;
	assert.equal(inspectRequiredFlightBody(bodyBuild,absent).complete,true);
	assert.equal(inspectRequiredFlightBody(withBodyBuild,absent).complete,false);
	assert.equal(inspectRequiredFlightBody(segmentBody({pending:false,output:null}),absent).complete,false);
	const dynamic={n:"employee",t:"d",k:null,s:["arbitrary-value"]};
	const body=Buffer.from(segmentBody({key:dynamic,pending:false,output:null}).toString().replace('[["children",','[["modal",'));
	assert.equal(inspectRequiredFlightBody(body,options("/@modal/$d$employee")).complete,true);
	assert.equal(inspectRequiredFlightBody(body,options("/@Modal/$d$employee")).complete,false);
	for(const invalid of [body.toString().replace('"p":"$@3"','"p":true'),body.toString().replace('6:false','6:null'),body.toString().replace('5:null','5:"$L9"')])
		assert.equal(inspectRequiredFlightBody(Buffer.from(invalid),options("/@modal/$d$employee")).complete,false);
});

test("typed segment completion is diagnostic and cannot admit a native cancellation or a serialized control",()=>{
	const bodyProof=inspectRequiredFlightBody(segmentBody(),{requestKind:"segment-prefetch",segmentBinding:segmentBinding("/page")});
	assert.equal(bodyProof.complete,true);
	const historical=testBrowserEvidence("context",true).measured.records[0].proof;
	const failure={...historical.failure,method:"GET",action:false,requestKind:"segment-prefetch",bodyProof};
	const packet={...historical.packet,method:"GET",action:false,requestKind:"segment-prefetch",bodyProof};
	const evidence=classifyControlCancellations({failures:[failure],proxy:[packet],browserRevision:chromiumSWRRevision,
		coverage:{installed:true,scopeClosed:true,missing:0,overflow:0,errors:0,pendingBodies:0}});
	assert.equal(evidence.unknownFailures,1);
	assert.equal(evidence.provenControls,0);
	const forged=testBrowserEvidence("context",true).measured;
	forged.records[0].proof.failure=failure;forged.records[0].proof.packet=packet;
	assert.equal(cleanBrowserFailureEvidence(forged,1),false);
});

test("segment shape and staged metadata are producer-qualified rather than generic full HTTP bodies",()=>{
	const source=segmentBody({pending:false,output:null}).toString();
	const options={requestKind:"segment-prefetch",segmentBinding:segmentBinding("/page")};
	for(const text of ["#"+source,"~"+source,
		source.replace('"s":"","c"','"s":"different-root","c"'),
		source.replace('"d":','"unsupported":'),source.replace('"s":"$4"','"s":null'),
		source.replace('3:"$undefined"','3:null'),source.replace('5:null','5:I["module",[],"export"]'),
		source.replace('6:false','6:I["module",[],"export"]'),source.replace('4:C','4:C"$dead"'),
		source.replace('"p":"$@3"','"p":"$@03"'),source.replace('"t":{"t"','"t":{"unsupported":null,"t"')])
		assert.equal(inspectRequiredFlightBody(Buffer.from(text),options).complete,false);
	for(const [key,encoded] of [["a/b","/!YS9i"],["/_not-found","/_not-found"],["ABC","/ABC"],["abc","/abc"]])
		assert.equal(inspectRequiredFlightBody(segmentBody({key,pending:false,output:null}),{...options,segmentBinding:segmentBinding(encoded)}).complete,true,key);
	const head=segmentBody({head:true,pending:false,output:null}).toString();
	assert.equal(inspectRequiredFlightBody(Buffer.from(head.replace('"s":""','"s":"","d":{"r":null}')),{...options,segmentBinding:segmentBinding("/_head")}).complete,false);
});

test("segment required structure never obtains object or scalar values from import, text, binary, or stream records",()=>{
	const source=segmentBody({pending:false,output:null}).toString();
	const options={requestKind:"segment-prefetch",segmentBinding:segmentBinding("/page")};
	for(const text of [source.replace("0:{","0:I{"),source.replace("2:[[","2:I[["),
		source.replace('"t":{"s":"","c":"$Q2"}','"t":"$7"')+'7:I{"s":"","c":"$Q2"}\n']) {
		assert.equal(inspectRequiredFlightBody(Buffer.from(text),options).complete,false);
	}
	for(const field of ["transport","tree","child","data","segment","vary-yield","stale-yield"]) for(const tag of ["I",""]) {
		const data={r:null,p:"$@3",v:null,s:"$4"},child={s:"page",d:data},tree={s:"",c:"$Q2"},transport={t:tree};
		const root={t:transport,a:"$@5",u:"$@6"};
		const children=[["children",child]];
		let value, yielded=60;
		if(field==="transport"){value=transport;root.t="$a";}
		if(field==="tree"){value=tree;transport.t="$a";}
		if(field==="child"){value=child;children[0][1]="$a";}
		if(field==="data"){value=data;child.d="$a";}
		if(field==="segment"){value="page";child.s="$a";}
		if(field==="vary-yield"){data.v="$4";value=0;yielded="$a";}
		if(field==="stale-yield"){value=60;yielded="$a";}
		const text=`0:${JSON.stringify(root)}\n2:${JSON.stringify(children)}\n3:"$undefined"\n4:X\n4:${JSON.stringify(yielded)}\n4:C\n5:null\n6:false\na:${tag}${JSON.stringify(value)}\n`;
		assert.equal(inspectRequiredFlightBody(Buffer.from(text),options).complete,tag==="",`${field}/${tag || "ordinary"}`);
	}
	const map=JSON.parse(source.split("\n").find(line=>line.startsWith("2:")).slice(2));
	for(const encoded of [`2:R\n2:${JSON.stringify(map[0])}\n2:C\n`,`2:T${Buffer.byteLength(JSON.stringify(map)).toString(16)},${JSON.stringify(map)}`,`2:o${Buffer.byteLength(JSON.stringify(map)).toString(16)},${JSON.stringify(map)}`])
		assert.equal(inspectRequiredFlightBody(Buffer.from(source.replace(/^2:.*\n/m,encoded)),options).complete,false);
	const aliased=source.replace('"t":{"s":"","c":"$Q2"}','"t":"$a:tree"')+'a:{"tree":"$b"}\nb:I{"s":"","c":"$Q2"}\n';
	assert.equal(inspectRequiredFlightBody(Buffer.from(aliased),options).complete,false,"ordinary path target cannot alias an import");
	assert.equal(inspectRequiredFlightBody(Buffer.from(aliased.replace('b:I','b:')),options).complete,true);
	assert.equal(inspectRequiredFlightBody(Buffer.from(source.replace('0:{','0:{"b":"$a",')+'a:I"build"\n'),options).complete,false);
	assert.equal(inspectRequiredFlightBody(Buffer.from(source.replace('0:{','0:{"b":"$a",')+'a:"build"\n'),options).complete,true,"header precedence still applies to a known ordinary body build");
});

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
		assert.doesNotMatch(JSON.stringify(proof), /PRIVATE|unrelated/);
		assert.equal(Object.values(proof).includes(42),false,"The unrelated business number is not retained; hashes may contain its digits.");
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

test("plain outlined paths project decoded element props through fulfilled own data only", () => {
	const body=(reference,rows)=>Buffer.from('~0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":'+JSON.stringify(reference)+',"p":true,"v":null}}}}\n'+rows);
	const rows='1:["$","div",null,{"children":{"leaf":"KNOWN_OUTPUT"}}]\n';
	assert.equal(inspectRequiredFlightBody(body('$1:props:children:leaf',rows),{cachedNavigations:true}).complete,true);
	for(const [reference,models] of [
		['$1:props:children:leaf','1:"$2"\n2:["$","div",null,{"children":{"leaf":"KNOWN_OUTPUT"}}]\n'],
		['$1:0:leaf','1:[{"leaf":"KNOWN_OUTPUT"}]\n'],
		['$1:length','1:[1,2]\n'],
		['$1:child:leaf','1:{"child":"$L2"}\n2:{"leaf":"KNOWN_OUTPUT"}\n'],
		['$1:self:leaf','1:{"self":"$1","leaf":"KNOWN_OUTPUT"}\n'],
		['$1::leaf','1:{"":{"leaf":"KNOWN_OUTPUT"}}\n'],
		['$1:prototype','1:{"prototype":"KNOWN_OUTPUT"}\n'],
		['$1:leaf','1:{"leaf":"KNOWN_OUTPUT","sibling":"$Q2"}\n2:[]\n'],
	])assert.equal(inspectRequiredFlightBody(body(reference,models),{cachedNavigations:true}).complete,true);
	for(const [reference,models] of [
		['$1:3:children:leaf',rows],['$1:props:constructor',rows],['$1:props:missing',rows],
		['$1:props:__proto__','1:["$","div",null,{"__proto__":"KNOWN_OUTPUT"}]\n'],
		['$1:leaf','1:{"leaf":"$undefined"}\n'],['$1:leaf','1:{"leaf":"KNOWN_OUTPUT","sibling":"$8"}\n'],
		['$1:child:leaf','1:{"child":"$L8"}\n'],['$1:child:leaf','1:{"child":"$@2"}\n2:{"leaf":"KNOWN_OUTPUT"}\n'],
		['$1:export','1:I["PRIVATE_MODULE",[],"export"]\n'],['$1:leaf','1:"$2"\n2:"$1"\n'],
		['$01:leaf','01:{"leaf":"KNOWN_OUTPUT"}\n'],['$Q1:leaf','1:{"leaf":[]}\n'],
		['$1:leaf','1:"$01"\n01:{"leaf":"KNOWN_OUTPUT"}\n'],
	])assert.equal(inspectRequiredFlightBody(body(reference,models),{cachedNavigations:true}).complete,false);
	assert.equal(inspectRequiredFlightBody(body('$1:props:children:leaf',rows+'8:E{"digest":"PRIVATE_ERROR"}\n'),{cachedNavigations:true}).complete,false);
	const shell=(fallback,child)=>Buffer.from('~0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":["$","$Sreact.suspense",null,{"fallback":'+JSON.stringify(fallback)+',"children":'+JSON.stringify(child)+'}],"p":true,"v":null}}}}\n1:{"value":"$L8"}\n');
	assert.equal(inspectRequiredFlightBody(shell("KNOWN_FALLBACK","$1:value"),{cachedNavigations:true,requestKind:"runtime-shell"}).complete,true);
	assert.equal(inspectRequiredFlightBody(shell("$1:value","KNOWN_CHILD"),{cachedNavigations:true,requestKind:"runtime-shell"}).complete,false);
	const diagnostic=inspectRequiredFlightBody(body('$1:private-organization-value','1:{}\n'),{cachedNavigations:true});
	assert.deepEqual(diagnostic.modelReference.pathKeyKinds,["other"]);
	assert.equal(diagnostic.pathFailure,"missing-own-property");
	assert.equal(inspectRequiredFlightBody(body('$1:leaf','1:{"leaf":"KNOWN_OUTPUT","sibling":"$8"}\n'),{cachedNavigations:true}).pathFailure,"missing-eager-model");
	assert.equal(inspectRequiredFlightBody(body('$1:export','1:I["PRIVATE_MODULE",[],"export"]\n'),{cachedNavigations:true}).pathFailure,"path-import-model");
	assert.doesNotMatch(JSON.stringify(diagnostic),/private|organization|\$1/);
	assert.equal(inspectRequiredFlightBody(body('$1:'+Array(33).fill('self').join(':'),'1:{"self":"$1"}\n'),{cachedNavigations:true}).complete,false);
	for(const result of ['{"success":false,"error":"PRIVATE_ERROR"}','"$2"']){
		const failure=inspectRequiredFlightBody(Buffer.from('0:{"a":"$1:result"}\n1:{"result":'+result+'}\n2:{"success":false,"error":"PRIVATE_ERROR"}\n'),{action:true});
		assert.equal(failure.complete,false);
		assert.equal(failure.explicitActionFailure,true);
	}
	const text=inspectRequiredFlightBody(Buffer.from('0:{"a":"$1"}\n1:T2,$22:{"success":false,"error":"PRIVATE_ERROR"}\n'),{action:true});
	assert.equal(text.complete,true);assert.equal(text.explicitActionFailure,false,"Opaque T text cannot become a model reference to an unreturned failure.");
	assert.equal(inspectRequiredFlightBody(Buffer.from('0:{"a":"$1"}\n1:"$1"\n'),{action:true}).complete,false);
});

test("outlined paths anchor only same-model materialized containers and retain eager cycle failures", () => {
	const body=(reference,rows)=>Buffer.from('~0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":'+JSON.stringify(reference)+',"p":true,"v":null}}}}\n'+rows);
	for(const [reference,rows]of [
		['$1:props:self:value','1:["$","span",null,{"value":"KNOWN","self":"$1:props"}]\n'],
		['$1:nested:back:back:value','1:{"nested":{"value":"KNOWN","back":"$1:nested"}}\n'],
	])assert.equal(inspectRequiredFlightBody(body(reference,rows),{cachedNavigations:true}).complete,true);
	for(const[reference,rows]of [
		['$1:next:back:value','1:{"value":"KNOWN","next":"$2"}\n2:{"back":"$1"}\n'],
		['$1:self:value','1:"$2"\n2:{"value":"KNOWN","self":"$1"}\n'],
		['$1:x','1:{"x":"$2:x"}\n2:{"x":"$1:x"}\n'],
		['$1:props:self:value','1:["$","span",null,{"value":"KNOWN","self":"$1:props","eager":"$8"}]\n'],
		['$1:props:self:value','1:["$","span",null,"$2"]\n2:{"value":"KNOWN","self":"$1:props"}\n'],
	])assert.equal(inspectRequiredFlightBody(body(reference,rows),{cachedNavigations:true}).complete,false);
});

test("shallow same-model outlined parents discharge all eager siblings without recursively restarting them", () => {
	const body = (paths, tailFirst, missing = false) => {
		let tail = "KNOWN"; for (let index=0;index<8;index++) tail={child:tail};
		const model={}; if(tailFirst)model.tail=tail;
		for(let index=paths-1;index>=0;index--)model[`a${index}`]={leaf:"KNOWN",back:`$1:a${Math.max(0,index-1)}`};
		if(!tailFirst)model.tail=tail;
		if(missing)model.unfulfilled="$8";
		return Buffer.from('~0:'+JSON.stringify({q:"",i:false,t:{t:{s:"en",d:{r:`$1:a${paths-1}:leaf`,p:true,v:null}}}})+'\n1:'+JSON.stringify(model)+'\n');
	};
	// The exact six row sets fulfill in the installed production decoder (source audit v3).
	for(const tailFirst of [false,true])for(const paths of [8,9,10]){
		assert.equal(inspectRequiredFlightBody(body(paths,tailFirst),{cachedNavigations:true}).complete,true);
		assert.equal(inspectRequiredFlightBody(body(paths,tailFirst,true),{cachedNavigations:true}).complete,false,"An active ancestor is provisional until its final eager sibling succeeds.");
	}
});

test("completed standalone outlined parents reuse structural readiness without skipping required roles or late siblings", () => {
	const encode=(parent,rows="")=>Buffer.from('~0:'+JSON.stringify({q:"",i:false,t:{t:{s:"en",d:{r:Array(450).fill("$1:leaf"),p:true,v:null}}}})+'\n1:'+JSON.stringify(parent)+'\n'+rows);
	const parent={leaf:"KNOWN",self:"$1"};for(let index=0;index<80;index++)parent[`p${index}`]="$1:leaf";
	assert.equal(inspectRequiredFlightBody(encode(parent),{cachedNavigations:true}).complete,true,"The installed decoder fulfills all 450 projections of this same-model parent.");
	assert.equal(inspectRequiredFlightBody(encode({...parent,last:"$8"}),{cachedNavigations:true}).complete,false);
	assert.equal(inspectRequiredFlightBody(encode(parent,'8:E{"digest":"PRIVATE"}\n'),{cachedNavigations:true}).complete,false);
	const represented=parent=>Buffer.from('~0:'+JSON.stringify({q:"",i:false,t:{t:{s:"en",d:{r:["$1:leaf","$1:required"],p:true,v:null}}}})+'\n1:'+JSON.stringify(parent)+'\n');
	for(const required of ["$8","$@8","$L8",["$","$L8",null,{}]])
		assert.equal(inspectRequiredFlightBody(represented({leaf:"KNOWN",required}),{cachedNavigations:true}).complete,false,"Parent readiness cannot discharge an independent required output/type reference.");
	const project=(refs,rows)=>Buffer.from('~0:'+JSON.stringify({q:"",i:false,t:{t:{s:"en",d:{r:refs,p:true,v:null}}}})+'\n'+rows);
	for(const [refs,rows] of [
		[["$1:leaf","$1:element:props:leaf"],'1:{"leaf":"KNOWN","element":["$","span",null,{"leaf":"KNOWN","bad":"$8"}]}\n'],
		[["$1:leaf","$1:element:type"],'1:{"leaf":"KNOWN","element":["$","$L8",null,{}]}\n'],
		[["$1:leaf","$1:element:props:cycle"],'1:{"leaf":"KNOWN","element":["$","span",null,{"cycle":"$2:back"}]}\n2:{"back":"$1:element:props:cycle"}\n'],
		[["$1:leaf","$2:props:self:value"],'1:{"leaf":"KNOWN"}\n2:["$","span",null,"$3"]\n3:{"value":"KNOWN","self":"$2:props"}\n'],
	]) assert.equal(inspectRequiredFlightBody(project(refs,rows),{cachedNavigations:true}).complete,false,"A completed parent cannot grant forceElement, type, alias or cross-record readiness to a later projection.");
});

test("reference-free JSON readiness reuses complete literal subtrees without discharging reference-bearing ancestors", () => {
	const literal={leaf:"KNOWN"};for(let index=0;index<200;index++)literal[`key${index}`]="KNOWN";
	const parent={leaf:"KNOWN",literal};for(let index=0;index<600;index++)parent[`alias${index}`]="$1:literal:leaf";
	const encode=parent=>Buffer.from('~0:'+JSON.stringify({q:"",i:false,t:{t:{s:"en",d:{r:"$1:leaf",p:true,v:null}}}})+'\n1:'+JSON.stringify(parent)+'\n');
	assert.equal(inspectRequiredFlightBody(encode(parent),{cachedNavigations:true}).complete,true);
	assert.equal(inspectRequiredFlightBody(encode({...parent,last:"$8"}),{cachedNavigations:true}).complete,false,"A completed literal child cannot certify its reference-bearing parent.");
});

test("reference-free cache depth spans compose through warmed ancestors at the same 64/65 boundary", () => {
	const inspect=(nest,warm)=>{
		let literal="KNOWN";for(let index=0;index<20;index++)literal={next:literal};
		let child="$1";for(let index=0;index<nest;index++)child={next:child};
		const bytes=Buffer.from('~0:'+JSON.stringify({q:"",i:false,t:{t:{s:"en",d:{r:warm?["$3:leaf","$2:leaf","$1:leaf"]:["$3:leaf"],p:true,v:null}}}})+'\n1:'+JSON.stringify({leaf:"KNOWN",deep:literal})+'\n2:{"leaf":"KNOWN","child":"$1"}\n3:'+JSON.stringify({leaf:"KNOWN",child})+'\n');
		return inspectRequiredFlightBody(bytes,{cachedNavigations:true});
	};
	for(const warm of [false,true]){
		assert.equal(inspect(40,warm).complete,true);
		const limit=inspect(41,warm);assert.equal(limit.complete,false);
		assert.equal(limit.pathLimitObservation.guard,"existing-recursion-depth");assert.equal(limit.pathLimitObservation.observedDepth,65);
	}
	const body=(r,rows)=>Buffer.from('~0:'+JSON.stringify({q:"",i:false,t:{t:{s:"en",d:{r,p:true,v:null}}}})+'\n'+rows);
	const skipped='1:{"leaf":"KNOWN","element":["$","span",null,{"leaf":"KNOWN","required":"$8"}]}\n';
	for(const refs of [["$1:leaf","$1:element:props:leaf"],["$1:element:props:leaf","$1:leaf"]])
		assert.equal(inspectRequiredFlightBody(body(refs,skipped),{cachedNavigations:true}).complete,false,"An uninspected element tuple never certifies its containing JSON as reference free.");
});

test("outlined limits identify the existing depth or shared-work guard without retaining data", () => {
	const encode=eager=>Buffer.from('~0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":"$1:leaf","p":true,"v":null}}}}\n1:'+JSON.stringify({leaf:"PRIVATE_VALUE",eager})+'\n');
	const inspect=eager=>inspectRequiredFlightBody(encode(eager),{cachedNavigations:true});
	let deep=null;for(let index=0;index<70;index++)deep={next:deep};
	const depth=inspect(deep);
	assert.equal(depth.complete,false);assert.equal(depth.pathLimitObservation.guard,"existing-recursion-depth");
	assert.equal(depth.pathLimitObservation.observedDepth,65);assert.equal(depth.pathLimitObservation.depthCap,64);
	assert.equal(depth.pathLimitObservation.phase,"eager-parent");assert.ok(depth.pathLimitObservation.jsonDepthInParent>50);
	assert.ok(depth.pathLimitObservation.parentMemoChecks>0);assert.ok(depth.pathLimitObservation.parentMemoAbsent>0);
	assert.equal(depth.pathLimitObservation.parentMemoPublished,0);assert.equal(depth.pathLimitObservation.parentMemoHits,0);
	const inner=encode(deep),outer=Buffer.concat([Buffer.from('0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":"KNOWN_MAIN","p":false,"v":null}}},"p":"$1"}\n1:R\n1:o'+inner.length.toString(16)+','),inner,Buffer.from('1:C\n')]);
	assert.equal(inspectRequiredFlightBody(outer,{cachedNavigations:true}).embeddedPathLimitObservation.guard,"existing-recursion-depth");
	const work=inspect(Array(100001).fill(null));
	assert.equal(work.complete,false);assert.equal(work.pathLimitObservation.guard,"shared-model-work");
	assert.equal(work.pathLimitObservation.sharedModelSteps,100001);assert.equal(work.pathLimitObservation.modelCap,100000);
	const warmed=Buffer.from('~0:'+JSON.stringify({q:"",i:false,t:{t:{s:"en",d:{r:["$2:leaf","$1:leaf","$1:leaf"],p:true,v:null}}}})+'\n1:{"leaf":"KNOWN"}\n2:'+JSON.stringify({leaf:"KNOWN",deep})+'\n');
	const warmedLimit=inspectRequiredFlightBody(warmed,{cachedNavigations:true});
	assert.ok(warmedLimit.pathLimitObservation.parentMemoHits>0);assert.ok(warmedLimit.pathLimitObservation.parentMemoPublished>0);
	assert.doesNotMatch(JSON.stringify([depth,work]),/PRIVATE_VALUE/);
});

test("supported hints and framed text never mistake text containing E for a Flight error", () => {
	const bytes = Buffer.from(
		'#:HL["/technical.css","style"]\n0:{"b":"b","t":{"t":{"s":"","d":{"r":["$1","$$literal","$undefined"]}}}}\n1:T6,2:E{}\n',
	);
	assert.equal(inspectRequiredFlightBody(bytes).complete, true);
});

test("a resource hint dispatch does not fulfill an outlined model dependency", () => {
	const body = Buffer.from('0:{"a":"$1"}\n1:HL["/technical.css","style"]\n');
	assert.equal(inspectRequiredFlightBody(body, { action: true }).complete, false);
	assert.equal(inspectRequiredFlightBody(Buffer.from('0:{"a":null}\n1:HL["/technical.css","style"]\n'), { action: true }).complete, true);
});

test("framing failures expose only fixed parsing stage, offset and first tag byte", () => {
	const prefix = Buffer.from('0:{"a":null}\n');
	const utf8 = inspectRequiredFlightBody(Buffer.concat([prefix, Buffer.from('1:T1,'), Buffer.from([255])]), { action: true });
	assert.equal(utf8.complete, false);
	assert.equal(utf8.reason, "invalid-record");
	assert.equal(utf8.framingStage, "utf8");
	assert.equal(utf8.recordOffset, prefix.length);
	assert.equal(utf8.tagByte, 84);
	const json = inspectRequiredFlightBody(Buffer.from('0:{"a":PRIVATE_VALUE}\n'), { action: true });
	assert.equal(json.framingStage, "json");
	assert.equal(json.recordOffset, 0);
	assert.equal(json.tagByte, 123);
	assert.doesNotMatch(JSON.stringify(json), /PRIVATE_VALUE|SyntaxError|stack|message/);
});

test("genuine Flight E is observed before unsupported endpoint or binary role semantics", () => {
	for (const requestKind of ["segment-prefetch", "head-prefetch", "navigation"]) {
		for (const marker of ["", "~", "#"]) {
			const error = inspectRequiredFlightBody(Buffer.from(`${marker}0:E{"digest":"PRIVATE"}\n`), { requestKind });
			assert.equal(error.serverErrors, 1);
			assert.equal(error.complete, false);
		}
	}
	for (const tag of ["o", "b", "A", "O", "U", "S", "s", "L", "l", "G", "g", "M", "m", "V"]) {
		const bytes = Buffer.concat([Buffer.from('0:{"a":"$1"}\n1:' + tag + '8,'), Buffer.alloc(8), Buffer.from('2:E{"digest":"PRIVATE"}\n')]);
		const proof = inspectRequiredFlightBody(bytes, { action: true });
		assert.equal(proof.serverErrors, 1, tag);
		assert.doesNotMatch(JSON.stringify(proof), /PRIVATE/);
	}
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
		'0:{"t":{"t":"$1"}}\n1:{"s":"","c":"$Q2"}\n2:[["children","$3"]]\n3:{"s":"__PAGE__"}\n',
	);
	const proof = inspectRequiredFlightBody(body, {
		requestKind: "route-tree",
		cachedNavigations: true,
		routeTreeBinding:segmentBinding("/_tree"),
	});
	assert.equal(proof.complete, true);
	assert.equal(proof.requiredStage, "route-tree-structure");
	assert.equal(
		proof.isPartial,
		false,
		"This is complete structure-only representation, not a full route payload.",
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
		body.toString().replace('{"s":"__PAGE__"}', '{"s":false}'),
		`${body}4:E{"digest":"PRIVATE"}\n`,
	])
		assert.equal(
			inspectRequiredFlightBody(Buffer.from(invalid), {
				requestKind: "route-tree",
				cachedNavigations: true,
				routeTreeBinding:segmentBinding("/_tree"),
			}).complete,
			false,
		);
});

test("route-tree required structure and phase binding cannot be supplied by import, text or stream metadata",()=>{
	const body='0:{"t":"$7"}\n7:{"t":"$1"}\n1:{"s":"","c":"$Q2"}\n2:[["children","$3"],["modal",{"s":"__PAGE__"}]]\n3:{"s":"__PAGE__"}\n';
	const options={requestKind:"route-tree",routeTreeBinding:segmentBinding("/_tree")};
	const inspect=(text,binding=options.routeTreeBinding)=>inspectRequiredFlightBody(Buffer.from(text),{...options,routeTreeBinding:binding});
	assert.equal(inspect(body).complete,true);
	for(const invalid of [
		body.replace('0:{','0:I{'),body.replace('7:{','7:I{'),body.replace('1:{','1:I{'),body.replace('2:[[','2:I[['),body.replace('3:{','3:I{'),
		body.replace('2:[[','2:X\n2:[['),body.replace('"s":"__PAGE__"','"s":"$4"')+'4:T8,__PAGE__',
		body.replaceAll('__PAGE__','layout'),body.replace('"s":"","c"','"s":"unanchored","c"'),body.replace('"s":"","c"','"s":"","d":{},"c"'),
		body.replace('3:{"s":"__PAGE__"}','3:{"s":{"n":"id","t":"d","k":null,"s":null}}'),
		body.replace('3:{"s":"__PAGE__"}','3:{"s":{"n":"id","t":"unknown","k":"known","s":null}}'),
		body.replace('0:{"t"','0:{"n":true,"t"'),body+'8:E{"digest":"synthetic"}\n',body.replace('2:[["children"','2:[["$missing"'),
	]) assert.equal(inspect(invalid).complete,false,invalid);
	for(const key of ["method","status","flight","rsc","prefetch","postponed","requestHeadersSha256","requestKeySha256","responseDeploymentSha256","compiledBuild","compiledManifestSha256","manifestVerified"]){
		const binding={...options.routeTreeBinding};delete binding[key];assert.equal(inspect(body,binding).complete,false,key);
	}
	assert.equal(inspect(body,segmentBinding("/_index")).complete,false);
	const bodyBuild=body.replace('0:{','0:{"b":"'+"b".repeat(40)+'",');
	assert.equal(inspect(bodyBuild,{...options.routeTreeBinding,responseDeploymentSha256:null}).complete,true);
	assert.equal(inspect(bodyBuild.replace('"b":"'+'b'.repeat(40),'"b":"'+'c'.repeat(40)),{...options.routeTreeBinding,responseDeploymentSha256:null}).complete,false);
	assert.equal(inspect(bodyBuild.replace('"b":"'+'b'.repeat(40),'"b":"'+'c'.repeat(40))).complete,true,"actual deployment header has source precedence over body b");
});

test("first rejected route segment exposes fixed kinds and provenance without admitting null dynamic values",()=>{
	const options={requestKind:"route-tree",routeTreeBinding:segmentBinding("/_tree")};
	const body=segment=>'0:{"t":{"t":{"s":"","c":"$Q1"}}}\n1:[["children",{"s":'+JSON.stringify(segment)+'}]]\n';
	const omitted={n:"PRIVATE_NAME",t:"d",k:null,s:null};
	const proof=inspectRequiredFlightBody(Buffer.from(body(omitted)),options);
	assert.equal(proof.complete,false);assert.equal(proof.reason,"unqualified-route-scalar-source");
	assert.deepEqual(proof.routeTreeSegmentObservation,{nodeOrdinal:2,rawKind:"object",resolvedKind:"object",provenance:"inline",paramType:"d",nameKind:"string",valueKind:"null",siblingsKind:"null",unknownFields:0});
	assert.equal(JSON.stringify(proof).includes("PRIVATE_NAME"),false);
	const wrong=inspectRequiredFlightBody(Buffer.from(body({...omitted,t:"PRIVATE_TYPE",k:false})),options);
	assert.equal(wrong.routeTreeSegmentObservation.paramType,"other");assert.equal(wrong.routeTreeSegmentObservation.valueKind,"boolean");
	assert.equal(JSON.stringify(wrong).includes("PRIVATE_TYPE"),false);
	const tagged=inspectRequiredFlightBody(Buffer.from(body("$2")+'2:I'+JSON.stringify(omitted)+'\n'),options);
	assert.equal(tagged.complete,false);assert.equal(tagged.routeTreeSegmentObservation.provenance,"import");assert.equal(tagged.routeTreeSegmentObservation.resolvedKind,"unresolved");
});

test("typed patch rejection retains the first fixed guard and safe field kinds without changing its verdict", () => {
	const root={q:"PRIVATE_QUERY",i:false,t:{t:{s:"en",d:{r:"PRIVATE_OUTPUT",p:true,v:null}}}};
	const encode=root=>Buffer.from('~0:'+JSON.stringify(root)+'\n');
	const invalid=structuredClone(root);invalid.t.t.d.p="$undefined";
	const direct=inspectRequiredFlightBody(encode(invalid),{cachedNavigations:true});
	assert.equal(direct.complete,false);assert.equal(direct.reason,"unsupported-navigation-patch-data");
	assert.equal(direct.patchDataObservation.location,"node-data");
	assert.equal(direct.patchDataObservation.failure,"partiality-type");
	assert.equal(direct.patchDataObservation.fieldKinds.p,"undefined-sentinel");
	assert.deepEqual(direct.patchDataObservation.present,{r:true,p:true,v:true,s:false,t:false,h:false,q:false,i:false,S:false,n:false});
	for(const [mutate,location,failure]of [
		[value=>delete value.t.t.d.r,"node-data","missing-output"],
		[value=>delete value.t.t.d.v,"node-data","missing-vary"],
		[value=>value.t.t.d.privateKey=true,"node-data","data-fields"],
		[value=>value.t.t.d.v="$undefined","node-data","vary-stream"],
		[value=>value.t.t.d.s="$undefined","node-data","stale-stream"],
		[value=>value.t.h="$undefined","head-data","data-shape"],
		[value=>value.t.other=true,"transport","transport-fields"],
		[value=>value.r="$undefined","root-vary","vary-stream"],
		[value=>value.s="$undefined","root-stale","stale-stream"],
		[value=>{value.t.t.h="$undefined";value.t.t.d.p="$undefined";},"node-hints","hints-integer"],
	]){
		const value=structuredClone(root);mutate(value);const result=inspectRequiredFlightBody(encode(value),{cachedNavigations:true});
		assert.equal(result.complete,false);assert.equal(result.reason,"unsupported-navigation-patch-data");
		assert.equal(result.patchDataObservation.location,location);assert.equal(result.patchDataObservation.failure,failure);
		assert.doesNotMatch(JSON.stringify(result),/privateKey|PRIVATE_QUERY|PRIVATE_OUTPUT/);
	}
	const inner=encode(invalid),outer=Buffer.concat([Buffer.from('0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":"MAIN","p":false,"v":null}}},"p":"$1"}\n1:R\n1:o'+inner.length.toString(16)+','),inner,Buffer.from('1:C\n')]);
	assert.deepEqual(inspectRequiredFlightBody(outer,{cachedNavigations:true}).embeddedPatchDataObservation,direct.patchDataObservation);
	assert.doesNotMatch(JSON.stringify([direct,inspectRequiredFlightBody(outer,{cachedNavigations:true})]),/PRIVATE_QUERY|PRIVATE_OUTPUT|\$undefined/);
});

test("typed Vary streams read branded framed text as literal strings only at the Vary edge", () => {
	const root={q:"",i:false,r:"$1",t:{t:{s:"en",d:{r:"KNOWN",p:true,v:"$1"}}}};
	const encode=(rows,value=root)=>Buffer.from('~0:'+JSON.stringify(value)+'\n'+rows);
	const rows='1:X\n'+["locale","$2",'2:E{"digest":"PRIVATE_LITERAL"}',"0"].map(text=>'1:T'+Buffer.byteLength(text).toString(16)+','+text).join('')+'1:0\n1:C\n';
	const proof=inspectRequiredFlightBody(encode(rows),{cachedNavigations:true});
	assert.equal(proof.complete,true);assert.equal(proof.serverErrors,0);
	const inner=encode(rows),outer=Buffer.concat([Buffer.from('0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":"MAIN","p":false,"v":null}}},"p":"$3"}\n3:R\n3:o'+inner.length.toString(16)+','),inner,Buffer.from('3:C\n')]);
	assert.equal(inspectRequiredFlightBody(outer,{cachedNavigations:true}).complete,true);
	for(const invalid of ['1:X\n1:{"textValue":"locale"}\n1:C\n','1:X\n1:1\n1:C\n','1:X\n1:"$2"\n1:C\n',rows.replace('1:C\n',''),rows+'2:E{"digest":"PRIVATE_ERROR"}\n'])
		assert.equal(inspectRequiredFlightBody(encode(invalid),{cachedNavigations:true}).complete,false);
	const stale=structuredClone(root);stale.r=null;stale.t.t.d.v=null;stale.t.t.d.s="$1";
	assert.equal(inspectRequiredFlightBody(encode('1:X\n1:T1,01:C\n',stale),{cachedNavigations:true}).complete,false,"A framed numeric-looking string never becomes a stale-time number.");
	assert.doesNotMatch(JSON.stringify(proof),/locale|PRIVATE_LITERAL|\$2/);
});

test("rejected typed iterable diagnostics distinguish reference, opener and already-inspected yield kinds", () => {
	const body=(reference,rows)=>Buffer.from('~0:'+JSON.stringify({q:"",i:false,t:{t:{s:"en",d:{r:"KNOWN",p:true,v:null,s:reference}}}})+'\n'+rows);
	const text="PRIVATE_PARAM";
	const proof=inspectRequiredFlightBody(body("$1",'1:X\n1:T'+Buffer.byteLength(text).toString(16)+','+text+'1:C\n'),{cachedNavigations:true});
	assert.equal(proof.complete,false);assert.equal(proof.patchDataObservation.failure,"stale-stream");
	assert.deepEqual(proof.patchDataObservation.iterable,{referenceForm:"model-reference",targetKnown:true,targetTag:"X",stream:true,closed:true,yieldCount:1,firstRejectedYield:{rawKind:"framed-text",resolvedKind:"framed-text"}});
	const alias=inspectRequiredFlightBody(body("$1:stream",'1:{"stream":"$2"}\n2:X\n2:C\n'),{cachedNavigations:true});
	assert.equal(alias.complete,false);assert.equal(alias.patchDataObservation.iterable.referenceForm,"outlined-path");
	assert.equal(alias.patchDataObservation.iterable.targetKnown,false,"No new resolution is performed for diagnostic purposes.");
	assert.doesNotMatch(JSON.stringify([proof,alias]),/PRIVATE_PARAM|\$1|\$2/);
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

test("runtime-shell preserves the known-fallback output claim separately from opaque cache representation", () => {
	const body = '~0:{"q":"","i":false,"t":{"t":{"s":"","c":"$Q1"}}}\n1:[["children","$2"]]\n2:{"s":"en","d":{"r":"$3","p":true,"v":null}}\n3:["$","$Sreact.suspense",null,{"fallback":["$","span",null,{"children":"KNOWN_FALLBACK"}],"children":"$Ldead"}]\n';
	const options = { requestKind: "runtime-shell", cachedNavigations: true };
	const componentFallback = body.replace('["$","span",null,{"children":"KNOWN_FALLBACK"}]', '["$","$4",null,{"data":null}]')+'4:I["PRIVATE_MODULE",[],"PRIVATE_EXPORT"]\n';
	const componentUnknown = inspectRequiredFlightBody(Buffer.from(componentFallback), options);
	assert.equal(componentUnknown.complete, true);
	assert.equal(componentUnknown.requiredStage,"runtime-shell-cache-representation");
	assert.equal(componentUnknown.renderableOutputClaim,false);
	assert.equal(componentUnknown.representedComponentFallbacks,1);
	const objectUnknown = inspectRequiredFlightBody(Buffer.from(body.replace('["$","span",null,{"children":"KNOWN_FALLBACK"}]','{"private":"PRIVATE_VALUE"}')), options);
	assert.equal(objectUnknown.fallbackKind, "non-renderable-value");
	assert.equal(objectUnknown.fallbackValueKind, "object");
	assert.doesNotMatch(JSON.stringify([componentUnknown,objectUnknown]), /PRIVATE|KNOWN_FALLBACK|dead/);
	const proof = inspectRequiredFlightBody(Buffer.from(body), options);
	for (const [fallback, emptyCount] of [[null,1],["$undefined",1],["omitted",1]]) {
		const changed = fallback === "omitted" ? body.replace('"fallback":["$","span",null,{"children":"KNOWN_FALLBACK"}],','') : body.replace('["$","span",null,{"children":"KNOWN_FALLBACK"}]',JSON.stringify(fallback));
		const empty = inspectRequiredFlightBody(Buffer.from(changed), options);
		assert.equal(empty.complete,true);
		assert.equal(empty.knownEmptyFallbacks,emptyCount);
	}
	assert.equal(proof.complete, true);
	assert.equal(proof.requiredStage, "runtime-shell-output");
	assert.equal(proof.isPartial, true);
	assert.equal(proof.postponedOutputReferences, 1);
	assert.equal(proof.knownSuspenseBoundaries, 1);
	assert.equal(proof.knownEmptyFallbacks, 0);
	const aliasedFallback = body.replace('["$","span",null,{"children":"KNOWN_FALLBACK"}]', '"$4"') + '4:["$","span",null,{"children":"KNOWN_FALLBACK"}]\n';
	assert.equal(inspectRequiredFlightBody(Buffer.from(aliasedFallback), options).complete, true);
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
	for (const count of [undefined, -1, 2]) {
		const badEmptyCount = structuredClone(receipt);
		badEmptyCount.records[0].proof.failure.bodyProof.knownEmptyFallbacks = count;
		assert.equal(cleanBrowserFailureEvidence(badEmptyCount,1),false);
	}
	for (const invalid of [
		body.replace('"children":"$Ldead"', '"children":"$dead"'),
		body.replace('"children":"$Ldead"', '"children":"$@dead"'),
		body.replace('"fallback":["$","span",null,{"children":"KNOWN_FALLBACK"}]', '"fallback":"$dead"'),
		body.replace('"fallback":["$","span",null,{"children":"KNOWN_FALLBACK"}]', '"fallback":"$Ldead"'),
		body.replace('"fallback":["$","span",null,{"children":"KNOWN_FALLBACK"}]', '"fallback":"$0"'),
		body.replace('"fallback":["$","span",null,{"children":"KNOWN_FALLBACK"}]', '"fallback":{"private":"not-renderable"}'),
		body.replace('"$Sreact.suspense"', '"$Ldead"'),
		body.replace('"children":"$Ldead"', '"children":"$Ldead","required":"$Ldead"'),
		body.replace('"q":""', '"q":"","required":"$3"'),
		body.replace('"q":""', '"q":"","required":"$2"'),
		body.replace('"q":""', '"q":"","required":"$0"'),
		body.replace('["$","span",null,{"children":"KNOWN_FALLBACK"}]', '["$","span",null]'),
		body.replace('["$","span",null,{"children":"KNOWN_FALLBACK"}]', '"$4"') + '4:["$","span",null,{"children":"$4"}]\n',
		body.replace('["$","span",null,{"children":"KNOWN_FALLBACK"}]', '"$4"') + '4:I["module",[],"export"]\n',
		body.replace('["$","span",null,{"children":"KNOWN_FALLBACK"}]', '"$Q4"') + '4:[["key",{"notReactOutput":true}]]\n',
		body.replace('["$","span",null,{"children":"KNOWN_FALLBACK"}]', '"$W4"') + '4:[{"notReactOutput":true}]\n',
		body.replace('["$","span",null,{"children":"KNOWN_FALLBACK"}]', '"$i4"') + '4:[{"notReactOutput":true}]\n',
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

test("embedded partial cache representation can contain a direct postponed r with no concrete output claim", () => {
	const inner='~0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":"$L9","p":true,"v":null}}}}\n';
	const outer=value=>Buffer.concat([Buffer.from('0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":"MAIN","p":false,"v":null}}},"p":"$1"}\n1:R\n1:o'+Buffer.byteLength(value).toString(16)+','),Buffer.from(value),Buffer.from('1:C\n')]);
	const proof=inspectRequiredFlightBody(outer(inner),{cachedNavigations:true});
	assert.equal(proof.complete,true);
	assert.equal(proof.embeddedRuntimePrefetch.requiredStage,"embedded-partial-prefetch-representation");
	assert.equal(proof.embeddedRuntimePrefetch.postponedDirectOutputs,1);
	assert.equal(proof.embeddedRuntimePrefetch.representedOutputs,0);
	assert.equal(proof.embeddedRuntimePrefetch.renderableOutputClaim,false);
	const head='~0:{"q":"","i":false,"t":{"t":{"s":"en"},"h":{"r":"$L9","p":true,"v":null}}}\n';
	assert.equal(inspectRequiredFlightBody(outer(head),{cachedNavigations:true}).embeddedRuntimePrefetch.postponedDirectOutputs,1);
	const input=cancellationFixture();Object.assign(input.failures[0],{bodyProof:proof,bodyReadbackComplete:true});Object.assign(input.proxy[0],{bodyProof:proof,complete:true,canceled:false});
	const receipt=classifyControlCancellations(input);assert.equal(cleanBrowserFailureEvidence(receipt,1),true);
	for(const changed of [{postponedDirectOutputs:undefined},{postponedCacheOutputs:undefined},{postponedCacheOutputs:0},{postponedDirectOutputs:3},{postponedDirectOutputs:"1"},{renderableOutputClaim:true},{requiredStage:"embedded-runtime-prefetch-output"}]){
		const corrupted=structuredClone(receipt);Object.assign(corrupted.records[0].proof.failure.bodyProof.embeddedRuntimePrefetch,changed);assert.equal(cleanBrowserFailureEvidence(corrupted,1),false);
	}
	for(const invalid of [inner.replace(/^~/,'#'),inner.replace('"$L9"','"$9"'),inner.replace('"$L9"','"$@9"'),
		inner.replace('"s":"en"','"s":"$L9"'),inner.replace('"p":true','"p":"$L9"'),inner.replace('"q":""','"q":"$L9"'),
		inner.replace('"$L9"','["$","$L9",null,{}]'),inner.replace('"$L9"','["$","$Sreact.suspense",null,{"fallback":"$L9","children":"$L8"}]'),
		inner.replace('"$L9"','"$L09"'),inner+'9:E{"digest":"PRIVATE"}\n'])
		assert.equal(inspectRequiredFlightBody(outer(invalid),{cachedNavigations:true}).complete,false);
	assert.equal(inspectRequiredFlightBody(Buffer.from(inner),{cachedNavigations:true}).complete,false);
	assert.equal(inspectRequiredFlightBody(Buffer.from(outer(inner).toString().replace('"MAIN"','"$L9"')),{cachedNavigations:true}).complete,false);
});

test("unresolved output records the actual bounded walk edge without granting descendant permissions", () => {
	const root={q:"",i:false,t:{t:{s:"en",d:{r:null,p:true,v:null}}}};
	for(const [value,rows,arrival,parentArrival]of [[["$","div",null,{title:"$2",children:"KNOWN"}],'2:"$L9"\n',"model-reference",null],[["$","div",null,{title:["$L9"]}],"","own-field","own-field"],[["$","$Sreact.suspense",null,{fallback:["$L9"],children:"KNOWN"}],"","array-output","element-fallback"]]){
		const data=structuredClone(root);data.t.t.d.r=value;const inner='~0:'+JSON.stringify(data)+'\n'+rows;
		const bytes=Buffer.concat([Buffer.from('0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":"MAIN","p":false,"v":null}}},"p":"$1"}\n1:R\n1:o'+Buffer.byteLength(inner).toString(16)+','),Buffer.from(inner),Buffer.from('1:C\n')]);
		const proof=inspectRequiredFlightBody(bytes,{cachedNavigations:true});
		assert.equal(proof.complete,false);assert.equal(proof.embeddedReason,"unresolved-model-reference");
		assert.deepEqual(proof.embeddedOutputEdgeObservation,{walkPathOnly:true,fromTypedOutput:true,directEmbeddedOutput:false,rArrayOutput:false,insideRArray:false,arrival,parentArrival});
		assert.doesNotMatch(JSON.stringify(proof),/\$L9|\$2|MAIN/);
	}
});

test("typed r arrays have separate nonrenderable partial-cache claims without granting other-prop permissions", () => {
	const inner='~0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":["KNOWN","$L9"],"p":true,"v":null}}}}\n';
	const outer=value=>Buffer.concat([Buffer.from('0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":"MAIN","p":false,"v":null}}},"p":"$1"}\n1:R\n1:o'+Buffer.byteLength(value).toString(16)+','),Buffer.from(value),Buffer.from('1:C\n')]);
	for(const shell of [false,true]){
		const inspect=value=>inspectRequiredFlightBody(shell?Buffer.from(value):outer(value),{cachedNavigations:true,...(shell?{requestKind:"runtime-shell"}:{})});
		const proof=inspect(inner),body=shell?proof:proof.embeddedRuntimePrefetch;
		assert.equal(proof.complete,true);assert.equal(body.postponedArrayOutputs,1);assert.equal(body.renderableOutputClaim,false);
		assert.equal(body.requiredStage,shell?"runtime-shell-cache-representation":"embedded-partial-prefetch-representation");
		for(const valid of [inner.replace('["KNOWN","$L9"]','"$2"')+'2:["KNOWN","$L9"]\n',inner.replace('["KNOWN","$L9"]','"$2:value"')+'2:{"value":["KNOWN","$L9"]}\n'])
			assert.equal(inspect(valid).complete,true,"A fulfilled ordinary model/path can supply the known r array.");
		const input=cancellationFixture();for(const row of [input.failures[0],input.proxy[0]])Object.assign(row,{requestKind:shell?"runtime-shell":"navigation",bodyProof:proof});Object.assign(input.failures[0],{bodyReadbackComplete:true});Object.assign(input.proxy[0],{complete:true,canceled:false});
		const receipt=classifyControlCancellations(input);assert.equal(cleanBrowserFailureEvidence(receipt,1),true);
		for(const changed of [{postponedArrayOutputs:undefined},{postponedCacheOutputs:undefined},{postponedCacheOutputs:0},{postponedArrayOutputs:"1"},{postponedArrayOutputs:100001},{renderableOutputClaim:true},{requiredStage:shell?"runtime-shell-output":"embedded-runtime-prefetch-output"}]){
			const corrupt=structuredClone(receipt),target=corrupt.records[0].proof.failure.bodyProof;Object.assign(shell?target:target.embeddedRuntimePrefetch,changed);assert.equal(cleanBrowserFailureEvidence(corrupt,1),false);
		}
		if(shell)for(const changed of [{postponedComponentReferences:1},{postponedDirectOutputs:1},{requestKind:"navigation"}]){
			const corrupt=structuredClone(receipt);Object.assign(corrupt.records[0].proof.failure.bodyProof,changed);assert.equal(cleanBrowserFailureEvidence(corrupt,1),false);
		}
		for(const invalid of [inner.replace(/^~/,'#'),inner.replace('"$L9"','"$9"'),inner.replace('"$L9"','"$@9"'),inner.replace('"$L9"','"$L09"'),inner.replace('"s":"en"','"s":"$L9"'),inner.replace('"p":true','"p":"$L9"'),inner.replace('"q":""','"q":"$L9"'),
			inner.replace('["KNOWN","$L9"]','["$","div",null,{"title":["$L9"]}]'),inner.replace('["KNOWN","$L9"]','["$","$L9",null,{}]'),inner.replace('["KNOWN","$L9"]','["$","$Sreact.suspense",null,{"fallback":["$L9"],"children":"KNOWN"}]'),
			inner.replace('["KNOWN","$L9"]','"$@2"')+'2:["$L9"]\n',inner.replace('["KNOWN","$L9"]','"$2"')+'2:I["$L9",[],"export"]\n',inner+'9:E{"digest":"PRIVATE"}\n'])
			assert.equal(inspect(invalid).complete,false);
	}
	assert.equal(inspectRequiredFlightBody(Buffer.from(inner),{cachedNavigations:true}).complete,false,"Ordinary main output gains no array-hole permission.");
});

test("shared output aliases recheck every required permission context in both array orders", () => {
	const outer=value=>Buffer.concat([Buffer.from('0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":"MAIN","p":false,"v":null}}},"p":"$1"}\n1:R\n1:o'+Buffer.byteLength(value).toString(16)+','),Buffer.from(value),Buffer.from('1:C\n')]);
	for(const shell of [false,true])for(const reverse of [false,true]){
		const inspect=value=>inspectRequiredFlightBody(shell?Buffer.from(value):outer(value),{cachedNavigations:true,...(shell?{requestKind:"runtime-shell"}:{})});
		for(const child of ["$2","$3:value"]){
			const allowed=[["$","div",null,{children:child}],"$2"];if(reverse)allowed.reverse();
			const positive='~0:'+JSON.stringify({q:"",i:false,t:{t:{s:"en",d:{r:allowed,p:true,v:null}}}})+'\n2:["$L9"]\n3:{"value":"$2"}\n';
			const proof=inspect(positive);assert.equal(proof.complete,true);assert.equal((shell?proof:proof.embeddedRuntimePrefetch).renderableOutputClaim,false,"Historical host-child cache-only case now has an explicit nonrenderable contract, in both orders.");
			const values=[["$","div",null,{title:child}],"$2"];if(reverse)values.reverse();
			const inner='~0:'+JSON.stringify({q:"",i:false,t:{t:{s:"en",d:{r:values,p:true,v:null}}}})+'\n2:["$L9"]\n3:{"value":"$2"}\n';
			assert.equal(inspect(inner).complete,false,"A permitted cache-output alias cannot suppress the required other-prop alias.");
		}
		for(const required of [["$","$2",null,{}],["$","$Sreact.suspense",null,{fallback:"$2",children:"KNOWN"}],"$Q3"]){
			const values=[required,"$2"];if(reverse)values.reverse();
			const inner='~0:'+JSON.stringify({q:"",i:false,t:{t:{s:"en",d:{r:values,p:true,v:null}}}})+'\n2:["$L9"]\n3:[["key","$2"]]\n';
			assert.equal(inspect(inner).complete,false,"A shared type, fallback or collection remains required after the output alias.");
		}
		const direct={r:"$2",p:true,v:null},array={r:["$2"],p:true,v:null};
		const inner='~0:'+JSON.stringify({q:"",i:false,t:{t:{s:"en",d:reverse?array:direct},h:reverse?direct:array}})+'\n2:"$L9"\n';
		const proof=inspect(inner);assert.equal(proof.complete,true);assert.equal((shell?proof:proof.embeddedRuntimePrefetch).renderableOutputClaim,false,"Both logical direct-r and r-array aliases have a source-qualified cache-only representation.");
	}
});

test("partial cache ReactNode output follows known host and Fragment children without granting other prop permissions", () => {
	const outer=value=>Buffer.concat([Buffer.from('0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":"MAIN","p":false,"v":null}}},"p":"$1"}\n1:R\n1:o'+Buffer.byteLength(value).toString(16)+','),Buffer.from(value),Buffer.from('1:C\n')]);
	const encode=(r,rows="")=>'~0:'+JSON.stringify({q:"",i:false,t:{t:{s:"en",d:{r,p:true,v:null}}}})+'\n'+rows;
	for(const shell of [false,true]){
		const inspect=value=>inspectRequiredFlightBody(shell?Buffer.from(value):outer(value),{cachedNavigations:true,...(shell?{requestKind:"runtime-shell"}:{})});
		for(const type of ["div","$Sreact.fragment"])for(const children of ["$L9",["$L9"],[["$L9"]]]){
			const proof=inspect(encode(["$",type,null,{children}])),body=shell?proof:proof.embeddedRuntimePrefetch;
			assert.equal(proof.complete,true);assert.equal(body.postponedCacheOutputs,1);assert.equal(body.renderableOutputClaim,false);
			assert.equal(body.requiredStage,shell?"runtime-shell-cache-representation":"embedded-partial-prefetch-representation");
		}
		const direct=inspect(encode("$L9")),body=shell?direct:direct.embeddedRuntimePrefetch;
		assert.equal(direct.complete,true);assert.equal(body.representedOutputs,0);assert.equal(body.postponedCacheOutputs,1);
		const input=cancellationFixture();for(const row of [input.failures[0],input.proxy[0]])Object.assign(row,{requestKind:shell?"runtime-shell":"navigation",bodyProof:direct});Object.assign(input.failures[0],{bodyReadbackComplete:true});Object.assign(input.proxy[0],{complete:true,canceled:false});
		const receipt=classifyControlCancellations(input);assert.equal(cleanBrowserFailureEvidence(receipt,1),true);
		for(const changed of [{postponedCacheOutputs:undefined},{postponedCacheOutputs:0},{postponedCacheOutputs:"1"},{postponedCacheOutputs:100001},{renderableOutputClaim:true},{requiredStage:shell?"runtime-shell-output":"embedded-runtime-prefetch-output"}]){
			const corrupt=structuredClone(receipt),target=corrupt.records[0].proof.failure.bodyProof;Object.assign(shell?target:target.embeddedRuntimePrefetch,changed);assert.equal(cleanBrowserFailureEvidence(corrupt,1),false);
		}
		for(const invalid of [encode(["$","div",null,{title:"$L9",children:"KNOWN"}]),encode(["$","$L9",null,{children:"KNOWN"}]),encode(["$","$Sreact.suspense",null,{fallback:"$L9",children:"KNOWN"}]),encode(["$","div",null,{children:"$9"}]),encode(["$","div",null,{children:"$@9"}]),encode(["$","div",null,{children:"$L9"}]).replace(/^~/,'#'),encode("KNOWN")+'9:E{"digest":"PRIVATE"}\n'])
			assert.equal(inspect(invalid).complete,false);
	}
});

test("embedded partial prefetch represents postponed component props without claiming renderable output", () => {
	const inner = '~4:I["synthetic",[],"Component"]\n0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":["$","$4",null,{"data":"$L9"}],"p":true,"v":null}}}}\n';
	const outer = (value) => Buffer.concat([
		Buffer.from('0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":"KNOWN_MAIN","p":false,"v":null}}},"p":"$1"}\n1:R\n1:o'+Buffer.byteLength(value).toString(16)+','),
		Buffer.from(value), Buffer.from('1:C\n'),
	]);
	const proof = inspectRequiredFlightBody(outer(inner), { cachedNavigations: true });
	assert.equal(proof.complete, true);
	assert.equal(proof.embeddedRuntimePrefetch.requiredStage, "embedded-partial-prefetch-representation");
	assert.equal(proof.embeddedRuntimePrefetch.postponedComponentReferences, 1);
	assert.equal(proof.embeddedRuntimePrefetch.renderableOutputClaim, false);
	const pathUnknown=inspectRequiredFlightBody(outer(inner.replace('"$L9"','"$5:PRIVATE_KEY"')+'5:{}\n'),{cachedNavigations:true});
	assert.equal(pathUnknown.complete,false);assert.equal(pathUnknown.embeddedPathFailure,"missing-own-property");
	assert.doesNotMatch(JSON.stringify(pathUnknown),/PRIVATE_KEY/);
	const evidence = cancellationFixture();
	Object.assign(evidence.failures[0], { bodyProof: proof, bodyReadbackComplete: true });
	Object.assign(evidence.proxy[0], { bodyProof: proof, complete: true, canceled: false });
	const receipt = classifyControlCancellations(evidence);
	assert.equal(cleanBrowserFailureEvidence(receipt, 1), true);
	for (const changed of [{ renderableOutputClaim: true }, { postponedComponentReferences: 0 }, { requestKind: "navigation" }, { requiredStage: "embedded-runtime-prefetch-output" }]) {
		const corrupt = structuredClone(receipt);
		Object.assign(corrupt.records[0].proof.failure.bodyProof.embeddedRuntimePrefetch, changed);
		assert.equal(cleanBrowserFailureEvidence(corrupt, 1), false);
	}
	for (const invalid of [
		inner.replace(/^~/, '#'),
		inner.replace('"data":"$L9"', '"data":"$9"'),
		inner.replace('"data":"$L9"', '"data":"$@9"'),
		inner.replace('"$","$4"', '"$","$L9"'),
		inner.replace('"s":"en"', '"s":"$L9"'),
		inner.replace('"p":true', '"p":"$L9"'),
		inner.replace('"q":""', '"q":"$L9"'),
		inner.replace('"q":""', '"q":"","required":"$L9"'),
		inner.replace('"data":"$L9"', '"data":["$","$L9",null,{}]'),
		inner.replace('"data":"$L9"', '"data":["$","$Sreact.suspense",null,{"fallback":"$L9","children":"$L8"}]'),
		inner+'9:E{"digest":"SYNTHETIC_ERROR"}\n',
	]) assert.equal(inspectRequiredFlightBody(outer(invalid), { cachedNavigations: true }).complete, false);
	assert.equal(inspectRequiredFlightBody(Buffer.from(inner), { cachedNavigations: true }).complete, false,
		"An ordinary main response cannot opt into the detached embedded claim.");
	assert.equal(inspectRequiredFlightBody(Buffer.from(outer(inner).toString().replace('"KNOWN_MAIN"','"$L9"')), { cachedNavigations: true }).complete, false);
});

test("embedded partial prefetch represents a fulfilled module-element fallback without claiming its rendering", () => {
	const fallback='["$","$4",null,{"data":{"known":true}}]';
	const inner='~4:I["synthetic",[],"Component"]\n0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":["$","$Sreact.suspense",null,{"fallback":'+fallback+',"children":"$L9"}],"p":true,"v":null}}}}\n';
	const outer=value=>Buffer.concat([Buffer.from('0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":"KNOWN_MAIN","p":false,"v":null}}},"p":"$1"}\n1:R\n1:o'+Buffer.byteLength(value).toString(16)+','),Buffer.from(value),Buffer.from('1:C\n')]);
	const proof=inspectRequiredFlightBody(outer(inner),{cachedNavigations:true});
	assert.equal(proof.complete,true);
	assert.equal(proof.embeddedRuntimePrefetch.requiredStage,"embedded-partial-prefetch-representation");
	assert.equal(proof.embeddedRuntimePrefetch.representedComponentFallbacks,1);
	assert.equal(proof.embeddedRuntimePrefetch.postponedComponentReferences,0);
	assert.equal(proof.embeddedRuntimePrefetch.renderableOutputClaim,false);
	for(const valid of [inner.replace('"$","$4"','"$","$L4"'),inner.replace('{"data":{"known":true}}','"$5"')+'5:{"data":{"known":true}}\n'])
		assert.equal(inspectRequiredFlightBody(outer(valid),{cachedNavigations:true}).complete,true);
	const input=cancellationFixture();Object.assign(input.failures[0],{bodyProof:proof,bodyReadbackComplete:true});Object.assign(input.proxy[0],{bodyProof:proof,complete:true,canceled:false});
	const receipt=classifyControlCancellations(input);assert.equal(cleanBrowserFailureEvidence(receipt,1),true);
	for(const changed of [{representedComponentFallbacks:undefined},{representedComponentFallbacks:0},{representedComponentFallbacks:100000},{renderableOutputClaim:true},{requiredStage:"embedded-runtime-prefetch-output"}]){
		const corrupted=structuredClone(receipt);Object.assign(corrupted.records[0].proof.failure.bodyProof.embeddedRuntimePrefetch,changed);assert.equal(cleanBrowserFailureEvidence(corrupted,1),false);
	}
	for(const invalid of [inner.replace(/^~/,'#'),inner.replace(fallback,'"$4"'),inner.replace(fallback,'["$","$L8",null,{}]'),
		inner.replace(fallback,'["$","$4",null,{"data":"$L8"}]'),inner.replace(fallback,'["$","$4",null,{"data":"$@8"}]'),inner.replace(fallback,'["$","$4",null,{"data":"$8"}]'),
		inner.replace(fallback,'["$","$4",null,null]'),inner.replace(fallback,'["$","$4","$L8",{}]'),inner.replace('I["synthetic",[],"Component"]','I["synthetic"]'),inner+'8:E{"digest":"PRIVATE"}\n'])
		{
			assert.equal(inspectRequiredFlightBody(outer(invalid),{cachedNavigations:true}).complete,false);
			assert.equal(inspectRequiredFlightBody(Buffer.from(invalid),{requestKind:"runtime-shell",cachedNavigations:true}).complete,false);
		}
	const shell=inspectRequiredFlightBody(Buffer.from(inner),{requestKind:"runtime-shell",cachedNavigations:true});
	assert.equal(shell.complete,true);assert.equal(shell.requiredStage,"runtime-shell-cache-representation");assert.equal(shell.renderableOutputClaim,false);
});

test("embedded runtime prefetch has exact binary framing, explicit stream close and its own required Flight graph", () => {
	const inner = Buffer.from('#0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":"KNOWN_INNER","p":false,"v":null}}}}\n');
	const outer = (data, stream = "R", tag = "o", close = true, declared = data.length.toString(16)) => Buffer.concat([
		Buffer.from(`0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":"KNOWN_MAIN","p":true,"v":null}}},"p":"$1"}\n1:${stream}\n1:${tag}${declared},`),
		data, Buffer.from(close ? '1:C\n' : ''),
	]);
	for (const [stream, tag] of [["R", "o"], ["r", "b"]]) {
		const proof = inspectRequiredFlightBody(outer(inner, stream, tag), { cachedNavigations: true });
		assert.equal(proof.complete, true);
		assert.equal(proof.embeddedRuntimePrefetch.complete, true);
		assert.equal(proof.embeddedRuntimePrefetch.requestKind, "embedded-runtime-prefetch");
		assert.equal(proof.embeddedRuntimePrefetch.bodySha256, createHash("sha256").update(inner).digest("hex"));
		assert.doesNotMatch(JSON.stringify(proof), /KNOWN_MAIN|KNOWN_INNER/);
		const evidence = cancellationFixture();
		Object.assign(evidence.failures[0], { bodyProof: proof, bodyReadbackComplete: true });
		Object.assign(evidence.proxy[0], { bodyProof: proof, complete: true, canceled: false });
		const receipt = classifyControlCancellations(evidence);
		assert.equal(cleanBrowserFailureEvidence(receipt, 1), true);
		const corrupt = structuredClone(receipt);
		corrupt.records[0].proof.failure.bodyProof.embeddedRuntimePrefetch.serverErrors = 1;
		assert.equal(cleanBrowserFailureEvidence(corrupt, 1), false);
	}
	const partialInner = Buffer.from('~0:{"q":"","i":false,"a":"$@2","t":{"t":{"s":"en","d":{"r":["$","$Sreact.suspense",null,{"fallback":["$","span",null,{"children":"KNOWN_FALLBACK"}],"children":"$Ldead"}],"p":true,"v":null}}}}\n2:null\n');
	const partial = inspectRequiredFlightBody(outer(partialInner), { cachedNavigations: true });
	assert.equal(partial.complete, true);
	assert.equal(partial.embeddedRuntimePrefetch.requiredStage, "embedded-runtime-prefetch-output");
	assert.equal(partial.embeddedRuntimePrefetch.postponedOutputReferences, 1);
	const omitted = inspectRequiredFlightBody(outer(Buffer.from(partialInner.toString().replace('"fallback":["$","span",null,{"children":"KNOWN_FALLBACK"}],',''))), { cachedNavigations: true });
	assert.equal(omitted.complete,true);
	assert.equal(omitted.embeddedRuntimePrefetch.knownEmptyFallbacks,1);
	const componentFallback = Buffer.from(partialInner.toString().replace('["$","span",null,{"children":"KNOWN_FALLBACK"}]', '["$","$4",null,{"data":null}]')+'4:I["PRIVATE_MODULE"]\n');
	const fallbackUnknown = inspectRequiredFlightBody(outer(componentFallback), { cachedNavigations: true });
	assert.equal(fallbackUnknown.complete, false);
	assert.equal(fallbackUnknown.embeddedReason, "unknown-runtime-shell-fallback");
	assert.equal(fallbackUnknown.embeddedFallbackKind, "component-element");
	assert.equal(fallbackUnknown.embeddedFallbackElementTypeKind, "module-record");
	assert.equal(fallbackUnknown.embeddedFallbackPropsKind, "object");
	assert.doesNotMatch(JSON.stringify(fallbackUnknown), /PRIVATE|KNOWN_FALLBACK|dead/);
	const missingInner = Buffer.from('#0:{"q":"","i":false,"t":{"t":{"s":"en","d":{"r":"$Ldead","p":false,"v":null}}}}\n');
	const missing = inspectRequiredFlightBody(outer(missingInner), { cachedNavigations: true });
	assert.equal(missing.complete, false);
	assert.equal(missing.embeddedReason, "unresolved-model-reference");
	assert.deepEqual(missing.embeddedModelReference, { prefix: "L", form: "lazy-reference", length: 6 });
	assert.equal(missing.embeddedSemanticRole, "required");
	assert.equal(missing.embeddedMarker, "complete");
	assert.equal(missing.embeddedIsPartial, false);
	assert.equal(missing.embeddedRequestKind, "embedded-runtime-prefetch");
	assert.equal(missing.embeddedDecodedBytes, missingInner.length);
	assert.equal(missing.embeddedBodySha256, createHash("sha256").update(missingInner).digest("hex"));
	assert.doesNotMatch(JSON.stringify(missing), /dead|KNOWN_MAIN/);
	assert.equal(inspectRequiredFlightBody(outer(Buffer.from(partialInner.toString().replace(/^~/, '#'))), { cachedNavigations: true }).complete, false);
	for (const invalid of [
		outer(inner, "R", "o", false),
		outer(inner, "R", "o", true, (inner.length + 1).toString(16)),
		outer(inner.subarray(0, inner.length - 1), "R", "o", false, inner.length.toString(16)),
		outer(Buffer.from('0:E{"digest":"PRIVATE"}\n')),
		outer(Buffer.from('#0:{"t":{"t":"$dead"}}\n')),
		outer(inner, "X", "o"),
		outer(inner, "r", "o"),
		outer(inner, "R", "b"),
		Buffer.from(outer(inner).toString().replace('"p":"$1"', '"required":"$1"')),
		Buffer.from(outer(inner).toString().replace('"KNOWN_MAIN"', '"$Ldead"')),
		outer(Buffer.from('PRIVATE_NOT_FLIGHT')),
		outer(Buffer.from('abc'), "r", "b", false, "800001"),
	]) assert.equal(inspectRequiredFlightBody(invalid, { cachedNavigations: true }).complete, false);
	assert.equal(inspectRequiredFlightBody(inner, { requestKind: "embedded-runtime-prefetch", cachedNavigations: true }).complete, false,
		"The private inner contract cannot be selected by an unrelated public request.");
	const deep = inspectRequiredFlightBody(outer(Buffer.concat([Buffer.from('#'), outer(inner)])), { cachedNavigations: true });
	assert.equal(deep.complete, false, "Nested p depth cannot multiply work limits.");
	assert.equal(deep.embeddedReason, "embedded-prefetch-depth-or-contract");
	const lotsOfRows = Buffer.concat([inner, Buffer.from(Array.from({ length: 4093 }, (_, i) => `${(i + 10000).toString(16)}:null\n`).join(''))]);
	assert.equal(inspectRequiredFlightBody(outer(lotsOfRows), { cachedNavigations: true }).embeddedReason, "record-limit", "Protocol row cap is shared by outer and inner bodies.");
	const largeInner = Buffer.from(inner.toString().replace('KNOWN_INNER', 'x'.repeat(4 * 1024 * 1024 + 1)));
	assert.equal(inspectRequiredFlightBody(outer(largeInner), { cachedNavigations: true }).reason, "aggregate-decoded-limit", "The decoded budget is shared, not renewed per recursion.");
	const manyModels = Array(50000).fill(null);
	const modelInner = Buffer.from(inner.toString().replace('"KNOWN_INNER"', JSON.stringify(manyModels)));
	const modelOuter = Buffer.from(outer(modelInner).toString().replace('"KNOWN_MAIN"', JSON.stringify(manyModels)));
	assert.equal(inspectRequiredFlightBody(modelOuter, { cachedNavigations: true }).reason, "model-limit", "Model traversal cap is shared.");
	const sharedLimit=inspectRequiredFlightBody(modelOuter,{cachedNavigations:true}).modelLimitObservation;
	assert.equal(sharedLimit.site,"semantic-loop");assert.equal(sharedLimit.guard,"shared-model-work");
	assert.equal(sharedLimit.sharedModelSteps,100001);assert.equal(sharedLimit.modelCap,100000);assert.ok(sharedLimit.embeddedModelSteps>0);
	assert.ok(sharedLimit.inspected<=100000);assert.ok(sharedLimit.queueLength>0);
});

test("model-limit diagnostics identify queue width and local loop work without changing either guard",()=>{
	const encode=value=>Buffer.from('#0:'+JSON.stringify({t:{t:{s:"en",d:{r:value,p:false,v:null}}}})+'\n');
	const wide=inspectRequiredFlightBody(encode(Array(100001).fill(null)));
	assert.equal(wide.complete,false);assert.equal(wide.reason,"model-limit");
	assert.equal(wide.modelLimitObservation.site,"semantic-queue-size");assert.equal(wide.modelLimitObservation.objectKeyCount,100001);
	assert.ok(wide.modelLimitObservation.sharedModelSteps<100000);
	let branch=null;for(let i=0;i<17;i++)branch={left:branch,right:branch};
	const local=inspectRequiredFlightBody(encode(branch));
	assert.equal(local.complete,false);assert.equal(local.reason,"model-limit");
	assert.equal(local.modelLimitObservation.guard,"local-inspected-work");assert.equal(local.modelLimitObservation.inspected,100001);assert.equal(local.modelLimitObservation.sharedModelSteps,100000);
	for(const facts of [wide.modelLimitObservation,local.modelLimitObservation]){
		assert.equal(facts.depthCap,64);assert.equal(facts.modelCap,100000);assert.equal(facts.embeddedModelSteps,0);
		assert.ok(Number.isSafeInteger(facts.parentMemoChecks));assert.ok(Number.isSafeInteger(facts.eagerUniqueObjects));
		assert.equal(Object.values(facts).some(value=>typeof value==="string" && /PRIVATE|\$[a-f0-9]/.test(value)),false);
	}
});
