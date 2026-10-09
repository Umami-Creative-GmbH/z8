import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DatabaseError } from "@/lib/effect/errors";
import { AuthService } from "@/lib/effect/services/auth.service";
import { DatabaseService } from "@/lib/effect/services/database.service";
import { getEmployeeSettingsActorContext } from "./employee-action-utils";

const { warn } = vi.hoisted(() => ({ warn: vi.fn() }));
vi.mock("@/lib/logger", () => ({ createLogger: () => ({ warn }) }));

type Membership = { role: string; status: string };
const activeEmployee = {
	id: "employee-1",
	organizationId: "org-1",
	role: "employee",
	isActive: true,
	privateProfileField: "private-profile-sentinel",
};

function runActor(
	input: {
		membership?: Membership | null;
		diagnosticMembership?: Membership | null;
		employee?: typeof activeEmployee | null;
		activeOrganizationId?: string | null;
		organizationId?: string;
		probeFails?: boolean;
	} = {},
) {
	const memberFindFirst = vi.fn(async ({ where }) => {
		const params = new PgDialect().sqlToQuery(where).params;
		if (params.includes("approved")) return input.membership ?? null;
		if (input.probeFails) throw new Error("secret-database-sentinel");
		return input.diagnosticMembership ?? null;
	});
	const query = vi.fn((name, execute) =>
		Effect.tryPromise({
			try: execute,
			catch: (cause) =>
				new DatabaseError({
					message: "Database query failed",
					operation: name,
					cause,
				}),
		}),
	);
	const authLayer = Layer.succeed(AuthService, {
		getSession: () =>
			Effect.succeed({
				user: { id: "user-1", email: "private-email-sentinel" },
				session: {
					activeOrganizationId:
						input.activeOrganizationId === undefined
							? "org-1"
							: input.activeOrganizationId,
					token: "secret-session-sentinel",
				},
			} as never),
	});
	const databaseLayer = Layer.succeed(DatabaseService, {
		db: {
			query: {
				member: { findFirst: memberFindFirst },
				employee: {
					findFirst: async () =>
						input.employee === undefined ? activeEmployee : input.employee,
				},
			},
		} as never,
		query,
	});
	return {
		memberFindFirst,
		query,
		result: Effect.runPromise(
			getEmployeeSettingsActorContext({
				queryName: "listEmployees:actor",
				organizationId: input.organizationId,
			}).pipe(Effect.provide(Layer.merge(authLayer, databaseLayer))),
		),
	};
}

beforeEach(() => warn.mockClear());

describe("employee settings denial diagnostics", () => {
	it("logs the action and role decision without exposing session or profile data", async () => {
		const { result, memberFindFirst } = runActor({
			membership: { role: "member", status: "approved" },
		});
		await expect(result).rejects.toMatchObject({ _tag: "AuthorizationError" });
		expect(warn).toHaveBeenCalledExactlyOnceWith(
			{
				event: "employee_settings_access_denied",
				operation: "listEmployees:actor",
				reason: "insufficient_role",
				userId: "user-1",
				organizationId: "org-1",
				activeOrganizationId: "org-1",
				requestedOrganizationId: null,
				membershipRole: "member",
				membershipStatus: "approved",
				membershipLookupFailed: false,
				employeeId: "employee-1",
				employeeRole: "employee",
				employeeIsActive: true,
				accessTier: "member",
			},
			"[DEBUG-employee-settings-access] Authorization denied",
		);
		expect(memberFindFirst).toHaveBeenCalledTimes(1);
		expect(JSON.stringify(warn.mock.calls)).not.toContain("sentinel");
	});

	it.each(["pending", "rejected", null])(
		"reports %s membership in the requested organization",
		async (status) => {
			const { result, memberFindFirst } = runActor({
				organizationId: "org-2",
				diagnosticMembership: status ? { role: "admin", status } : null,
			});
			await expect(result).rejects.toMatchObject({
				_tag: "AuthorizationError",
				message: "You do not have access to employee settings",
			});
			expect(warn.mock.calls[0][0]).toMatchObject({
				reason: "no_approved_membership",
				organizationId: "org-2",
				activeOrganizationId: "org-1",
				requestedOrganizationId: "org-2",
				membershipRole: status ? "admin" : null,
				membershipStatus: status,
				membershipLookupFailed: false,
			});
			const dialect = new PgDialect();
			expect(
				dialect.sqlToQuery(memberFindFirst.mock.calls[0][0].where).params,
			).toEqual(["user-1", "org-2", "approved"]);
			expect(
				dialect.sqlToQuery(memberFindFirst.mock.calls[1][0].where).params,
			).toEqual(["user-1", "org-2"]);
		},
	);

	it("preserves the original denial when the diagnostic membership lookup fails", async () => {
		const { result } = runActor({ probeFails: true });
		await expect(result).rejects.toMatchObject({
			_tag: "AuthorizationError",
			message: "You do not have access to employee settings",
		});
		expect(warn.mock.calls[0][0]).toMatchObject({
			reason: "no_approved_membership",
			membershipLookupFailed: true,
			membershipStatus: null,
		});
		expect(JSON.stringify(warn.mock.calls)).not.toContain("sentinel");
	});

	it("identifies inactive employees without probing membership again", async () => {
		const { result, memberFindFirst } = runActor({
			membership: { role: "owner", status: "approved" },
			employee: { ...activeEmployee, role: "admin", isActive: false },
		});
		await expect(result).rejects.toThrow("Organization access is inactive");
		expect(warn.mock.calls[0][0]).toMatchObject({
			reason: "inactive_employee",
			membershipRole: "owner",
			employeeIsActive: false,
		});
		expect(memberFindFirst).toHaveBeenCalledTimes(1);
	});

	it("identifies missing organization selection before querying membership", async () => {
		const { result, memberFindFirst } = runActor({
			activeOrganizationId: null,
		});
		await expect(result).rejects.toThrow("No active organization selected");
		expect(warn.mock.calls[0][0]).toMatchObject({
			reason: "no_organization",
			organizationId: null,
		});
		expect(memberFindFirst).not.toHaveBeenCalled();
	});

	it.each(["owner", "admin"])(
		"keeps approved %s access silent without an employee",
		async (role) => {
			const { result, memberFindFirst } = runActor({
				membership: { role, status: "approved" },
				employee: null,
			});
			await expect(result).resolves.toMatchObject({ accessTier: "orgAdmin" });
			expect(warn).not.toHaveBeenCalled();
			expect(memberFindFirst).toHaveBeenCalledTimes(1);
		},
	);
});
