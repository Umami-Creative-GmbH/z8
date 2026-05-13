import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, test, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const organizationUpdateWhere = vi.fn(async () => undefined);
	const organizationUpdateSet = vi.fn(() => ({ where: organizationUpdateWhere }));

	return {
		session: {
			user: {
				id: "user-1",
				email: "owner@example.com",
				name: "Owner",
			},
			session: {
				activeOrganizationId: "org-1",
			},
		},
		memberRecord: {
			id: "member-1",
			userId: "user-1",
			organizationId: "org-1",
			role: "owner",
		},
		eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
		and: vi.fn((...args: unknown[]) => ({ and: args })),
		memberFindFirst: vi.fn(),
		dbUpdate: vi.fn(() => ({ set: organizationUpdateSet })),
		organizationUpdateSet,
		organizationUpdateWhere,
	};
});

vi.mock("@opentelemetry/api", () => ({
	SpanStatusCode: {
		OK: 1,
		ERROR: 2,
	},
	trace: {
		getTracer: vi.fn(() => ({
			startActiveSpan: vi.fn((_name, _options, callback) =>
				callback({
					setAttribute: vi.fn(),
					setStatus: vi.fn(),
					recordException: vi.fn(),
					end: vi.fn(),
				}),
			),
		})),
	},
}));

vi.mock("drizzle-orm", () => ({
	and: mockState.and,
	eq: mockState.eq,
}));

vi.mock("next/headers", () => ({
	headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/db/auth-schema", () => ({
	member: {
		userId: "member.userId",
		organizationId: "member.organizationId",
	},
	organization: {
		id: "organization.id",
	},
	invitation: {
		id: "invitation.id",
		organizationId: "invitation.organizationId",
		email: "invitation.email",
		status: "invitation.status",
	},
	user: {
		email: "user.email",
	},
}));

vi.mock("@/db/schema", () => ({
	employee: {
		id: "employee.id",
		organizationId: "employee.organizationId",
	},
}));

vi.mock("@/db", () => ({
	db: {
		query: {
			member: {
				findFirst: mockState.memberFindFirst,
			},
			invitation: {
				findFirst: vi.fn(),
			},
			user: {
				findFirst: vi.fn(),
			},
			organization: {
				findFirst: vi.fn(),
			},
			employee: {
				findFirst: vi.fn(),
			},
		},
		update: mockState.dbUpdate,
	},
}));

vi.mock("@/lib/app-url", () => ({
	getOrganizationBaseUrl: vi.fn(async () => "https://example.com"),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			createInvitation: vi.fn(),
			cancelInvitation: vi.fn(),
			removeMember: vi.fn(),
			updateMemberRole: vi.fn(),
			updateOrganization: vi.fn(),
		},
	},
}));

vi.mock("@/lib/enterprise-identity/enforcement", () => ({
	assertEnterpriseIdentityInvitationAllowed: vi.fn(async () => undefined),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: vi.fn(() => ({
		info: vi.fn(),
		error: vi.fn(),
		warn: vi.fn(),
	})),
}));

vi.mock("@/lib/effect/services/auth.service", async () => {
	const { Context } = await import("effect");
	const AuthService = Context.GenericTag<any>("AuthService");
	return { AuthService };
});

vi.mock("@/lib/effect/services/database.service", async () => {
	const { Context } = await import("effect");
	const DatabaseService = Context.GenericTag<any>("DatabaseService");
	return { DatabaseService };
});

vi.mock("@/lib/effect/runtime", async () => {
	const { Effect, Layer } = await import("effect");
	const { AuthService } = await import("@/lib/effect/services/auth.service");
	const { DatabaseService } = await import("@/lib/effect/services/database.service");

	return {
		AppLayer: Layer.mergeAll(
			Layer.succeed(AuthService, {
				getSession: () => Effect.succeed(mockState.session),
			}),
			Layer.succeed(DatabaseService, {
				db: {
					query: {
						member: {
							findFirst: mockState.memberFindFirst,
						},
					},
					update: mockState.dbUpdate,
				},
				query: (_key: string, fn: () => Promise<unknown>) =>
					Effect.tryPromise({
						try: fn,
						catch: (error) => error,
					}),
			}),
		),
	};
});

