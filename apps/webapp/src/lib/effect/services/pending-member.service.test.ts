import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { member } from "@/db/auth-schema";
import { employee, memberApproval } from "@/db/schema";
import { DatabaseError, ValidationError } from "../errors";
import { DatabaseService } from "./database.service";
import {
	PendingMemberService,
	PendingMemberServiceLive,
} from "./pending-member.service";

const billingMock = vi.hoisted(() => ({
	sync: vi.fn(async () => undefined),
}));

vi.mock("@/lib/billing/seat-sync-trigger", () => ({
	syncBillingSeatsAfterMemberChange: billingMock.sync,
}));

type ApprovalFakeOptions = {
	memberOrganizationId?: string;
	transitionWins?: boolean;
	provisioningFails?: boolean;
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
			employee: { findFirst: vi.fn(async () => null) },
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
						returning: vi.fn(async () => [{ id: "approval-1", ...values }]),
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
	] as const)("counts %s as a bulk failure without committed side effects", async (_case, options) => {
		const fake = approvalLayer(options);

		await expect(bulkApproveWith(fake.layer)).resolves.toEqual({
			approved: 0,
			failed: 1,
		});
		expect(fake.approvals).toEqual([]);
		expect(fake.employees).toEqual([]);
		expect(billingMock.sync).not.toHaveBeenCalled();
	});
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
	statusRace?: boolean;
	existingApproval?: boolean;
};

function rejectionLayer(options: RejectionFakeOptions = {}) {
	const approvals: Array<Record<string, unknown>> = [];
	const deletes: unknown[] = [];
	const memberLookups: unknown[] = [];
	const events: string[] = [];
	const record = {
		id: "member-1",
		userId: "user-1",
		organizationId: options.memberOrganizationId ?? "org-1",
		role: "member",
		status: options.memberStatus ?? "pending",
		createdAt: new Date("2026-01-01T00:00:00.000Z"),
	};
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
					return record;
				}),
			},
			user: { findFirst: vi.fn(async () => userRecord) },
			inviteCodeUsage: { findFirst: vi.fn(async () => null) },
			memberApproval: {
				findFirst: vi.fn(async () =>
					options.existingApproval ? { status: "approved" } : null,
				),
			},
		},
		execute: vi.fn(async () => {
			events.push("lock");
		}),
		insert: vi.fn(() => ({
			values: vi.fn((values: Record<string, unknown>) => {
				approvals.push(values);
				return {
					returning: vi.fn(async () => [{ id: "approval-1", ...values }]),
				};
			}),
		})),
		delete: vi.fn(() => ({
			where: vi.fn((where: unknown) => {
				deletes.push(where);
				return {
					returning: vi.fn(async () =>
						options.statusRace ? [] : [{ ...record }],
					),
				};
			}),
		})),
	};
	const db = {
		query: tx.query,
		execute: tx.execute,
		insert: tx.insert,
		delete: tx.delete,
		transaction: vi.fn(
			async (callback: (client: typeof tx) => Promise<unknown>) => {
				const approvalCount = approvals.length;
				const deleteCount = deletes.length;
				events.push("transaction-start");
				try {
					const result = await callback(tx);
					events.push("transaction-commit");
					return result;
				} catch (error) {
					approvals.length = approvalCount;
					deletes.length = deleteCount;
					events.push("transaction-rollback");
					throw error;
				}
			},
		),
	};

	return {
		approvals,
		db,
		deletes,
		events,
		layer: serviceLayer(db),
		memberLookups,
	};
}

async function rejectWith(
	layer: ReturnType<typeof rejectionLayer>["layer"],
	memberIds: string[] = ["member-1"],
) {
	return Effect.runPromise(
		Effect.gen(function* () {
			const service = yield* PendingMemberService;
			if (memberIds.length === 1) {
				return yield* service.reject({
					memberId: memberIds[0] as string,
					organizationId: "org-1",
					rejectedBy: "admin-1",
				});
			}
			return yield* service.bulkReject(memberIds, "org-1", "admin-1");
		}).pipe(Effect.provide(layer)),
	);
}

describe("PendingMemberService rejection isolation", () => {
	it.each([
		["approved without an approval row", { memberStatus: "approved" }],
		["a known cross-organization UUID", { memberOrganizationId: "org-other" }],
	] as const)("denies individual rejection of %s", async (_case, options) => {
		const fake = rejectionLayer(options);

		await expect(rejectWith(fake.layer)).rejects.toBeDefined();

		expect(fake.db.transaction).toHaveBeenCalledOnce();
		expect(fake.approvals).toEqual([]);
		expect(fake.deletes).toEqual([]);
	});

	it("resolves and deletes an individual member by id, organization, and pending status under lock", async () => {
		const fake = rejectionLayer();

		await expect(rejectWith(fake.layer)).resolves.toMatchObject({
			success: true,
		});

		expect(fake.events).toEqual([
			"transaction-start",
			"lock",
			"transaction-commit",
		]);
		expect(collectColumnNames(fake.memberLookups[0])).toEqual(
			expect.arrayContaining(["id", "organization_id", "status"]),
		);
		expect(collectColumnNames(fake.deletes[0])).toEqual(
			expect.arrayContaining(["id", "organization_id", "status"]),
		);
	});

	it("rolls back the rejection record when the final pending-status delete loses a race", async () => {
		const fake = rejectionLayer({ statusRace: true });

		await expect(rejectWith(fake.layer)).rejects.toBeDefined();

		expect(fake.events).toContain("transaction-rollback");
		expect(fake.approvals).toEqual([]);
		expect(fake.deletes).toEqual([]);
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
		expect(fake.approvals).toHaveLength(1);
		expect(fake.deletes).toHaveLength(1);
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
		expect(fake.approvals).toEqual([
			expect.objectContaining({
				memberId: "member-1",
				organizationId: "org-1",
			}),
		]);
		expect(fake.deletes).toHaveLength(1);
	});

	it.each([
		["a cross-organization member", { memberOrganizationId: "org-other" }],
		["an approved member", { memberStatus: "approved" }],
		["an already processed member", { existingApproval: true }],
	] as const)("bulk rejection does not write or delete %s", async (_case, options) => {
		const fake = rejectionLayer(options);

		await expect(
			Effect.runPromise(
				Effect.gen(function* () {
					const service = yield* PendingMemberService;
					return yield* service.bulkReject(["member-1"], "org-1", "admin-1");
				}).pipe(Effect.provide(fake.layer)),
			),
		).resolves.toEqual({ rejected: 0, failed: 1 });
		expect(fake.approvals).toEqual([]);
		expect(fake.deletes).toEqual([]);
	});

	it("bulk rejection rolls back an item's audit when its final delete loses the status race", async () => {
		const fake = rejectionLayer({ statusRace: true });

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
		expect(fake.deletes).toEqual([]);
	});
});
