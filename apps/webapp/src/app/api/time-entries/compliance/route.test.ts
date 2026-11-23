import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComplianceAlert, RestPeriodCheckResult } from "@/db/schema";
import type { ExceptionWithDetails } from "@/lib/effect/services/compliance-guardrail.service";
import { parseSuperJsonResponse } from "@/lib/superjson";
import type { StubCaller } from "@/test/organization-action";

const state = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	timezone: vi.fn(async (): Promise<{ timezone: string } | undefined> => ({
		timezone: "Europe/Berlin",
	})),
	rest: vi.fn(),
	alerts: vi.fn(),
	exceptions: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () =>
	(await import("@/test/effect-runtime")).runtimeModuleOver(
		(await import("@/test/organization-action")).organizationActionStubLayer(() => state.caller, {
			db: { query: { userSettings: { findFirst: state.timezone } } },
		}),
	),
);

vi.mock("@/lib/effect/services/compliance-guardrail.service", async (importOriginal) => {
	const original =
		await importOriginal<typeof import("@/lib/effect/services/compliance-guardrail.service")>();
	const { Effect, Layer } = await import("effect");
	const unexpected = () =>
		Effect.die("This clock display must not read or mutate unused compliance data");
	return {
		...original,
		ComplianceGuardrailServiceLive: Layer.succeed(original.ComplianceGuardrailService, {
			checkRestPeriod: state.rest,
			getProactiveAlerts: state.alerts,
			getMyExceptions: state.exceptions,
			getComplianceStatus: unexpected,
			getOvertimeStats: unexpected,
			requestException: unexpected,
			hasValidException: unexpected,
			markExceptionAsUsed: unexpected,
			expireOldExceptions: unexpected,
		}),
	};
});

const { GET } = await import("./route");

const member: StubCaller = {
	userId: "user-a",
	activeOrganizationId: "org-a",
	membershipRole: "member",
	employee: { id: "employee-a", role: "employee", former: false },
};
const blockedRest: RestPeriodCheckResult = {
	canClockIn: false,
	enforcement: "block",
	violation: null,
	hasValidException: false,
	minutesUntilAllowed: 30,
	nextAllowedClockIn: new Date("2026-11-17T09:00:00Z"),
};
const exceptions: ExceptionWithDetails[] = [
	{
		id: "exception-a",
		exceptionType: "rest_period",
		status: "approved",
		reason: "Approved change",
		plannedDurationMinutes: null,
		validFrom: new Date("2026-11-17T00:00:00Z"),
		validUntil: new Date("2026-11-18T00:00:00Z"),
		wasUsed: false,
		employee: { id: "employee-a", userId: "user-a", firstName: null, lastName: null },
		createdAt: new Date("2026-11-16T10:00:00Z"),
	},
];
const alerts: ComplianceAlert[] = [
	{ alertType: "overtime_daily", severity: "warning", message: "Approaching the daily threshold" },
];

function request(
	query = "mode=idle&currentSessionMinutes=0",
	headers: Record<string, string> = {},
) {
	return new Request(`http://localhost/api/time-entries/compliance?${query}`, {
		headers: { "x-z8-context-user": "user-a", "x-z8-context-organization": "org-a", ...headers },
	});
}

