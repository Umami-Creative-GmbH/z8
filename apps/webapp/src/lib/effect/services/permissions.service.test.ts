import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { DatabaseError } from "../errors";
import { DatabaseService } from "./database.service";
import {
	PermissionsService,
	PermissionsServiceLive,
} from "./permissions.service";

function collectColumnNames(value: unknown): string[] {
	if (!value || typeof value !== "object") return [];
	const node = value as {
		config?: { name?: unknown };
		queryChunks?: unknown[];
	};
	const ownName =
		typeof node.config?.name === "string" ? [node.config.name] : [];
	return [...ownName, ...(node.queryChunks ?? []).flatMap(collectColumnNames)];
}

function collectParams(
	value: unknown,
	params: unknown[] = [],
	seen = new WeakSet<object>(),
): unknown[] {
	if (typeof value === "string" || typeof value === "number") {
		params.push(value);
		return params;
	}
	if (Array.isArray(value)) {
		for (const item of value) collectParams(item, params, seen);
		return params;
	}
	if (!value || typeof value !== "object" || seen.has(value)) return params;
	seen.add(value);
	const node = value as {
		constructor?: { name?: string };
		encoder?: unknown;
		queryChunks?: unknown[];
		value?: unknown;
	};
	if (node.constructor?.name === "Param" || "encoder" in node)
		params.push(node.value);
	for (const chunk of node.queryChunks ?? [])
		collectParams(chunk, params, seen);
	return params;
}

function collectSqlText(value: unknown): string {
	if (typeof value === "string") return value;
	if (!value || typeof value !== "object") return "";
	const node = value as { queryChunks?: unknown[]; value?: unknown };
	const ownValue = Array.isArray(node.value)
		? node.value
				.filter((part): part is string => typeof part === "string")
				.join("")
		: "";
	return `${ownValue}${(node.queryChunks ?? []).map(collectSqlText).join("")}`;
}

function databaseLayer(db: unknown) {
	return Layer.succeed(
		DatabaseService,
		DatabaseService.of({
			db: db as never,
			query: (name, query) =>
				Effect.tryPromise({
					try: query,
					catch: (cause) =>
						new DatabaseError({
							message: `Database query failed: ${name}`,
							operation: name,
							cause,
						}),
				}) as never,
		}),
	);
}

function runWithService<A>(
	db: unknown,
	use: (service: PermissionsService) => Effect.Effect<A, unknown>,
) {
	const layer = PermissionsServiceLive.pipe(Layer.provide(databaseLayer(db)));
	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* PermissionsService;
			return yield* use(service);
		}).pipe(Effect.provide(layer)),
	);
}

type PermissionRow = {
	id: string;
	employeeId: string;
	organizationId: string;
	teamId: string | null;
	canCreateTeams: boolean;
	canManageTeamMembers: boolean;
	canManageTeamSettings: boolean;
	canApproveTeamRequests: boolean;
	grantedBy: string;
	grantedAt: Date;
};

