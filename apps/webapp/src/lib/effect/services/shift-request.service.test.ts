import { sql } from "drizzle-orm";
import { Cause, Effect, Exit, Layer, Option } from "effect";
import { describe, expect, it, vi } from "vitest";
import { auditLog, shift, shiftRequest } from "@/db/schema";
import { DatabaseError } from "../errors";
import { DatabaseService } from "./database.service";
import {
	ShiftRequestService,
	ShiftRequestServiceLive,
} from "./shift-request.service";

type EmployeeRow = {
	id: string;
	userId: string;
	organizationId: string;
	teamId: string | null;
	role: "employee" | "manager" | "admin";
	isActive: boolean;
	firstName: string | null;
	lastName: string | null;
	birthday: Date | null;
	currentHourlyRate: string | null;
	employeeNumber: string | null;
};

type ShiftRow = {
	id: string;
	organizationId: string;
	employeeId: string | null;
	status: "draft" | "published";
};

type RequestRow = {
	id: string;
	shiftId: string;
	type: "swap" | "assignment" | "pickup";
	status: "pending" | "approved" | "rejected";
	requesterId: string;
	targetEmployeeId: string | null;
	approverId: string | null;
	approvedAt: Date | null;
	rejectionReason: string | null;
};

type AuditRow = {
	organizationId: string;
	entityType: string;
	entityId: string;
	action: string;
	performedBy: string;
	employeeId: string | null;
	changes: string | null;
	metadata: string | null;
};

type HarnessState = {
	employees: EmployeeRow[];
	shifts: ShiftRow[];
	requests: RequestRow[];
	audits: AuditRow[];
};

type QueryConfig = {
	where?: unknown;
	with?: {
		shift?: RelationConfig;
		requester?: RelationConfig;
		targetEmployee?: RelationConfig;
	};
};

type RelationConfig =
	| boolean
	| {
			columns?: Record<string, boolean>;
			with?: { employee?: RelationConfig };
	  };

const baseState = (): HarnessState => ({
	employees: [
		{
			id: "employee-requester",
			userId: "user-requester",
			organizationId: "org-1",
			teamId: "team-1",
			role: "employee",
			isActive: true,
			firstName: "Riley",
			lastName: "Requester",
			birthday: new Date("1990-02-03T00:00:00.000Z"),
			currentHourlyRate: "37.50",
			employeeNumber: "SECRET-001",
		},
		{
			id: "employee-target",
			userId: "user-target",
			organizationId: "org-1",
			teamId: "team-1",
			role: "employee",
			isActive: true,
			firstName: "Taylor",
			lastName: "Target",
			birthday: new Date("1992-04-05T00:00:00.000Z"),
			currentHourlyRate: "42.00",
			employeeNumber: "SECRET-002",
		},
		{
			id: "employee-manager",
			userId: "user-manager",
			organizationId: "org-1",
			teamId: "team-1",
			role: "manager",
			isActive: true,
			firstName: "Morgan",
			lastName: "Manager",
			birthday: new Date("1985-06-07T00:00:00.000Z"),
			currentHourlyRate: "55.00",
			employeeNumber: "SECRET-003",
		},
		{
			id: "employee-other-manager",
			userId: "user-other-manager",
			organizationId: "org-2",
			teamId: "team-2",
			role: "manager",
			isActive: true,
			firstName: "Other",
			lastName: "Manager",
			birthday: new Date("1984-08-09T00:00:00.000Z"),
			currentHourlyRate: "60.00",
			employeeNumber: "SECRET-004",
		},
	],
	shifts: [
		{
			id: "shift-owned",
			organizationId: "org-1",
			employeeId: "employee-requester",
			status: "published",
		},
		{
			id: "shift-open",
			organizationId: "org-1",
			employeeId: null,
			status: "published",
		},
		{
			id: "shift-other-org",
			organizationId: "org-2",
			employeeId: null,
			status: "published",
		},
	],
	requests: [],
	audits: [],
});

