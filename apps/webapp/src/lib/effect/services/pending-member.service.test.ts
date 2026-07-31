import type { SQL } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { member } from "@/db/auth-schema";
import { auditLog, employee, memberApproval } from "@/db/schema";
import { DatabaseError, ValidationError } from "../errors";
import { DatabaseService } from "./database.service";
import {
	PendingMemberService,
	PendingMemberServiceLive,
} from "./pending-member.service";

const billingMock = vi.hoisted(() => ({
	sync: vi.fn(async () => undefined),
}));

const removalCleanupMock = vi.hoisted(() => ({
	complete: vi.fn(async () => undefined),
	completePostCommit: vi.fn(async () => undefined),
	revokeInTransaction: vi.fn(async () => ({
		accessRestored: false,
		sessionTokens: ["session-token"],
	})),
}));

vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	syncBillingSeatsAfterMemberChange: billingMock.sync,
}));

vi.mock("@/lib/auth/member-removal-cleanup", () => ({
	completeRemovedMemberCleanup: removalCleanupMock.complete,
	completeRemovedMemberCleanupPostCommit: removalCleanupMock.completePostCommit,
	revokeRemovedMemberAccessInTransaction:
		removalCleanupMock.revokeInTransaction,
}));

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((resolvePromise) => {
		resolve = resolvePromise;
	});
	return { promise, resolve };
}

type ApprovalFakeOptions = {
	memberOrganizationId?: string;
	transitionWins?: boolean;
	provisioningFails?: boolean;
	approvalInsertPromise?: Promise<void>;
	employeeReadPromise?: Promise<void>;
};

function collectColumnNames(value: unknown): string[] {
	if (!value || typeof value !== "object") return [];
	const node = value as {
		config?: { name?: unknown };
		queryChunks?: unknown[];
	};
	const ownName =
		typeof node.config?.name === "string" ? [node.config.name] : [];
	const chunkNames = Array.isArray(node.queryChunks)
		? node.queryChunks.flatMap(collectColumnNames)
		: [];
	return [...ownName, ...chunkNames];
}

function serviceLayer(db: unknown) {
	return PendingMemberServiceLive.pipe(
		Layer.provide(
			Layer.succeed(
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
			),
		),
	);
}

function approvalLayer(options: ApprovalFakeOptions = {}) {
	const events: string[] = [];
	const approvals: unknown[] = [];
	const employees: unknown[] = [];
	const memberUpdates: unknown[] = [];
	const memberRecord = {
		id: "member-1",
		userId: "user-1",
		organizationId: options.memberOrganizationId ?? "org-1",
		role: "member",
		status: "pending",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
	};
	const userRecord = {
		id: "user-1",
		name: "Ada Lovelace",
		email: "ada@example.com",
		image: null,
	};

	const makeClient = () => ({
		query: {
			member: {
				findFirst: vi.fn(async () =>
					memberRecord.organizationId === "org-1" ? memberRecord : null,
				),
			},
			user: { findFirst: vi.fn(async () => userRecord) },
			inviteCodeUsage: { findFirst: vi.fn(async () => null) },
			memberApproval: { findFirst: vi.fn(async () => null) },
			team: { findFirst: vi.fn(async () => ({ id: "team-1" })) },
			employee: {
				findFirst: vi.fn(async () => {
					events.push("employee-read-start");
					await options.employeeReadPromise;
					return null;
				}),
			},
		},
		execute: vi.fn(async () => {
			events.push("identity-lock");
		}),
		update: vi.fn((table) => ({
			set: vi.fn((values) => ({
				where: vi.fn(() => {
					if (table === member) {
						memberUpdates.push(values);
						return {
							returning: vi.fn(async () =>
								options.transitionWins === false
									? []
									: [{ ...memberRecord, ...values }],
							),
						};
					}
					return Promise.resolve(undefined);
				}),
			})),
		})),
		insert: vi.fn((table) => ({
			values: vi.fn((values) => {
				if (table === memberApproval) {
					approvals.push(values);
					return {
						returning: vi.fn(async () => {
							events.push("approval-insert-start");
							await options.approvalInsertPromise;
							return [{ id: "approval-1", ...values }];
						}),
					};
				}
				if (table === employee) {
					if (options.provisioningFails)
						throw new Error("employee insert failed");
					employees.push(values);
				}
				return {
					returning: vi.fn(async () => [{ id: "employee-1", ...values }]),
				};
			}),
		})),
	});

	const tx = makeClient();
	const db = makeClient() as ReturnType<typeof makeClient> & {
		transaction: (
			callback: (client: typeof tx) => Promise<unknown>,
		) => Promise<unknown>;
	};
	db.transaction = vi.fn(async (callback) => {
		const snapshots = {
			approvals: approvals.length,
			employees: employees.length,
			memberUpdates: memberUpdates.length,
		};
		events.push("transaction-start");
		try {
			const result = await callback(tx);
			events.push("transaction-commit");
			return result;
		} catch (error) {
			approvals.length = snapshots.approvals;
			employees.length = snapshots.employees;
			memberUpdates.length = snapshots.memberUpdates;
			events.push("transaction-rollback");
			throw error;
		}
	});

	const layer = serviceLayer(db);

	return { approvals, db, employees, events, layer, memberUpdates };
}

