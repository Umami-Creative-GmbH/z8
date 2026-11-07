import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { user } from "@/db/auth-schema";
import { CACHE_TAGS } from "@/lib/cache/tags";
import { DatabaseError, ValidationError } from "@/lib/effect/errors";
import type { StubCaller } from "@/test/organization-action";

const validUserId = "11111111-1111-4111-8111-111111111111";
const validTeamId = "22222222-2222-4222-8222-222222222222";
const validEmployeeId = "33333333-3333-4333-8333-333333333333";
const validManagerEmployeeId = "55555555-5555-4555-8555-555555555555";
const otherManagerId = "66666666-6666-4666-8666-666666666666";

type FakeDbService = {
	db: Record<string, unknown>;
	query: (name: string, run: () => Promise<unknown>) => Effect.Effect<unknown, unknown>;
};

const mocks = vi.hoisted(() => ({
	caller: null as StubCaller | null,
	dbService: null as FakeDbService | null,
	/** The employees a scoped manager manages, by `actor.managedScope()`. */
	managedEmployeeIds: [] as string[],
	managerService: null as Record<string, unknown> | null,
	markEmployeeWorkBalanceDirty: vi.fn(),
	requestEmployeeWorkBalanceFullRebuild: vi.fn(),
	writeFirstEmploymentTerms: vi.fn(),
	logAudit: vi.fn(async () => undefined),
	revalidateTag: vi.fn(),
}));

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { ManagerService } = await import("@/lib/effect/services/manager.service");
	const { runtimeModuleOver } = await import("@/test/effect-runtime");
	const { organizationActionStubLayer } = await import("@/test/organization-action");
	// Each test's fake database, behind the stub's one `DatabaseService`.
	const db = new Proxy({}, { get: (_target, property) => mocks.dbService?.db[property as string] });
	const managerService = new Proxy(
		{},
		{ get: (_target, property) => mocks.managerService?.[property as string] },
	);
	return runtimeModuleOver(
		Layer.mergeAll(
			organizationActionStubLayer(() => mocks.caller, {
				db,
				query: (name, run) =>
					name === "organizationAction.managedScope"
						? (Effect.succeed([mocks.managedEmployeeIds.map((id) => ({ id })), []]) as never)
						: (mocks.dbService?.query(name, run) as never),
			}),
			Layer.succeed(ManagerService, managerService as never),
		),
	);
});

vi.mock("next/cache", async (importOriginal) => ({
	...(await importOriginal<typeof import("next/cache")>()),
	revalidateTag: mocks.revalidateTag,
}));

vi.mock("@/lib/audit-logger", async (importOriginal) => ({
	...(await importOriginal<typeof import("@/lib/audit-logger")>()),
	logAudit: mocks.logAudit,
}));

// The terms themselves are covered by first-terms.integration.test.ts.
vi.mock("@/lib/employment-history/first-terms", () => ({
	writeFirstEmploymentTerms: mocks.writeFirstEmploymentTerms,
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({ error: vi.fn(), info: vi.fn(), warn: vi.fn(), debug: vi.fn() }),
}));

// Protection is covered by authorization-mutation.test.ts and the PostgreSQL
// suite; here the mutation runs against the fake database.
const protection = vi.hoisted(() => ({ scopes: [] as unknown[] }));
vi.mock("@/lib/authorization/authorization-mutation", () => ({
	withAuthorizationMutation: async (
		scope: unknown,
		mutation: (tx: unknown) => Promise<unknown>,
		database: unknown,
	) => {
		protection.scopes.push(scope);
		return mutation(database);
	},
}));

// Custom field values (#818) are covered by the PostgreSQL suites.
vi.mock("@/lib/organization/custom-fields/form-values", () => ({
	keepCustomFieldRefusal: (effect: unknown) => effect,
	saveFormCustomFieldValues: vi.fn(async () => undefined),
}));

