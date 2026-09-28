/**
 * The legacy time-entries route. GET reads entries under CASL; POST is a legacy
 * clock command adapter (#483): how a legacy body becomes a Clocking command, and
 * how an outcome becomes the route's established response behind the #266 fence.
 * The Clocking module is replaced; its behaviour is covered on PostgreSQL by
 * `lib/time-tracking/clocking/*.integration.test.ts` and `route.integration.test.ts`.
 */
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { timeEntry } from "@/db/schema";
import { parseInstant } from "@/lib/datetime/temporal-core";

const state = vi.hoisted(() => {
	class UnsupportedAuthorizationConditionError extends Error {}
	class ClockingAccessError extends Error {}
	const limit = vi.fn();
	const where = vi.fn(() => ({ limit }));
	const from = vi.fn(() => ({ where }));
	return {
		UnsupportedAuthorizationConditionError,
		ClockingAccessError,
		limit,
		select: vi.fn(() => ({ from })),
		headers: vi.fn(),
		getSession: vi.fn(),
		membership: vi.fn(),
		getAbility: vi.fn(),
		accessibleByDrizzle: vi.fn(),
		runPromise: vi.fn(),
		requireActor: vi.fn(),
		run: vi.fn(),
		preserveLateClockEvidence: vi.fn(),
	};
});

vi.mock("next/headers", () => ({ headers: state.headers }));
vi.mock("next/server", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/server")>()),
	connection: async () => undefined,
}));
vi.mock("@/db", () => ({
	db: {
		select: state.select,
		query: {
			member: { findFirst: state.membership },
			userSettings: { findFirst: async () => ({ timezone: "Europe/Berlin" }) },
		},
	},
}));
vi.mock("@/lib/auth", () => ({ auth: { api: { getSession: state.getSession } } }));
vi.mock("@/lib/auth-helpers", () => ({ getAbility: state.getAbility }));
vi.mock("@/lib/authorization", () => ({
	UnsupportedAuthorizationConditionError: state.UnsupportedAuthorizationConditionError,
	accessibleByDrizzle: state.accessibleByDrizzle,
	asAppSubject: (subject: string, data: object) => ({ ...data, __caslSubjectType__: subject }),
	ForbiddenError: class ForbiddenError extends Error {},
	toHttpError: () => ({ body: { error: "Forbidden" }, status: 403 }),
}));
vi.mock("@/lib/effect/runtime", () => ({ runtime: { runPromise: state.runPromise } }));
vi.mock("@/lib/time-tracking/clocking", () => ({ clocking: { run: state.run } }));
vi.mock("@/lib/time-tracking/clocking-service", () => ({
	ClockingAccessError: state.ClockingAccessError,
	clockingService: { requireActor: state.requireActor },
}));
vi.mock("@/lib/employee-lifecycle/late-clock-evidence", () => ({
	preserveLateClockEvidence: state.preserveLateClockEvidence,
}));

const { GET, POST } = await import("./route");

beforeEach(() => {
	vi.clearAllMocks();
	state.limit.mockReset();
	state.headers.mockResolvedValue(new Headers());
	state.getSession.mockResolvedValue({
		session: { activeOrganizationId: "org-1" },
		user: { id: "user-1" },
	});
	state.membership.mockResolvedValue({ id: "member-1" });
	state.requireActor.mockResolvedValue({
		employee: { id: "employee-1", organizationId: "org-1" },
		organizationId: "org-1",
		userId: "user-1",
	});
});

function getRequest(employeeId: string) {
	return { nextUrl: new URL(`https://z8.test/api/time-entries?employeeId=${employeeId}`) } as never;
}

describe("GET /api/time-entries authorization source", () => {
	it("uses CASL query adapter and subject checks for time entry reads", () => {
		const source = readFileSync("src/app/api/time-entries/route.ts", "utf8");

		expect(source).toContain("accessibleByDrizzle");
		expect(source).toContain("asAppSubject");
		expect(source).toContain("TimeEntry");
		expect(source).toContain("timeEntry.organizationId");
		expect(source).toContain("timeEntry.employeeId");
		expect(source).toContain("authorizationPredicate: timeEntryAccess ?? undefined");
	});
});