function request(overrides: Partial<RequestRow> = {}): RequestRow {
	return {
		id: "request-1",
		shiftId: "shift-open",
		type: "pickup",
		status: "pending",
		requesterId: "employee-requester",
		targetEmployeeId: null,
		approverId: null,
		approvedAt: null,
		rejectionReason: null,
		...overrides,
	};
}

function paramsFrom(
	expression: unknown,
	values: unknown[] = [],
	seen = new WeakSet<object>(),
) {
	if (!expression || typeof expression !== "object") return values;
	if (seen.has(expression)) return values;
	seen.add(expression);
	const candidate = expression as {
		constructor?: { name?: string };
		queryChunks?: unknown[];
		value?: unknown;
	};
	if (candidate.constructor?.name === "Param") values.push(candidate.value);
	for (const chunk of candidate.queryChunks ?? [])
		paramsFrom(chunk, values, seen);
	return values;
}

function makeQueryPromise<T>(
	execute: () => Promise<T>,
	returning?: () => Promise<unknown[]>,
) {
	const promise = execute();
	return Object.assign(promise, {
		returning: returning ?? (async () => (await promise) as unknown[]),
	});
}

function findEmployee(state: HarnessState, employeeId: string) {
	const row = state.employees.find((item) => item.id === employeeId);
	if (!row) throw new Error(`Missing test employee ${employeeId}`);
	return row;
}

function findShift(state: HarnessState, shiftId: string) {
	const row = state.shifts.find((item) => item.id === shiftId);
	if (!row) throw new Error(`Missing test shift ${shiftId}`);
	return row;
}

function projectEmployee(
	row: EmployeeRow | undefined,
	relation: RelationConfig | undefined,
) {
	if (!row || !relation) return row;
	if (relation === true || !relation.columns) return { ...row };
	return Object.fromEntries(
		Object.entries(relation.columns)
			.filter(([, included]) => included)
			.map(([column]) => [column, row[column as keyof EmployeeRow]]),
	);
}

function attachRelations(
	state: HarnessState,
	row: RequestRow,
	config: QueryConfig,
) {
	const result: Record<string, unknown> = { ...row };
	const shiftRelation = config.with?.shift;
	if (shiftRelation) {
		const currentShift = state.shifts.find((item) => item.id === row.shiftId);
		result.shift = currentShift
			? {
					...currentShift,
					...(typeof shiftRelation === "object" && shiftRelation.with?.employee
						? {
								employee: projectEmployee(
									state.employees.find(
										(item) => item.id === currentShift.employeeId,
									),
									shiftRelation.with.employee,
								),
							}
						: {}),
				}
			: undefined;
	}
	if (config.with?.requester) {
		result.requester = projectEmployee(
			state.employees.find((item) => item.id === row.requesterId),
			config.with.requester,
		);
	}
	if (config.with?.targetEmployee) {
		result.targetEmployee =
			projectEmployee(
				state.employees.find((item) => item.id === row.targetEmployeeId),
				config.with.targetEmployee,
			) ?? null;
	}
	return result;
}