// Personnel numbers (#881) are covered by personnel-number-uniqueness.integration.test.ts.
vi.mock("@/lib/organization/personnel-number-uniqueness", () => ({
	assertPersonnelNumberFree: vi.fn(async () => undefined),
	assertPersonnelNumberLocallyEditable: vi.fn(async () => undefined),
	findPersonnelNumberHolder: vi.fn(async () => null),
	keepPersonnelNumberRefusal: () => (effect: unknown) => effect,
}));

// The placement itself is covered by team-placement.integration.test.ts (#1594).
const placeArrivingEmployee = vi.hoisted(() =>
	vi.fn(async (_tx: unknown, input: { teamId: string | null }) => ({
		addTeamId: input.teamId,
		endTeamId: null,
		primaryTeamId: input.teamId,
	})),
);
vi.mock("@/lib/organization/team-placement/team-placement", () => ({
	applyTeamChange: vi.fn(async () => undefined),
	keepTeamChangeRefusals: (effect: unknown) => effect,
	placeArrivingEmployee,
	previewTeamChange: vi.fn(async () => undefined),
	teamChangeScope: (change: { organizationId: string; employeeId: string }) => ({
		organizationId: change.organizationId,
		employeeIds: [change.employeeId],
	}),
}));

// The work balance is marked from the terms' calendar date in the organization's timezone.
vi.mock("@/lib/timezone/load-organization-timezone", () => ({
	loadOrganizationTimezone: vi.fn(async () => "Europe/Berlin"),
}));

vi.mock("@/lib/work-balance/service", () => ({
	markEmployeeWorkBalanceDirty: mocks.markEmployeeWorkBalanceDirty,
	requestEmployeeWorkBalanceFullRebuild: mocks.requestEmployeeWorkBalanceFullRebuild,
}));

import {
	createEmployeeSchema,
	personalInformationSchema,
	updateEmployeeInvitationDraftSchema,
	updateEmployeeSchema,
} from "@/lib/validations/employee";
import {
	assignManagersAction,
	createEmployeeAction,
	previewEmployeeTeamChangeDrivingImpact,
	requestEmployeeWorkBalanceRecalculationAction,
	updateEmployeeAction,
	updateOwnProfileAction,
} from "./employee-mutations.actions";

const orgAdmin: StubCaller = {
	userId: "user-admin-1",
	activeOrganizationId: "org-1",
	membershipRole: "admin",
	employee: { id: "44444444-4444-4444-8444-444444444444", role: "admin", former: false },
};
const scopedManager: StubCaller = {
	userId: "user-manager-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: validManagerEmployeeId, role: "manager", former: false },
};
const orgMember: StubCaller = {
	userId: "user-member-1",
	activeOrganizationId: "org-1",
	membershipRole: "member",
	employee: { id: "77777777-7777-4777-8777-777777777777", role: "employee", former: false },
};
const pendingMember: StubCaller = { ...orgMember, membershipRole: null };

/** A database whose queries fail the way DatabaseService wraps them. */
function fakeDatabase(db: Record<string, unknown>): FakeDbService {
	const dbService: FakeDbService = {
		db,
		query: vi.fn((name: string, run: () => Promise<unknown>) =>
			Effect.tryPromise({
				try: run,
				catch: (cause) =>
					new DatabaseError({ message: `Database query failed: ${name}`, operation: name, cause }),
			}),
		),
	};
	mocks.dbService = dbService;
	return dbService;
}

function targetEmployee(overrides: Record<string, unknown> = {}) {
	return {
		id: validEmployeeId,
		userId: validUserId,
		organizationId: "org-1",
		contractType: "fixed",
		...overrides,
	};
}

beforeEach(() => {
	vi.clearAllMocks();
	protection.scopes = [];
	mocks.caller = orgAdmin;
	mocks.dbService = null;
	mocks.managedEmployeeIds = [];
	mocks.managerService = null;
});

