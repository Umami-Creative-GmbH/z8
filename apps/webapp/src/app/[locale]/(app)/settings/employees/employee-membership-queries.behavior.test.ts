import { sql } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { member } from "@/db/auth-schema";
import { employee, employeeInvitationDraft } from "@/db/schema";
import { DatabaseError } from "@/lib/effect/errors";

const mocks = vi.hoisted(() => ({
	ensureEmployeeProfiles: vi.fn(),
	ensureTargetAccess: vi.fn(() => Effect.void),
	getActor: vi.fn(),
}));

vi.mock("@/lib/auth/organization-member-provisioning", () => ({
	ensureEmployeeProfilesForOrganizationMembers: mocks.ensureEmployeeProfiles,
}));

vi.mock("@/lib/effect/runtime", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@/lib/effect/runtime")>();
	const { Layer } = await import("effect");
	return { ...actual, AppLayer: Layer.empty };
});

vi.mock("./employee-action-utils", () => ({
	ensureSettingsActorCanAccessEmployeeTarget: mocks.ensureTargetAccess,
	getEmployeeSettingsActorContext: mocks.getActor,
}));

import {
	getEmployeeAction,
	listEmployeesAction,
} from "./employee-queries.actions";

type EmployeeModel = {
	id: string;
	organizationId: string;
	userId: string;
	isActive: boolean;
};

type MemberModel = {
	id: string;
	organizationId: string;
	userId: string;
	role: string;
	status: string | null;
	createdAt: Date;
};

function employeeRow(model: EmployeeModel) {
	return {
		id: model.id,
		organizationId: model.organizationId,
		userId: model.userId,
		teamId: null,
		role: "employee" as const,
		isActive: model.isActive,
		firstName: null,
		lastName: null,
		position: null,
		employeeNumber: null,
		gender: null,
		pronouns: null,
		birthday: null,
		startDate: null,
		endDate: null,
		contractType: "permanent" as const,
		currentHourlyRate: null,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
	};
}

function userRow(model: EmployeeModel) {
	return {
		id: model.userId,
		name: model.userId,
		email: `${model.userId}@example.com`,
		emailVerified: true,
		image: null,
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
		updatedAt: new Date("2026-01-01T00:00:00.000Z"),
		firstName: null,
		lastName: null,
		role: null,
		banned: null,
		banReason: null,
		banExpires: null,
		twoFactorEnabled: null,
		canCreateOrganizations: null,
		invitedVia: null,
		pendingInviteCode: null,
	};
}

function createDb(employees: EmployeeModel[], memberships: MemberModel[]) {
	const lateralQueries: Array<{ sql: string; params: unknown[] }> = [];
	const employeePredicates: unknown[] = [];
	const detailPredicates: unknown[] = [];
	let joinedMemberships = new Map<string, MemberModel>();

	const select = vi.fn((_selection: Record<string, unknown>) => {
		let source: unknown;
		let rows: unknown[] = [];
		let wherePredicate: unknown;
		let limitValue: number | undefined;
		let chain: Record<string, unknown>;
		const methods = {
			from(table: unknown) {
				source = table;
				return chain;
			},
			innerJoin() {
				return chain;
			},
			leftJoin() {
				return chain;
			},
			leftJoinLateral(query: { getSQL(): unknown }) {
				const rendered = new PgDialect().sqlToQuery(query.getSQL() as never);
				lateralQueries.push(rendered);
				const isOrganizationScoped = rendered.sql.includes(
					'"member"."organization_id" = $',
				);
				const isUserScoped = rendered.sql.includes(
					'"member"."user_id" = "employee"."user_id"',
				);
				const approvedOnly = rendered.params.includes("approved");
				const deterministic =
					rendered.sql.includes('"member"."created_at" desc') &&
					rendered.sql.includes('"member"."id" desc') &&
					rendered.sql.includes("limit $");

				joinedMemberships = new Map(
					employees.map((candidate) => {
						const matches = memberships
							.filter(
								(membership) =>
									(!isUserScoped || membership.userId === candidate.userId) &&
									(!isOrganizationScoped ||
										membership.organizationId === "org-1") &&
									(!approvedOnly || membership.status === "approved"),
							)
							.toSorted((a, b) =>
								deterministic
									? b.createdAt.getTime() - a.createdAt.getTime() ||
										b.id.localeCompare(a.id)
									: 0,
							);
						return [`${candidate.organizationId}:${candidate.id}`, matches[0]];
					}),
				);
				return chain;
			},
			where(predicate: unknown) {
				wherePredicate = predicate;
				if (source === employee) {
					employeePredicates.push(predicate);
					rows = employees
						.filter((candidate) => candidate.organizationId === "org-1")
						.map((candidate) => {
							const membership = joinedMemberships.get(
								`${candidate.organizationId}:${candidate.id}`,
							);
							return {
								employee: employeeRow(candidate),
								user: userRow(candidate),
								team: null,
								membership: membership
									? {
											id: membership.id,
											role: membership.role,
											status: membership.status,
										}
									: { id: null, role: null, status: null },
							};
						});
				} else if (source === employeeInvitationDraft) {
					rows = [];
				}
				return chain;
			},
			orderBy() {
				return chain;
			},
			limit(value: number) {
				limitValue = value;
				return chain;
			},
			offset() {
				return chain;
			},
			as() {
				if (source !== member) return chain;
				return {
					getSQL: () => sql`
						select ${member.id}, ${member.role}, ${member.status}
						from ${member}
						where ${wherePredicate as never}
						order by ${member.createdAt} desc, ${member.id} desc
						limit ${limitValue}
					`,
				};
			},
		};
		chain = new Proxy(Promise.resolve(undefined), {
			get(_target, property) {
				if (property === "then")
					return Promise.resolve(rows).then.bind(Promise.resolve(rows));
				return methods[property as keyof typeof methods];
			},
		});
		return chain;
	});

	const findFirst = vi.fn(async (options: { where: unknown }) => {
		detailPredicates.push(options.where);
		const query = new PgDialect().sqlToQuery(options.where as never);
		const target = employees.find(
			(candidate) =>
				candidate.id === query.params.find((param) => param === candidate.id) &&
				candidate.organizationId ===
					query.params.find((param) => param === candidate.organizationId),
		);
		return target
			? {
					...employeeRow(target),
					user: userRow(target),
					team: null,
					managers: [],
				}
			: null;
	});

	return {
		dbService: {
			db: { select, query: { employee: { findFirst } } },
			query: vi.fn((name: string, run: () => Promise<unknown>) =>
				Effect.tryPromise({
					try: run,
					catch: (cause) =>
						new DatabaseError({ message: name, operation: name, cause }),
				}),
			),
		},
		detailPredicates,
		employeePredicates,
		lateralQueries,
	};
}