function createHarness(
	setup?: (state: HarnessState) => void,
	options: {
		failRequestStatusUpdate?: boolean;
		failShiftUpdate?: boolean;
		rejectionCasWins?: boolean;
	} = {},
) {
	let durable = baseState();
	setup?.(durable);
	let transactionTail = Promise.resolve();
	let nextRequest = 1;
	const execute = vi.fn().mockResolvedValue(undefined);
	const transaction = vi.fn(
		async (callback: (tx: unknown) => Promise<unknown>) => {
			const previous = transactionTail;
			let release!: () => void;
			transactionTail = new Promise<void>((resolve) => {
				release = resolve;
			});
			await previous;
			const staged = structuredClone(durable);

			const findRequest = (config: QueryConfig) => {
				const params = paramsFrom(config?.where);
				const byId = staged.requests.find((item) => params.includes(item.id));
				const found =
					byId ??
					staged.requests.find(
						(item) =>
							params.includes(item.shiftId) &&
							params.includes(item.requesterId) &&
							params.includes(item.type) &&
							params.includes(item.status),
					);
				return found ? attachRelations(staged, found, config) : undefined;
			};

			const tx = {
				execute,
				query: {
					employee: {
						findFirst: vi.fn(async (config: QueryConfig) => {
							const params = paramsFrom(config?.where);
							const row = staged.employees.find(
								(item) =>
									params.includes(item.id) || params.includes(item.userId),
							);
							if (!row) return undefined;
							if (params.includes("org-1") && row.organizationId !== "org-1")
								return undefined;
							if (params.includes("org-2") && row.organizationId !== "org-2")
								return undefined;
							if (params.includes(true) && !row.isActive) return undefined;
							return row;
						}),
					},
					shift: {
						findFirst: vi.fn(async (config: QueryConfig) => {
							const params = paramsFrom(config?.where);
							const row = staged.shifts.find((item) =>
								params.includes(item.id),
							);
							if (!row) return undefined;
							if (params.includes("org-1") && row.organizationId !== "org-1")
								return undefined;
							if (params.includes("org-2") && row.organizationId !== "org-2")
								return undefined;
							return row;
						}),
					},
					shiftRequest: {
						findFirst: vi.fn(async (config: QueryConfig) =>
							findRequest(config),
						),
						findMany: vi.fn(async (config: QueryConfig) => {
							const params = paramsFrom(config?.where);
							return staged.requests
								.filter((item) => {
									if (params.includes(item.id)) return true;
									if (params.includes(item.shiftId)) return true;
									return params.includes(item.status);
								})
								.map((item) => attachRelations(staged, item, config));
						}),
					},
				},
				insert: vi.fn((table: unknown) => ({
					values: vi.fn((values: Record<string, unknown>) => {
						if (table === shiftRequest) {
							const create = async () => {
								const row = request({
									id: `created-${nextRequest++}`,
									...(values as Partial<RequestRow>),
									targetEmployeeId: values.targetEmployeeId ?? null,
								});
								staged.requests.push(row);
								return [row];
							};
							return makeQueryPromise(async () => undefined, create);
						}
						if (table === auditLog) {
							const create = async () => {
								staged.audits.push(values as AuditRow);
								return undefined;
							};
							return makeQueryPromise(create, async () => []);
						}
						throw new Error("Unexpected insert table");
					}),
				})),
				update: vi.fn((table: unknown) => ({
					set: vi.fn((values: Record<string, unknown>) => ({
						where: vi.fn((where: unknown) => {
							const run = async () => {
								const params = paramsFrom(where);
								if (table === shift) {
									if (options.failShiftUpdate)
										throw new Error("shift update failed");
									const row = staged.shifts.find((item) =>
										params.includes(item.id),
									);
									if (
										!row ||
										!params.includes(row.organizationId) ||
										row.status !== "published"
									)
										return [];
									Object.assign(row, values);
									return [{ ...row }];
								}
								if (table === shiftRequest) {
									if (options.failRequestStatusUpdate)
										throw new Error("request update failed");
									if (
										options.rejectionCasWins === false &&
										values.status === "rejected"
									)
										return [];
									const rows = staged.requests.filter((item) => {
										const idMatch = params.some((param) => param === item.id);
										const shiftMatch = params.includes(item.shiftId);
										const statusMatch =
											!params.includes("pending") || item.status === "pending";
										const typeMatch =
											!params.includes("pickup") || item.type === "pickup";
										return (
											(idMatch ||
												(!params.some((param) =>
													staged.requests.some((r) => r.id === param),
												) &&
													shiftMatch)) &&
											statusMatch &&
											typeMatch
										);
									});
									for (const row of rows) Object.assign(row, values);
									return rows.map((row) => ({ ...row }));
								}
								throw new Error("Unexpected update table");
							};
							return makeQueryPromise(run);
						}),
					})),
				})),
				delete: vi.fn((table: unknown) => ({
					where: vi.fn((where: unknown) => {
						const run = async () => {
							if (table !== shiftRequest)
								throw new Error("Unexpected delete table");
							const params = paramsFrom(where);
							const index = staged.requests.findIndex(
								(item) =>
									params.includes(item.id) &&
									params.includes(item.shiftId) &&
									params.includes(item.requesterId) &&
									item.status === "pending",
							);
							if (index < 0) return [];
							return staged.requests.splice(index, 1);
						};
						return makeQueryPromise(run);
					}),
				})),
			};

			try {
				const result = await callback(tx);
				durable = staged;
				return result;
			} finally {
				release();
			}
		},
	);

	const directDb = {
		transaction,
		query: {
			employee: {
				findFirst: vi.fn(async (config: QueryConfig) => {
					const params = paramsFrom(config.where);
					const row = durable.employees.find((item) =>
						params.includes(item.id),
					);
					if (!row || (params.includes(true) && !row.isActive))
						return undefined;
					if (params.includes("org-1") && row.organizationId !== "org-1")
						return undefined;
					return row;
				}),
			},
			shift: {
				findFirst: vi.fn(async (config: QueryConfig) => {
					const params = paramsFrom(config.where);
					const row = durable.shifts.find((item) => params.includes(item.id));
					if (!row) return undefined;
					if (params.includes("org-1") && row.organizationId !== "org-1")
						return undefined;
					return row;
				}),
			},
			shiftRequest: {
				findFirst: vi.fn(async (config: QueryConfig) => {
					const params = paramsFrom(config.where);
					const row = durable.requests.find((item) => params.includes(item.id));
					return row ? attachRelations(durable, row, config) : undefined;
				}),
				findMany: vi.fn(async (config: QueryConfig) =>
					durable.requests
						.filter((item) => item.status === "pending")
						.map((item) => attachRelations(durable, item, config)),
				),
			},
		},
		select: vi.fn(() => ({
			from: vi.fn(() => ({
				where: vi.fn(() => sql`select 1`),
			})),
		})),
	};

	const dbLayer = Layer.succeed(
		DatabaseService,
		DatabaseService.of({
			db: directDb as never,
			query: (name, query) =>
				Effect.tryPromise({
					try: query,
					catch: (cause) =>
						new DatabaseError({
							message: `Database query failed: ${name}`,
							operation: name,
							cause,
						}),
				}),
		}),
	);
	const layer = ShiftRequestServiceLive.pipe(Layer.provide(dbLayer));
	const run = <A, E>(
		effect: (
			service: typeof ShiftRequestService.Service,
		) => Effect.Effect<A, E>,
	) =>
		Effect.runPromise(
			Effect.flatMap(ShiftRequestService, effect).pipe(Effect.provide(layer)),
		);
	const runExit = <A, E>(
		effect: (
			service: typeof ShiftRequestService.Service,
		) => Effect.Effect<A, E>,
	) =>
		Effect.runPromiseExit(
			Effect.flatMap(ShiftRequestService, effect).pipe(Effect.provide(layer)),
		);

	return {
		execute,
		get state() {
			return durable;
		},
		run,
		runExit,
		transaction,
	};
}