describe("employee mutation schemas", () => {
	const source = () =>
		readFileSync(new URL("./employee-mutations.actions.ts", import.meta.url), "utf8");

	it("exposes a draft update action that requires org admin access", () => {
		const draftAction = source().slice(
			source().indexOf("export const updateEmployeeInvitationDraftAction"),
			source().indexOf("export const deleteEmployeeInvitationDraftAction"),
		);
		expect(draftAction).toContain('requires: "orgAdmin"');
		expect(draftAction).toContain("employeeInvitationDraft");
		expect(draftAction).toContain("getEmployeeInvitationDraftForUpdate");
	});

	it("does not clear draft hourly rates when hourlyRate is omitted", () => {
		expect(source()).toContain('Object.hasOwn(validatedData, "hourlyRate")');
		expect(source()).toContain("...(hasHourlyRateUpdate");
	});

	it("uses the shared pending-future predicate for the locked eligibility recheck", () => {
		expect(source().match(/buildEligibleInvitationDraftPredicate\(\{/g)).toHaveLength(1);
		expect(source()).toContain("dateFromInstant(systemClock.nowInstant())");
		expect(source()).toContain("draftId,");
		expect(source()).not.toContain("realEmployeeUser");
		expect(source()).not.toContain("realEmployee");
		expect(source()).not.toContain("invitedVia");
	});

	it("strips employee-owned names from create employee input", () => {
		const result = createEmployeeSchema.safeParse({
			userId: validUserId,
			organizationId: "org-1",
			teamId: validTeamId,
			role: "employee",
			firstName: "Ada",
			lastName: "Lovelace",
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).not.toHaveProperty("firstName");
		expect(result.data).not.toHaveProperty("lastName");
	});

	it("accepts and trims auth user names in update employee input", () => {
		const result = updateEmployeeSchema.safeParse({
			position: "Engineer",
			firstName: " Ada ",
			lastName: " Lovelace ",
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.firstName).toBe("Ada");
		expect(result.data.lastName).toBe("Lovelace");
	});

	it("rejects blank auth user names when provided in update employee input", () => {
		const result = updateEmployeeSchema.safeParse({ firstName: " ", lastName: "Lovelace" });

		expect(result.success).toBe(false);
		if (result.success) return;
		expect(result.error.issues[0]?.path).toEqual(["firstName"]);
	});

	it("keeps structured names in self-service profile validation", () => {
		const result = personalInformationSchema.safeParse({ firstName: "Ada", lastName: "Lovelace" });

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data.firstName).toBe("Ada");
		expect(result.data.lastName).toBe("Lovelace");
	});

	it("strips contract type and wage from the employee update input", () => {
		const result = updateEmployeeSchema.safeParse({
			position: "Engineer",
			contractType: "hourly",
			hourlyRate: "42.50",
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual({ position: "Engineer" });
	});

	it("keeps contract type and wage editable on invitation drafts", () => {
		const result = updateEmployeeInvitationDraftSchema.safeParse({
			contractType: "hourly",
			hourlyRate: "42.50",
		});

		expect(result.success).toBe(true);
		if (!result.success) return;
		expect(result.data).toEqual({ contractType: "hourly", hourlyRate: "42.50" });
	});
});

describe("createEmployeeAction", () => {
	const createdEmployee = { id: "employee-1", userId: validUserId, organizationId: "org-1" };

	function arrange() {
		const returning = vi.fn().mockResolvedValue([createdEmployee]);
		const values = vi.fn(() => ({ returning }));
		const insert = vi.fn(() => ({ values }));
		const db = {
			insert,
			query: {
				employee: { findFirst: vi.fn().mockResolvedValue(null) },
				user: { findFirst: vi.fn().mockResolvedValue({ id: validUserId }) },
			},
		};
		const dbService = fakeDatabase(db);
		return { db, dbService, insert, values };
	}

	const create = (input: Record<string, unknown> = {}) =>
		createEmployeeAction({ userId: validUserId, role: "employee", ...input });

	it("does not write employee-owned names into the employee insert payload", async () => {
		const { values } = arrange();
		mocks.writeFirstEmploymentTerms.mockResolvedValue(null);

		await expect(
			create({
				teamId: validTeamId,
				position: "Engineer",
				firstName: "Ada",
				lastName: "Lovelace",
			}),
		).resolves.toMatchObject({ success: true });

		expect(values).toHaveBeenCalledWith(
			expect.not.objectContaining({ firstName: expect.anything(), lastName: expect.anything() }),
		);
		expect(values).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1" }));
		// The team is a membership and the primary team (Organization ADR 0010).
		expect(placeArrivingEmployee).toHaveBeenCalledWith(
			expect.anything(),
			expect.objectContaining({ organizationId: "org-1", teamId: validTeamId }),
		);
		// The absent employee row is inserted under the new user's protection.
		expect(protection.scopes).toContainEqual({ organizationId: "org-1", userIds: [validUserId] });
		expect(mocks.revalidateTag).toHaveBeenCalledWith(CACHE_TAGS.EMPLOYEES("org-1"), "max");
	});

	it("creates the employee in the session's organization, not one the client names", async () => {
		const { values } = arrange();
		mocks.writeFirstEmploymentTerms.mockResolvedValue(null);

		await expect(create({ organizationId: "org-2" })).resolves.toMatchObject({ success: true });

		expect(values).toHaveBeenCalledWith(expect.objectContaining({ organizationId: "org-1" }));
	});

	it("refuses a scoped manager, one level below org admin", async () => {
		const { insert } = arrange();
		mocks.caller = scopedManager;

		await expect(create()).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(insert).not.toHaveBeenCalled();
	});

	it("translates the serialized employee identity conflict without leaking database details", async () => {
		const triggerError = Object.assign(
			new Error("Employee identity already exists in organization"),
			{ code: "23505", detail: "private-row-detail" },
		);
		const { dbService } = arrange();
		const query = dbService.query;
		dbService.query = vi.fn((name: string, run: () => Promise<unknown>) =>
			name === "createEmployee"
				? Effect.fail(
						new DatabaseError({
							message: "Database query failed: createEmployee",
							operation: "createEmployee",
							cause: triggerError,
						}),
					)
				: query(name, run),
		);

		const result = await create();

		expect(result).toEqual({
			success: false,
			code: "ValidationError",
			error: "Employee already exists for this user in this organization",
		});
		expect(JSON.stringify(result)).not.toContain("private-row-detail");
	});

	describe("first employment terms", () => {
		const startDate = new Date("2026-03-01T00:00:00.000Z");

		it("writes an hourly employee's first terms in the employee transaction, and no rate history", async () => {
			const { insert } = arrange();
			mocks.writeFirstEmploymentTerms.mockResolvedValue({
				validFrom: startDate,
				reviewState: "confirmed",
			});

			const result = await create({ contractType: "hourly", hourlyRate: "25.50", startDate });

			expect(result).toMatchObject({ success: true, data: createdEmployee });
			// The fake protection runs the mutation on the database itself.
			expect(mocks.writeFirstEmploymentTerms).toHaveBeenCalledExactlyOnceWith(expect.anything(), {
				organizationId: "org-1",
				employeeId: "employee-1",
				actorUserId: "user-admin-1",
				contractType: "hourly",
				hourlyRate: 25.5,
				startDate,
			});
			expect(insert).toHaveBeenCalledOnce();
			expect(mocks.markEmployeeWorkBalanceDirty).toHaveBeenCalledExactlyOnceWith({
				employeeId: "employee-1",
				organizationId: "org-1",
				dirtyFromDate: "2026-03-01",
			});
		});

		it("writes no terms and marks no balance for a fixed employee", async () => {
			arrange();
			mocks.writeFirstEmploymentTerms.mockResolvedValue(null);

			const result = await create({ contractType: "fixed" });

			expect(result).toMatchObject({ success: true });
			expect(mocks.writeFirstEmploymentTerms).toHaveBeenCalledExactlyOnceWith(
				expect.anything(),
				expect.objectContaining({ contractType: "fixed", hourlyRate: null }),
			);
			expect(mocks.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		});

		it("fails the creation with the terms refusal when the terms write fails", async () => {
			arrange();
			mocks.writeFirstEmploymentTerms.mockRejectedValue(
				new ValidationError({
					message: "Employment terms cannot start before the current employment period.",
					field: "validFrom",
				}),
			);

			const result = await create({ contractType: "hourly", hourlyRate: "25.50", startDate });

			expect(result).toEqual({
				success: false,
				code: "ValidationError",
				error: "Employment terms cannot start before the current employment period.",
			});
			expect(mocks.revalidateTag).not.toHaveBeenCalled();
			expect(mocks.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		});

		it("refuses an hourly wage that employment terms cannot hold", async () => {
			const { insert } = arrange();

			const result = await create({ contractType: "hourly", hourlyRate: "25.555", startDate });

			expect(result).toMatchObject({ success: false, code: "ValidationError" });
			expect(insert).not.toHaveBeenCalled();
			expect(mocks.writeFirstEmploymentTerms).not.toHaveBeenCalled();
		});
	});
});

describe("updateEmployeeAction", () => {
	/** The detail save's fake database: the employee update, then the auth user's. */
	function arrange(target = targetEmployee(), lockedBirthday: Date | null = null) {
		const employeeSet = vi.fn((_values: unknown) => ({
			where: vi.fn().mockResolvedValue(undefined),
		}));
		const userWhere = vi.fn().mockResolvedValue(undefined);
		const userSet = vi.fn((_values: unknown) => ({ where: userWhere }));
		const update = vi.fn((table: unknown) => ({ set: table === user ? userSet : employeeSet }));
		// The row as the save's transaction locks it.
		const select = vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => ({
					for: vi.fn().mockResolvedValue([{ birthday: lockedBirthday }]),
				})),
			})),
		}));
		const findFirst = vi.fn().mockResolvedValue(target);
		fakeDatabase({ update, select, query: { employee: { findFirst } } });
		return { employeeSet, userSet, userWhere, update, findFirst };
	}

	const save = (data: Record<string, unknown>) =>
		updateEmployeeAction({ employeeId: validEmployeeId, data });

	it("refuses to switch an employee on or off, leaving that to Deactivate and Reactivate (#1439)", async () => {
		const { update, findFirst } = arrange();

		for (const isActive of [false, true]) {
			await expect(save({ position: "Engineer", isActive })).resolves.toMatchObject({
				success: false,
				code: "ValidationError",
				error: "Use Deactivate or Reactivate to change whether an employee is active.",
			});
		}
		expect(findFirst).not.toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
	});

	it("refuses an org member, one level below scoped manager", async () => {
		const { update } = arrange();
		mocks.caller = orgMember;

		await expect(save({ position: "Engineer" })).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(update).not.toHaveBeenCalled();
	});

	it("loads the employee by ID in the session's organization only", async () => {
		const { findFirst, update } = arrange(null as never);

		await expect(save({ position: "Engineer" })).resolves.toMatchObject({
			success: false,
			code: "NotFoundError",
		});
		expect(findFirst).toHaveBeenCalledOnce();
		expect(update).not.toHaveBeenCalled();
	});

	it("refuses a scoped manager an employee they do not manage", async () => {
		const { update } = arrange();
		mocks.caller = scopedManager;
		mocks.managedEmployeeIds = [otherManagerId];

		await expect(save({ position: "Engineer" })).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(update).not.toHaveBeenCalled();
	});

	it("writes auth names to the linked user and not the employee update payload", async () => {
		const { employeeSet, userSet, userWhere, update } = arrange(
			targetEmployee({ user: { firstName: "Old", lastName: "Name", name: "Old Name" } }),
		);

		await expect(
			save({ position: "Engineer", firstName: "Ada", lastName: "Lovelace" }),
		).resolves.toMatchObject({ success: true });

		expect(employeeSet).toHaveBeenCalledWith(
			expect.not.objectContaining({ firstName: expect.anything(), lastName: expect.anything() }),
		);
		expect(userSet).toHaveBeenCalledWith(
			expect.objectContaining({ firstName: "Ada", lastName: "Lovelace", name: "Ada Lovelace" }),
		);
		expect(update).toHaveBeenNthCalledWith(2, user);
		expect(userWhere).toHaveBeenCalledWith(eq(user.id, validUserId));
		expect(mocks.revalidateTag).toHaveBeenCalledWith(CACHE_TAGS.EMPLOYEES("org-1"), "max");
	});

	it("preserves existing auth name parts when only one name is provided", async () => {
		const { employeeSet, userSet } = arrange(
			targetEmployee({
				user: {
					firstName: "ExistingFirst",
					lastName: "ExistingLast",
					name: "ExistingFirst ExistingLast",
				},
			}),
		);

		await save({ position: "Engineer", firstName: "Ada" });

		expect(employeeSet).toHaveBeenCalledWith(
			expect.not.objectContaining({ firstName: expect.anything(), lastName: expect.anything() }),
		);
		expect(userSet).toHaveBeenCalledWith(
			expect.objectContaining({
				firstName: "Ada",
				lastName: "ExistingLast",
				name: "Ada ExistingLast",
			}),
		);
	});

	it("lets a scoped manager save only manager fields of an employee they manage", async () => {
		const { employeeSet, userSet } = arrange();
		mocks.caller = scopedManager;
		mocks.managedEmployeeIds = [validEmployeeId];

		await expect(
			save({ position: "Engineer", firstName: "Ada", lastName: "Lovelace", role: "admin" }),
		).resolves.toMatchObject({ success: true });

		// A manager's save never touches the wage or contract type (#1177).
		expect(employeeSet).toHaveBeenCalledWith({
			position: "Engineer",
			updatedAt: expect.anything(),
		});
		expect(userSet).not.toHaveBeenCalled();
	});

	describe("birthday (#1579)", () => {
		const storedBirthday = new Date("1990-05-01T00:00:00.000Z");

		it.each([
			{ change: "changed", birthday: new Date("1990-05-02T00:00:00.000Z") },
			{ change: "cleared", birthday: null },
		])(
			"records that an org admin $change the birthday, without the dates",
			async ({ change, birthday }) => {
				const { employeeSet } = arrange(
					targetEmployee({ birthday: storedBirthday }),
					storedBirthday,
				);

				await save({ position: "Engineer", birthday });

				expect(employeeSet).toHaveBeenCalledWith(expect.objectContaining({ birthday }));
				expect(mocks.logAudit).toHaveBeenCalledTimes(1);
				const [entry] = mocks.logAudit.mock.calls[0] as unknown as [Record<string, unknown>];
				expect(entry).toMatchObject({
					action: "employee.updated",
					actorId: "user-admin-1",
					actorEmail: "user-admin-1@example.test",
					targetType: "employee",
					targetId: validEmployeeId,
					employeeId: validEmployeeId,
					organizationId: "org-1",
					metadata: { field: "birthday", change },
				});
				expect(JSON.stringify(entry)).not.toContain("1990");
			},
		);

		it("records nothing when the saved birthday is unchanged", async () => {
			arrange(targetEmployee({ birthday: storedBirthday }), storedBirthday);

			await save({ position: "Engineer", birthday: new Date("1990-05-01T00:00:00.000Z") });

			expect(mocks.logAudit).not.toHaveBeenCalled();
		});

		it("compares with the birthday the save replaced, not the one read before it", async () => {
			// The employee changed it to May 2 after the admin's form loaded May 1.
			const may2 = new Date("1990-05-02T00:00:00.000Z");
			arrange(targetEmployee({ birthday: storedBirthday }), may2);

			await save({ birthday: may2 });

			expect(mocks.logAudit).not.toHaveBeenCalled();
		});

		it("neither writes nor records a birthday a manager sends", async () => {
			const { employeeSet } = arrange(targetEmployee({ birthday: storedBirthday }), storedBirthday);
			mocks.caller = scopedManager;
			mocks.managedEmployeeIds = [validEmployeeId];

			await save({ position: "Engineer", birthday: new Date("2000-01-01T00:00:00.000Z") });

			expect(employeeSet).toHaveBeenCalledWith(
				expect.not.objectContaining({ birthday: expect.anything() }),
			);
			expect(mocks.logAudit).not.toHaveBeenCalled();
		});
	});

	it.each([
		{ change: "changing", startDate: new Date("2026-05-01T00:00:00.000Z") },
		{ change: "clearing", startDate: null },
	])("requires reviewed correction when $change the actual joining date", async ({ startDate }) => {
		const update = vi.fn();
		const selectWhere = vi
			.fn()
			.mockResolvedValue([{ startDate: new Date("2026-05-10T00:00:00.000Z") }]);
		const select = vi.fn(() => ({ from: vi.fn(() => ({ where: selectWhere })) }));
		const dbService = fakeDatabase({
			update,
			select,
			query: {
				employee: {
					findFirst: vi
						.fn()
						.mockResolvedValue(targetEmployee({ startDate: new Date("2026-05-10T00:00:00.000Z") })),
				},
			},
		});
		// The refusal thrown inside the transaction reaches the client as itself.
		dbService.query = vi.fn((_name: string, run: () => Promise<unknown>) => Effect.promise(run));

		expect(await save({ startDate })).toMatchObject({
			success: false,
			code: "ValidationError",
			error: "Review the actual employment start correction before saving it.",
		});
		expect(selectWhere).toHaveBeenCalled();
		expect(update).not.toHaveBeenCalled();
		expect(mocks.markEmployeeWorkBalanceDirty).not.toHaveBeenCalled();
		expect(mocks.requestEmployeeWorkBalanceFullRebuild).not.toHaveBeenCalled();
		expect(mocks.revalidateTag).not.toHaveBeenCalled();
	});
});