describe("GET /api/time-entries", () => {
	beforeEach(() => {
		state.accessibleByDrizzle.mockReturnValue({ type: "sql" });
		state.getAbility.mockResolvedValue({ can: vi.fn(() => true) });
		state.runPromise.mockResolvedValue([{ id: "entry-1" }]);
	});

	/** The reader's own employee, then the requested one. */
	function employees(...targets: object[][]) {
		state.limit.mockResolvedValueOnce([{ id: "employee-1", organizationId: "org-1" }]);
		for (const target of targets) state.limit.mockResolvedValueOnce(target);
	}

	it("allows direct-report reads when the query adapter cannot translate legacy rules", async () => {
		const ability = { can: vi.fn(() => true) };
		state.getAbility.mockResolvedValue(ability);
		state.accessibleByDrizzle.mockImplementation(() => {
			throw new state.UnsupportedAuthorizationConditionError("Unconditional rules");
		});
		employees([{ id: "employee-2", organizationId: "org-1" }]);

		const response = await GET(getRequest("employee-2"));

		expect(response.status).toBe(200);
		expect(await response.json()).toEqual({ entries: [{ id: "entry-1" }] });
		expect(ability.can).toHaveBeenCalledWith(
			"read",
			expect.objectContaining({ employeeId: "employee-2", organizationId: "org-1" }),
		);
	});

	it("passes translated authorization predicates to the time entry service", async () => {
		employees([{ id: "employee-2", organizationId: "org-1" }]);

		const response = await GET(getRequest("employee-2"));

		expect(response.status).toBe(200);
		expect(state.accessibleByDrizzle).toHaveBeenCalledWith(expect.anything(), "read", "TimeEntry", {
			employeeId: timeEntry.employeeId,
			organizationId: timeEntry.organizationId,
		});
		expect(state.runPromise).toHaveBeenCalledTimes(1);
	});

	it("returns 403 for cross-employee reads without an ability", async () => {
		state.getAbility.mockResolvedValue(undefined);
		employees();

		const response = await GET(getRequest("employee-2"));

		expect(response.status).toBe(403);
		expect(state.accessibleByDrizzle).not.toHaveBeenCalled();
		expect(state.runPromise).not.toHaveBeenCalled();
	});

	it("returns 403 for same-organization targets denied by record authorization", async () => {
		state.getAbility.mockResolvedValue({ can: vi.fn(() => false) });
		employees([{ id: "employee-2", organizationId: "org-1" }]);

		const response = await GET(getRequest("employee-2"));

		expect(response.status).toBe(403);
		expect(state.runPromise).not.toHaveBeenCalled();
	});

	it("returns 404 for cross-organization or missing targets before fetching entries", async () => {
		employees([]);

		const response = await GET(getRequest("employee-2"));

		expect(response.status).toBe(404);
		expect(state.runPromise).not.toHaveBeenCalled();
	});
});

