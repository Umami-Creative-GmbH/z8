import { describe, expect, it, vi } from "vitest";
import {
	type WorkPlan,
	type WorkRoute,
	WorkTransactionProtocolViolation,
	WorkTransactionScopeChanged,
	workTransactionScopeFor,
} from "./index";
import {
	acquireExclusiveOrganizationConfigurationGuard,
	acquireOrganizationConfigurationGuard,
	adoptionGate,
	approvalWriteGateGuard,
	employeeCoordinationGuard,
	holdGuard,
	organizationConfigurationGuard,
	Rank,
	recordGuard,
	sourceIdentityGuard,
	userConfigurationAccessGuard,
} from "./ranks";
import { fakeWorkTransaction } from "./testing";

const organizationId = "org-1";

function plan<R extends WorkRoute>(
	route: R | ((attempt: { widened: boolean }) => R),
	extra: Partial<WorkPlan<R>> = {},
): WorkPlan<R> {
	return {
		organizationId,
		route: async (_db, attempt) => (typeof route === "function" ? route(attempt) : route),
		...extra,
	};
}

const simple: WorkRoute = {
	users: ["user-b", "user-a", "user-b"],
	employees: ["emp-2", "emp-1"],
	writeTargets: ["emp-2"],
};

const describeGuards = (guards: readonly { rank: number; key: string; mode: string }[]) =>
	guards.map(({ rank, key, mode }) => `${rank} ${mode} ${key}`);