describe("previewEmployeeTeamChangeDrivingImpact", () => {
	it("refuses an org member, one level below scoped manager", async () => {
		const findFirst = vi.fn();
		fakeDatabase({ query: { employee: { findFirst } } });
		mocks.caller = orgMember;

		await expect(
			previewEmployeeTeamChangeDrivingImpact({ employeeId: validEmployeeId, teamId: validTeamId }),
		).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(findFirst).not.toHaveBeenCalled();
	});
});

describe("updateOwnProfileAction", () => {
	it("writes the caller's own employee record in the session's organization", async () => {
		const set = vi.fn((_values: unknown) => ({ where: vi.fn().mockResolvedValue(undefined) }));
		fakeDatabase({ update: vi.fn(() => ({ set })) });
		mocks.caller = orgMember;

		await expect(
			updateOwnProfileAction({ firstName: "Ada", pronouns: "she/her" }),
		).resolves.toEqual({ success: true, data: undefined });
		expect(set).toHaveBeenCalledWith(expect.not.objectContaining({ firstName: expect.anything() }));
	});

	it("refuses a pending membership, below org member", async () => {
		const update = vi.fn();
		fakeDatabase({ update });
		mocks.caller = pendingMember;

		await expect(updateOwnProfileAction({ pronouns: "she/her" })).resolves.toMatchObject({
			success: false,
			code: "AuthorizationError",
		});
		expect(update).not.toHaveBeenCalled();
	});
});

