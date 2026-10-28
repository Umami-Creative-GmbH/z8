/** Actual authenticated header UI. The caller owns Page/auth/replica/trace interception. */
import { createHash } from "node:crypto";
import { waitVisible } from "./journey-steps.mjs";
import { observationTimeoutMs } from "./clean-evidence.mjs";
import { legacyClockReadinessAuthority } from "./browser-control-collector.mjs";

const initialFailureDiagnostics=new WeakMap();
const weakErrorKey=value=>value!==null&&(typeof value==="object"||typeof value==="function");
/** Metadata only: never retain, inspect or export the thrown value's fields. */
export function getPublicHeaderClockFailureDiagnostics(error){
	if(!weakErrorKey(error))return null;const value=initialFailureDiagnostics.get(error);
	return value?structuredClone(value):null;
}


/** Browser callback; Node caller supplies only its privately verified authority result. */
export function readPublicHeaderClockDOM(known,legacyQualified=false){
	// Diagnostic only: query metadata never participates in readiness.
function readMountedClockQueryState(button){
 const unknown=reason=>({known:false,reason,queryStatus:null,fetchStatus:null,isInvalidated:null,cachedHasEmployee:null,cachedIsClockedIn:null,observerCount:null,failureCount:null});
 const data=(value,key)=>value&&typeof value==='object'?Object.getOwnPropertyDescriptor(value,key)?.value:undefined;
 const method=(value,key)=>{for(let i=0;value&&i<8;i++,value=Object.getPrototypeOf(value)){const d=Object.getOwnPropertyDescriptor(value,key);if(d)return typeof d.value==='function'?d.value:null;}return null;};
 const call=(object,key,args=[])=>{const fn=method(object,key);if(!fn)throw Error();return Reflect.apply(fn,object,args);};
 try{
  if(!button||typeof button!=='object')return unknown('no-element');
  const keys=Object.getOwnPropertyNames(button);if(keys.length>32)return unknown('host-bound');const fiberKeys=keys.filter(key=>key.startsWith('__reactFiber$'));if(fiberKeys.length!==1)return unknown('fiber-unknown');
  const connected=Object.getOwnPropertyDescriptor(Node.prototype,'isConnected')?.get;if(!connected||!Reflect.apply(connected,button,[]))return unknown('not-mounted');
  const host=data(button,fiberKeys[0]),branches=[host,data(host,'alternate')].filter(Boolean),paths=[];let rootOwner=null;
  for(const first of branches){let node=first;const path=[],seen=new Set();let valid=data(first,'tag')===5&&data(first,'stateNode')===button;
   for(let depth=0;node&&depth<256;depth++){
    if(seen.has(node)){valid=false;break;}seen.add(node);path.push(node);const parent=data(node,'return');
    if(!parent){const root=data(node,'stateNode'),current=data(root,'current');if(data(node,'tag')!==3||!root||!current||typeof current!=='object'||(current!==node&&current!==data(node,'alternate'))||(rootOwner&&rootOwner!==root))valid=false;rootOwner=root;node=null;break;}node=parent;
   }
   if(node||!valid)return unknown('current-fiber-unknown');paths.push(path);
  }
  if(!paths.length)return unknown('current-fiber-unknown');
  const candidates=[];
  for(const path of paths){const found=[];for(const node of path){const client=data(data(node,'memoizedProps'),'client'),child=data(node,'child'),context=data(child,'type');if(!client||typeof data(node,'type')!=='function'||data(child,'tag')!==10||data(context,'$$typeof')!==Symbol.for('react.context')||data(data(child,'memoizedProps'),'value')!==client)continue;found.push(client);}if(found.length!==1)return unknown(found.length?'provider-multiple':'provider-unknown');candidates.push(found[0]);}
  if(candidates.some(value=>value!==candidates[0]))return unknown('provider-alternate-unknown');
  const client=candidates[0],key=['time-clock','status'],state=call(client,'getQueryState',[key]);if(!state)return unknown('query-absent');
  const cache=call(client,'getQueryCache'),query=call(cache,'get',['["time-clock","status"]']);if(!query||data(query,'state')!==state)return unknown('query-identity-unknown');
  const queryStatus=data(state,'status'),fetchStatus=data(state,'fetchStatus'),invalidated=data(state,'isInvalidated'),count=call(query,'getObserversCount'),failureCount=data(state,'fetchFailureCount');
  if(!['pending','success','error'].includes(queryStatus)||!['idle','fetching','paused'].includes(fetchStatus)||typeof invalidated!=='boolean'||!Number.isSafeInteger(count)||count<0||count>10000||!Number.isSafeInteger(failureCount)||failureCount<0||failureCount>10000)return unknown('state-unknown');
  const clockedIn=data(data(state,'data'),'isClockedIn'),hasEmployee=data(data(state,'data'),'hasEmployee');
  return {known:true,reason:'read-only-provider-query',queryStatus,fetchStatus,isInvalidated:invalidated,cachedHasEmployee:typeof hasEmployee==='boolean'?hasEmployee:null,cachedIsClockedIn:typeof clockedIn==='boolean'?clockedIn:null,observerCount:count,failureCount};
 }catch{return unknown('read-failed');}
}


			const buttons = [
				...document.querySelectorAll(
					'header button[aria-label="Clock In"],header button[aria-label="Clock Out"]',
				),
			],button=buttons.find((node) => node.getClientRects().length && !node.disabled);
			let value=null;
			if(button){value =
				button.getAttribute("aria-label") === "Clock In" ? "out" : "in";
			if (
				!button.closest('[data-clock-status="ready"]') &&
				(known?.hasEmployee !== true || known.isClockedIn !== (value === "in"))
			)
				value=null;}
			// Preserve the old readiness decision even if extra diagnostic reads fail.
			try{
			const markerFor=node=>{const marker=node.closest('[data-clock-status]')?.getAttribute("data-clock-status");return marker===undefined||marker===null?"absent":["ready","pending","unavailable"].includes(marker)?marker:"other";};
			const dom={known:true,candidates:Math.min(buttons.length,32),truncated:buttons.length>32,visible:0,enabledVisible:0,clockInVisible:0,clockOutVisible:0,clockInEnabledVisible:0,clockOutEnabledVisible:0,markers:{ready:0,pending:0,unavailable:0,absent:0,other:0},selectedLabel:button?button.getAttribute("aria-label")==="Clock In"?"clock-in":"clock-out":"none",marker:button?markerFor(button):"absent",state:value};
			for(const node of buttons.slice(0,32)){dom.markers[markerFor(node)]++;if(node.getClientRects().length){dom.visible++;if(node.getAttribute("aria-label")==="Clock In")dom.clockInVisible++;else dom.clockOutVisible++;if(!node.disabled){dom.enabledVisible++;if(node.getAttribute("aria-label")==="Clock In")dom.clockInEnabledVisible++;else dom.clockOutEnabledVisible++;}}}
			dom.conflictingUsableLabels=dom.clockInEnabledVisible>0&&dom.clockOutEnabledVisible>0?true:dom.truncated?null:false;
			dom.readinessAuthority=value===null?"unknown":"existing-marker-or-status";
			if(value===null && legacyQualified===true && button?.tagName==="BUTTON" && dom.truncated===false && dom.visible===1 && dom.enabledVisible===1 && dom.conflictingUsableLabels===false && dom.marker==="absent" && button.getAttribute("aria-disabled")!=="true" && !button.matches(":disabled") && typeof button.checkVisibility==="function" && button.checkVisibility({visibilityProperty:true,opacityProperty:true,contentVisibilityAuto:true})===true){
				value=button.getAttribute("aria-label")==="Clock In"?"out":"in";
				dom.state=value;dom.readinessAuthority="qualified-legacy-dom";
			}
			dom.mountedClockQuery=readMountedClockQueryState(button);
			return {value,dom};
			}catch{return {value,dom:{known:false,reason:"diagnostic-read-unavailable",state:value,mountedClockQuery:readMountedClockQueryState(null)}};}
		}
