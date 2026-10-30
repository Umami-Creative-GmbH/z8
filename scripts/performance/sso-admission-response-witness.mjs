/** Exact fail-closed missing-IdP fixture flow. This never claims successful SSO. */
import { channel } from "node:diagnostics_channel";

const contracts = [
	{
		path: "/api/organizations/switch",
		message:
			"Sign in with your organization's SSO provider to access this organization",
		code: "SSO_REQUIRED",
	},
	{
		path: "/api/organizations/sso",
		message:
			"SSO sign-in could not be started. Try again or contact your organization administrator.",
		code: null,
	},
];
export function createSsoAdmissionResponseWitness({
	origin,
	traceIds,
	contextId,
	page,
}) {
	const target = new URL(origin),
		ids = new Set(traceIds);
	if (
		target.protocol !== "http:" ||
		!["localhost", "127.0.0.1"].includes(target.hostname) ||
		target.origin !== origin ||
		ids.size !== 3 ||
		[...ids].some((id) => !/^[a-f0-9]{32}$/.test(id)) ||
		!/^[a-f0-9]{32}$/.test(contextId)
	)
		throw Error("SSO witness requires its owned registered browser context.");
	const forwards = [],
		bodies = [];
	let overflow = 0,
		unknown = 0,
		confirmed = false,
		acknowledgement = null,
		pendingBodies = 0,
		deadline;
	const contractFor = (url, method) =>
		url.origin === origin && !url.search && method === "POST"
			? contracts.find((c) => c.path === url.pathname)
			: undefined;
	const observe = ({ request }) => {
		try {
			const parent = /^00-([a-f0-9]{32})-[a-f0-9]{16}-0[01]$/i.exec(
				String(request.getHeader("traceparent") ?? ""),
			);
			if (
				request.getHeader("host") !== target.host ||
				!parent ||
				!ids.has(parent[1])
			)
				return;
			const contract = contractFor(
				new URL(request.path, origin),
				request.method,
			);
			if (!contract) return;
			if (forwards.length >= 4) {
				overflow++;
				return;
			}
			const row = {
				traceId: parent[1],
				method: "POST",
				path: contract.path,
				status: null,
				json: false,
				ended: false,
				aborted: false,
				error: false,
			};
			forwards.push(row);
			request.once("error", () => {
				row.error = true;
			});
			request.once("response", (answer) => {
				row.status = answer.statusCode;
				row.json =
					String(answer.headers["content-type"] ?? "").split(";", 1)[0] ===
					"application/json";
				answer.once("end", () => {
					row.ended = true;
				});
				answer.once("aborted", () => {
					row.aborted = true;
				});
				answer.once("error", () => {
					row.error = true;
				});
			});
		} catch {
			unknown++;
		}
	};
	const observeBody = (response) => {
		let contract;
		try {
			contract = contractFor(
				new URL(response.url()),
				response.request().method(),
			);
		} catch {
			unknown++;
			return;
		}
		if (!contract) return;
		if (bodies.length >= 4) {
			overflow++;
			return;
		}
		const row = {
			method: "POST",
			path: contract.path,
			status: response.status(),
			json: false,
			readComplete: false,
			bounded: false,
			bytes: null,
			exactShape: false,
		};
		bodies.push(row);
		pendingBodies++;
		void (async () => {
			row.json =
				String(response.headers()["content-type"] ?? "").split(";", 1)[0] ===
				"application/json";
			if (row.status !== 403 || !row.json) return;
			const length = Number(response.headers()["content-length"]);
			if (Number.isFinite(length) && length > 4096) return;
			const bytes = await response.buffer();
			row.bytes = bytes.length;
			row.readComplete = true;
			if (bytes.length > 4096) return;
			row.bounded = true;
			const body = JSON.parse(bytes.toString("utf8"));
			const keys =
				body && typeof body === "object" && !Array.isArray(body)
					? Object.keys(body).sort()
					: [];
			row.exactShape =
				JSON.stringify(keys) ===
					JSON.stringify(contract.code ? ["code", "error"] : ["error"]) &&
				body.error === contract.message &&
				(!contract.code || body.code === contract.code);
		})()
			.catch(() => {
				unknown++;
			})
			.finally(() => {
				pendingBodies--;
			});
	};
	const subscription = channel("http.client.request.start");
	subscription.subscribe(observe);
	page.on("response", observeBody);
	const snapshot = () => ({
		kind: "missing-provider-sso-admission-v1",
		contextId,
		registeredTraceIds: [...ids],
		expected: contracts.map((c) => ({
			method: "POST",
			path: c.path,
			status: 403,
			count: 1,
		})),
		forwards: structuredClone(forwards),
		bodies: structuredClone(bodies),
		overflow,
		unknown,
		pendingBodies,
		confirmed,
		acknowledgement,
	});
	return {
		snapshot,
		acknowledge(input) {
			if (
				acknowledgement ||
				input.clockStatusDenied !== true ||
				input.protectedContentEmitted !== false ||
				!Number.isFinite(input.deadline) ||
				performance.now() >= input.deadline
			)
				throw Error(
					"SSO admission assertions or original deadline are incomplete.",
				);
			deadline = input.deadline;
			acknowledgement = {
				clockStatusDenied: true,
				protectedContentEmitted: false,
				blockedInit: false,
			};
		},
		async confirmAfterCleanup() {
			if (confirmed || !acknowledgement || performance.now() >= deadline)
				throw Error(
					"SSO admission did not prove its blocked missing-provider UI within the navigation deadline.",
				);
			let timer;
			let dom;
			try {
				dom = await Promise.race([
					page.evaluate(() => ({
						documentReady: Boolean(document.documentElement && document.body),
						pathname: location.pathname,
						blockedInit: Boolean(
							document
								.querySelector(
									'[data-testid="init-organization-picker"] [role="alert"]',
								)
								?.textContent?.trim() ===
								"SSO sign-in could not be started. Try again or contact your organization administrator.",
						),
						protectedContent: Boolean(
							document.querySelector(
								'header [data-clock-status], [data-widget-id], [data-testid="manager-today-metrics"]',
							),
						),
					})),
					new Promise((_done, reject) => {
						timer = setTimeout(
							() =>
								reject(
									Error(
										"SSO blocked UI observation exceeded the original navigation deadline.",
									),
								),
							deadline - performance.now(),
						);
					}),
				]);
			} finally {
				clearTimeout(timer);
			}
			if (
				performance.now() >= deadline ||
				dom.documentReady !== true ||
				dom.pathname !== "/en/init" ||
				dom.blockedInit !== true ||
				dom.protectedContent !== false
			)
				throw Error(
					"SSO missing-provider picker was not proved without protected content.",
				);
			confirmed = true;
			acknowledgement.blockedInit = true;
			if (!ssoAdmissionResponsesComplete(snapshot(), contextId))
				throw Error("Missing-provider SSO response proof is incomplete.");
		},
		close() {
			subscription.unsubscribe(observe);
			page.off("response", observeBody);
		},
	};
}
export function ssoAdmissionResponsesComplete(proof, contextId) {
	if (
		typeof contextId !== "string" ||
		!/^[a-f0-9]{32}$/.test(contextId) ||
		proof?.kind !== "missing-provider-sso-admission-v1" ||
		proof.contextId !== contextId ||
		proof.confirmed !== true ||
		proof.overflow !== 0 ||
		proof.unknown !== 0 ||
		proof.pendingBodies !== 0 ||
		!Array.isArray(proof.registeredTraceIds) ||
		proof.registeredTraceIds.length !== 3 ||
		new Set(proof.registeredTraceIds).size !== 3 ||
		proof.registeredTraceIds.some((id) => !/^[a-f0-9]{32}$/.test(id)) ||
		proof.acknowledgement?.clockStatusDenied !== true ||
		proof.acknowledgement.protectedContentEmitted !== false ||
		proof.acknowledgement.blockedInit !== true ||
		!Array.isArray(proof.expected) ||
		proof.expected.length !== 2 ||
		!Array.isArray(proof.forwards) ||
		proof.forwards.length !== 2 ||
		!Array.isArray(proof.bodies) ||
		proof.bodies.length !== 2
	)
		return false;
	return contracts.every((c) => {
		const declared = proof.expected.filter((r) => r.path === c.path),
			forward = proof.forwards.filter((r) => r.path === c.path),
			body = proof.bodies.filter((r) => r.path === c.path);
		return (
			declared.length === 1 &&
			declared[0].method === "POST" &&
			declared[0].status === 403 &&
			declared[0].count === 1 &&
			forward.length === 1 &&
			body.length === 1 &&
			forward[0].status === 403 &&
			forward[0].method === "POST" &&
			proof.registeredTraceIds.includes(forward[0].traceId) &&
			body[0].method === "POST" &&
			forward[0].json === true &&
			forward[0].ended === true &&
			forward[0].aborted === false &&
			forward[0].error === false &&
			body[0].status === 403 &&
			body[0].json === true &&
			body[0].readComplete === true &&
			body[0].bounded === true &&
			Number.isSafeInteger(body[0].bytes) &&
			body[0].bytes > 0 &&
			body[0].bytes <= 4096 &&
			body[0].exactShape === true
		);
	});
}