describe("assignManagersAction", () => {
	function arrange() {
		const assignManager = vi.fn((..._args: unknown[]) => Effect.void);
		mocks.managerService = {
			assignManager,
			getManagers: vi.fn(() => Effect.succeed([])),
			removeManager: vi.fn(() => Effect.void),
		};
		fakeDatabase({
			query: { employee: { findFirst: vi.fn().mockResolvedValue(targetEmployee()) } },
		});
		return { assignManager };
	}

	const assign = () =>
		assignManagersAction({
			employeeId: validEmployeeId,
			data: { managers: [{ managerId: otherManagerId, isPrimary: true }] },
		});

	it("records manager assignments as assigned by the session user", async () => {
		const { assignManager } = arrange();

		await expect(assign()).resolves.toEqual({ success: true, data: undefined });
		expect(assignManager).toHaveBeenCalledWith(
			validEmployeeId,
			otherManagerId,
			true,
			"user-admin-1",
		);
	});

	it("refuses a scoped manager, one level below org admin", async () => {
		const { assignManager } = arrange();
		mocks.caller = scopedManager;
		mocks.managedEmployeeIds = [validEmployeeId];

		await expect(assign()).resolves.toMatchObject({ success: false, code: "AuthorizationError" });
		expect(assignManager).not.toHaveBeenCalled();
	});
});

