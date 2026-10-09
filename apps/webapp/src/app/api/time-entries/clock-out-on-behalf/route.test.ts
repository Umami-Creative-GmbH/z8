/**
 * The on-behalf clock-out route as a Clocking adapter (#482): how a request becomes
 * a Clocking command, and how an outcome becomes the HTTP response. The Clocking
 * module is replaced; its on-behalf behaviour is covered on PostgreSQL by
 * `lib/time-tracking/clocking/clock-out.integration.test.ts` and `route.integration.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	getSession: vi.fn(),
	canAccessSso: vi.fn(),
	run: vi.fn(),
	workPeriodOwner: vi.fn(),
	revalidate: vi.fn(),
	logError: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => {},
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: mocks.getSession } } }));
vi.mock("@/lib/enterprise-identity/session-sso-store", () => ({
	canAccessOrganizationWithSso: mocks.canAccessSso,
}));
vi.mock("@/lib/time-tracking/clocking", () => ({
	clocking: { run: mocks.run },
	workPeriodOwner: mocks.workPeriodOwner,
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/clocking", () => ({
	revalidateAfterClockOut: mocks.revalidate,
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/manual-entry-target", () => ({
	resolveManualEntryTargetZone: async () => ({ timezone: "America/New_York", source: "employee" }),
}));
vi.mock("@/app/[locale]/(app)/time-tracking/actions/shared", () => ({
	logger: { error: mocks.logError },
}));

const { POST } = await import("./route");

const operationId = "5b0d1c52-4c6f-4a53-9d2e-6f1f3b2a7c10";
const owner = { id: "employee-1", userId: "target-user", organizationId: "org-1" };
const entry = { id: operationId, type: "clock_out", employeeId: owner.id };
const receipt = { version: 1, operationId };

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
			session: { id: "session-1", userId: "manager-user", activeOrganizationId: "org-1" },
		});
		mocks.canAccessSso.mockResolvedValue(true);
		mocks.workPeriodOwner.mockResolvedValue(owner);
	});

	it("runs a clock-out of the named period on behalf of its owner, in the owner's zone", async () => {
		mocks.run.mockResolvedValue({
			outcome: "executed",
			result: { ...entry, complianceWarnings: [{ type: "rest" }], pendingApproval: undefined },
			durationMinutes: 481,
			receipt,
		});

		const result = await respond({ workPeriodId: "period-1", operationId, projectId: null });

		expect(mocks.workPeriodOwner).toHaveBeenCalledWith("org-1", "period-1");
		expect(mocks.run).toHaveBeenCalledWith({
			organizationId: "org-1",
			principal: { kind: "user", userId: "manager-user" },
			subject: { employeeId: owner.id, onBehalf: true },
			identity: { origin: "client", id: operationId },
			channel: "web",
			at: { kind: "now" },
			zone: { device: null, fallback: "America/New_York" },
			body: {
				kind: "clock_out",
				target: { kind: "period", workPeriodId: "period-1" },
				project: { kind: "clear" },
				workCategory: { kind: "preserve" },
			},
		});
		// The follow-ups' advice is the employee's, not the manager's response.
		expect(result).toEqual({
			status: 201,
			body: { outcome: "executed", operationId, entry, receipt },
		});
		expect(mocks.revalidate).toHaveBeenCalledTimes(1);
	});

	it("answers a committed replay with 200 and leaves the cache alone", async () => {
		mocks.run.mockResolvedValue({
			outcome: "replayed",
			result: entry,
			durationMinutes: 481,
			receipt: null,
		});

		expect(await respond({ workPeriodId: "period-1", operationId })).toEqual({
			status: 200,
			body: { outcome: "replayed", operationId, entry, receipt: null },
		});
		expect(mocks.revalidate).not.toHaveBeenCalled();
	});

	it("runs identity-less requests under a server identity and reports it once executed", async () => {
		mocks.run.mockResolvedValue({
			outcome: "executed",
			result: entry,
			durationMinutes: 1,
			receipt,
		});

		const result = await respond({ workPeriodId: "period-1" });

		const [command] = mocks.run.mock.calls[0];
		expect(command.identity).toEqual({ origin: "server", id: expect.any(String) });
		expect(result.body.operationId).toBe(command.identity.id);
	});

	it("refuses a period the organization does not own as unknown without running", async () => {
		mocks.workPeriodOwner.mockResolvedValue(null);

		expect(await respond({ workPeriodId: "period-1", operationId })).toEqual({
			status: 404,
			body: { error: "Work period not found", code: "target_unknown", operationId },
		});
		expect(mocks.run).not.toHaveBeenCalled();
	});

	it.each([
		["access_denied", 403, "access_denied"],
		["invalid_command", 400, "invalid_command"],
		["admission_window", 400, "invalid_command"],
		["frozen_not_accepted", 400, "invalid_command"],
		["target_unknown", 404, "target_unknown"],
		["target_not_active", 409, "target_not_active"],
		["not_clocked_in", 409, "target_not_active"],
		["collision", 409, "collision"],
		["invalid_interval", 409, "invalid_interval"],
		["append_review_required", 409, "append_review_required"],
	])("maps the %s refusal to %i %s", async (failure, status, code) => {
		mocks.run.mockResolvedValue({ outcome: "refused", failure: { code: failure } });

		expect(await respond({ workPeriodId: "period-1", operationId })).toEqual({
			status,
			body: { error: expect.any(String), code, operationId },
		});
	});

	it.each([
		["project_not_allowed", "projectId"],
		["work_category_not_allowed", "workCategoryId"],
	])("maps the %s refusal to 422 with its field", async (failure, field) => {
		mocks.run.mockResolvedValue({ outcome: "refused", failure: { code: failure } });

		expect(await respond({ workPeriodId: "period-1", operationId })).toEqual({
			status: 422,
			body: { error: expect.any(String), code: "attribution_not_allowed", field, operationId },
		});
	});

	it("maps a task refusal to 422 with its field and stable reason (#874)", async () => {
		mocks.run.mockResolvedValue({
			outcome: "refused",
			failure: { code: "task_not_allowed", reason: "task_done" },
		});

		expect(await respond({ workPeriodId: "period-1", operationId, taskId: "task-1" })).toEqual({
			status: 422,
			body: {
				error: "Cannot book time to this task",
				code: "attribution_not_allowed",
				field: "taskId",
				reason: "task_done",
				operationId,
			},
		});
	});

	it("answers billing refusals with the billing guard's 402", async () => {
		mocks.run.mockResolvedValue({
			outcome: "refused",
			failure: { code: "billing_required", reason: "subscription_expired" },
		});

		expect(await respond({ workPeriodId: "period-1", operationId })).toEqual({
			status: 402,
			body: { error: "billing_required", reason: "subscription_expired" },
		});
	});

	it("keeps rejections of identity-less requests without an identity to resend", async () => {
		mocks.run.mockResolvedValue({ outcome: "refused", failure: { code: "target_not_active" } });

		expect((await respond({ workPeriodId: "period-1" })).body.operationId).toBeNull();
	});

	it.each(["failed", "unconfirmed"])(
		"reports a %s outcome as unknown with the identity to resend",
		async (failure) => {
			mocks.run.mockResolvedValue({
				outcome: "refused",
				failure: { code: failure, cause: new Error("connection reset") },
			});

			expect(await respond({ workPeriodId: "period-1", operationId })).toEqual({
				status: 500,
				body: { error: "Internal server error", outcome: "unknown", operationId },
			});
			expect(mocks.logError).toHaveBeenCalledTimes(1);
		},
	);

	it("reports an unknown outcome when the adapter throws", async () => {
		mocks.run.mockRejectedValue(new Error("connection reset"));

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
		expect(mocks.run).not.toHaveBeenCalled();
	});

	it("authenticates the session, its organization and its SSO admission before running", async () => {
		mocks.getSession.mockResolvedValueOnce(null);
		expect((await respond({ workPeriodId: "period-1" })).status).toBe(401);

		mocks.getSession.mockResolvedValueOnce({
			user: { id: "manager-user" },
			session: { id: "session-1", userId: "manager-user", activeOrganizationId: null },
		});
		expect((await respond({ workPeriodId: "period-1" })).status).toBe(400);

		mocks.canAccessSso.mockResolvedValueOnce(false);
		expect(await respond({ workPeriodId: "period-1", operationId })).toMatchObject({
			status: 403,
			body: { code: "access_denied", operationId },
		});
		expect(mocks.run).not.toHaveBeenCalled();
	});
});
