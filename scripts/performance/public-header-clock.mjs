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
			return {value,dom};
			}catch{return {value,dom:{known:false,reason:"diagnostic-read-unavailable",state:value}};}
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
	const ordinal=()=>{if(diagnostic.eventOrdinal>=10000){diagnostic.overflow++;return null;}return ++diagnostic.eventOrdinal;};
	const snapshot=()=>structuredClone({...diagnostic,legacyReadinessSource:legacyAuthority,statusAgeMs:cachedStatusAt===null?null:Math.max(0,performance.now()-cachedStatusAt),
		cachedStatusSameObservedNavigationGeneration:diagnostic.cachedStatus?.requestDocumentGeneration===undefined?null:diagnostic.cachedStatus.requestDocumentGeneration===diagnostic.documentGeneration,
		writeMatchesCurrentAttempt:Number.isSafeInteger(diagnostic.attempt?.submitEventOrdinal)&&Number.isSafeInteger(diagnostic.writeResponse?.submitEventOrdinal)?diagnostic.attempt.submitEventOrdinal===diagnostic.writeResponse.submitEventOrdinal:null,
		statusRequestAfterAcceptedWrite:diagnostic.writeResponse?.accepted===true && Number.isSafeInteger(diagnostic.cachedStatus?.requestEventOrdinal) && Number.isSafeInteger(diagnostic.writeResponse.acknowledgedEventOrdinal)?diagnostic.cachedStatus.requestEventOrdinal>diagnostic.writeResponse.acknowledgedEventOrdinal:null});
	const kind=value=>value===undefined?"absent":value===null?"null":typeof value==="boolean"?"boolean":"other";
	const observeRequest=request=>{
		const eventOrdinal=ordinal();if(diagnostic.requestFacts>=10000){diagnostic.overflow++;return;}
		if(request && typeof request==="object" && !requests.has(request)){requests.set(request,{requestEventOrdinal:eventOrdinal,documentGeneration:diagnostic.documentGeneration,responseEventOrdinal:null});diagnostic.requestFacts++;}
		else diagnostic.errors++;
	};
	const observeNavigation=frame=>{try{if(frame.parentFrame()===null){ordinal();diagnostic.navigationEvents++;diagnostic.documentGeneration++;}}catch{diagnostic.errors++;}};
	const observeStatus = async (response) => {
		const request=response.request(),headers=request.headers(),fact=requests.get(request),responseEventOrdinal=ordinal();
		if(fact)fact.responseEventOrdinal=responseEventOrdinal;
		if (!headers["next-action"]) return;
		const descriptor=Object.getOwnPropertyDescriptor(headers,"next-action"),action=descriptor && Object.hasOwn(descriptor,"value") && typeof descriptor.value==="string" && Buffer.byteLength(descriptor.value)<=1024?descriptor.value:null;
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
		if (typeof value?.isClockedIn === "boolean") {
			if(Number.isSafeInteger(diagnostic.cachedStatus?.requestEventOrdinal) && Number.isSafeInteger(metadata.requestEventOrdinal) && metadata.requestEventOrdinal<diagnostic.cachedStatus.requestEventOrdinal)diagnostic.outOfOrderStatusUpdates++;
			knownStatus = value;diagnostic.cachedStatus=metadata;cachedStatusAt=performance.now();
		}
	};
	page.on("request",observeRequest);page.on("framenavigated",observeNavigation);
	page.on("response", observeStatus);
	const dispose=()=>{diagnostic.disposed=true;page.off("request",observeRequest);page.off("framenavigated",observeNavigation);page.off("response",observeStatus);};

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
					httpStatus = received.status();
					outcomeKnown = typeof payload?.success === "boolean";
					commandResponseMs = performance.now() - started;
					const request=received.request(),fact=requests.get(request);let originMatches=null;try{originMatches=new URL(received.url()).origin===url.origin;}catch{diagnostic.errors++;}
					diagnostic.writeResponse={source:"matched-public-clock-response",action,submitEventOrdinal,submitDocumentGeneration,acknowledgedEventOrdinal:ordinal(),sendObserved:sent,
						requestOrderKnown:Number.isSafeInteger(fact?.requestEventOrdinal),requestEventOrdinal:fact?.requestEventOrdinal ?? null,responseEventOrdinal:fact?.responseEventOrdinal ?? null,requestDocumentGeneration:fact?.documentGeneration ?? null,
						requestStartedAfterSubmit:Number.isSafeInteger(fact?.requestEventOrdinal)&&Number.isSafeInteger(submitEventOrdinal)?fact.requestEventOrdinal>submitEventOrdinal:null,
						sameObservedNavigationGeneration:fact?fact.documentGeneration===diagnostic.documentGeneration:null,documentNavigationObserved:diagnostic.navigationEvents>0,originMatches,httpStatus,
						successType:kind(payload?.success),success:outcomeKnown?payload.success:null,accepted:received.ok()&&payload?.success===true};
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