const pause = (ms) => new Promise((done) => setTimeout(done, ms));
function resultFrom(text) {
	try {
		return JSON.parse(text);
	} catch {}
	for (const line of text.split("\n"))
		try {
			const result = JSON.parse(line.slice(line.indexOf(":") + 1));
			if (typeof result?.isClockedIn === "boolean") return result;
		} catch {}
	return null;
}

async function verifyActor(page, expected) {
	const current = await page.evaluate(async () => {
		const response = await fetch("/api/auth/get-session", {
			credentials: "same-origin",
			cache: "no-store",
			signal: AbortSignal.timeout(5000),
		});
		return response.ok ? response.json() : null;
	});
	if (
		current?.user?.email !== expected.email ||
		current?.session?.activeOrganizationId !== expected.organizationId ||
		current?.mfaRequired ||
		current?.ssoRequired
	)
		throw new Error("Actual header actor does not match the fixture workload.");
}

/** No invented command bodies, action IDs, hidden clicks or automatic write retries. */
export async function openPublicHeaderClock(
	page,
	{ origin, expectedActor, phase = "release", timeoutMs = observationTimeoutMs(phase), browserControlBinding },
) {
	const url = new URL(origin);
	if (
		url.protocol !== "http:" ||
		!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
		url.username ||
		url.password ||
		url.pathname !== "/" ||
		url.search ||
		url.hash ||
		!expectedActor?.email ||
		!expectedActor.organizationId ||
		!Number.isFinite(timeoutMs) ||
		timeoutMs < 1 ||
		observationTimeoutMs(phase) === undefined ||
		timeoutMs > observationTimeoutMs(phase)
	)
		throw new Error(
			"An authenticated loopback fixture and bounded timeout are required.",
		);
	const legacyAuthority=legacyClockReadinessAuthority(browserControlBinding,{origin:url.origin,phase});
	let knownStatus = null,
		armed = false,
		needsResolution = false;
	const diagnostic={protocol:"public-header-clock-readiness-diagnostic-v1",acceptanceClaim:"none",polls:0,errors:0,overflow:0,eventOrdinal:0,requestFacts:0,navigationEvents:0,documentGeneration:0,actorVerifiedGeneration:null,pendingStatusReads:0,outOfOrderStatusUpdates:0,disposed:false,lastDOM:null,lastStatusRead:null,cachedStatus:null,attempt:null,writeResponse:null,failureStage:null};
	const requests=new WeakMap();let cachedStatusAt=null;
	// One bounded attempt view; raw requests remain only WeakMap keys.
	const actionReads={protocol:"public-clock-attempt-action-reads-v1",rowLimit:32,byteLimit:32768,retainedBytes:2048,attemptPrepareEventOrdinal:null,overflow:0,errors:0,records:[]};
	const actionReadUnknown=overflow=>{if(overflow){actionReads.overflow++;diagnostic.overflow++;}else{actionReads.errors++;diagnostic.errors++;}};
	const ordinal=()=>{if(diagnostic.eventOrdinal>=10000){diagnostic.overflow++;return null;}return ++diagnostic.eventOrdinal;};
	const snapshot=()=>structuredClone({...diagnostic,legacyReadinessSource:legacyAuthority,statusAgeMs:cachedStatusAt===null?null:Math.max(0,performance.now()-cachedStatusAt),
		attemptActionReads:{...actionReads,completeness:actionReads.overflow===0&&actionReads.errors===0&&diagnostic.overflow===0?"known":"UNKNOWN"},
		cachedStatusSameObservedNavigationGeneration:diagnostic.cachedStatus?.requestDocumentGeneration===undefined?null:diagnostic.cachedStatus.requestDocumentGeneration===diagnostic.documentGeneration,
		writeMatchesCurrentAttempt:Number.isSafeInteger(diagnostic.attempt?.submitEventOrdinal)&&Number.isSafeInteger(diagnostic.writeResponse?.submitEventOrdinal)?diagnostic.attempt.submitEventOrdinal===diagnostic.writeResponse.submitEventOrdinal:null,
		statusRequestAfterAcceptedWrite:diagnostic.writeResponse?.accepted===true && Number.isSafeInteger(diagnostic.cachedStatus?.requestEventOrdinal) && Number.isSafeInteger(diagnostic.writeResponse.acknowledgedEventOrdinal)?diagnostic.cachedStatus.requestEventOrdinal>diagnostic.writeResponse.acknowledgedEventOrdinal:null});
	const kind=value=>value===undefined?"absent":value===null?"null":typeof value==="boolean"?"boolean":"other";
	const actionRow=fact=>Number.isSafeInteger(fact?.requestEventOrdinal)?actionReads.records.find(row=>row.requestEventOrdinal===fact.requestEventOrdinal):null;
	const optionalRequestIdHash=request=>{try{const descriptor=Object.getOwnPropertyDescriptor(request,"id"),id=descriptor && Object.hasOwn(descriptor,"value")?descriptor.value:null;return typeof id==="string" && id.length>0 && id.length<=256 && Buffer.byteLength(id)<=256 && /^[A-Za-z0-9_.:-]+$/.test(id)?createHash("sha256").update(id).digest("hex"):null;}catch{return null;}};
	const observeActionRequest=(request,fact)=>{try{
		const headers=request.headers(),descriptor=Object.getOwnPropertyDescriptor(headers,"next-action");
		if(!descriptor){if("next-action" in headers)actionReadUnknown(false);return;}
		if(!Object.hasOwn(descriptor,"value")||typeof descriptor.value!=="string"||descriptor.value.length===0||Buffer.byteLength(descriptor.value)>1024||!Number.isSafeInteger(fact.requestEventOrdinal)||!Number.isSafeInteger(fact.documentGeneration)||fact.documentGeneration>10000){actionReadUnknown(false);return;}
		// Reserve the fixed row allowance before hashing or constructing its metadata.
		if(actionReads.records.length>=actionReads.rowLimit||actionReads.retainedBytes+960>actionReads.byteLimit){actionReadUnknown(true);return;}
		actionReads.retainedBytes+=960;
		const cdpRequestIdSha256=optionalRequestIdHash(request);
		actionReads.records.push({actionHeaderSha256:createHash("sha256").update(descriptor.value).digest("hex"),cdpRequestIdSha256,cdpRequestIdIdentity:cdpRequestIdSha256===null?"UNKNOWN":"known",requestEventOrdinal:fact.requestEventOrdinal,requestDocumentGeneration:fact.documentGeneration,requestAttemptPrepareEventOrdinal:actionReads.attemptPrepareEventOrdinal,attemptPrepareEventOrdinal:actionReads.attemptPrepareEventOrdinal,carryIn:false,responseEventOrdinal:null,responseDocumentGeneration:null,completedEventOrdinal:null,completedDocumentGeneration:null,failedEventOrdinal:null,httpStatus:null,parseOutcome:"request-pending",pending:true,statusReadPending:false,failure:null,hasEmployee:null,isClockedIn:null,deliveredToStatusCache:false});
	}catch{actionReadUnknown(false);}};
	const beginActionAttempt=prepareEventOrdinal=>{
		actionReads.records=actionReads.records.filter(row=>row.pending);
		for(const row of actionReads.records){row.carryIn=true;row.attemptPrepareEventOrdinal=prepareEventOrdinal;}
		actionReads.retainedBytes=2048+960*actionReads.records.length;
		actionReads.attemptPrepareEventOrdinal=prepareEventOrdinal;
	};
	const observeRequest=request=>{
		const eventOrdinal=ordinal();if(diagnostic.requestFacts>=10000){diagnostic.overflow++;return;}
		if(request && typeof request==="object" && !requests.has(request)){const fact={requestEventOrdinal:eventOrdinal,documentGeneration:diagnostic.documentGeneration,responseEventOrdinal:null};requests.set(request,fact);diagnostic.requestFacts++;observeActionRequest(request,fact);}
		else diagnostic.errors++;
	};
	const observeRequestFailed=request=>{try{const row=actionRow(requests.get(request));if(row){row.failedEventOrdinal=ordinal();row.pending=row.statusReadPending;row.failure="request-failed";row.parseOutcome="request-failed";}}catch{actionReadUnknown(false);}};
	const observeNavigation=frame=>{try{if(frame.parentFrame()===null){ordinal();diagnostic.navigationEvents++;diagnostic.documentGeneration++;}}catch{diagnostic.errors++;}};
	const observeStatus = async (response) => {
		const request=response.request(),headers=request.headers(),fact=requests.get(request),responseEventOrdinal=ordinal();
		if(fact)fact.responseEventOrdinal=responseEventOrdinal;
		if (!headers["next-action"]) return;
		const descriptor=Object.getOwnPropertyDescriptor(headers,"next-action"),action=descriptor && Object.hasOwn(descriptor,"value") && typeof descriptor.value==="string" && Buffer.byteLength(descriptor.value)<=1024?descriptor.value:null;
		const readRow=actionRow(fact);
		if(!readRow)actionReadUnknown(false);
		if(readRow){readRow.responseEventOrdinal=responseEventOrdinal;readRow.responseDocumentGeneration=diagnostic.documentGeneration;readRow.parseOutcome="response-pending";readRow.statusReadPending=true;readRow.pending=true;try{const status=response.status();readRow.httpStatus=Number.isInteger(status)&&status>=100&&status<=599?status:null;}catch{actionReadUnknown(false);}}
		let bodyUnavailable=false;diagnostic.pendingStatusReads++;
		const value = resultFrom(await response.text().catch(() => {bodyUnavailable=true;return "";}));
		diagnostic.pendingStatusReads--;
		let originMatches=null;try{originMatches=new URL(response.url()).origin===url.origin;}catch{diagnostic.errors++;}
		const metadata={source:"page-response-next-action",requestOrderKnown:Number.isSafeInteger(fact?.requestEventOrdinal),requestEventOrdinal:fact?.requestEventOrdinal ?? null,responseEventOrdinal,completedEventOrdinal:ordinal(),requestDocumentGeneration:fact?.documentGeneration ?? null,
			sameObservedNavigationGeneration:fact?fact.documentGeneration===diagnostic.documentGeneration:null,documentNavigationObserved:diagnostic.navigationEvents>0,originMatches,
			actionHeaderSha256Known:action!==null,actionHeaderSha256:action===null?null:createHash("sha256").update(action).digest("hex"),
			parseOutcome:bodyUnavailable?"body-unavailable":typeof value?.isClockedIn==="boolean"?"status-known":"unrecognized",
			hasEmployeeType:kind(value?.hasEmployee),hasEmployee:value?.hasEmployee===true?true:value?.hasEmployee===false?false:null,isClockedInType:kind(value?.isClockedIn),isClockedIn:typeof value?.isClockedIn==="boolean"?value.isClockedIn:null};
		diagnostic.lastStatusRead=metadata;
		if(readRow){readRow.completedEventOrdinal=metadata.completedEventOrdinal;readRow.completedDocumentGeneration=diagnostic.documentGeneration;readRow.pending=false;readRow.statusReadPending=false;readRow.parseOutcome=metadata.parseOutcome;readRow.hasEmployee=metadata.hasEmployee;readRow.isClockedIn=metadata.isClockedIn;if(bodyUnavailable&&readRow.failure===null)readRow.failure="body-unavailable";}
		if (typeof value?.isClockedIn === "boolean") {
			if(Number.isSafeInteger(diagnostic.cachedStatus?.requestEventOrdinal) && Number.isSafeInteger(metadata.requestEventOrdinal) && metadata.requestEventOrdinal<diagnostic.cachedStatus.requestEventOrdinal)diagnostic.outOfOrderStatusUpdates++;
			knownStatus = value;diagnostic.cachedStatus=metadata;cachedStatusAt=performance.now();
			if(readRow)readRow.deliveredToStatusCache=true;
		}
	};
	page.on("request",observeRequest);page.on("requestfailed",observeRequestFailed);page.on("framenavigated",observeNavigation);
	page.on("response", observeStatus);
	const dispose=()=>{diagnostic.disposed=true;page.off("request",observeRequest);page.off("requestfailed",observeRequestFailed);page.off("framenavigated",observeNavigation);page.off("response",observeStatus);};

	async function state(expected=null) {
		diagnostic.polls++;
		let observation;
		try{observation=await page.evaluate(readPublicHeaderClockDOM, knownStatus, legacyAuthority!==null);}catch(error){diagnostic.failureStage="readiness-read";diagnostic.errors++;throw error;}
		if(observation.dom.known!==true)diagnostic.errors++;
		diagnostic.lastDOM={...observation.dom,expected:["in","out"].includes(expected)?expected:null,expectedMatches:expected===null?null:observation.value===expected};
		return observation.value;
	}
	async function waitState(expected) {
		const deadline = performance.now() + timeoutMs;
		while (performance.now() < deadline) {
			const current = await state(expected ?? null);
			if (current && (!expected || current === expected)) return current;
			await pause(25);
		}
		diagnostic.failureStage="readiness-deadline";throw new Error("Authoritative usable header state did not settle.");
	}
	async function resolveState() {
		if (armed) throw new Error("A header command is already prepared.");
		knownStatus = null;
		diagnostic.cachedStatus=null;cachedStatusAt=null;
		diagnostic.failureStage="resolve-reload";
		await page.reload({ waitUntil: "domcontentloaded", timeout: timeoutMs });
		diagnostic.failureStage="resolve-actor";
		await verifyActor(page, expectedActor);
		diagnostic.actorVerifiedGeneration=diagnostic.documentGeneration;
		const current = await waitState();
		needsResolution = false;
		diagnostic.failureStage=null;
		return current;
	}
	try {
		await page.goto(`${url.origin}/en`, {
			waitUntil: "domcontentloaded",
			timeout: timeoutMs,
		});
		await verifyActor(page, expectedActor);
		diagnostic.actorVerifiedGeneration=diagnostic.documentGeneration;
		const capabilities = await page.evaluate(async () => {
			const response = await fetch("/api/time-entries/commands", {
				credentials: "same-origin",
				cache: "no-store",
				signal: AbortSignal.timeout(5000),
			});
			return response.ok ? response.json() : null;
		});
		if (
			capabilities?.onlineSubmit !== "available" ||
			capabilities?.submit !== "unavailable"
		)
			throw new Error(
				"The unchanged online legacy fixture is required before clock writes.",
			);
		await waitState("out");
	} catch (error) {
		try{if(weakErrorKey(error))initialFailureDiagnostics.set(error,{...snapshot(),capture:"initial-open-failure-before-dispose"});}catch{}
		dispose();
		throw error;
	}

	async function prepare(action) {
		if (!["in", "out"].includes(action) || armed || needsResolution)
			throw new Error(
				"Resolve previous work before preparing one header command.",
			);
		armed = true;
		diagnostic.attempt={action,prepareEventOrdinal:ordinal(),submitEventOrdinal:null,documentGeneration:diagnostic.documentGeneration};
		beginActionAttempt(diagnostic.attempt.prepareEventOrdinal);
		let button;
		try {
			diagnostic.failureStage="prepare-state";
			await waitState(action === "in" ? "out" : "in");
			diagnostic.failureStage="prepare-control";
			const label = action === "in" ? "Clock In" : "Clock Out";
			const trigger = await waitVisible(
				page,
				`header button[aria-label="${label}"]`,
				timeoutMs,
			);
			if (
				(await trigger.evaluate((node) =>
					node.getAttribute("aria-expanded"),
				)) !== "true"
			)
				await trigger.asLocator().setTimeout(timeoutMs).click();
			await page.waitForFunction(
				(label) =>
					[
						...document.querySelectorAll(
							'[data-slot="popover-content"] button',
						),
					].some(
						(node) =>
							node.textContent.trim() === label &&
							node.getClientRects().length &&
							!node.disabled,
					),
				{ timeout: timeoutMs },
				label,
			);
			for (const candidate of await page.$$(
				'[data-slot="popover-content"] button',
			))
				if (
					await candidate.evaluate(
						(node, label) =>
							node.textContent.trim() === label &&
							node.getClientRects().length &&
							!node.disabled,
						label,
					)
				) {
					button = candidate;
					break;
				}
			if (!button) throw new Error("Actual header submit control unavailable.");
		} catch (error) {
			armed = false;
			throw error;
		}
		let submitted = false;
		return {
			async submit() {
				if (submitted)
					throw new Error(
						"A prepared header write can be submitted only once.",
					);
				submitted = true;
				const started = performance.now();
				const submitEventOrdinal=ordinal(),submitDocumentGeneration=diagnostic.documentGeneration;
				diagnostic.attempt.submitEventOrdinal=submitEventOrdinal;
				diagnostic.failureStage="click";
				let sent = false,
					outcomeKnown = false,
					httpStatus = null,
					commandResponseMs = null,
					clockReadyMs = null;
				const observe = (request) => {
					if (
						new URL(request.url()).pathname === "/api/time-clock" &&
						request.method() === "POST"
					)
						sent = true;
				};
				page.on("request", observe);
				const response = page.waitForResponse(
					(value) =>
						new URL(value.url()).pathname === "/api/time-clock" &&
						value.request().method() === "POST" &&
						resultFrom(value.request().postData() ?? "")?.action ===
							`clock_${action}`,
					{ timeout: timeoutMs },
				);
				response.catch(() => {});
				try {
					await button.asLocator().setTimeout(timeoutMs).click();
					diagnostic.failureStage="response";
					const received = await response;
					diagnostic.failureStage="caller-result";
					const payload = resultFrom(await received.text());
					const serverQueuedDescriptor=payload && typeof payload==="object"?Object.getOwnPropertyDescriptor(payload,"queued"):undefined;
					const serverQueued=serverQueuedDescriptor && Object.hasOwn(serverQueuedDescriptor,"value")?serverQueuedDescriptor.value:undefined;
					httpStatus = received.status();
					outcomeKnown = typeof payload?.success === "boolean";
					commandResponseMs = performance.now() - started;
					const request=received.request(),fact=requests.get(request);let originMatches=null;try{originMatches=new URL(received.url()).origin===url.origin;}catch{diagnostic.errors++;}
					diagnostic.writeResponse={source:"matched-public-clock-response",action,submitEventOrdinal,submitDocumentGeneration,acknowledgedEventOrdinal:ordinal(),sendObserved:sent,
						requestOrderKnown:Number.isSafeInteger(fact?.requestEventOrdinal),requestEventOrdinal:fact?.requestEventOrdinal ?? null,responseEventOrdinal:fact?.responseEventOrdinal ?? null,requestDocumentGeneration:fact?.documentGeneration ?? null,
						requestStartedAfterSubmit:Number.isSafeInteger(fact?.requestEventOrdinal)&&Number.isSafeInteger(submitEventOrdinal)?fact.requestEventOrdinal>submitEventOrdinal:null,
						sameObservedNavigationGeneration:fact?fact.documentGeneration===diagnostic.documentGeneration:null,documentNavigationObserved:diagnostic.navigationEvents>0,originMatches,httpStatus,
						successType:kind(payload?.success),success:outcomeKnown?payload.success:null,accepted:received.ok()&&payload?.success===true,
						serverQueuedFieldPresent:serverQueuedDescriptor!==undefined,serverQueuedFieldType:serverQueuedDescriptor===undefined?"absent":kind(serverQueued),serverQueued:typeof serverQueued==="boolean"?serverQueued:null};
					if (!received.ok() || payload?.success !== true)
						throw new Error("Public clock write refused.");
					diagnostic.failureStage="readiness-read";
					await waitState(action === "in" ? "in" : "out");
					clockReadyMs = performance.now() - started;
					diagnostic.failureStage="popover-dismiss";
					if (action === "out")
						for (const skip of await page.$$(
							'[data-slot="popover-content"] button',
						))
							if (
								await skip.evaluate(
									(node) =>
										node.textContent.trim() === "Skip" &&
										node.getClientRects().length,
								)
							) {
								await skip.click();
								break;
							}
					diagnostic.failureStage=null;
					return {
						success: true,
						censored: false,
						unknownCommandOutcome: false,
						httpStatus,
						commandResponseMs,
						clockReadyMs,
						elapsedUntilFailureMs: null,
						clockReadinessDiagnostics:snapshot(),
					};
				} catch {
					needsResolution = sent;
					return {
						success: false,
						censored: true,
						unknownCommandOutcome: sent && !outcomeKnown,
						httpStatus,
						commandResponseMs,
						clockReadyMs,
						elapsedUntilFailureMs: performance.now() - started,
						clockReadinessDiagnostics:snapshot(),
					};
				} finally {
					armed = false;
					page.off("request", observe);
				}
			},
		};
	}
	return {
		prepare,
		state,
		resolveState,
		snapshot,
		dispose,
	};
}