describe("POST /api/time-entries", () => {
	const actionId = "6f1c2a4e-8b3d-4c5e-9f70-1a2b3c4d5e6f";
	const entry = { id: "entry-1", type: "clock_in" };

	beforeEach(() => {
		// No committed entry under an action id.
		state.limit.mockResolvedValue([]);
		state.run.mockResolvedValue({ outcome: "executed", result: entry });
	});

	async function post(body: Record<string, unknown>) {
		const response = await POST(
			new Request("https://z8.test/api/time-entries", {
				method: "POST",
				body: JSON.stringify(body),
			}) as never,
		);
		return { status: response.status, body: await response.json() };
	}

	/** An X3 extension capture: action id, device zone and offset, sent now. */
	function capture(overrides: Record<string, unknown> = {}) {
		return {
			id: actionId,
			type: "clock_out",
			timestamp: new Date().toISOString(),
			browserTimezone: "UTC",
			utcOffsetMinutes: 0,
			...overrides,
		};
	}

	function command() {
		return state.run.mock.calls[0]?.[0];
	}

	describe("transport to command", () => {
		it("runs a desktop clock-in as a legacy command of the actor's own employee", async () => {
			const response = await post({
				type: "clock_in",
				workLocationType: "remote",
				timestamp: "2026-05-04T09:00:00.000Z",
			});

			expect(response).toEqual({ status: 201, body: { entry } });
			expect(command()).toEqual({
				organizationId: "org-1",
				principal: { kind: "user", userId: "user-1" },
				subject: { employeeId: "employee-1" },
				// Without an action id nothing replays.
				identity: { origin: "server", id: expect.stringMatching(/^[0-9a-f-]{36}$/) },
				channel: "api",
				legacy: true,
				at: { kind: "occurred", instant: parseInstant("2026-05-04T09:00:00.000Z") },
				zone: { device: null, fallback: "Europe/Berlin" },
				body: { kind: "clock_in", workLocationType: "remote" },
			});
		});

		it("samples an instant-less clock-in at the server in the office", async () => {
			await post({ type: "clock_in" });

			expect(command()).toMatchObject({
				at: { kind: "now" },
				body: { kind: "clock_in", workLocationType: "office" },
			});
		});

		it("runs a captured clock-out under its client identity and attribution intents", async () => {
			await post(
				capture({ id: actionId.toUpperCase(), projectId: "project-1", workCategoryId: null }),
			);
			await post(capture({ projectId: "" }));

			expect(command()).toMatchObject({
				identity: { origin: "client", id: actionId },
				zone: { device: "UTC", fallback: "Europe/Berlin" },
				body: {
					kind: "clock_out",
					project: { kind: "replace", id: "project-1" },
					workCategory: { kind: "clear" },
				},
			});
			expect(state.run.mock.calls[1]?.[0].body).toEqual({
				kind: "clock_out",
				project: { kind: "clear" },
				workCategory: { kind: "preserve" },
			});
		});

		it("refuses a fresh capture outside its age window before running it", async () => {
			const stale = capture({
				timestamp: new Date(Date.now() - 8 * 24 * 60 * 60_000).toISOString(),
				replay: true,
			});

			// The extension keeps a refused row on 409 (#266).
			await expect(post(stale)).resolves.toEqual({
				status: 409,
				body: {
					error: "Clock instant is outside the allowed capture window",
					hold: "legacy-extension-queue",
				},
			});
			expect(state.run).not.toHaveBeenCalled();

			// A committed action replays through the module at any age (#275).
			state.limit.mockResolvedValueOnce([{ id: actionId }]);
			await expect(post(stale)).resolves.toMatchObject({ status: 201 });
			expect(command()).toMatchObject({ identity: { origin: "client", id: actionId } });
		});

		it("refuses an offset that does not match the captured instant", async () => {
			await expect(post(capture({ utcOffsetMinutes: 60 }))).resolves.toMatchObject({
				status: 409,
				body: { error: "Timezone offset does not match instant" },
			});
			expect(state.run).not.toHaveBeenCalled();
		});

		it.each([
			[{ type: "clock_in", employeeId: "employee-2" }, "employeeId is server-derived"],
			[{ type: "break" }, "Invalid type. Must be 'clock_in' or 'clock_out'"],
			[{ type: "clock_in", timestamp: "not a date" }, "Invalid clock instant"],
		])("refuses a malformed body %j", async (body, error) => {
			state.headers.mockResolvedValue(new Headers({ authorization: "Bearer desktop-token" }));

			await expect(post(body)).resolves.toEqual({ status: 400, body: { error } });
			expect(state.run).not.toHaveBeenCalled();
		});

		it("answers the pre-preservation browser queue with a retaining 401", async () => {
			// The pre-#267 service worker always sends its queued organizationId.
			await expect(
				post({ type: "clock_in", organizationId: "unknown", browserTimezone: "UTC" }),
			).resolves.toEqual({
				status: 401,
				body: { error: "organizationId is server-derived", hold: "legacy-browser-queue" },
			});
			expect(state.run).not.toHaveBeenCalled();
		});
	});

	describe("actor authentication", () => {
		it("answers a missing session with 401", async () => {
			state.getSession.mockResolvedValue(null);

			await expect(post(capture({ replay: true }))).resolves.toEqual({
				status: 401,
				body: { error: "Unauthorized" },
			});
		});

		it("preserves a refused pre-cutoff extension replay for review and still refuses it", async () => {
			state.requireActor.mockRejectedValue(new state.ClockingAccessError("Employee gone"));
			const replay = capture({ replay: true });

			await expect(post(replay)).resolves.toEqual({
				status: 403,
				body: { error: "Employee gone" },
			});
			expect(state.preserveLateClockEvidence).toHaveBeenCalledWith(
				expect.anything(),
				expect.objectContaining({
					organizationId: "org-1",
					userId: "user-1",
					actionId,
					type: "clock_out",
					utcOffsetMinutes: 0,
					timezone: "UTC",
				}),
			);
			// A live click is refused without preservation.
			await post(capture());
			expect(state.preserveLateClockEvidence).toHaveBeenCalledTimes(1);
			expect(state.run).not.toHaveBeenCalled();
		});
	});

	describe("outcome to response", () => {
		it("answers an executed or replayed command with the entry alone", async () => {
			const closed = {
				id: actionId,
				type: "clock_out",
				complianceWarnings: [{ type: "rest_period" }],
				breakAdjustment: { breakMinutes: 30 },
				pendingApproval: false,
			};
			state.run.mockResolvedValueOnce({ outcome: "executed", result: closed });
			state.run.mockResolvedValueOnce({ outcome: "replayed", result: closed });

			const executed = await post(capture());
			const replayed = await post(capture());

			expect(executed).toEqual({
				status: 201,
				body: { entry: { id: actionId, type: "clock_out" } },
			});
			expect(replayed).toEqual(executed);
		});

		it.each([
			[
				{ code: "legacy_not_accepted" },
				409,
				{
					error: "This organization only accepts coordinated clock commands",
					code: "append_adopted",
				},
			],
			[
				{ code: "billing_required", reason: "subscription_required" },
				402,
				{ error: "billing_required", reason: "subscription_required" },
			],
			[
				{ code: "already_clocked_in", since: parseInstant("2026-05-04T08:00:00Z") },
				409,
				{ error: "Active work period already exists" },
			],
			[{ code: "occupancy_conflict" }, 409, { error: "Clock-in overlaps recorded work" }],
			[
				{ code: "holiday_blocked", holidayName: "Closing day" },
				409,
				{ error: "Clock-in is not allowed on a holiday" },
			],
			[{ code: "not_clocked_in" }, 409, { error: "No active work period found" }],
			[{ code: "project_not_allowed" }, 400, { error: "Cannot assign to this project" }],
			[{ code: "unconfirmed", cause: new Error("lost") }, 500, { error: "Internal server error" }],
		])("words a %j refusal", async (failure, status, body) => {
			state.run.mockResolvedValueOnce({ outcome: "refused", failure });

			await expect(post({ type: "clock_in" })).resolves.toEqual({ status, body });
		});

		it("keeps an extension's refused row with 409 in place of a deleting 400", async () => {
			state.run.mockResolvedValueOnce({
				outcome: "refused",
				failure: { code: "project_not_allowed" },
			});

			await expect(post(capture({ replay: true }))).resolves.toEqual({
				status: 409,
				body: { error: "Cannot assign to this project", hold: "legacy-extension-queue" },
			});
		});
	});
});
