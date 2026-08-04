import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClockodoClient } from "./client";
import type {
	ClockodoHolidayQuota,
	ClockodoTeam,
	ClockodoUser,
	ImportSelections,
} from "./types";

const mocks = vi.hoisted(() => ({
	env: {
		CLOCKODO_IMPORT_QUERY_CHUNK_SIZE: "500",
		CLOCKODO_IMPORT_CONCURRENCY: "4",
	},
	teamFindFirst: vi.fn(),
	teamFindMany: vi.fn(),
	employeeFindMany: vi.fn(),
	allowanceFindFirst: vi.fn(),
	allowanceFindMany: vi.fn(),
	transaction: vi.fn(),
	rootTeamFindMany: vi.fn(),
	rootEmployeeFindMany: vi.fn(),
	rootAllowanceFindMany: vi.fn(),
	rootInsert: vi.fn(),
	insert: vi.fn(),
	insertTeamValues: vi.fn(),
	returnTeams: vi.fn(),
	insertAllowanceValues: vi.fn(),
	returnAllowances: vi.fn(),
}));

vi.mock("@/env", () => ({ env: mocks.env }));
vi.mock("@/db", () => ({
	db: {
		query: {
			team: {
				findFirst: mocks.teamFindFirst,
				findMany: mocks.rootTeamFindMany,
			},
			employee: { findMany: mocks.rootEmployeeFindMany },
			employeeVacationAllowance: {
				findFirst: mocks.allowanceFindFirst,
				findMany: mocks.rootAllowanceFindMany,
			},
		},
		insert: mocks.rootInsert,
		transaction: mocks.transaction,
	},
}));

const schema = await import("@/db/schema");
const { orchestrateImport } = await import("./import-orchestrator");

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

async function settleDeferredImport(
	importing: Promise<unknown>,
	settlers: Array<() => void>,
): Promise<void> {
	let settled = false;
	void importing.then(
		() => {
			settled = true;
		},
		() => {
			settled = true;
		},
	);
	while (!settled) {
		for (const settle of settlers) settle();
		await new Promise((resolve) => setTimeout(resolve, 0));
	}
	await importing;
}

function selections(overrides: Partial<ImportSelections>): ImportSelections {
	return {
		users: false,
		teams: false,
		services: false,
		entries: false,
		absences: false,
		targetHours: false,
		holidayQuotas: false,
		nonBusinessDays: false,
		surcharges: false,
		dateRange: { preset: "all_data", startDate: null, endDate: null },
		...overrides,
	};
}

function team(id: number, name: string): ClockodoTeam {
	return { id, name, leader: null };
}

function client(overrides: Partial<ClockodoClient>): ClockodoClient {
	return overrides as ClockodoClient;
}

function user(id: number): ClockodoUser {
	return {
		id,
		name: `User ${id}`,
		number: null,
		email: `user-${id}@example.com`,
		role: "user",
		active: true,
		teams_id: null,
		timezone: "Europe/Berlin",
		wage_type: 1,
		language: "en",
	};
}

function quota(
	id: number,
	usersId: number,
	year: number,
): ClockodoHolidayQuota {
	return {
		id,
		users_id: usersId,
		year_since: year,
		year_until: null,
		count: 30,
	};
}

function mapping(
	clockodoUserId: number,
	employeeId = `employee-${clockodoUserId}`,
) {
	return {
		clockodoUserId,
		employeeId,
		userId: `user-${clockodoUserId}`,
		mappingType: "manual" as const,
	};
}

async function importQuotas(
	quotas: ClockodoHolidayQuota[],
	mappings = [...new Set(quotas.map((item) => item.users_id))].map((id) =>
		mapping(id),
	),
) {
	return orchestrateImport(
		client({
			getUsers: vi
				.fn()
				.mockResolvedValue(mappings.map((item) => user(item.clockodoUserId))),
			getHolidayQuotas: vi.fn().mockResolvedValue(quotas),
		}),
		"org-1",
		"actor-1",
		selections({ users: true, holidayQuotas: true }),
		mappings,
		true,
	);
}

beforeEach(() => {
	vi.clearAllMocks();
	const tx = {
		query: {
			team: { findMany: mocks.teamFindMany },
			employee: { findMany: mocks.employeeFindMany },
			employeeVacationAllowance: { findMany: mocks.allowanceFindMany },
		},
		insert: mocks.insert,
	};
	mocks.transaction.mockImplementation(
		(callback: (client: typeof tx) => Promise<unknown>) => callback(tx),
	);
	mocks.rootTeamFindMany.mockImplementation((args) => mocks.teamFindMany(args));
	mocks.rootEmployeeFindMany.mockImplementation((args) =>
		mocks.employeeFindMany(args),
	);
	mocks.rootAllowanceFindMany.mockImplementation((args) =>
		mocks.allowanceFindMany(args),
	);
	mocks.rootInsert.mockImplementation((table) => mocks.insert(table));
	mocks.teamFindFirst.mockResolvedValue(null);
	mocks.teamFindMany.mockResolvedValue([]);
	mocks.employeeFindMany.mockResolvedValue([]);
	mocks.allowanceFindFirst.mockResolvedValue(null);
	mocks.allowanceFindMany.mockResolvedValue([]);
	mocks.returnTeams.mockResolvedValue([]);
	mocks.returnAllowances.mockResolvedValue([]);
	mocks.insertTeamValues.mockImplementation(() => ({
		returning: mocks.returnTeams,
	}));
	mocks.insertAllowanceValues.mockImplementation(() => ({
		returning: mocks.returnAllowances,
	}));
	mocks.insert.mockImplementation((table) => {
		if (table === schema.team) return { values: mocks.insertTeamValues };
		if (table === schema.employeeVacationAllowance)
			return { values: mocks.insertAllowanceValues };
		throw new Error("Unexpected insert table in Clockodo orchestrator test");
	});
});

