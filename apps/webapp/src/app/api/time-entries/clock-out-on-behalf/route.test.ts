/**
 * HTTP adapter contract for manager on-behalf clock-out (#276). The closure
 * itself (authorization, graph, replay, rollback, legacy mode) is verified
 * against PostgreSQL in `route.integration.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	closeWorkOnBehalf: vi.fn(),
	logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => {},
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/billing/guard", () => ({
	createBillingForbiddenResponse: (access: { reason: string }) =>
		Response.json({ error: "billing_required", code: access.reason }, { status: 402 }),
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/shared", () => ({
	logger: { error: mocks.logError },
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/clock-out-on-behalf", () => ({
	closeWorkOnBehalf: mocks.closeWorkOnBehalf,
}));

const { POST } = await import("./route");

const operationId = "5b0d1c52-4c6f-4a53-9d2e-6f1f3b2a7c10";

function request(body: unknown) {
	return new Request("https://app.test/api/time-entries/clock-out-on-behalf", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: typeof body === "string" ? body : JSON.stringify(body),
	}) as never;
}

async function respond(body: unknown) {
	const response = await POST(request(body));
	return { status: response.status, body: await response.json() };
}

describe("POST /api/time-entries/clock-out-on-behalf", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.getSession.mockResolvedValue({
			user: { id: "manager-user" },
			session: { activeOrganizationId: "org-1" },
		});
	});

	it("passes the parsed request and the session scope to the operation", async () => {
		mocks.closeWorkOnBehalf.mockResolvedValue({
			outcome: "executed",
			operationId,
			entry: { id: operationId },
			receipt: null,
		});

		const result = await respond({ workPeriodId: "period-1", operationId, projectId: null });

		expect(result).toEqual({
			status: 201,
			body: { outcome: "executed", operationId, entry: { id: operationId }, receipt: null },
		});
		expect(mocks.closeWorkOnBehalf).toHaveBeenCalledWith({
			request: { workPeriodId: "period-1", operationId, projectId: null },
			session: { userId: "manager-user", activeOrganizationId: "org-1" },
		});
	});

	it("answers a committed replay with 200", async () => {
		mocks.closeWorkOnBehalf.mockResolvedValue({
			outcome: "replayed",
			operationId,
			entry: { id: operationId },
			receipt: null,
		});

		expect((await respond({ workPeriodId: "period-1", operationId })).status).toBe(200);
	});

	it.each([
		[{ code: "access_denied" }, 403],
		[{ code: "target_unknown" }, 404],
		[{ code: "target_not_active" }, 409],
		[{ code: "collision" }, 409],
		[{ code: "invalid_interval" }, 409],
		[{ code: "append_review_required" }, 409],
		[{ code: "integrity_review_required" }, 409],
		[{ code: "attribution_not_allowed", field: "projectId" }, 422],
	])("maps the %o rejection to %i with its code", async (rejection, status) => {
		mocks.closeWorkOnBehalf.mockResolvedValue({ outcome: "rejected", operationId, ...rejection });

		const result = await respond({ workPeriodId: "period-1", operationId });

		expect(result.status).toBe(status);
		expect(result.body).toMatchObject({ ...rejection, operationId, error: expect.any(String) });
	});

	it("returns the billing guard response for billing rejections", async () => {
		mocks.closeWorkOnBehalf.mockResolvedValue({
			outcome: "rejected",
			operationId,
			code: "billing_required",
			billing: { canAccess: false, reason: "subscription_required" },
		});

		expect(await respond({ workPeriodId: "period-1", operationId })).toEqual({
			status: 402,
			body: { error: "billing_required", code: "subscription_required" },
		});
	});

	it("reports an unknown outcome with the identity to resend when the operation throws", async () => {
		mocks.closeWorkOnBehalf.mockRejectedValue(new Error("connection reset"));

		expect(await respond({ workPeriodId: "period-1", operationId })).toEqual({
			status: 500,
			body: { error: "Internal server error", outcome: "unknown", operationId },
		});
		expect(mocks.logError).toHaveBeenCalledTimes(1);
	});

	it.each([
		["a missing work period", {}],
		["a non-string work period", { workPeriodId: 1 }],
		[
			"an uppercase operation id",
			{ workPeriodId: "period-1", operationId: operationId.toUpperCase() },
		],
		["a non-UUID operation id", { workPeriodId: "period-1", operationId: "retry-1" }],
		["an empty project id", { workPeriodId: "period-1", projectId: "" }],
		["a numeric category id", { workPeriodId: "period-1", workCategoryId: 3 }],
		["an array body", [{ workPeriodId: "period-1" }]],
		["malformed JSON", "{"],
	])("rejects %s with 400 before reading the session", async (_label, body) => {
		expect((await respond(body)).status).toBe(400);
		expect(mocks.getSession).not.toHaveBeenCalled();
		expect(mocks.closeWorkOnBehalf).not.toHaveBeenCalled();
	});

	it("rejects unauthenticated requests and sessions without an organization", async () => {
		mocks.getSession.mockResolvedValueOnce(null);
		expect((await respond({ workPeriodId: "period-1" })).status).toBe(401);

		mocks.getSession.mockResolvedValueOnce({
			user: { id: "manager-user" },
			session: { activeOrganizationId: null },
		});
		expect((await respond({ workPeriodId: "period-1" })).status).toBe(400);
		expect(mocks.closeWorkOnBehalf).not.toHaveBeenCalled();
	});
});