function failureTag(
	exit: Awaited<ReturnType<ReturnType<typeof createHarness>["runExit"]>>,
) {
	if (Exit.isSuccess(exit)) return undefined;
	const failure = Cause.failureOption(exit.cause);
	return Option.isSome(failure)
		? (failure.value as { _tag?: string })._tag
		: undefined;
}

describe("ShiftRequestService organization containment", () => {
	it("returns only display-safe employee fields from shift request reads", async () => {
		const harness = createHarness((state) => {
			state.requests.push(
				request({
					shiftId: "shift-owned",
					type: "swap",
					targetEmployeeId: "employee-target",
				}),
			);
		});

		const pendingRequests = await harness.run((service) =>
			service.getPendingRequests("org-1", "employee-manager"),
		);
		const requestsByShift = await harness.run((service) =>
			service.getRequestsByShift("org-1", "shift-owned"),
		);
		const requestById = await harness.run((service) =>
			service.getRequestById("org-1", "request-1"),
		);
		const serializedRequests = JSON.parse(
			JSON.stringify([pendingRequests[0], requestsByShift[0], requestById]),
		);

		for (const serialized of serializedRequests) {
			expect(serialized.requester).toEqual({
				id: "employee-requester",
				firstName: "Riley",
				lastName: "Requester",
			});
			expect(serialized.targetEmployee).toEqual({
				id: "employee-target",
				firstName: "Taylor",
				lastName: "Target",
			});
			expect(serialized.shift.employee).toEqual({
				id: "employee-requester",
				firstName: "Riley",
				lastName: "Requester",
			});
			expect(
				JSON.stringify([
					serialized.requester,
					serialized.targetEmployee,
					serialized.shift.employee,
				]),
			).not.toMatch(
				/birthday|currentHourlyRate|employeeNumber|userId|organizationId/,
			);
		}
	});

	it("does not create requests for a shift in another organization", async () => {
		const harness = createHarness();
		const exit = await harness.runExit((service) =>
			service.requestPickup("org-1", {
				shiftId: "shift-other-org",
				requesterId: "employee-requester",
			}),
		);

		expect(failureTag(exit)).toBe("NotFoundError");
		expect(harness.state.requests).toHaveLength(0);
	});

	it.each([
		["cross-organization", { organizationId: "org-2", isActive: true }],
		["inactive", { organizationId: "org-1", isActive: false }],
	])("rejects a %s requester", async (_label, requesterChange) => {
		const harness = createHarness((state) => {
			Object.assign(findEmployee(state, "employee-requester"), requesterChange);
		});
		const exit = await harness.runExit((service) =>
			service.requestPickup("org-1", {
				shiftId: "shift-open",
				requesterId: "employee-requester",
			}),
		);

		expect(failureTag(exit)).toBe("NotFoundError");
		expect(harness.state.requests).toHaveLength(0);
	});

	it.each([
		["cross-organization", { organizationId: "org-2", isActive: true }],
		["inactive", { organizationId: "org-1", isActive: false }],
	])("rejects a %s swap target", async (_label, targetChange) => {
		const harness = createHarness((state) => {
			Object.assign(findEmployee(state, "employee-target"), targetChange);
		});
		const exit = await harness.runExit((service) =>
			service.requestSwap("org-1", {
				shiftId: "shift-owned",
				requesterId: "employee-requester",
				targetEmployeeId: "employee-target",
			}),
		);

		expect(failureTag(exit)).toBe("NotFoundError");
		expect(harness.state.requests).toHaveLength(0);
	});

	it("hides a request whose joined shift belongs to another organization", async () => {
		const harness = createHarness((state) => {
			state.requests.push(
				request({ id: "request-other", shiftId: "shift-other-org" }),
			);
		});
		const exit = await harness.runExit((service) =>
			service.approveRequest("org-1", "request-other", "employee-manager"),
		);

		expect(failureTag(exit)).toBe("NotFoundError");
		expect(harness.state.requests[0]?.status).toBe("pending");
		expect(
			harness.state.shifts.find((item) => item.id === "shift-other-org")
				?.employeeId,
		).toBeNull();
	});

	it.each([
		[
			"cross-organization manager",
			"employee-other-manager",
			"AuthorizationError",
		],
		["ordinary employee", "employee-requester", "AuthorizationError"],
	])("rejects an active %s as approver", async (_label, approverId, expectedTag) => {
		const harness = createHarness((state) => state.requests.push(request()));
		const exit = await harness.runExit((service) =>
			service.approveRequest("org-1", "request-1", approverId),
		);

		expect(failureTag(exit)).toBe(expectedTag);
		expect(harness.state.requests[0]?.status).toBe("pending");
	});

	it("rejects an inactive manager", async () => {
		const harness = createHarness((state) => {
			state.requests.push(request());
			findEmployee(state, "employee-manager").isActive = false;
		});
		const exit = await harness.runExit((service) =>
			service.rejectRequest("org-1", "request-1", "employee-manager"),
		);

		expect(failureTag(exit)).toBe("AuthorizationError");
		expect(harness.state.requests[0]?.status).toBe("pending");
	});
});