function createMutationDb(initialRows: PermissionRow[] = []) {
	const rows = initialRows.map((row) => ({ ...row }));
	const locks = new Map<string, Promise<void>>();
	const lockStatements: unknown[] = [];
	const employeeWheres: unknown[] = [];
	const teamWheres: unknown[] = [];
	const deleteWheres: unknown[] = [];
	let nextId = 1;

	function employeeFor(where: unknown) {
		employeeWheres.push(where);
		const params = collectParams(where);
		if (!params.includes("org-1")) return undefined;
		if (params.includes("employee-target")) {
			return {
				id: "employee-target",
				organizationId: "org-1",
				userId: "user-target",
				role: "employee",
			};
		}
		if (params.includes("employee-granter")) {
			return {
				id: "employee-granter",
				organizationId: "org-1",
				userId: "user-admin",
				role: "employee",
			};
		}
		return undefined;
	}

	function makeClient(releases: Array<() => void>) {
		return {
			query: {
				employee: {
					findFirst: vi.fn(async ({ where }: { where: unknown }) =>
						employeeFor(where),
					),
				},
				member: { findFirst: vi.fn(async () => ({ role: "owner" })) },
				team: {
					findFirst: vi.fn(async ({ where }: { where: unknown }) => {
						teamWheres.push(where);
						const params = collectParams(where);
						return params.includes("team-1") && params.includes("org-1")
							? { id: "team-1", organizationId: "org-1" }
							: undefined;
					}),
				},
				teamPermissions: {
					findFirst: vi.fn(async () => rows[0]),
					findMany: vi.fn(async ({ where }: { where: unknown }) => {
						const params = collectParams(where);
						const teamId = params.includes("team-1") ? "team-1" : null;
						return rows
							.filter(
								(row) =>
									row.employeeId === "employee-target" &&
									row.organizationId === "org-1" &&
									row.teamId === teamId,
							)
							.toSorted((left, right) => left.id.localeCompare(right.id));
					}),
				},
			},
			execute: vi.fn(async (statement: unknown) => {
				lockStatements.push(statement);
				const [key] = collectParams(statement);
				if (typeof key !== "string")
					throw new Error("Expected parameterized lock key");
				const previous = locks.get(key) ?? Promise.resolve();
				let release!: () => void;
				const held = new Promise<void>((resolve) => {
					release = resolve;
				});
				locks.set(
					key,
					previous.then(() => held),
				);
				await previous;
				releases.push(release);
			}),
			insert: vi.fn(() => ({
				values: vi.fn(
					async (values: Omit<PermissionRow, "id" | "grantedAt">) => {
						rows.push({
							id: `permission-${nextId++}`,
							grantedAt: new Date(),
							...values,
						});
					},
				),
			})),
			update: vi.fn(() => ({
				set: vi.fn((values: Partial<PermissionRow>) => ({
					where: vi.fn(async (where: unknown) => {
						const params = collectParams(where);
						const row = rows.find((candidate) => params.includes(candidate.id));
						if (row) Object.assign(row, values);
					}),
				})),
			})),
			delete: vi.fn(() => ({
				where: vi.fn(async (where: unknown) => {
					deleteWheres.push(where);
					const params = collectParams(where).flatMap((value) =>
						Array.isArray(value) ? value : [value],
					);
					const explicitIds = rows
						.filter((row) => params.includes(row.id))
						.map((row) => row.id);
					const teamId = params.includes("team-1") ? "team-1" : null;
					for (let index = rows.length - 1; index >= 0; index--) {
						const row = rows[index];
						if (!row) continue;
						const matches = explicitIds.length
							? explicitIds.includes(row.id)
							: row.employeeId === "employee-target" &&
								row.organizationId === "org-1" &&
								row.teamId === teamId;
						if (matches) rows.splice(index, 1);
					}
				}),
			})),
		};
	}

	const root = makeClient([]);
	const transaction = vi.fn(
		async (
			operation: (tx: ReturnType<typeof makeClient>) => Promise<unknown>,
		) => {
			const releases: Array<() => void> = [];
			try {
				return await operation(makeClient(releases));
			} finally {
				for (const release of releases.toReversed()) release();
			}
		},
	);

	return {
		db: { ...root, transaction },
		rows,
		transaction,
		lockStatements,
		employeeWheres,
		teamWheres,
		deleteWheres,
	};
}

describe("PermissionsService.getEmployeePermissions", () => {
	it("scopes both employee existence and permission reads to the organization", async () => {
		let employeeWhere: unknown;
		let permissionsWhere: unknown;
		const findEmployee = vi.fn(async (query: { where: unknown }) => {
			employeeWhere = query.where;
			return { id: "employee-shared", organizationId: "org-actor" };
		});
		const findPermissions = vi.fn(async (query: { where: unknown }) => {
			permissionsWhere = query.where;
			return [];
		});
		const databaseLayer = Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: {
					query: {
						employee: { findFirst: findEmployee },
						teamPermissions: { findMany: findPermissions },
					},
				} as never,
				query: (name, query) =>
					Effect.tryPromise({
						try: query,
						catch: (cause) =>
							new DatabaseError({
								message: `Database query failed: ${name}`,
								operation: name,
								cause,
							}),
					}) as never,
			}),
		);
		const layer = PermissionsServiceLive.pipe(Layer.provide(databaseLayer));

		await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* PermissionsService;
				return yield* service.getEmployeePermissions(
					"employee-shared",
					"org-actor",
				);
			}).pipe(Effect.provide(layer)),
		);

		expect(collectColumnNames(employeeWhere)).toEqual(
			expect.arrayContaining(["id", "organization_id"]),
		);
		expect(collectParams(employeeWhere)).toEqual(
			expect.arrayContaining(["employee-shared", "org-actor"]),
		);
		expect(collectColumnNames(permissionsWhere)).toEqual(
			expect.arrayContaining(["employee_id", "organization_id"]),
		);
		expect(collectParams(permissionsWhere)).toEqual(
			expect.arrayContaining(["employee-shared", "org-actor"]),
		);
	});
});