vi.mock("@/lib/effect/result", async () => {
	const { Cause, Effect, Exit, Option } = await import("effect");

	return {
		runServerActionSafe: async <T>(effect: Parameters<typeof Effect.runPromiseExit<T>>[0]) => {
			const exit = await Effect.runPromiseExit(effect);
			return Exit.match(exit, {
				onSuccess: (data) => ({ success: true as const, data }),
				onFailure: (cause) => {
					const defect = [...Cause.defects(cause)][0] ?? null;
					const failure = Option.getOrNull(Cause.failureOption(cause));
					const error = defect ?? failure ?? cause;

					if (error && typeof error === "object" && "_tag" in error) {
						return {
							success: false as const,
							error: (error as { message: string }).message,
							code: (error as { _tag: string })._tag,
						};
					}

					return {
						success: false as const,
						error: error instanceof Error ? error.message : "An unexpected error occurred",
						code: "UNKNOWN_ERROR",
					};
				},
			});
		},
	};
});

const source = readFileSync(fileURLToPath(new URL("./actions.ts", import.meta.url)), "utf8");
const { updateOrganizationFiscalYearStartMonth } = await import("./actions");

describe("organization fiscal year start month action", () => {
	test("exports updateOrganizationFiscalYearStartMonth", () => {
		expect(source).toContain("export async function updateOrganizationFiscalYearStartMonth");
	});

	test("requires organization owners to update fiscal year settings", () => {
		expect(source).toContain('if (memberRecord.role !== "owner")');
		expect(source).toContain("Only owners can change organization fiscal year settings");
	});

	test("validates fiscal year start month is an integer from 1 through 12", () => {
		expect(source).toContain("Number.isInteger(month)");
		expect(source).toContain("month < 1 || month > 12");
		expect(source).toContain("Invalid fiscal year start month");
	});

	test("updates fiscal year start month only for the scoped organization", () => {
		expect(source).toContain(".set({ fiscalYearStartMonth: month })");
		expect(source).toContain(".where(eq(authSchema.organization.id, organizationId))");
	});
});

describe("updateOrganizationFiscalYearStartMonth behavior", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.memberRecord = {
			id: "member-1",
			userId: "user-1",
			organizationId: "org-1",
			role: "owner",
		};
		mockState.memberFindFirst.mockResolvedValue(mockState.memberRecord);
		mockState.organizationUpdateWhere.mockResolvedValue(undefined);
	});

	test("rejects invalid month and does not update the database", async () => {
		const result = await updateOrganizationFiscalYearStartMonth("org-1", 13);

		expect(result).toMatchObject({
			success: false,
			error: "Invalid fiscal year start month",
		});
		expect(mockState.memberFindFirst).not.toHaveBeenCalled();
		expect(mockState.dbUpdate).not.toHaveBeenCalled();
		expect(mockState.organizationUpdateSet).not.toHaveBeenCalled();
		expect(mockState.organizationUpdateWhere).not.toHaveBeenCalled();
	});

	test("rejects non-owner members and does not update the database", async () => {
		mockState.memberRecord = {
			...mockState.memberRecord,
			role: "admin",
		};
		mockState.memberFindFirst.mockResolvedValue(mockState.memberRecord);

		const result = await updateOrganizationFiscalYearStartMonth("org-1", 4);

		expect(result).toMatchObject({
			success: false,
			error: "Only owners can change organization fiscal year settings",
		});
		expect(mockState.memberFindFirst).toHaveBeenCalledWith({
			where: {
				and: [
					{ eq: ["member.userId", "user-1"] },
					{ eq: ["member.organizationId", "org-1"] },
				],
			},
		});
		expect(mockState.dbUpdate).not.toHaveBeenCalled();
		expect(mockState.organizationUpdateSet).not.toHaveBeenCalled();
		expect(mockState.organizationUpdateWhere).not.toHaveBeenCalled();
	});

	test("allows owners to update fiscal year start month for the scoped organization", async () => {
		const result = await updateOrganizationFiscalYearStartMonth("org-1", 4);

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.dbUpdate).toHaveBeenCalledWith({ id: "organization.id" });
		expect(mockState.organizationUpdateSet).toHaveBeenCalledWith({ fiscalYearStartMonth: 4 });
		expect(mockState.organizationUpdateWhere).toHaveBeenCalledWith({
			eq: ["organization.id", "org-1"],
		});
	});
});