async function approveWith(layer: ReturnType<typeof approvalLayer>["layer"]) {
	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* PendingMemberService;
			return yield* service.approve({
				memberId: "member-1",
				organizationId: "org-1",
				assignedTeamId: "team-1",
				approvedBy: "admin-1",
			});
		}).pipe(Effect.provide(layer)),
	);
}

async function bulkApproveWith(
	layer: ReturnType<typeof approvalLayer>["layer"],
) {
	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* PendingMemberService;
			return yield* service.bulkApprove(
				["member-1"],
				"org-1",
				"admin-1",
				"team-1",
			);
		}).pipe(Effect.provide(layer)),
	);
}

describe("PendingMemberService approval transactions", () => {
	beforeEach(() => {
		billingMock.sync.mockClear();
	});

	it("atomically approves the member, records the audit, provisions the employee, then bills", async () => {
		const fake = approvalLayer();

		await expect(approveWith(fake.layer)).resolves.toMatchObject({
			success: true,
		});

		expect(fake.db.transaction).toHaveBeenCalledOnce();
		expect(fake.memberUpdates).toEqual([{ status: "approved" }]);
		expect(fake.approvals).toEqual([
			expect.objectContaining({
				memberId: "member-1",
				organizationId: "org-1",
				status: "approved",
			}),
		]);
		expect(fake.employees).toEqual([
			expect.objectContaining({
				userId: "user-1",
				organizationId: "org-1",
				isActive: true,
			}),
		]);
		expect(fake.events).toContain("identity-lock");
		expect(fake.events.at(-1)).toBe("transaction-commit");
		expect(billingMock.sync).toHaveBeenCalledWith({
			organizationId: "org-1",
			memberId: "member-1",
			userId: "user-1",
			change: "added",
		});
	});

	it("starts the approval insert and employee read together after winning the transition", async () => {
		const approvalInsert = deferred<void>();
		const employeeRead = deferred<void>();
		const fake = approvalLayer({
			approvalInsertPromise: approvalInsert.promise,
			employeeReadPromise: employeeRead.promise,
		});
		const approval = approveWith(fake.layer);
		let approvalOutcome!: PromiseSettledResult<Awaited<typeof approval>>;

		try {
			await vi.waitFor(() => {
				expect(fake.events).toContain("approval-insert-start");
			});
			expect(fake.events).toContain("employee-read-start");
		} finally {
			approvalInsert.resolve();
			employeeRead.resolve();
			[approvalOutcome] = await Promise.allSettled([approval]);
		}

		if (approvalOutcome.status === "rejected") {
			throw approvalOutcome.reason;
		}
		expect(approvalOutcome.value).toMatchObject({ success: true });
	});

	it("rolls back the member and approval when employee provisioning fails", async () => {
		const fake = approvalLayer({ provisioningFails: true });

		await expect(approveWith(fake.layer)).rejects.toBeDefined();

		expect(fake.events).toContain("transaction-rollback");
		expect(fake.memberUpdates).toEqual([]);
		expect(fake.approvals).toEqual([]);
		expect(billingMock.sync).not.toHaveBeenCalled();
	});

	it("handles a lost pending-status race without audit, employee, or billing writes", async () => {
		const fake = approvalLayer({ transitionWins: false });

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* PendingMemberService;
					return yield* service.approve({
						memberId: "member-1",
						organizationId: "org-1",
						approvedBy: "admin-1",
					});
				}).pipe(Effect.provide(fake.layer)),
			),
		);

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.any(ValidationError),
		});
		expect(fake.approvals).toEqual([]);
		expect(fake.employees).toEqual([]);
		expect(billingMock.sync).not.toHaveBeenCalled();
	});

	it("does not mutate a member from another organization", async () => {
		const fake = approvalLayer({ memberOrganizationId: "org-other" });

		await expect(approveWith(fake.layer)).rejects.toBeDefined();

		expect(fake.db.transaction).not.toHaveBeenCalled();
		expect(fake.memberUpdates).toEqual([]);
		expect(fake.approvals).toEqual([]);
		expect(fake.employees).toEqual([]);
		expect(billingMock.sync).not.toHaveBeenCalled();
	});

	it("uses the same atomic transition and post-commit billing for bulk approval", async () => {
		const fake = approvalLayer();
		const result = await bulkApproveWith(fake.layer);

		expect(result).toEqual({ approved: 1, failed: 0 });
		expect(fake.db.transaction).toHaveBeenCalledOnce();
		expect(fake.memberUpdates).toEqual([{ status: "approved" }]);
		expect(fake.approvals).toHaveLength(1);
		expect(fake.employees).toHaveLength(1);
		expect(billingMock.sync).toHaveBeenCalledOnce();
	});

	it.each([
		["a lost pending-status race", { transitionWins: false }],
		["an employee provisioning rollback", { provisioningFails: true }],
		["a cross-organization member", { memberOrganizationId: "org-other" }],
	] as const)(
		"counts %s as a bulk failure without committed side effects",
		async (_case, options) => {
			const fake = approvalLayer(options);

			await expect(bulkApproveWith(fake.layer)).resolves.toEqual({
				approved: 0,
				failed: 1,
			});
			expect(fake.approvals).toEqual([]);
			expect(fake.employees).toEqual([]);
			expect(billingMock.sync).not.toHaveBeenCalled();
		},
	);
});