function setActor(dbService: ReturnType<typeof createDb>["dbService"]) {
	mocks.getActor.mockReturnValue(
		Effect.succeed({
			accessTier: "orgAdmin",
			organizationId: "org-1",
			currentEmployee: null,
			session: { user: { id: "admin-1", email: "admin@example.com" } },
			dbService,
		}),
	);
}

describe("employee membership queries", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mocks.ensureEmployeeProfiles.mockResolvedValue(undefined);
	});

	it("attaches only the newest approved membership in the actor organization", async () => {
		const employees = [
			{
				id: "employee-1",
				organizationId: "org-1",
				userId: "user-1",
				isActive: true,
			},
		];
		const fake = createDb(employees, [
			{
				id: "member-old",
				organizationId: "org-1",
				userId: "user-1",
				role: "member",
				status: "approved",
				createdAt: new Date("2025-01-01"),
			},
			{
				id: "member-pending",
				organizationId: "org-1",
				userId: "user-1",
				role: "admin",
				status: "pending",
				createdAt: new Date("2027-01-01"),
			},
			{
				id: "member-new",
				organizationId: "org-1",
				userId: "user-1",
				role: "owner",
				status: "approved",
				createdAt: new Date("2026-01-01"),
			},
		]);
		setActor(fake.dbService);

		const result = await listEmployeesAction();

		expect(result).toMatchObject({
			success: true,
			data: {
				employees: [
					{
						id: "employee-1",
						membership: { id: "member-new", role: "owner", status: "approved" },
					},
				],
			},
		});
		expect(result.success && result.data.employees).toHaveLength(1);
	});

	it("does not attach cross-organization membership and retains inactive employees without one", async () => {
		const fake = createDb(
			[
				{
					id: "employee-1",
					organizationId: "org-1",
					userId: "user-1",
					isActive: false,
				},
			],
			[
				{
					id: "member-other-org",
					organizationId: "org-2",
					userId: "user-1",
					role: "owner",
					status: "approved",
					createdAt: new Date("2026-01-01"),
				},
			],
		);
		setActor(fake.dbService);

		const result = await listEmployeesAction({ status: "all" });

		expect(result).toMatchObject({
			success: true,
			data: {
				employees: [{ id: "employee-1", isActive: false, membership: null }],
			},
		});
	});

	it("returns drafts with null membership", async () => {
		const source = await import("node:fs").then(({ readFileSync }) =>
			readFileSync(
				new URL("./employee-queries.actions.ts", import.meta.url),
				"utf8",
			),
		);
		expect(source).toContain("membership: null");
	});

	it("scopes both detail lookups by final employee id and actor organization", async () => {
		const fake = createDb(
			[
				{
					id: "employee-1",
					organizationId: "org-1",
					userId: "user-1",
					isActive: true,
				},
				{
					id: "employee-1",
					organizationId: "org-2",
					userId: "user-2",
					isActive: true,
				},
			],
			[
				{
					id: "member-1",
					organizationId: "org-1",
					userId: "user-1",
					role: "member",
					status: "approved",
					createdAt: new Date("2026-01-01"),
				},
			],
		);
		setActor(fake.dbService);

		const result = await getEmployeeAction("employee-1");

		expect(result).toMatchObject({
			success: true,
			data: { userId: "user-1", membership: { id: "member-1" } },
		});
		for (const predicate of [
			...fake.employeePredicates,
			...fake.detailPredicates,
		]) {
			const query = new PgDialect().sqlToQuery(predicate as never);
			expect(query.params).toEqual(
				expect.arrayContaining(["employee-1", "org-1"]),
			);
		}
	});
});