describe("orchestrateImport team batching", () => {
	it("uses configured query chunk size and concurrency", async () => {
		mocks.env.CLOCKODO_IMPORT_QUERY_CHUNK_SIZE = "2";
		mocks.env.CLOCKODO_IMPORT_CONCURRENCY = "2";
		vi.resetModules();
		const configuredModule = await import("./import-orchestrator");
		const teams = Array.from({ length: 5 }, (_, index) =>
			team(index + 1, `Configured team ${index + 1}`),
		);
		const settlers: Array<() => void> = [];
		let active = 0;
		let maxActive = 0;
		mocks.teamFindMany.mockImplementation(({ where }) => {
			const names = collectParams(where).filter(
				(value): value is string =>
					typeof value === "string" && value.startsWith("Configured team "),
			);
			active++;
			maxActive = Math.max(maxActive, active);
			return new Promise((resolve) => {
				let pending = true;
				settlers.push(() => {
					if (!pending) return;
					pending = false;
					active--;
					resolve(names.map((name) => ({ id: `existing-${name}`, name })));
				});
			});
		});

		const importing = configuredModule.orchestrateImport(
			client({ getTeams: vi.fn().mockResolvedValue(teams) }),
			"org-1",
			"user-1",
			selections({ teams: true }),
		);
		try {
			await vi.waitFor(() =>
				expect(mocks.teamFindMany).toHaveBeenCalledTimes(2),
			);
			expect(maxActive).toBe(2);
			for (const settle of settlers.slice(0, 2)) settle();
			await vi.waitFor(() =>
				expect(mocks.teamFindMany).toHaveBeenCalledTimes(3),
			);
			expect(maxActive).toBe(2);
		} finally {
			try {
				await settleDeferredImport(importing, settlers);
			} finally {
				mocks.env.CLOCKODO_IMPORT_QUERY_CHUNK_SIZE = "500";
				mocks.env.CLOCKODO_IMPORT_CONCURRENCY = "4";
				vi.resetModules();
			}
		}

		expect(
			mocks.teamFindMany.mock.calls.map(
				([{ where }]) =>
					collectParams(where).filter(
						(value) =>
							typeof value === "string" && value.startsWith("Configured team "),
					).length,
			),
		).toEqual([2, 2, 1]);
	});

	it("finishes source preparation before opening the team transaction", async () => {
		let insideTransaction = false;
		let queryChunksConstructedInsideTransaction = false;
		const originalSlice = Array.prototype.slice;
		const sliceSpy = vi
			.spyOn(Array.prototype, "slice")
			.mockImplementation(function (
				this: unknown[],
				start?: number,
				end?: number,
			) {
				if (this[0] === "Prepared team") {
					queryChunksConstructedInsideTransaction = insideTransaction;
				}
				return originalSlice.call(this, start, end);
			});
		const sourceTeam = {
			id: 1,
			leader: null,
			get name() {
				if (insideTransaction)
					throw new Error("team payload accessed inside transaction");
				return "Prepared team";
			},
		} satisfies ClockodoTeam;
		mocks.returnTeams.mockResolvedValue([
			{ id: "prepared-team", name: "Prepared team" },
		]);
		mocks.transaction.mockImplementation(async (callback) => {
			insideTransaction = true;
			try {
				return await callback({
					query: {
						team: { findMany: mocks.teamFindMany },
						employee: { findMany: mocks.employeeFindMany },
						employeeVacationAllowance: {
							findMany: mocks.allowanceFindMany,
						},
					},
					insert: mocks.insert,
				});
			} finally {
				insideTransaction = false;
			}
		});

		let result: Awaited<ReturnType<typeof orchestrateImport>>;
		try {
			result = await orchestrateImport(
				client({ getTeams: vi.fn().mockResolvedValue([sourceTeam]) }),
				"org-1",
				"user-1",
				selections({ teams: true }),
			);
		} finally {
			sliceSpy.mockRestore();
		}

		expect(result.teams).toEqual({ imported: 1, skipped: 0, errors: [] });
		expect(queryChunksConstructedInsideTransaction).toBe(true);
		expect(mocks.transaction).toHaveBeenCalledTimes(1);
		expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
			isolationLevel: "serializable",
		});
	});

	it("settles the active write window before rolling back the team phase", async () => {
		const teams = Array.from({ length: 2_501 }, (_, index) =>
			team(index + 1, `Team ${index + 1}`),
		);
		const firstError = new Error("first team chunk failed");
		const laterError = new Error("later team chunk failed");
		const committedTeams: Array<{ organizationId: string; name: string }> = [];
		let transactionTeams:
			| Array<{ organizationId: string; name: string }>
			| undefined;
		let delayedWrite: (() => void) | undefined;
		let delayedSiblingSettled = false;
		let transactionFailure: unknown;
		const getHolidayQuotas = vi.fn().mockResolvedValue([]);

		mocks.transaction.mockImplementation(async (callback) => {
			transactionTeams = [];
			try {
				const value = await callback({
					query: {
						team: { findMany: mocks.teamFindMany },
						employee: { findMany: mocks.employeeFindMany },
						employeeVacationAllowance: {
							findMany: mocks.allowanceFindMany,
						},
					},
					insert: mocks.insert,
				});
				committedTeams.push(...transactionTeams);
				return value;
			} catch (error) {
				transactionFailure = error;
				throw error;
			} finally {
				transactionTeams = undefined;
			}
		});
		mocks.insertTeamValues.mockImplementation(
			(rows: Array<{ organizationId: string; name: string }>) => {
				const target = transactionTeams ?? committedTeams;
				const chunkIndex = mocks.insertTeamValues.mock.calls.length - 1;
				return {
					returning: () => {
						if (chunkIndex === 0) return Promise.reject(firstError);
						if (chunkIndex === 1) {
							return new Promise((resolve) => {
								delayedWrite = () => {
									target.push(...rows);
									delayedSiblingSettled = true;
									resolve(
										rows.map((row, index) => ({
											id: `team-delayed-${index}`,
											name: row.name,
										})),
									);
								};
							});
						}
						if (chunkIndex === 2) return Promise.reject(laterError);
						target.push(...rows);
						return Promise.resolve(
							rows.map((row, index) => ({
								id: `team-${chunkIndex}-${index}`,
								name: row.name,
							})),
						);
					},
				};
			},
		);

		const importing = orchestrateImport(
			client({
				getTeams: vi.fn().mockResolvedValue(teams),
				getHolidayQuotas,
			}),
			"org-1",
			"user-1",
			selections({ teams: true, holidayQuotas: true }),
		);
		let importSettled = false;
		void importing.then(
			() => {
				importSettled = true;
			},
			() => {
				importSettled = true;
			},
		);

		try {
			await vi.waitFor(() =>
				expect(mocks.insertTeamValues).toHaveBeenCalledTimes(4),
			);
			await new Promise((resolve) => setTimeout(resolve, 0));
			expect(importSettled).toBe(false);
			expect(mocks.insertTeamValues).toHaveBeenCalledTimes(4);
			expect(delayedSiblingSettled).toBe(false);
		} finally {
			delayedWrite?.();
		}

		await expect(importing).rejects.toBe(firstError);
		expect(transactionFailure).toBe(firstError);
		expect(delayedSiblingSettled).toBe(true);
		expect(committedTeams).toEqual([]);
		expect(mocks.insertTeamValues).toHaveBeenCalledTimes(4);
		expect(getHolidayQuotas).not.toHaveBeenCalled();
		expect(mocks.rootTeamFindMany).not.toHaveBeenCalled();
		expect(mocks.rootInsert).not.toHaveBeenCalled();
	});

	it("rolls back completed team windows when a later write window fails", async () => {
		const teams = Array.from({ length: 4_501 }, (_, index) =>
			team(index + 1, `Team ${index + 1}`),
		);
		const laterWindowError = new Error("later team window failed");
		const committedTeams: Array<{ organizationId: string; name: string }> = [];
		let localTeams: typeof committedTeams | undefined;
		let settleDelayedSibling: (() => void) | undefined;
		let delayedSiblingSettled = false;
		const getHolidayQuotas = vi.fn().mockResolvedValue([]);

		mocks.transaction.mockImplementation(async (callback) => {
			localTeams = [];
			try {
				const value = await callback({
					query: {
						team: { findMany: mocks.teamFindMany },
						employee: { findMany: mocks.employeeFindMany },
						employeeVacationAllowance: {
							findMany: mocks.allowanceFindMany,
						},
					},
					insert: mocks.insert,
				});
				committedTeams.push(...localTeams);
				return value;
			} finally {
				localTeams = undefined;
			}
		});
		mocks.insertTeamValues.mockImplementation(
			(rows: Array<{ organizationId: string; name: string }>) => {
				const target = localTeams ?? committedTeams;
				const chunkIndex = mocks.insertTeamValues.mock.calls.length - 1;
				return {
					returning: () => {
						if (chunkIndex === 4) return Promise.reject(laterWindowError);
						if (chunkIndex === 5) {
							return new Promise((resolve) => {
								settleDelayedSibling = () => {
									target.push(...rows);
									delayedSiblingSettled = true;
									resolve(
										rows.map((row, index) => ({
											id: `later-team-${index}`,
											name: row.name,
										})),
									);
								};
							});
						}
						target.push(...rows);
						return Promise.resolve(
							rows.map((row, index) => ({
								id: `team-${chunkIndex}-${index}`,
								name: row.name,
							})),
						);
					},
				};
			},
		);

		const importing = orchestrateImport(
			client({
				getTeams: vi.fn().mockResolvedValue(teams),
				getHolidayQuotas,
			}),
			"org-1",
			"user-1",
			selections({ teams: true, holidayQuotas: true }),
		);

		try {
			await vi.waitFor(() =>
				expect(mocks.insertTeamValues).toHaveBeenCalledTimes(8),
			);
			expect(localTeams).toHaveLength(3_000);
			expect(delayedSiblingSettled).toBe(false);
			expect(mocks.insertTeamValues).toHaveBeenCalledTimes(8);
		} finally {
			settleDelayedSibling?.();
		}

		await expect(importing).rejects.toBe(laterWindowError);
		expect(delayedSiblingSettled).toBe(true);
		expect(committedTeams).toEqual([]);
		expect(mocks.insertTeamValues).toHaveBeenCalledTimes(8);
		expect(getHolidayQuotas).not.toHaveBeenCalled();
	});

	it("deduplicates exact source names and inserts the first representative once", async () => {
		mocks.returnTeams.mockResolvedValue([
			{ id: "team-support", name: "Support" },
		]);
		const getTeams = vi
			.fn()
			.mockResolvedValue([team(10, "Support"), team(20, "Support")]);

		const result = await orchestrateImport(
			client({ getTeams }),
			"org-1",
			"user-1",
			selections({ teams: true }),
		);

		expect(result.teams).toEqual({ imported: 1, skipped: 1, errors: [] });
		expect(mocks.teamFindMany).toHaveBeenCalledTimes(1);
		expect(mocks.teamFindFirst).not.toHaveBeenCalled();
		expect(mocks.insertTeamValues).toHaveBeenCalledWith([
			{ organizationId: "org-1", name: "Support" },
		]);
	});

	it("maps all duplicate rows to an existing exact-name team without inserting", async () => {
		mocks.teamFindMany.mockResolvedValue([
			{ id: "team-support", name: "Support" },
		]);
		const getTeams = vi
			.fn()
			.mockResolvedValue([team(10, "Support"), team(20, "Support")]);

		const result = await orchestrateImport(
			client({ getTeams }),
			"org-1",
			"user-1",
			selections({ teams: true }),
		);

		expect(result.teams).toEqual({ imported: 0, skipped: 2, errors: [] });
		expect(mocks.teamFindMany).toHaveBeenCalledTimes(1);
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.transaction).toHaveBeenCalledTimes(1);
	});

	it("bulk inserts missing names in first-occurrence order", async () => {
		mocks.teamFindMany.mockResolvedValue([
			{ id: "team-support", name: "Support" },
		]);
		mocks.returnTeams.mockResolvedValue([
			{ id: "team-sales", name: "Sales" },
			{ id: "team-ops", name: "Operations" },
		]);
		const getTeams = vi
			.fn()
			.mockResolvedValue([
				team(1, "Sales"),
				team(2, "Support"),
				team(3, "Operations"),
				team(4, "Sales"),
			]);

		const result = await orchestrateImport(
			client({ getTeams }),
			"org-1",
			"user-1",
			selections({ teams: true }),
		);

		expect(result.teams).toEqual({ imported: 2, skipped: 2, errors: [] });
		expect(mocks.insertTeamValues).toHaveBeenCalledTimes(1);
		expect(mocks.insertTeamValues).toHaveBeenCalledWith([
			{ organizationId: "org-1", name: "Sales" },
			{ organizationId: "org-1", name: "Operations" },
		]);
	});

	it("avoids database work for an empty team payload", async () => {
		const result = await orchestrateImport(
			client({ getTeams: vi.fn().mockResolvedValue([]) }),
			"org-1",
			"user-1",
			selections({ teams: true }),
		);

		expect(result.teams).toEqual({ imported: 0, skipped: 0, errors: [] });
		expect(mocks.teamFindMany).not.toHaveBeenCalled();
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.transaction).not.toHaveBeenCalled();
	});

	it.each([
		[
			"missing",
			[],
			'Team "Support": insert did not return exactly one matching team',
		],
		[
			"duplicate",
			[
				{ id: "team-1", name: "Support" },
				{ id: "team-2", name: "Support" },
			],
			'Team "Support": insert did not return exactly one matching team',
		],
		[
			"unexpected",
			[
				{ id: "team-support", name: "Support" },
				{ id: "team-other", name: "Other" },
			],
			'Team insert returned unexpected team "Other"',
		],
	])(
		"rolls back %s returned team identities inside the transaction",
		async (_case, returned, errorMessage) => {
			const committedTeams: Array<{ organizationId: string; name: string }> =
				[];
			let localTeams: typeof committedTeams | undefined;
			mocks.returnTeams.mockResolvedValue(returned);
			mocks.transaction.mockImplementation(async (callback) => {
				localTeams = [];
				try {
					const value = await callback({
						query: {
							team: { findMany: mocks.teamFindMany },
							employee: { findMany: mocks.employeeFindMany },
							employeeVacationAllowance: {
								findMany: mocks.allowanceFindMany,
							},
						},
						insert: mocks.insert,
					});
					committedTeams.push(...localTeams);
					return value;
				} finally {
					localTeams = undefined;
				}
			});
			mocks.insertTeamValues.mockImplementation(
				(rows: Array<{ organizationId: string; name: string }>) => ({
					returning: async () => {
						localTeams?.push(...rows);
						return returned;
					},
				}),
			);

			await expect(
				orchestrateImport(
					client({
						getTeams: vi
							.fn()
							.mockResolvedValue([team(1, "Support"), team(2, "Support")]),
					}),
					"org-1",
					"user-1",
					selections({ teams: true }),
				),
			).rejects.toThrow(errorMessage);
			expect(committedTeams).toEqual([]);
			expect(mocks.rootTeamFindMany).not.toHaveBeenCalled();
			expect(mocks.rootInsert).not.toHaveBeenCalled();
		},
	);

	it("scopes the team candidate query to the organization and exact names", async () => {
		mocks.returnTeams.mockResolvedValue([
			{ id: "team-support", name: "Support" },
		]);
		await orchestrateImport(
			client({ getTeams: vi.fn().mockResolvedValue([team(1, "Support")]) }),
			"org-1",
			"user-1",
			selections({ teams: true }),
		);

		const where = mocks.teamFindMany.mock.calls[0]?.[0]?.where;
		expect(collectColumnNames(where)).toEqual(
			expect.arrayContaining(["organization_id", "name"]),
		);
		expect(collectParams(where)).toEqual(
			expect.arrayContaining(["org-1", "Support"]),
		);
	});

	it("chunks 501 unique team reads and inserts without changing accounting", async () => {
		const teams = Array.from({ length: 501 }, (_, index) =>
			team(index + 1, `Team ${index + 1}`),
		);
		mocks.insertTeamValues.mockImplementation(
			(rows: Array<{ organizationId: string; name: string }>) => ({
				returning: vi.fn().mockResolvedValue(
					rows.map((row, index) => ({
						id: `inserted-${index}-${row.name}`,
						name: row.name,
					})),
				),
			}),
		);

		const result = await orchestrateImport(
			client({ getTeams: vi.fn().mockResolvedValue(teams) }),
			"org-1",
			"user-1",
			selections({ teams: true }),
		);

		expect(result.teams).toEqual({ imported: 501, skipped: 0, errors: [] });
		expect(mocks.teamFindMany).toHaveBeenCalledTimes(2);
		for (const [{ where }] of mocks.teamFindMany.mock.calls) {
			const params = collectParams(where);
			expect(params).toContain("org-1");
			expect(
				params.filter(
					(value) => typeof value === "string" && value.startsWith("Team "),
				),
			).toHaveLength(params.includes("Team 501") ? 1 : 500);
		}
		expect(mocks.insertTeamValues).toHaveBeenCalledTimes(2);
		for (const [rows] of mocks.insertTeamValues.mock.calls) {
			expect(rows.length).toBeLessThanOrEqual(500);
			expect(
				rows.every(
					(row: { organizationId: string }) => row.organizationId === "org-1",
				),
			).toBe(true);
		}
	});

	it("limits 2,001 team candidate reads to four active statements", async () => {
		const teams = Array.from({ length: 2_001 }, (_, index) =>
			team(index + 1, `Team ${index + 1}`),
		);
		const settlers: Array<() => void> = [];
		let active = 0;
		let maxActive = 0;
		mocks.teamFindMany.mockImplementation(({ where }) => {
			const names = collectParams(where).filter(
				(value): value is string =>
					typeof value === "string" && value.startsWith("Team "),
			);
			active++;
			maxActive = Math.max(maxActive, active);
			return new Promise((resolve) => {
				let pending = true;
				settlers.push(() => {
					if (!pending) return;
					pending = false;
					active--;
					resolve(names.map((name) => ({ id: `existing-${name}`, name })));
				});
			});
		});

		const importing = orchestrateImport(
			client({ getTeams: vi.fn().mockResolvedValue(teams) }),
			"org-1",
			"user-1",
			selections({ teams: true }),
		);
		try {
			await vi.waitFor(() =>
				expect(mocks.teamFindMany).toHaveBeenCalledTimes(4),
			);
			expect(mocks.teamFindMany).toHaveBeenCalledTimes(4);
			expect(maxActive).toBe(4);
			for (const settle of settlers.slice(0, 4)) settle();
			await vi.waitFor(() =>
				expect(mocks.teamFindMany).toHaveBeenCalledTimes(5),
			);
			expect(maxActive).toBe(4);
		} finally {
			await settleDeferredImport(importing, settlers);
		}
	});
});