describe("GET /api/time-entries/compliance", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.spyOn(console, "error").mockImplementation(() => {});
		state.caller = structuredClone(member);
		state.timezone.mockResolvedValue({ timezone: "Europe/Berlin" });
		state.rest.mockImplementation(() => Effect.succeed(blockedRest));
		state.alerts.mockImplementation(() => Effect.succeed(alerts));
		state.exceptions.mockImplementation(() => Effect.succeed(exceptions));
	});

	it("loads only idle clock notices, preserving rest and exception Date values", async () => {
		const response = await GET(request());
		expect(response.status).toBe(200);
		expect(response.headers.get("cache-control")).toBe("private, no-store");
		expect(await parseSuperJsonResponse(response)).toEqual({
			scope: { userId: "user-a", organizationId: "org-a", employeeId: "employee-a" },
			mode: "idle",
			restPeriod: blockedRest,
			alerts: [],
			myExceptions: exceptions,
		});
		expect(state.rest).toHaveBeenCalledExactlyOnceWith({
			employeeId: "employee-a",
			timezone: "Europe/Berlin",
		});
		expect(state.exceptions).toHaveBeenCalledExactlyOnceWith({
			employeeId: "employee-a",
			includeExpired: false,
		});
		expect(state.alerts).not.toHaveBeenCalled();
	});

	it("polls only active alerts and uses the authenticated employee's timezone", async () => {
		const response = await GET(request("mode=active&currentSessionMinutes=120"));
		expect(response.status).toBe(200);
		expect(await parseSuperJsonResponse(response)).toMatchObject({
			mode: "active",
			restPeriod: null,
			alerts,
			myExceptions: [],
		});
		expect(state.alerts).toHaveBeenCalledExactlyOnceWith({
			employeeId: "employee-a",
			timezone: "Europe/Berlin",
			currentSessionMinutes: 120,
		});
		expect(state.rest).not.toHaveBeenCalled();
		expect(state.exceptions).not.toHaveBeenCalled();
	});

	it("retains the existing zero-minute alert behavior", async () => {
		const response = await GET(request("mode=active&currentSessionMinutes=0"));
		expect(response.status).toBe(200);
		expect(state.alerts).not.toHaveBeenCalled();
	});

	it.each([
		[null, 401],
		[{ ...member, activeOrganizationId: null }, 403],
		[{ ...member, membershipRole: null }, 403],
		[{ ...member, employee: { ...member.employee!, former: true } }, 403],
		[{ ...member, organizationAccessRefused: true }, 401],
		[{ ...member, membershipRole: "owner", employee: null }, 404],
	] satisfies Array<[StubCaller | null, number]>)(
		"refuses inaccessible callers before any display read: %j",
		async (caller, status) => {
			state.caller = caller;
			const response = await GET(request());
			expect(response.status).toBe(status);
			expect(response.headers.get("cache-control")).toBe("private, no-store");
			expect(state.timezone).not.toHaveBeenCalled();
			expect(state.rest).not.toHaveBeenCalled();
			expect(state.alerts).not.toHaveBeenCalled();
			expect(state.exceptions).not.toHaveBeenCalled();
		},
	);

	it.each([
		{ "x-z8-context-user": "another-user" },
		{ "x-z8-context-organization": "another-org" },
	])("rejects stale display scope without granting target selection: %j", async (headers) => {
		const response = await GET(request(undefined, headers));
		expect(response.status).toBe(409);
		expect(state.timezone).not.toHaveBeenCalled();
		expect(state.rest).not.toHaveBeenCalled();
	});

	it("rechecks membership on every poll instead of retaining prior authorization", async () => {
		expect((await GET(request())).status).toBe(200);
		state.caller = { ...member, membershipRole: null };
		state.rest.mockClear();
		expect((await GET(request())).status).toBe(403);
		expect(state.rest).not.toHaveBeenCalled();
	});

	it.each([
		"mode=idle&currentSessionMinutes=-1",
		"mode=active&currentSessionMinutes=Infinity",
		"mode=idle&currentSessionMinutes=nope",
		"mode=other&currentSessionMinutes=0",
		"mode=idle&currentSessionMinutes=0&employeeId=another-employee",
		"mode=idle&currentSessionMinutes=0&organizationId=another-org",
	])("rejects malformed or target-selecting query inputs: %s", async (query) => {
		const response = await GET(request(query));
		expect(response.status).toBe(400);
		expect(state.rest).not.toHaveBeenCalled();
	});

	it("returns a safe private failure if a display reader fails", async () => {
		state.rest.mockImplementation(() => Effect.die(new Error("private database detail")));
		const response = await GET(request());
		expect(response.status).toBe(500);
		expect(await response.json()).toEqual({ error: "Compliance data could not be loaded" });
		expect(response.headers.get("cache-control")).toBe("private, no-store");
	});
});