describe("runWorkTransaction", () => {
	it("takes every guard in rank order, sorted and deduplicated", async () => {
		const fake = fakeWorkTransaction();
		await fake.run(
			plan({
				...simple,
				sourceIdentities: [
					["provider", "z"],
					["provider", "a"],
				],
			}),
			async () => undefined,
		);

		expect(describeGuards(fake.guards)).toEqual([
			`1 shared ${JSON.stringify(["completed-work-adoption", organizationId])}`,
			`3 shared ${JSON.stringify(["work-organization-configuration", organizationId])}`,
			`4 shared ${JSON.stringify(["work-user-configuration-access", "user-a"])}`,
			`4 shared ${JSON.stringify(["work-user-configuration-access", "user-b"])}`,
			"5 exclusive emp-1",
			"5 exclusive emp-2",
			`6 exclusive ${JSON.stringify(["provider", "a"])}`,
			`6 exclusive ${JSON.stringify(["provider", "z"])}`,
		]);
	});

	it("honours exclusive and absent organization and user modes", async () => {
		const exclusive = fakeWorkTransaction();
		await exclusive.run(
			plan({ ...simple, guards: { organization: "exclusive", users: "exclusive" } }),
			async () => undefined,
		);
		expect(exclusive.guards.filter((guard) => guard.rank === 3 || guard.rank === 4)).toEqual([
			expect.objectContaining({ rank: 3, mode: "exclusive" }),
			expect.objectContaining({ rank: 4, mode: "exclusive" }),
			expect.objectContaining({ rank: 4, mode: "exclusive" }),
		]);

		const none = fakeWorkTransaction();
		await none.run(plan({ ...simple, guards: { organization: "none" } }), async () => undefined);
		expect(none.guards.some((guard) => guard.rank === 3)).toBe(false);
	});

	it("routes before the guards and again under them, then hands over the confirmed route", async () => {
		const route = vi.fn(async () => simple);
		const lockRows = vi.fn(async () => undefined);
		const fake = fakeWorkTransaction({ admission: "append" });

		const seen = await fake.run({ organizationId, route, lockRows }, async (scope) => ({
			route: scope.route,
			admission: scope.admission,
		}));

		expect(route).toHaveBeenCalledTimes(3);
		expect(lockRows).toHaveBeenCalledOnce();
		expect(seen).toEqual({ route: simple, admission: "append" });
	});

	it("restricts the sealed scope to write targets and refuses it once settled", async () => {
		const fake = fakeWorkTransaction();
		const scope = await fake.run(plan(simple), async (scope) => {
			expect(() => scope.assertEmployee(organizationId, "emp-2")).not.toThrow();
			expect(() => scope.assertEmployee(organizationId, "emp-1")).toThrow(
				"Employee scope is outside the work transaction",
			);
			expect(() => scope.assertEmployee("org-2", "emp-2")).toThrow(
				"Employee scope is outside the work transaction",
			);
			expect(workTransactionScopeFor(scope.db)).toBe(scope);
			return scope;
		});

		expect(() => scope.assertEmployee(organizationId, "emp-2")).toThrow(
			"Work transaction is no longer active",
		);
		expect(() => scope.restart()).toThrow("Work transaction is no longer active");
	});

	it("refuses a write target outside the routed employees before any guard", async () => {
		const fake = fakeWorkTransaction();
		const operation = vi.fn();

		await expect(
			fake.run(plan({ ...simple, writeTargets: ["emp-3"] }), operation),
		).rejects.toBeInstanceOf(WorkTransactionProtocolViolation);
		expect(operation).not.toHaveBeenCalled();
		expect(fake.guards).toEqual([]);
	});

	it("restarts once after a concurrent scope change", async () => {
		const fake = fakeWorkTransaction({ changeScopeOn: [1] });
		const operation = vi.fn(async () => "done");

		await expect(fake.run(plan(simple), operation)).resolves.toBe("done");
		expect(fake.attempts).toBe(2);
		expect(operation).toHaveBeenCalledOnce();
	});

	it("gives up with WorkTransactionScopeChanged after 3 changed attempts", async () => {
		const fake = fakeWorkTransaction({ changeScopeOn: [1, 2, 3] });
		const operation = vi.fn();

		await expect(fake.run(plan(simple), operation)).rejects.toBeInstanceOf(
			WorkTransactionScopeChanged,
		);
		expect(fake.attempts).toBe(3);
		expect(operation).not.toHaveBeenCalled();
	});

	it("compares the canonical route including the snapshot", async () => {
		let reads = 0;
		const fake = fakeWorkTransaction();
		const operation = vi.fn();

		await expect(
			fake.run(
				plan(() => {
					reads += 1;
					return { ...simple, snapshot: { reads } };
				}),
				operation,
			),
		).rejects.toBeInstanceOf(WorkTransactionScopeChanged);
		expect(reads).toBe(6);
		expect(operation).not.toHaveBeenCalled();
	});

	it("treats a reordered route as the same scope", async () => {
		let reads = 0;
		const fake = fakeWorkTransaction();
		await expect(
			fake.run(
				plan(() => {
					reads += 1;
					return reads === 1
						? { ...simple, snapshot: { b: 1, a: 2 } }
						: {
								users: ["user-a", "user-b"],
								employees: ["emp-1", "emp-2", "emp-1"],
								writeTargets: ["emp-2"],
								guards: { organization: "shared" as const },
								snapshot: { a: 2, b: 1 },
							};
				}),
				async () => "same",
			),
		).resolves.toBe("same");
		expect(fake.attempts).toBe(1);
	});

	it("restarts on request and widens the next routing", async () => {
		const fake = fakeWorkTransaction();
		const widenings: boolean[] = [];
		const result = await fake.run(
			plan((attempt) => {
				widenings.push(attempt.widened);
				return simple;
			}),
			async (scope) => {
				if (fake.attempts === 1) scope.restart({ widen: true });
				if (fake.attempts === 2) scope.restart();
				return fake.attempts;
			},
		);

		expect(result).toBe(3);
		expect(widenings).toEqual([false, false, true, true, true, true]);
	});

	it("keeps the restart intent when the operation redacts or swallows it", async () => {
		const redacted = fakeWorkTransaction();
		await expect(
			redacted.run(plan(simple), async (scope) => {
				if (redacted.attempts > 1) return "retried";
				try {
					scope.restart();
				} catch {
					throw new Error("redacted");
				}
			}),
		).resolves.toBe("retried");

		const swallowed = fakeWorkTransaction();
		await expect(
			swallowed.run(plan(simple), async (scope) => {
				if (swallowed.attempts > 1) return "retried";
				try {
					scope.restart();
				} catch {}
				return "committed";
			}),
		).resolves.toBe("retried");
	});

	it("shares the budget of 3 between restarts and scope changes", async () => {
		const fake = fakeWorkTransaction({ changeScopeOn: [1, 2] });
		await expect(fake.run(plan(simple), async (scope) => scope.restart())).rejects.toBeInstanceOf(
			WorkTransactionScopeChanged,
		);
		expect(fake.attempts).toBe(3);
	});

	it("propagates routing and operation errors without retrying", async () => {
		const failingRoute = fakeWorkTransaction();
		await expect(
			failingRoute.run(
				{
					organizationId,
					route: async () => {
						throw new Error("route failed");
					},
				},
				async () => undefined,
			),
		).rejects.toThrow("route failed");
		expect(failingRoute.attempts).toBe(1);

		const failingOperation = fakeWorkTransaction();
		await expect(
			failingOperation.run(plan(simple), async () => {
				throw new Error("operation failed");
			}),
		).rejects.toThrow("operation failed");
		expect(failingOperation.attempts).toBe(1);
	});

	it("refuses a work transaction inside a work transaction", async () => {
		const fake = fakeWorkTransaction();
		await expect(
			fake.run(plan(simple), () => fake.run(plan(simple), async () => undefined)),
		).rejects.toBeInstanceOf(WorkTransactionProtocolViolation);

		// A settled run does not refuse the next one.
		await expect(fake.run(plan(simple), async () => "next")).resolves.toBe("next");
	});

	it("restarts on a scope change seen after the row locks", async () => {
		let reads = 0;
		const lockRows = vi.fn(async () => undefined);
		const fake = fakeWorkTransaction();
		const result = await fake.run(
			plan(
				() => {
					reads += 1;
					// The third read, after the first attempt's row locks, sees a new employee.
					return reads >= 3 ? { ...simple, employees: [...simple.employees, "emp-3"] } : simple;
				},
				{ lockRows },
			),
			async (scope) => scope.route.employees,
		);

		expect(result).toContain("emp-3");
		expect(fake.attempts).toBe(2);
		expect(lockRows).toHaveBeenCalledTimes(2);
	});

	it("opens each attempt through the supplied transaction and passes guards to its lock", async () => {
		const opened: object[] = [];
		const locked: string[] = [];
		const fake = fakeWorkTransaction({
			changeScopeOn: [1],
			transaction: async (body) => {
				const client = { attempt: opened.length + 1 };
				opened.push(client);
				return body(client);
			},
			lock: async (client, guard) => {
				locked.push(`${(client as { attempt: number }).attempt} ${guard.rank} ${guard.key}`);
			},
		});

		const client = await fake.run(plan(simple), async (scope) => scope.db);

		expect(opened).toHaveLength(2);
		expect(client).toBe(opened[1]);
		expect(locked).toEqual(
			fake.guards.map(({ attempt, rank, key }) => `${attempt} ${rank} ${key}`),
		);
	});

	it("settles a savepoint scope when its savepoint ends", async () => {
		const fake = fakeWorkTransaction();
		await fake.run(plan(simple), async (scope) => {
			const inner = await scope.savepoint(async (savepoint) => savepoint);
			expect(() => inner.assertEmployee(organizationId, "emp-2")).toThrow(
				"Work transaction is no longer active",
			);
			expect(() => scope.assertEmployee(organizationId, "emp-2")).not.toThrow();
		});
	});

	it("runs a savepoint with a scope of its own", async () => {
		const fake = fakeWorkTransaction();
		await fake.run(plan(simple), async (scope) => {
			const inner = await scope.savepoint(async (savepoint) => {
				expect(savepoint.db).not.toBe(scope.db);
				expect(savepoint.route).toBe(scope.route);
				expect(workTransactionScopeFor(savepoint.db)).toBe(savepoint);
				return "inner";
			});
			expect(inner).toBe("inner");
		});
	});

	describe("approval write gate", () => {
		type Approval = { pinned: string | null };
		/** `record` names the workflow type whose gate the port records; `true` records the routed one. */
		const port = (record: boolean | string, seen: number[] = []) => ({
			borrow: async <T>(_db: unknown, body: (approval: Approval) => Promise<T>) =>
				body({ pinned: null }),
			gate: async (approval: Approval, organization: string, workflowType: string) => {
				seen.push(fakeGuards.length);
				const recorded = record === true ? workflowType : record;
				if (recorded) {
					const { key } = approvalWriteGateGuard(organization, recorded);
					recordGuard(currentDb, Rank.approvalWriteGate, key, "shared");
				}
				return { ...approval, pinned: workflowType };
			},
		});
		let fakeGuards: readonly unknown[] = [];
		let currentDb: object = {};

		it("takes the gate at rank 2 and pins it on the scope", async () => {
			const fake = fakeWorkTransaction();
			fakeGuards = fake.guards;
			const seen: number[] = [];
			const approval = await fake.run(
				{
					organizationId,
					route: async (db) => {
						currentDb = db;
						return { ...simple, approvalGate: "time_correction" };
					},
					approval: port(true, seen),
				},
				async (scope) => scope.approval,
			);

			expect(approval).toEqual({ pinned: "time_correction" });
			// Only the adoption gate precedes the approval gate.
			expect(seen).toEqual([1]);
		});

		it("restarts on a scope change even when the port redacts the error", async () => {
			const fake = fakeWorkTransaction({ changeScopeOn: [1] });
			const redacting = {
				borrow: async <T>(_db: unknown, body: (approval: Approval) => Promise<T>) => {
					try {
						return await body({ pinned: null });
					} catch {
						throw new Error("redacted");
					}
				},
				gate: async (approval: Approval) => approval,
			};

			await expect(
				fake.run(
					{ organizationId, route: async () => simple, approval: redacting },
					async () => "ok",
				),
			).resolves.toBe("ok");
			expect(fake.attempts).toBe(2);
		});

		it("refuses a gate without a port, and a port that does not record rank 2", async () => {
			const fake = fakeWorkTransaction();
			await expect(
				fake.run(plan({ ...simple, approvalGate: "time_correction" }), async () => undefined),
			).rejects.toBeInstanceOf(WorkTransactionProtocolViolation);

			await expect(
				fake.run(
					{
						organizationId,
						route: async () => ({ ...simple, approvalGate: "time_correction" }),
						approval: port(false),
					},
					async () => undefined,
				),
			).rejects.toThrow("the approval gate did not record rank 2");
		});

		it("refuses a port that records another workflow type's gate", async () => {
			const fake = fakeWorkTransaction();
			await expect(
				fake.run(
					{
						organizationId,
						route: async (db) => {
							currentDb = db;
							return { ...simple, approvalGate: "time_correction" };
						},
						approval: port("absence"),
					},
					async () => undefined,
				),
			).rejects.toThrow("the approval gate did not record rank 2");
		});

		it("takes the rank-2 guard for a test-double gate when asked", async () => {
			const fake = fakeWorkTransaction({ recordApprovalGate: true });
			const approval = await fake.run(
				{
					organizationId,
					route: async () => ({ ...simple, approvalGate: "time_correction" }),
					approval: port(false),
				},
				async (scope) => scope.approval,
			);

			expect(approval).toEqual({ pinned: "time_correction" });
			expect(fake.guards[1]).toEqual({
				...approvalWriteGateGuard(organizationId, "time_correction"),
				attempt: 1,
			});
		});

		it("records a self-locked guard only inside a work transaction", async () => {
			// A long-lived handle keeps no ledger, so a later lower rank is not refused.
			const handle = { execute: vi.fn(async () => undefined) };
			const { key } = approvalWriteGateGuard(organizationId, "time_correction");
			recordGuard(handle, Rank.approvalWriteGate, key, "shared");
			await holdGuard(handle as never, adoptionGate(organizationId));
			expect(handle.execute).toHaveBeenCalledTimes(1);

			const fake = fakeWorkTransaction();
			await expect(
				fake.run(plan(simple), async (scope) =>
					recordGuard(scope.db, Rank.approvalWriteGate, key, "shared"),
				),
			).rejects.toThrow(/rank 2 shared guard .* after rank 5/);
		});
	});

	describe("ledger", () => {
		it("refuses a guard while routing", async () => {
			const fake = fakeWorkTransaction();
			await expect(
				fake.run(
					{
						organizationId,
						route: async (db) => {
							await holdGuard(db, sourceIdentityGuard(["provider", "a"]));
							return simple;
						},
					},
					async () => undefined,
				),
			).rejects.toThrow(/during routing/);
		});

		it("refuses a lower rank after a higher one", async () => {
			const fake = fakeWorkTransaction();
			await expect(
				fake.run(plan(simple), (scope) =>
					holdGuard(scope.db, userConfigurationAccessGuard("user-c")),
				),
			).rejects.toThrow(/rank 4 shared guard .* after rank 5/);
		});

		it("refuses an upgrade from shared to exclusive", async () => {
			const fake = fakeWorkTransaction();
			await expect(
				fake.run(plan(simple), (scope) =>
					holdGuard(scope.db, organizationConfigurationGuard(organizationId, "exclusive")),
				),
			).rejects.toThrow(/upgrades a shared guard/);
		});

		it("allows re-acquiring a held guard in the same or a weaker mode without locking again", async () => {
			const fake = fakeWorkTransaction();
			await fake.run(plan({ ...simple, guards: { users: "exclusive" } }), async (scope) => {
				await holdGuard(scope.db, organizationConfigurationGuard(organizationId, "shared"));
				await holdGuard(scope.db, userConfigurationAccessGuard("user-a", "shared"));
				await holdGuard(scope.db, employeeCoordinationGuard("emp-1"));
				await holdGuard(scope.db, sourceIdentityGuard(["provider", "late"]));
			});
			expect(fake.guards).toHaveLength(7);
			expect(fake.guards.at(-1)).toEqual(expect.objectContaining({ rank: 6 }));
		});

		it("refuses a guard inside a savepoint, on either client", async () => {
			const fake = fakeWorkTransaction();
			await expect(
				fake.run(plan(simple), (scope) =>
					scope.savepoint((savepoint) =>
						holdGuard(savepoint.db, sourceIdentityGuard(["provider", "a"])),
					),
				),
			).rejects.toThrow(/inside a savepoint/);
			await expect(
				fake.run(plan(simple), (scope) =>
					scope.savepoint(() => holdGuard(scope.db, sourceIdentityGuard(["provider", "a"]))),
				),
			).rejects.toThrow(/inside a savepoint/);
		});

		it("refuses every guard after the row locks", async () => {
			const fake = fakeWorkTransaction();
			await expect(
				fake.run(plan(simple, { lockRows: async () => undefined }), (scope) =>
					holdGuard(scope.db, sourceIdentityGuard(["provider", "a"])),
				),
			).rejects.toThrow(/after rank 7/);
		});

		it("records the organization configuration guard only inside a work transaction", async () => {
			const handle = { execute: vi.fn(async () => undefined) };
			await acquireOrganizationConfigurationGuard(handle as never, organizationId);
			await acquireExclusiveOrganizationConfigurationGuard(handle as never, organizationId);
			expect(handle.execute).toHaveBeenCalledTimes(2);

			// A ledger holdGuard created on its own does not make the handle coordinated.
			const lazy = { execute: vi.fn(async () => undefined) };
			await holdGuard(lazy as never, sourceIdentityGuard(["provider", "a"]));
			await acquireOrganizationConfigurationGuard(lazy as never, organizationId);
			expect(lazy.execute).toHaveBeenCalledTimes(2);

			const fake = fakeWorkTransaction();
			await expect(
				fake.run(plan(simple), (scope) =>
					acquireExclusiveOrganizationConfigurationGuard(scope.db, organizationId),
				),
			).rejects.toThrow(/upgrades a shared guard/);
		});

		it("does not retry a violation", async () => {
			const fake = fakeWorkTransaction();
			await expect(
				fake.run(plan(simple), (scope) =>
					holdGuard(scope.db, userConfigurationAccessGuard("user-c")),
				),
			).rejects.toBeInstanceOf(WorkTransactionProtocolViolation);
			expect(fake.attempts).toBe(1);
		});

		it("does not retry a violation raised after a swallowed restart", async () => {
			const fake = fakeWorkTransaction();
			await expect(
				fake.run(plan(simple), async (scope) => {
					try {
						scope.restart();
					} catch {}
					await holdGuard(scope.db, userConfigurationAccessGuard("user-c"));
				}),
			).rejects.toBeInstanceOf(WorkTransactionProtocolViolation);
			expect(fake.attempts).toBe(1);
		});

		it("allows re-taking a held guard inside a savepoint without locking again", async () => {
			const fake = fakeWorkTransaction();
			await fake.run(plan(simple), (scope) =>
				scope.savepoint(async (savepoint) => {
					await holdGuard(savepoint.db, adoptionGate(organizationId));
					await holdGuard(savepoint.db, employeeCoordinationGuard("emp-2"));
				}),
			);
			expect(fake.guards).toHaveLength(6);
		});
	});
});