describe("orchestrateImport holiday quota batching", () => {
	it("finishes source preparation before opening the quota transaction", async () => {
		let insideTransaction = false;
		let queryChunksConstructedInsideTransaction = false;
		const originalSlice = Array.prototype.slice;
		const sliceSpy = vi
			.spyOn(Array.prototype, "slice")
			.mockImplementation(function (
				this: unknown[],
				start?: number,
				end?: number,
			) {
				if (this[0] === "employee-1") {
					queryChunksConstructedInsideTransaction = insideTransaction;
				}
				return originalSlice.call(this, start, end);
			});
		const prepared = <T>(value: T): T => {
			if (insideTransaction)
				throw new Error("quota payload accessed inside transaction");
			return value;
		};
		const sourceQuota = {
			get id() {
				return prepared(1);
			},
			get users_id() {
				return prepared(1);
			},
			get year_since() {
				return prepared(2026);
			},
			get year_until() {
				return prepared(null);
			},
			get count() {
				return prepared(30);
			},
		} satisfies ClockodoHolidayQuota;
		mocks.employeeFindMany.mockResolvedValue([{ id: "employee-1" }]);
		mocks.returnAllowances.mockResolvedValue([
			{ employeeId: "employee-1", year: 2026 },
		]);
		mocks.transaction.mockImplementation(async (callback) => {
			insideTransaction = true;
			try {
				return await callback({
					query: {
						team: { findMany: mocks.teamFindMany },
						employee: { findMany: mocks.employeeFindMany },
						employeeVacationAllowance: {
							findMany: mocks.allowanceFindMany,
						},
					},
					insert: mocks.insert,
				});
			} finally {
				insideTransaction = false;
			}
		});

		let result: Awaited<ReturnType<typeof importQuotas>>;
		try {
			result = await importQuotas([sourceQuota]);
		} finally {
			sliceSpy.mockRestore();
		}

		expect(result.holidayQuotas).toEqual({
			imported: 1,
			skipped: 0,
			errors: [],
		});
		expect(queryChunksConstructedInsideTransaction).toBe(true);
		expect(mocks.transaction).toHaveBeenCalledTimes(1);
		expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
			isolationLevel: "serializable",
		});
	});

	it("commits teams separately and rolls back a failed quota write window", async () => {
		const quotas = Array.from({ length: 2_501 }, (_, index) =>
			quota(index + 1, index + 1, 2026),
		);
		const mappings = quotas.map((item) => mapping(item.users_id));
		const quotaError = new Error("first quota chunk failed");
		const committedTeams: Array<{ organizationId: string; name: string }> = [];
		const committedQuotas: Array<{ employeeId: string; year: number }> = [];
		let localTeams: typeof committedTeams | undefined;
		let localQuotas: typeof committedQuotas | undefined;
		let delayedWrite: (() => void) | undefined;
		let delayedSiblingSettled = false;
		let transactionNumber = 0;
		let quotaTransactionFailure: unknown;

		mocks.employeeFindMany.mockImplementation(({ where }) =>
			Promise.resolve(
				collectParams(where)
					.filter(
						(value): value is string =>
							typeof value === "string" && value.startsWith("employee-"),
					)
					.map((id) => ({ id })),
			),
		);
		mocks.transaction.mockImplementation(async (callback) => {
			transactionNumber++;
			localTeams = [];
			localQuotas = [];
			try {
				const value = await callback({
					query: {
						team: { findMany: mocks.teamFindMany },
						employee: { findMany: mocks.employeeFindMany },
						employeeVacationAllowance: {
							findMany: mocks.allowanceFindMany,
						},
					},
					insert: mocks.insert,
				});
				committedTeams.push(...localTeams);
				committedQuotas.push(...localQuotas);
				return value;
			} catch (error) {
				if (transactionNumber === 2) quotaTransactionFailure = error;
				throw error;
			} finally {
				localTeams = undefined;
				localQuotas = undefined;
			}
		});
		mocks.insertTeamValues.mockImplementation(
			(rows: Array<{ organizationId: string; name: string }>) => ({
				returning: async () => {
					localTeams?.push(...rows);
					return rows.map((row, index) => ({
						id: `committed-team-${index}`,
						name: row.name,
					}));
				},
			}),
		);
		mocks.insertAllowanceValues.mockImplementation(
			(rows: Array<{ employeeId: string; year: number }>) => {
				const target = localQuotas ?? committedQuotas;
				const chunkIndex = mocks.insertAllowanceValues.mock.calls.length - 1;
				return {
					returning: () => {
						if (chunkIndex === 0) return Promise.reject(quotaError);
						if (chunkIndex === 1) {
							return new Promise((resolve) => {
								delayedWrite = () => {
									target.push(...rows);
									delayedSiblingSettled = true;
									resolve(rows);
								};
							});
						}
						target.push(...rows);
						return Promise.resolve(rows);
					},
				};
			},
		);

		const importing = orchestrateImport(
			client({
				getTeams: vi.fn().mockResolvedValue([team(1, "Committed")]),
				getUsers: vi
					.fn()
					.mockResolvedValue(mappings.map((item) => user(item.clockodoUserId))),
				getHolidayQuotas: vi.fn().mockResolvedValue(quotas),
			}),
			"org-1",
			"actor-1",
			selections({ teams: true, users: true, holidayQuotas: true }),
			mappings,
			true,
		);

		try {
			await vi.waitFor(() =>
				expect(mocks.insertAllowanceValues).toHaveBeenCalledTimes(4),
			);
			expect(delayedSiblingSettled).toBe(false);
			expect(mocks.insertAllowanceValues).toHaveBeenCalledTimes(4);
		} finally {
			delayedWrite?.();
		}

		await expect(importing).rejects.toBe(quotaError);
		expect(quotaTransactionFailure).toBe(quotaError);
		expect(delayedSiblingSettled).toBe(true);
		expect(committedTeams).toEqual([
			{ organizationId: "org-1", name: "Committed" },
		]);
		expect(committedQuotas).toEqual([]);
		expect(mocks.transaction).toHaveBeenCalledTimes(2);
		expect(mocks.insertAllowanceValues).toHaveBeenCalledTimes(4);
		expect(mocks.rootEmployeeFindMany).not.toHaveBeenCalled();
		expect(mocks.rootAllowanceFindMany).not.toHaveBeenCalled();
		expect(mocks.rootInsert).not.toHaveBeenCalled();
	});

	it("rolls back completed quota windows when a later write window fails", async () => {
		const quotas = Array.from({ length: 4_501 }, (_, index) =>
			quota(index + 1, index + 1, 2026),
		);
		const mappings = quotas.map((item) => mapping(item.users_id));
		const laterWindowError = new Error("later quota window failed");
		const committedAllowances: Array<{ employeeId: string; year: number }> = [];
		let localAllowances: typeof committedAllowances | undefined;
		let settleDelayedSibling: (() => void) | undefined;
		let delayedSiblingSettled = false;
		const getNonBusinessDays = vi.fn().mockResolvedValue([]);

		mocks.employeeFindMany.mockImplementation(({ where }) =>
			Promise.resolve(
				collectParams(where)
					.filter(
						(value): value is string =>
							typeof value === "string" && value.startsWith("employee-"),
					)
					.map((id) => ({ id })),
			),
		);
		mocks.transaction.mockImplementation(async (callback) => {
			localAllowances = [];
			try {
				const value = await callback({
					query: {
						team: { findMany: mocks.teamFindMany },
						employee: { findMany: mocks.employeeFindMany },
						employeeVacationAllowance: {
							findMany: mocks.allowanceFindMany,
						},
					},
					insert: mocks.insert,
				});
				committedAllowances.push(...localAllowances);
				return value;
			} finally {
				localAllowances = undefined;
			}
		});
		mocks.insertAllowanceValues.mockImplementation(
			(rows: Array<{ employeeId: string; year: number }>) => {
				const target = localAllowances ?? committedAllowances;
				const chunkIndex = mocks.insertAllowanceValues.mock.calls.length - 1;
				return {
					returning: () => {
						if (chunkIndex === 4) return Promise.reject(laterWindowError);
						if (chunkIndex === 5) {
							return new Promise((resolve) => {
								settleDelayedSibling = () => {
									target.push(...rows);
									delayedSiblingSettled = true;
									resolve(rows);
								};
							});
						}
						target.push(...rows);
						return Promise.resolve(rows);
					},
				};
			},
		);

		const importing = orchestrateImport(
			client({
				getUsers: vi
					.fn()
					.mockResolvedValue(mappings.map((item) => user(item.clockodoUserId))),
				getHolidayQuotas: vi.fn().mockResolvedValue(quotas),
				getNonBusinessDays,
			}),
			"org-1",
			"actor-1",
			selections({ users: true, holidayQuotas: true, nonBusinessDays: true }),
			mappings,
			true,
		);

		try {
			await vi.waitFor(() =>
				expect(mocks.insertAllowanceValues).toHaveBeenCalledTimes(8),
			);
			expect(localAllowances).toHaveLength(3_000);
			expect(delayedSiblingSettled).toBe(false);
			expect(mocks.insertAllowanceValues).toHaveBeenCalledTimes(8);
		} finally {
			settleDelayedSibling?.();
		}

		await expect(importing).rejects.toBe(laterWindowError);
		expect(delayedSiblingSettled).toBe(true);
		expect(committedAllowances).toEqual([]);
		expect(mocks.insertAllowanceValues).toHaveBeenCalledTimes(8);
		expect(getNonBusinessDays).not.toHaveBeenCalled();
	});

	it("deduplicates an employee/year payload key with first-wins accounting", async () => {
		mocks.employeeFindMany.mockResolvedValue([{ id: "employee-1" }]);
		mocks.returnAllowances.mockResolvedValue([
			{ employeeId: "employee-1", year: 2026 },
		]);

		const result = await importQuotas([quota(1, 1, 2026), quota(2, 1, 2026)]);

		expect(result.holidayQuotas).toEqual({
			imported: 1,
			skipped: 1,
			errors: [],
		});
		expect(mocks.allowanceFindMany).toHaveBeenCalledTimes(1);
		expect(mocks.allowanceFindFirst).not.toHaveBeenCalled();
		expect(mocks.insertAllowanceValues).toHaveBeenCalledWith([
			{ employeeId: "employee-1", year: 2026, customAnnualDays: "30" },
		]);
	});

	it("keeps different years for one employee as distinct keys", async () => {
		mocks.employeeFindMany.mockResolvedValue([{ id: "employee-1" }]);
		mocks.returnAllowances.mockResolvedValue([
			{ employeeId: "employee-1", year: 2026 },
			{ employeeId: "employee-1", year: 2027 },
		]);

		const result = await importQuotas([quota(1, 1, 2026), quota(2, 1, 2027)]);

		expect(result.holidayQuotas).toEqual({
			imported: 2,
			skipped: 0,
			errors: [],
		});
		expect(mocks.insertAllowanceValues.mock.calls[0][0]).toHaveLength(2);
	});

	it("keeps the same year for different employees as distinct keys", async () => {
		mocks.employeeFindMany.mockResolvedValue([
			{ id: "employee-1" },
			{ id: "employee-2" },
		]);
		mocks.returnAllowances.mockResolvedValue([
			{ employeeId: "employee-1", year: 2026 },
			{ employeeId: "employee-2", year: 2026 },
		]);

		const result = await importQuotas([quota(1, 1, 2026), quota(2, 2, 2026)]);

		expect(result.holidayQuotas).toEqual({
			imported: 2,
			skipped: 0,
			errors: [],
		});
	});

	it("skips every source row for an exact existing allowance key", async () => {
		mocks.employeeFindMany.mockResolvedValue([{ id: "employee-1" }]);
		mocks.allowanceFindMany.mockResolvedValue([
			{ employeeId: "employee-1", year: 2026 },
		]);

		const result = await importQuotas([quota(1, 1, 2026), quota(2, 1, 2026)]);

		expect(result.holidayQuotas).toEqual({
			imported: 0,
			skipped: 2,
			errors: [],
		});
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.transaction).toHaveBeenCalledTimes(1);
	});

	it("ignores allowance cross-product candidates that were not requested", async () => {
		mocks.employeeFindMany.mockResolvedValue([
			{ id: "employee-1" },
			{ id: "employee-2" },
		]);
		mocks.allowanceFindMany.mockResolvedValue([
			{ employeeId: "employee-1", year: 2027 },
		]);
		mocks.returnAllowances.mockResolvedValue([
			{ employeeId: "employee-1", year: 2026 },
			{ employeeId: "employee-2", year: 2027 },
		]);

		const result = await importQuotas([quota(1, 1, 2026), quota(2, 2, 2027)]);

		expect(result.holidayQuotas).toEqual({
			imported: 2,
			skipped: 0,
			errors: [],
		});
		expect(mocks.insertAllowanceValues.mock.calls[0][0]).toHaveLength(2);
	});

	it("reports missing Clockodo mappings in source order", async () => {
		mocks.employeeFindMany.mockResolvedValue([{ id: "employee-1" }]);
		mocks.allowanceFindMany.mockResolvedValue([
			{ employeeId: "employee-1", year: 2026 },
		]);
		const result = await importQuotas(
			[quota(1, 91, 2026), quota(2, 1, 2026), quota(3, 92, 2027)],
			[mapping(1)],
		);

		expect(result.holidayQuotas.errors).toEqual([
			"Holiday quota for user 91: no matching employee found",
			"Holiday quota for user 92: no matching employee found",
		]);
	});

	it("rejects mapped employees outside the active organization before allowance access", async () => {
		const result = await importQuotas([quota(1, 1, 2026)]);

		expect(result.holidayQuotas).toEqual({
			imported: 0,
			skipped: 0,
			errors: [
				"Holiday quota for user 1: mapped employee employee-1 was not found in organization org-1",
			],
		});
		expect(mocks.allowanceFindMany).not.toHaveBeenCalled();
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.transaction).toHaveBeenCalledTimes(1);
	});

	it("scopes employee validation to the active organization and mapped IDs", async () => {
		mocks.employeeFindMany.mockResolvedValue([{ id: "employee-1" }]);
		mocks.returnAllowances.mockResolvedValue([
			{ employeeId: "employee-1", year: 2026 },
		]);

		await importQuotas([quota(1, 1, 2026)]);

		const where = mocks.employeeFindMany.mock.calls[0]?.[0]?.where;
		expect(collectColumnNames(where)).toEqual(
			expect.arrayContaining(["organization_id", "id"]),
		);
		expect(collectParams(where)).toEqual(
			expect.arrayContaining(["org-1", "employee-1"]),
		);
	});

	it("chunks 501-key validation, candidates, and inserts without changing accounting", async () => {
		const quotas = Array.from({ length: 501 }, (_, index) =>
			quota(index + 1, index + 1, 2026),
		);
		const mappings = quotas.map((item) => mapping(item.users_id));
		mocks.employeeFindMany.mockImplementation(({ where }) =>
			Promise.resolve(
				collectParams(where)
					.filter(
						(value): value is string =>
							typeof value === "string" && value.startsWith("employee-"),
					)
					.map((id) => ({ id })),
			),
		);
		mocks.insertAllowanceValues.mockImplementation(
			(rows: Array<{ employeeId: string; year: number }>) => ({
				returning: vi
					.fn()
					.mockResolvedValue(
						rows.map(({ employeeId, year }) => ({ employeeId, year })),
					),
			}),
		);

		const result = await importQuotas(quotas, mappings);
		expect(result.holidayQuotas).toEqual({
			imported: 501,
			skipped: 0,
			errors: [],
		});
		expect(mocks.employeeFindMany).toHaveBeenCalledTimes(2);
		expect(mocks.allowanceFindMany).toHaveBeenCalledTimes(2);
		for (const [{ where }] of mocks.employeeFindMany.mock.calls) {
			const params = collectParams(where);
			expect(params).toContain("org-1");
			expect(
				params.filter(
					(value) => typeof value === "string" && value.startsWith("employee-"),
				),
			).toHaveLength(params.includes("employee-501") ? 1 : 500);
		}
		for (const [{ where }] of mocks.allowanceFindMany.mock.calls) {
			expect(
				collectParams(where).filter(
					(value) => typeof value === "string" && value.startsWith("employee-"),
				),
			).toHaveLength(collectParams(where).includes("employee-501") ? 1 : 500);
		}
		expect(mocks.insertAllowanceValues).toHaveBeenCalledTimes(2);
		for (const [rows] of mocks.insertAllowanceValues.mock.calls)
			expect(rows.length).toBeLessThanOrEqual(500);
	});

	it("limits 2,001 employee validation reads to four active statements", async () => {
		const quotas = Array.from({ length: 2_001 }, (_, index) =>
			quota(index + 1, index + 1, 2026),
		);
		const mappings = quotas.map((item) => mapping(item.users_id));
		const settlers: Array<() => void> = [];
		let active = 0;
		let maxActive = 0;
		mocks.employeeFindMany.mockImplementation(({ where }) => {
			const employeeIds = collectParams(where).filter(
				(value): value is string =>
					typeof value === "string" && value.startsWith("employee-"),
			);
			active++;
			maxActive = Math.max(maxActive, active);
			return new Promise((resolve) => {
				let pending = true;
				settlers.push(() => {
					if (!pending) return;
					pending = false;
					active--;
					resolve(employeeIds.map((id) => ({ id })));
				});
			});
		});
		mocks.allowanceFindMany.mockResolvedValue(
			mappings.map(({ employeeId }) => ({ employeeId, year: 2026 })),
		);

		const importing = importQuotas(quotas, mappings);
		try {
			await vi.waitFor(() =>
				expect(mocks.employeeFindMany).toHaveBeenCalledTimes(4),
			);
			expect(mocks.employeeFindMany).toHaveBeenCalledTimes(4);
			expect(maxActive).toBe(4);
			for (const settle of settlers.slice(0, 4)) settle();
			await vi.waitFor(() =>
				expect(mocks.employeeFindMany).toHaveBeenCalledTimes(5),
			);
			expect(maxActive).toBe(4);
		} finally {
			await settleDeferredImport(importing, settlers);
		}
	});

	it.each([
		[
			"missing",
			[],
			"Holiday quota (user 1, year 2026): insert did not return exactly one matching allowance",
		],
		[
			"duplicate",
			[
				{ employeeId: "employee-1", year: 2026 },
				{ employeeId: "employee-1", year: 2026 },
			],
			"Holiday quota (user 1, year 2026): insert did not return exactly one matching allowance",
		],
		[
			"unexpected",
			[
				{ employeeId: "employee-1", year: 2026 },
				{ employeeId: "employee-9", year: 2025 },
			],
			"Holiday quota insert returned unexpected allowance for employee employee-9, year 2025",
		],
	])(
		"rolls back %s returned allowance identities inside the transaction",
		async (_case, returned, errorMessage) => {
			const committedAllowances: Array<{ employeeId: string; year: number }> =
				[];
			let localAllowances: typeof committedAllowances | undefined;
			mocks.employeeFindMany.mockResolvedValue([{ id: "employee-1" }]);
			mocks.transaction.mockImplementation(async (callback) => {
				localAllowances = [];
				try {
					const value = await callback({
						query: {
							team: { findMany: mocks.teamFindMany },
							employee: { findMany: mocks.employeeFindMany },
							employeeVacationAllowance: {
								findMany: mocks.allowanceFindMany,
							},
						},
						insert: mocks.insert,
					});
					committedAllowances.push(...localAllowances);
					return value;
				} finally {
					localAllowances = undefined;
				}
			});
			mocks.insertAllowanceValues.mockImplementation(
				(rows: Array<{ employeeId: string; year: number }>) => ({
					returning: async () => {
						localAllowances?.push(...rows);
						return returned;
					},
				}),
			);

			await expect(
				importQuotas([quota(1, 1, 2026), quota(2, 1, 2026)]),
			).rejects.toThrow(errorMessage);
			expect(committedAllowances).toEqual([]);
			expect(mocks.rootEmployeeFindMany).not.toHaveBeenCalled();
			expect(mocks.rootAllowanceFindMany).not.toHaveBeenCalled();
			expect(mocks.rootInsert).not.toHaveBeenCalled();
		},
	);

	it("avoids allowance access for empty and wholly invalid payloads", async () => {
		const empty = await importQuotas([]);
		const invalid = await importQuotas([quota(1, 99, 2026)], []);

		expect(empty.holidayQuotas).toEqual({
			imported: 0,
			skipped: 0,
			errors: [],
		});
		expect(invalid.holidayQuotas.errors).toEqual([
			"Holiday quota for user 99: no matching employee found",
		]);
		expect(mocks.employeeFindMany).not.toHaveBeenCalled();
		expect(mocks.allowanceFindMany).not.toHaveBeenCalled();
		expect(mocks.insert).not.toHaveBeenCalled();
		expect(mocks.transaction).not.toHaveBeenCalled();
	});
});