describe("ShiftRequestService serialized mutations", () => {
	it("serializes duplicate creation so only one identical pending request persists", async () => {
		const harness = createHarness();
		const create = () =>
			harness.runExit((service) =>
				service.requestPickup("org-1", {
					shiftId: "shift-open",
					requesterId: "employee-requester",
				}),
			);
		const exits = await Promise.all([create(), create()]);

		expect(exits.filter(Exit.isSuccess)).toHaveLength(1);
		expect(
			exits.map(failureTag).filter((tag) => tag === "ConflictError"),
		).toHaveLength(1);
		expect(harness.state.requests).toHaveLength(1);
		expect(harness.transaction).toHaveBeenCalledTimes(2);
		expect(harness.execute).toHaveBeenCalledTimes(2);
	});

	it("allows exactly one competing pickup approval to win", async () => {
		const harness = createHarness((state) => {
			state.employees.push({
				id: "employee-second",
				userId: "user-second",
				organizationId: "org-1",
				teamId: "team-1",
				role: "employee",
				isActive: true,
				firstName: "Second",
				lastName: "Requester",
				birthday: null,
				currentHourlyRate: null,
				employeeNumber: null,
			});
			state.requests.push(
				request({ id: "request-first" }),
				request({ id: "request-second", requesterId: "employee-second" }),
			);
		});
		const exits = await Promise.all([
			harness.runExit((service) =>
				service.approveRequest("org-1", "request-first", "employee-manager"),
			),
			harness.runExit((service) =>
				service.approveRequest("org-1", "request-second", "employee-manager"),
			),
		]);

		expect(exits.filter(Exit.isSuccess)).toHaveLength(1);
		expect(
			harness.state.requests.filter((item) => item.status === "approved"),
		).toHaveLength(1);
		expect(
			harness.state.requests.filter((item) => item.status === "rejected"),
		).toHaveLength(1);
		const winner = harness.state.requests.find(
			(item) => item.status === "approved",
		);
		if (!winner) throw new Error("Expected an approved pickup request");
		expect(
			harness.state.shifts.find((item) => item.id === "shift-open")?.employeeId,
		).toBe(winner.requesterId);
	});

	it("serializes approval against cancellation", async () => {
		const harness = createHarness((state) => state.requests.push(request()));
		const exits = await Promise.all([
			harness.runExit((service) =>
				service.approveRequest("org-1", "request-1", "employee-manager"),
			),
			harness.runExit((service) =>
				service.cancelRequest("org-1", "request-1", "employee-requester"),
			),
		]);

		expect(exits.filter(Exit.isSuccess)).toHaveLength(1);
		expect(harness.state.requests[0]?.status).toBe("approved");
		expect(harness.state.audits).toHaveLength(0);
	});

	it("does not mutate a targetless swap during attempted approval", async () => {
		const harness = createHarness((state) => {
			state.requests.push(
				request({
					shiftId: "shift-owned",
					type: "swap",
					targetEmployeeId: null,
				}),
			);
		});
		const exit = await harness.runExit((service) =>
			service.approveRequest("org-1", "request-1", "employee-manager"),
		);

		expect(failureTag(exit)).toBe("ConflictError");
		expect(harness.state.requests[0]?.status).toBe("pending");
		expect(
			harness.state.shifts.find((item) => item.id === "shift-owned")
				?.employeeId,
		).toBe("employee-requester");
	});

	it.each([
		"failShiftUpdate",
		"failRequestStatusUpdate",
	] as const)("rolls back approval when %s is injected", async (failure) => {
		const harness = createHarness((state) => state.requests.push(request()), {
			[failure]: true,
		});
		const exit = await harness.runExit((service) =>
			service.approveRequest("org-1", "request-1", "employee-manager"),
		);

		expect(failureTag(exit)).toBe("DatabaseError");
		expect(harness.state.requests[0]?.status).toBe("pending");
		expect(
			harness.state.shifts.find((item) => item.id === "shift-open")?.employeeId,
		).toBeNull();
	});

	it("returns a stale conflict when rejection compare-and-set loses", async () => {
		const harness = createHarness((state) => state.requests.push(request()), {
			rejectionCasWins: false,
		});
		const exit = await harness.runExit((service) =>
			service.rejectRequest(
				"org-1",
				"request-1",
				"employee-manager",
				"No coverage",
			),
		);

		expect(failureTag(exit)).toBe("ConflictError");
		expect(harness.state.requests[0]?.status).toBe("pending");
	});

	it("lets an active manager reject a pending request after the shift and participants become inactive", async () => {
		const harness = createHarness((state) => {
			state.requests.push(
				request({
					shiftId: "shift-owned",
					type: "swap",
					targetEmployeeId: "employee-target",
				}),
			);
			findShift(state, "shift-owned").status = "draft";
			findEmployee(state, "employee-requester").isActive = false;
			findEmployee(state, "employee-target").isActive = false;
		});

		const rejected = await harness.run((service) =>
			service.rejectRequest(
				"org-1",
				"request-1",
				"employee-manager",
				"Request is no longer applicable",
			),
		);

		expect(rejected.status).toBe("rejected");
		expect(harness.state.requests[0]?.rejectionReason).toBe(
			"Request is no longer applicable",
		);
	});

	it("allows only the active organization requester to cancel and preserves audit evidence", async () => {
		const harness = createHarness((state) => state.requests.push(request()));
		const unauthorized = await harness.runExit((service) =>
			service.cancelRequest("org-1", "request-1", "employee-target"),
		);
		expect(failureTag(unauthorized)).toBe("AuthorizationError");
		expect(harness.state.requests).toHaveLength(1);

		await harness.run((service) =>
			service.cancelRequest("org-1", "request-1", "employee-requester"),
		);

		expect(harness.state.requests).toHaveLength(0);
		expect(harness.state.audits).toEqual([
			expect.objectContaining({
				organizationId: "org-1",
				entityType: "shift_request",
				entityId: "request-1",
				action: "cancel",
				performedBy: "user-requester",
				employeeId: "employee-requester",
			}),
		]);
		const changes = harness.state.audits[0]?.changes;
		if (!changes) throw new Error("Expected cancellation audit changes");
		expect(JSON.parse(changes)).toEqual({
			status: { from: "pending", to: "cancelled" },
		});
	});

	it("lets the active requester cancel on an unpublished shift with an inactive target", async () => {
		const harness = createHarness((state) => {
			state.requests.push(
				request({
					shiftId: "shift-owned",
					type: "swap",
					targetEmployeeId: "employee-target",
				}),
			);
			findShift(state, "shift-owned").status = "draft";
			findEmployee(state, "employee-target").isActive = false;
		});

		await harness.run((service) =>
			service.cancelRequest("org-1", "request-1", "employee-requester"),
		);

		expect(harness.state.requests).toHaveLength(0);
		expect(harness.state.audits).toEqual([
			expect.objectContaining({
				organizationId: "org-1",
				entityId: "request-1",
				action: "cancel",
			}),
		]);
	});

	it("does not let an inactive requester act to cancel", async () => {
		const harness = createHarness((state) => {
			state.requests.push(request());
			findEmployee(state, "employee-requester").isActive = false;
		});

		const exit = await harness.runExit((service) =>
			service.cancelRequest("org-1", "request-1", "employee-requester"),
		);

		expect(failureTag(exit)).toBe("AuthorizationError");
		expect(harness.state.requests).toHaveLength(1);
		expect(harness.state.audits).toHaveLength(0);
	});
});