describe("PermissionsService mutations", () => {
	it("authorizes a membership admin by the scoped granter employee user ID", async () => {
		let granterWhere: unknown;
		let membershipWhere: unknown;
		let lockStatement: unknown;
		let inserted: Record<string, unknown> | undefined;
		const tx = {
			query: {
				employee: {
					findFirst: vi.fn(async ({ where }: { where: unknown }) => {
						const params = collectParams(where);
						if (params.includes("employee-target"))
							return {
								id: "employee-target",
								organizationId: "org-1",
								userId: "user-target",
							};
						granterWhere = where;
						return {
							id: "employee-granter",
							organizationId: "org-1",
							userId: "user-admin",
							role: "employee",
						};
					}),
				},
				member: {
					findFirst: vi.fn(async ({ where }: { where: unknown }) => {
						membershipWhere = where;
						return { role: "owner" };
					}),
				},
				team: { findFirst: vi.fn() },
				teamPermissions: { findMany: vi.fn(async () => []) },
			},
			execute: vi.fn(async (statement: unknown) => {
				lockStatement = statement;
			}),
			insert: vi.fn(() => ({
				values: vi.fn(async (values: Record<string, unknown>) => {
					inserted = values;
				}),
			})),
			update: vi.fn(),
			delete: vi.fn(),
		};
		const transaction = vi.fn(
			async (operation: (tx: typeof tx) => Promise<unknown>) => operation(tx),
		);
		const db = { ...tx, transaction };

		await runWithService(db, (service) =>
			service.grantPermissions(
				"employee-target",
				"org-1",
				{ canCreateTeams: true },
				null,
				"employee-granter",
			),
		);

		expect(transaction).toHaveBeenCalledOnce();
		expect(collectColumnNames(granterWhere)).toEqual(
			expect.arrayContaining(["id", "organization_id"]),
		);
		expect(collectParams(granterWhere)).toEqual(
			expect.arrayContaining(["employee-granter", "org-1"]),
		);
		expect(collectParams(membershipWhere)).toEqual(
			expect.arrayContaining(["user-admin", "org-1"]),
		);
		expect(collectParams(membershipWhere)).not.toContain("employee-granter");
		expect(collectSqlText(lockStatement)).toContain("pg_advisory_xact_lock");
		expect(collectParams(lockStatement)).toEqual([
			"team-permissions:org-1:employee-target:organization-wide",
		]);
		expect(inserted).toMatchObject({
			grantedBy: "employee-granter",
			organizationId: "org-1",
		});
	});

	it("rejects a cross-organization target employee in the SQL predicate", async () => {
		let targetWhere: unknown;
		const tx = {
			query: {
				employee: {
					findFirst: vi.fn(async ({ where }: { where: unknown }) => {
						targetWhere = where;
						return undefined;
					}),
				},
			},
		};
		const db = {
			...tx,
			transaction: vi.fn(
				async (operation: (tx: typeof tx) => Promise<unknown>) => operation(tx),
			),
		};

		await expect(
			runWithService(db, (service) =>
				service.grantPermissions(
					"employee-foreign",
					"org-1",
					{},
					null,
					"employee-granter",
				),
			),
		).rejects.toBeDefined();
		expect(collectColumnNames(targetWhere)).toEqual(
			expect.arrayContaining(["id", "organization_id"]),
		);
		expect(collectParams(targetWhere)).toEqual(
			expect.arrayContaining(["employee-foreign", "org-1"]),
		);
	});

	it("rejects a cross-organization team before inserting", async () => {
		let teamWhere: unknown;
		const insert = vi.fn();
		const tx = {
			query: {
				employee: {
					findFirst: vi
						.fn()
						.mockResolvedValueOnce({
							id: "employee-target",
							organizationId: "org-1",
						})
						.mockResolvedValueOnce({
							id: "employee-granter",
							organizationId: "org-1",
							userId: "user-admin",
							role: "admin",
						}),
				},
				team: {
					findFirst: vi.fn(async ({ where }: { where: unknown }) => {
						teamWhere = where;
						return undefined;
					}),
				},
			},
			insert,
		};
		const db = {
			...tx,
			transaction: vi.fn(
				async (operation: (tx: typeof tx) => Promise<unknown>) => operation(tx),
			),
		};

		await expect(
			runWithService(db, (service) =>
				service.grantPermissions(
					"employee-target",
					"org-1",
					{},
					"team-foreign",
					"employee-granter",
				),
			),
		).rejects.toBeDefined();
		expect(collectColumnNames(teamWhere)).toEqual(
			expect.arrayContaining(["id", "organization_id"]),
		);
		expect(collectParams(teamWhere)).toEqual(
			expect.arrayContaining(["team-foreign", "org-1"]),
		);
		expect(insert).not.toHaveBeenCalled();
	});

	it("serializes concurrent organization-wide grants into one row", async () => {
		const context = createMutationDb();

		await Promise.all([
			runWithService(context.db, (service) =>
				service.grantPermissions(
					"employee-target",
					"org-1",
					{ canCreateTeams: true },
					null,
					"employee-granter",
				),
			),
			runWithService(context.db, (service) =>
				service.grantPermissions(
					"employee-target",
					"org-1",
					{ canManageTeamMembers: true },
					null,
					"employee-granter",
				),
			),
		]);

		expect(context.transaction).toHaveBeenCalledTimes(2);
		expect(context.lockStatements).toHaveLength(2);
		expect(context.rows).toHaveLength(1);
		expect(context.rows[0]).toMatchObject({
			teamId: null,
			canCreateTeams: true,
			canManageTeamMembers: true,
		});
	});

	it("updates the deterministic first org-wide row and removes duplicates", async () => {
		const base = {
			employeeId: "employee-target",
			organizationId: "org-1",
			teamId: null,
			canCreateTeams: true,
			canManageTeamMembers: false,
			canManageTeamSettings: false,
			canApproveTeamRequests: false,
			grantedBy: "employee-granter",
			grantedAt: new Date("2026-07-29T08:00:00.000Z"),
		};
		const context = createMutationDb([
			{ id: "permission-b", ...base },
			{ id: "permission-a", ...base },
		]);

		await runWithService(context.db, (service) =>
			service.grantPermissions(
				"employee-target",
				"org-1",
				{ canManageTeamSettings: true },
				null,
				"employee-granter",
			),
		);

		expect(context.rows).toHaveLength(1);
		expect(context.rows[0]).toMatchObject({
			id: "permission-a",
			canCreateTeams: true,
			canManageTeamSettings: true,
		});
	});

	it("serializes and scopes team revocation by organization, employee, and team", async () => {
		const context = createMutationDb([
			{
				id: "permission-team",
				employeeId: "employee-target",
				organizationId: "org-1",
				teamId: "team-1",
				canCreateTeams: true,
				canManageTeamMembers: false,
				canManageTeamSettings: false,
				canApproveTeamRequests: false,
				grantedBy: "employee-granter",
				grantedAt: new Date("2026-07-29T08:00:00.000Z"),
			},
		]);

		await runWithService(context.db, (service) =>
			service.revokePermissions("employee-target", "org-1", "team-1"),
		);

		expect(context.rows).toHaveLength(0);
		expect(context.transaction).toHaveBeenCalledOnce();
		expect(collectParams(context.lockStatements[0])).toEqual([
			"team-permissions:org-1:employee-target:team-1",
		]);
		expect(collectColumnNames(context.employeeWheres[0])).toEqual(
			expect.arrayContaining(["id", "organization_id"]),
		);
		expect(collectColumnNames(context.teamWheres[0])).toEqual(
			expect.arrayContaining(["id", "organization_id"]),
		);
		expect(collectColumnNames(context.deleteWheres[0])).toEqual(
			expect.arrayContaining(["employee_id", "organization_id", "team_id"]),
		);
	});

	it("rejects a cross-organization revoke target before deletion", async () => {
		let targetWhere: unknown;
		const deletePermissions = vi.fn();
		const tx = {
			query: {
				employee: {
					findFirst: vi.fn(async ({ where }: { where: unknown }) => {
						targetWhere = where;
						return undefined;
					}),
				},
			},
			delete: deletePermissions,
		};
		const db = {
			...tx,
			transaction: vi.fn(
				async (operation: (tx: typeof tx) => Promise<unknown>) => operation(tx),
			),
		};

		await expect(
			runWithService(db, (service) =>
				service.revokePermissions("employee-foreign", "org-1", null),
			),
		).rejects.toBeDefined();
		expect(collectColumnNames(targetWhere)).toEqual(
			expect.arrayContaining(["id", "organization_id"]),
		);
		expect(collectParams(targetWhere)).toEqual(
			expect.arrayContaining(["employee-foreign", "org-1"]),
		);
		expect(deletePermissions).not.toHaveBeenCalled();
	});

	it("rejects a cross-organization revoke team before deletion", async () => {
		let teamWhere: unknown;
		const deletePermissions = vi.fn();
		const tx = {
			query: {
				employee: {
					findFirst: vi.fn(async () => ({
						id: "employee-target",
						organizationId: "org-1",
					})),
				},
				team: {
					findFirst: vi.fn(async ({ where }: { where: unknown }) => {
						teamWhere = where;
						return undefined;
					}),
				},
			},
			delete: deletePermissions,
		};
		const db = {
			...tx,
			transaction: vi.fn(
				async (operation: (tx: typeof tx) => Promise<unknown>) => operation(tx),
			),
		};

		await expect(
			runWithService(db, (service) =>
				service.revokePermissions("employee-target", "org-1", "team-foreign"),
			),
		).rejects.toBeDefined();
		expect(collectColumnNames(teamWhere)).toEqual(
			expect.arrayContaining(["id", "organization_id"]),
		);
		expect(collectParams(teamWhere)).toEqual(
			expect.arrayContaining(["team-foreign", "org-1"]),
		);
		expect(deletePermissions).not.toHaveBeenCalled();
	});
});