describe("PendingMemberService pending-state queries", () => {
	const pendingMember = {
		id: "member-pending",
		userId: "user-pending",
		organizationId: "org-1",
		role: "member",
		status: "pending",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
	};
	const approvedMember = {
		...pendingMember,
		id: "member-approved",
		userId: "user-approved",
		status: "approved",
	};
	const foreignMember = {
		...pendingMember,
		id: "member-foreign",
		userId: "user-foreign",
		organizationId: "org-other",
	};
	const usages = [pendingMember, approvedMember, foreignMember].map(
		(record) => ({
			memberId: record.id,
			userId: record.userId,
			usedAt: record.createdAt,
			member: record,
			user: {
				id: record.userId,
				name: record.id,
				email: `${record.id}@example.com`,
				image: null,
			},
			inviteCode: {
				id: "invite-1",
				code: "CODE",
				label: "Invite",
				organizationId: "org-1",
				defaultTeamId: null,
			},
		}),
	);

	function queryLayer() {
		const select = vi.fn(() => ({
			from: vi.fn(() => ({
				innerJoin: vi.fn(() => ({
					innerJoin: vi.fn(() => ({
						innerJoin: vi.fn(() => ({
							where: vi.fn(() => ({
								orderBy: vi.fn(async () => [usages[0]]),
								execute: vi.fn(async () => [{ count: 1 }]),
							})),
						})),
					})),
				})),
			})),
		}));
		return {
			select,
			layer: serviceLayer({
				select,
				query: {
					inviteCodeUsage: { findMany: vi.fn(async () => usages) },
					memberApproval: { findMany: vi.fn(async () => []) },
				},
			}),
		};
	}

	it("lists only members whose actual organization and status are pending", async () => {
		const fake = queryLayer();
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* PendingMemberService;
				return yield* service.listPending({ organizationId: "org-1" });
			}).pipe(Effect.provide(fake.layer)),
		);

		expect(result.map(({ id }) => id)).toEqual(["member-pending"]);
		expect(fake.select).toHaveBeenCalledOnce();
	});

	it("counts only members whose actual organization and status are pending", async () => {
		const fake = queryLayer();
		const result = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* PendingMemberService;
				return yield* service.countPending("org-1");
			}).pipe(Effect.provide(fake.layer)),
		);

		expect(result).toBe(1);
		expect(fake.select).toHaveBeenCalledOnce();
	});
});