describe("requestEmployeeWorkBalanceRecalculationAction", () => {
	it("requests a full work balance rebuild of the employee in the session's organization", async () => {
		const findFirst = vi.fn().mockResolvedValue({ id: validEmployeeId, organizationId: "org-1" });
		const dbService = fakeDatabase({ query: { employee: { findFirst } } });
		mocks.requestEmployeeWorkBalanceFullRebuild.mockResolvedValue(undefined);

		const result = await requestEmployeeWorkBalanceRecalculationAction(validEmployeeId);

		expect(result).toEqual({ success: true, data: undefined });
		expect(dbService.query).toHaveBeenCalledWith(
			"getEmployeeForWorkBalanceRecalculation",
			expect.any(Function),
		);
		expect(findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.anything() }));
		expect(mocks.requestEmployeeWorkBalanceFullRebuild).toHaveBeenCalledWith({
			employeeId: validEmployeeId,
			organizationId: "org-1",
		});
	});

	it("does not request recalculation when the employee is not in the active organization", async () => {
		fakeDatabase({ query: { employee: { findFirst: vi.fn().mockResolvedValue(null) } } });

		const result = await requestEmployeeWorkBalanceRecalculationAction(validEmployeeId);

		expect(result).toEqual({
			success: false,
			error: "Employee not found",
			code: "NotFoundError",
		});
		expect(mocks.requestEmployeeWorkBalanceFullRebuild).not.toHaveBeenCalled();
	});

	it("rejects invalid employee IDs before target lookup or rebuild", async () => {
		const findFirst = vi.fn();
		fakeDatabase({ query: { employee: { findFirst } } });

		const result = await requestEmployeeWorkBalanceRecalculationAction("not-a-uuid");

		expect(result).toEqual({
			success: false,
			error: "Invalid employee ID",
			code: "ValidationError",
		});
		expect(findFirst).not.toHaveBeenCalled();
		expect(mocks.requestEmployeeWorkBalanceFullRebuild).not.toHaveBeenCalled();
	});

	it("refuses a scoped manager, one level below org admin, before lookup or rebuild", async () => {
		const findFirst = vi.fn();
		fakeDatabase({ query: { employee: { findFirst } } });
		mocks.caller = scopedManager;

		const result = await requestEmployeeWorkBalanceRecalculationAction(validEmployeeId);

		expect(result).toMatchObject({ success: false, code: "AuthorizationError" });
		expect(findFirst).not.toHaveBeenCalled();
		expect(mocks.requestEmployeeWorkBalanceFullRebuild).not.toHaveBeenCalled();
	});
});
