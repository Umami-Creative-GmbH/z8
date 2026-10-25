/** One declared negative-test response; raw HTTP errors are never removed. */
import { channel } from "node:diagnostics_channel";

const path = "/api/time-entries/status";
// Signed-out endpoint contract: 401. Qualified DE0 desktop/mobile MFA/SSO
// controls each returned the existing fail-closed no-active-organization 400.
// Never select an expected status from the response currently under test.
const statuses = { "signed-out": 401, mfa: 400, sso: 400 };
export function createAdmissionResponseWitness({ origin, traceIds, scenario }) {
	if (!Object.hasOwn(statuses, scenario))
		throw Error("Unknown admission scenario.");
	const target = new URL(origin);
	if (
		target.protocol !== "http:" ||
		!["localhost", "127.0.0.1"].includes(target.hostname)
	)
		throw Error("Admission witness requires the owned loopback origin.");
	const ids = new Set(traceIds);
	if (ids.size !== 3 || [...ids].some((id) => !/^[a-f0-9]{32}$/.test(id)))
		throw Error(
			"Admission witness requires this context's three registered IDs.",
		);
	const expected = {
		method: "GET",
		path,
		status: statuses[scenario],
		count: 1,
	};
	let matches = 0,
		confirmed = false,
		unknown = 0,
		acknowledgement = null;
	const responses = [];
	const observe = ({ request }) => {
		try {
			const parent = /^00-([a-f0-9]{32})-[a-f0-9]{16}-0[01]$/i.exec(
				String(request.getHeader("traceparent") ?? ""),
			);
			if (
				String(request.getHeader("host")) !== target.host ||
				!parent ||
				!ids.has(parent[1])
			)
				return;
			const url = new URL(request.path, origin);
			if (
				url.origin !== origin ||
				url.pathname !== path ||
				url.search ||
				request.method !== expected.method
			)
				return;
			matches++;
			if (responses.length >= 2) return; // Retention bounded; total cardinality still rejects every duplicate.
			const row = {
				status: null,
				json: false,
				ended: false,
				aborted: false,
				error: false,
			};
			responses.push(row);
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
	const subscription = channel("http.client.request.start");
	subscription.subscribe(observe);
	return {
		confirm({ response, clockStatusDenied, protectedContentEmitted }) {
			if (
				confirmed ||
				clockStatusDenied !== true ||
				protectedContentEmitted !== false ||
				response?.status !== expected.status ||
				response.json !== true ||
				response.redirected !== false ||
				response.hasEmployee !== false ||
				response.employeeIdMaterialized !== false ||
				response.clockedIn !== false ||
				response.activePeriodMaterialized !== false
			)
				throw Error(
					"The declared response did not prove admission denial without protected data.",
				);
			confirmed = true;
			acknowledgement = {
				status: response.status,
				json: true,
				redirected: false,
				clockStatusDenied: true,
				protectedContentEmitted: false,
				hasEmployee: false,
				employeeIdMaterialized: false,
				clockedIn: false,
				activePeriodMaterialized: false,
			};
		},
		snapshot() {
			return {
				kind: "declared-clock-admission-response-v1",
				scenario,
				expected,
				matches,
				confirmed,
				unknown,
				acknowledgement,
				responses: structuredClone(responses),
			};
		},
		close() {
			subscription.unsubscribe(observe);
		},
	};
}

export function admissionResponseComplete(proof) {
	const expected = proof?.expected,
		response = proof?.responses?.[0],
		ack = proof?.acknowledgement;
	return (
		proof?.kind === "declared-clock-admission-response-v1" &&
		Object.hasOwn(statuses, proof.scenario) &&
		expected?.method === "GET" &&
		expected.path === path &&
		expected.status === statuses[proof.scenario] &&
		expected.count === 1 &&
		proof.matches === 1 &&
		Array.isArray(proof.responses) &&
		proof.responses.length === 1 &&
		proof.confirmed === true &&
		proof.unknown === 0 &&
		ack?.status === expected.status &&
		ack.json === true &&
		ack.redirected === false &&
		ack.clockStatusDenied === true &&
		ack.protectedContentEmitted === false &&
		ack.hasEmployee === false &&
		ack.employeeIdMaterialized === false &&
		ack.clockedIn === false &&
		ack.activePeriodMaterialized === false &&
		response.status === expected.status &&
		response.json === true &&
		response.ended === true &&
		response.aborted === false &&
		response.error === false
	);
}