type RejectionFakeOptions = {
	memberOrganizationId?: string;
	memberStatus?: string;
	transitionWins?: boolean;
	existingApproval?: boolean;
};

function rejectionLayer(options: RejectionFakeOptions = {}) {
	const members = [
		{
			id: "member-1",
			userId: "user-1",
			organizationId: options.memberOrganizationId ?? "org-1",
			role: "member",
			status: options.memberStatus ?? "pending",
			createdAt: new Date("2026-01-01T00:00:00.000Z"),
		},
	];
	const approvals: Array<Record<string, unknown>> = options.existingApproval
		? [
				{
					id: "approval-existing",
					memberId: "member-1",
					organizationId: "org-1",
					status: "approved",
				},
			]
		: [];
	const inviteCodeUsages: Array<Record<string, unknown>> = [
		{
			id: "usage-1",
			inviteCodeId: "invite-1",
			memberId: "member-1",
			userId: "user-1",
			usedAt: new Date("2026-01-01T00:00:00.000Z"),
			inviteCode: { id: "invite-1", code: "JOIN-TEAM", label: "Invite" },
		},
	];
	const memberUpdates: Array<Record<string, unknown>> = [];
	const audits: Array<Record<string, unknown>> = [];
	const employeeUpdates: Array<Record<string, unknown>> = [];
	const deletedMembers: Array<Record<string, unknown>> = [];
	const memberLookups: unknown[] = [];
	const memberUpdatePredicates: unknown[] = [];
	const memberDeletePredicates: unknown[] = [];
	const events: string[] = [];
	const userRecord = {
		id: "user-1",
		name: "Ada Lovelace",
		email: "ada@example.com",
		image: null,
	};

	const tx = {
		query: {
			member: {
				findFirst: vi.fn(async (query) => {
					memberLookups.push(query.where);
					return members[0] ?? null;
				}),
			},
			user: { findFirst: vi.fn(async () => userRecord) },
			inviteCodeUsage: {
				findFirst: vi.fn(async () => inviteCodeUsages[0] ?? null),
			},
			memberApproval: {
				findFirst: vi.fn(async () => approvals[0] ?? null),
			},
		},
		execute: vi.fn(async (statement: SQL) => {
			const query = new PgDialect().sqlToQuery(statement);
			events.push(
				query.sql.includes("pg_advisory_xact_lock")
					? "identity-lock"
					: "member-lock",
			);
		}),
		insert: vi.fn((table) => ({
			values: vi.fn((values: Record<string, unknown>) => {
				if (table === auditLog) {
					audits.push(values);
					return {
						returning: vi.fn(async () => [{ id: "audit-1", ...values }]),
					};
				}
				if (table === memberApproval) approvals.push(values);
				return {
					returning: vi.fn(async () => [{ id: "approval-1", ...values }]),
				};
			}),
		})),
		update: vi.fn((table) => ({
			set: vi.fn((values: Record<string, unknown>) => ({
				where: vi.fn((where: unknown) => {
					if (table === employee) {
						employeeUpdates.push(values);
						return Promise.resolve(undefined);
					}
					if (table !== member) return Promise.resolve(undefined);
					memberUpdatePredicates.push(where);
					return {
						returning: vi.fn(async () => {
							if (options.transitionWins === false || !members[0]) return [];
							memberUpdates.push(values);
							Object.assign(members[0], values);
							return [{ id: members[0].id, status: members[0].status }];
						}),
					};
				}),
			})),
		})),
		delete: vi.fn(() => ({
			where: vi.fn((where: unknown) => {
				memberDeletePredicates.push(where);
				return {
					returning: vi.fn(async () => {
						if (options.transitionWins === false || !members[0]) return [];
						const [removed] = members.splice(0, 1);
						deletedMembers.push(removed as Record<string, unknown>);
						approvals.length = 0;
						inviteCodeUsages.length = 0;
						return [{ id: removed?.id }];
					}),
				};
			}),
		})),
	};
	const db = {
		query: tx.query,
		execute: tx.execute,
		insert: tx.insert,
		update: tx.update,
		delete: tx.delete,
		transaction: vi.fn(
			async (callback: (client: typeof tx) => Promise<unknown>) => {
				const snapshots = {
					members: members.map((record) => ({ ...record })),
					approvals: approvals.map((record) => ({ ...record })),
					audits: audits.map((record) => ({ ...record })),
					employeeUpdates: employeeUpdates.map((record) => ({ ...record })),
					inviteCodeUsages: inviteCodeUsages.map((record) => ({ ...record })),
					memberUpdates: memberUpdates.map((record) => ({ ...record })),
					deletedMembers: deletedMembers.map((record) => ({ ...record })),
				};
				events.push("transaction-start");
				try {
					const result = await callback(tx);
					events.push("transaction-commit");
					return result;
				} catch (error) {
					members.splice(0, members.length, ...snapshots.members);
					approvals.splice(0, approvals.length, ...snapshots.approvals);
					audits.splice(0, audits.length, ...snapshots.audits);
					employeeUpdates.splice(
						0,
						employeeUpdates.length,
						...snapshots.employeeUpdates,
					);
					inviteCodeUsages.splice(
						0,
						inviteCodeUsages.length,
						...snapshots.inviteCodeUsages,
					);
					memberUpdates.splice(
						0,
						memberUpdates.length,
						...snapshots.memberUpdates,
					);
					deletedMembers.splice(
						0,
						deletedMembers.length,
						...snapshots.deletedMembers,
					);
					events.push("transaction-rollback");
					throw error;
				}
			},
		),
	};

	return {
		approvals,
		audits,
		db,
		deletedMembers,
		employeeUpdates,
		events,
		inviteCodeUsages,
		layer: serviceLayer(db),
		memberLookups,
		memberDeletePredicates,
		members,
		memberUpdatePredicates,
		memberUpdates,
	};
}

async function rejectWith(
	layer: ReturnType<typeof rejectionLayer>["layer"],
	memberIds: string[] = ["member-1"],
	notes?: string,
) {
	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* PendingMemberService;
			if (memberIds.length === 1) {
				return yield* service.reject({
					memberId: memberIds[0] as string,
					organizationId: "org-1",
					rejectedBy: "admin-1",
					notes,
				});
			}
			return yield* service.bulkReject(memberIds, "org-1", "admin-1");
		}).pipe(Effect.provide(layer)),
	);
}

describe("PendingMemberService rejection isolation", () => {
	beforeEach(() => {
		removalCleanupMock.complete.mockReset();
		removalCleanupMock.complete.mockResolvedValue(undefined);
		removalCleanupMock.completePostCommit.mockReset();
		removalCleanupMock.completePostCommit.mockResolvedValue(undefined);
		removalCleanupMock.revokeInTransaction.mockReset();
		removalCleanupMock.revokeInTransaction.mockResolvedValue({
			accessRestored: false,
			sessionTokens: ["session-token"],
		});
	});

	it.each([
		["approved without an approval row", { memberStatus: "approved" }],
		["a known cross-organization UUID", { memberOrganizationId: "org-other" }],
	] as const)("denies individual rejection of %s", async (_case, options) => {
		const fake = rejectionLayer(options);

		await expect(rejectWith(fake.layer)).rejects.toBeDefined();

		expect(fake.db.transaction).toHaveBeenCalledOnce();
		expect(fake.approvals).toEqual([]);
		expect(fake.memberUpdates).toEqual([]);
		expect(fake.deletedMembers).toEqual([]);
	});

	it("takes the identity advisory lock before the member row lock", async () => {
		const fake = rejectionLayer();

		await expect(rejectWith(fake.layer)).resolves.toMatchObject({
			success: true,
		});

		expect(fake.events).toEqual([
			"transaction-start",
			"identity-lock",
			"member-lock",
			"transaction-commit",
		]);
		expect(collectColumnNames(fake.memberLookups[0])).toEqual(
			expect.arrayContaining(["id", "organization_id", "status"]),
		);
		expect(collectColumnNames(fake.memberDeletePredicates[0])).toEqual(
			expect.arrayContaining(["id", "organization_id", "status"]),
		);
	});

	it("creates no rejection audit when the pending-to-rejected transition loses", async () => {
		const fake = rejectionLayer({ transitionWins: false });

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* PendingMemberService;
					return yield* service.reject({
						memberId: "member-1",
						organizationId: "org-1",
						rejectedBy: "admin-1",
					});
				}).pipe(Effect.provide(fake.layer)),
			),
		);

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.any(DatabaseError),
		});
		expect(fake.events).toContain("transaction-rollback");
		expect(fake.approvals).toEqual([]);
		expect(fake.inviteCodeUsages).toHaveLength(1);
		expect(fake.members).toEqual([
			expect.objectContaining({ id: "member-1", status: "pending" }),
		]);
		expect(fake.deletedMembers).toEqual([]);
	});

	it("removes member authorization while retaining durable rejection identity", async () => {
		const fake = rejectionLayer();
		removalCleanupMock.revokeInTransaction.mockImplementation(async () => {
			fake.events.push("transactional-cleanup");
			return { accessRestored: false, sessionTokens: ["session-token"] };
		});
		removalCleanupMock.completePostCommit.mockImplementation(async () => {
			fake.events.push("post-commit-cleanup");
		});

		await expect(rejectWith(fake.layer)).resolves.toMatchObject({
			success: true,
		});

		expect(fake.members).toEqual([]);
		expect(fake.deletedMembers).toEqual([
			expect.objectContaining({
				id: "member-1",
				organizationId: "org-1",
			}),
		]);
		expect(fake.approvals).toEqual([]);
		expect(fake.inviteCodeUsages).toEqual([]);
		expect(fake.employeeUpdates).toEqual([]);
		expect(fake.audits).toEqual([
			expect.objectContaining({
				organizationId: "org-1",
				entityType: "membership",
				action: "reject",
				performedBy: "admin-1",
				metadata: expect.any(String),
			}),
		]);
		expect(JSON.parse(fake.audits[0]?.metadata as string)).toMatchObject({
			memberId: "member-1",
			userId: "user-1",
			inviteCodeId: "invite-1",
			inviteCode: "JOIN-TEAM",
		});
		expect(
			removalCleanupMock.revokeInTransaction,
		).toHaveBeenCalledExactlyOnceWith(
			expect.objectContaining({ query: fake.db.query }),
			"user-1",
			"org-1",
		);
		expect(
			removalCleanupMock.completePostCommit,
		).toHaveBeenCalledExactlyOnceWith({
			organizationId: "org-1",
			sessionTokens: ["session-token"],
		});
		expect(fake.events).toContain("transactional-cleanup");
		expect(fake.events.indexOf("transactional-cleanup")).toBeLessThan(
			fake.events.indexOf("transaction-commit"),
		);
		expect(fake.events.at(-2)).toBe("transaction-commit");
		expect(fake.events.at(-1)).toBe("post-commit-cleanup");
	});

	it("retains rejection notes in the durable audit after member cascade", async () => {
		const fake = rejectionLayer();

		await expect(
			rejectWith(fake.layer, ["member-1"], "Identity could not be verified"),
		).resolves.toMatchObject({ success: true });

		expect(JSON.parse(fake.audits[0]?.metadata as string)).toMatchObject({
			memberId: "member-1",
			userId: "user-1",
			notes: "Identity could not be verified",
		});
	});

	it("rolls back rejection when transactional access cleanup fails", async () => {
		const fake = rejectionLayer();
		removalCleanupMock.revokeInTransaction.mockRejectedValue(
			new Error("database session cleanup failed"),
		);

		await expect(rejectWith(fake.layer)).rejects.toBeDefined();

		expect(fake.events).toContain("transaction-rollback");
		expect(fake.events).not.toContain("transaction-commit");
		expect(fake.members).toEqual([
			expect.objectContaining({ id: "member-1", status: "pending" }),
		]);
		expect(fake.audits).toEqual([]);
		expect(fake.inviteCodeUsages).toHaveLength(1);
		expect(removalCleanupMock.completePostCommit).not.toHaveBeenCalled();
	});

	it("keeps committed rejection while surfacing post-commit cleanup failure", async () => {
		const fake = rejectionLayer();
		removalCleanupMock.completePostCommit.mockRejectedValue(
			new Error("redis unavailable"),
		);

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* PendingMemberService;
					return yield* service.reject({
						memberId: "member-1",
						organizationId: "org-1",
						rejectedBy: "admin-1",
					});
				}).pipe(Effect.provide(fake.layer)),
			),
		);

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.any(DatabaseError),
		});
		expect(fake.events).toContain("transaction-commit");
		expect(fake.events).not.toContain("transaction-rollback");
		expect(fake.members).toEqual([]);
		expect(fake.audits).toHaveLength(1);
	});

	it("bulk rejection safely ignores duplicate member IDs", async () => {
		const fake = rejectionLayer();

		await expect(
			Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* PendingMemberService;
					return yield* service.bulkReject(
						["member-1", "member-1"],
						"org-1",
						"admin-1",
					);
				}).pipe(Effect.provide(fake.layer)),
			),
		).resolves.toEqual({ rejected: 1, failed: 0 });
		expect(fake.db.transaction).toHaveBeenCalledOnce();
		expect(fake.approvals).toEqual([]);
		expect(fake.audits).toHaveLength(1);
		expect(fake.members).toEqual([]);
	});

	it("bulk mixed input rejects the foreign UUID without rolling back the authorized member", async () => {
		const fake = rejectionLayer();

		await expect(
			Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* PendingMemberService;
					return yield* service.bulkReject(
						["member-1", "known-foreign-member-uuid"],
						"org-1",
						"admin-1",
					);
				}).pipe(Effect.provide(fake.layer)),
			),
		).resolves.toEqual({ rejected: 1, failed: 1 });
		expect(fake.db.transaction).toHaveBeenCalledTimes(2);
		expect(fake.audits).toEqual([
			expect.objectContaining({
				organizationId: "org-1",
				action: "reject",
			}),
		]);
		expect(fake.approvals).toEqual([]);
		expect(fake.members).toEqual([]);
	});

	it.each([
		["a cross-organization member", { memberOrganizationId: "org-other" }],
		["an approved member", { memberStatus: "approved" }],
		["an already processed member", { existingApproval: true }],
	] as const)(
		"bulk rejection does not write or transition %s",
		async (_case, options) => {
			const fake = rejectionLayer(options);
			const initialApprovals = [...fake.approvals];

			await expect(
				Effect.runPromise(
					Effect.gen(function* () {
						const service = yield* PendingMemberService;
						return yield* service.bulkReject(["member-1"], "org-1", "admin-1");
					}).pipe(Effect.provide(fake.layer)),
				),
			).resolves.toEqual({ rejected: 0, failed: 1 });
			expect(fake.approvals).toEqual(initialApprovals);
			expect(fake.memberUpdates).toEqual([]);
			expect(fake.deletedMembers).toEqual([]);
			expect(removalCleanupMock.revokeInTransaction).not.toHaveBeenCalled();
			expect(removalCleanupMock.completePostCommit).not.toHaveBeenCalled();
		},
	);

	it("bulk rejection rolls back an item's audit when its guarded transition loses the status race", async () => {
		const fake = rejectionLayer({ transitionWins: false });

		await expect(
			Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* PendingMemberService;
					return yield* service.bulkReject(["member-1"], "org-1", "admin-1");
				}).pipe(Effect.provide(fake.layer)),
			),
		).resolves.toEqual({ rejected: 0, failed: 1 });
		expect(fake.events).toContain("transaction-rollback");
		expect(fake.approvals).toEqual([]);
		expect(fake.memberUpdates).toEqual([]);
		expect(fake.deletedMembers).toEqual([]);
		expect(removalCleanupMock.revokeInTransaction).not.toHaveBeenCalled();
		expect(removalCleanupMock.completePostCommit).not.toHaveBeenCalled();
	});
});
