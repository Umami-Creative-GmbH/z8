import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const employeeFindFirst = vi.fn();
	const employeeUpdateWhere = vi.fn();
	const employeeUpdateSet = vi.fn(() => ({ where: employeeUpdateWhere }));

	return {
		headers: new Headers(),
		session: {
			user: {
				id: "user-1",
				email: "ada@example.com",
				name: "Existing Name",
				firstName: "Stored",
				lastName: "User",
				image: "/avatars/original.png",
			},
			session: {
				id: "session-1",
				userId: "user-1",
				expiresAt: new Date("2099-01-01T00:00:00.000Z"),
				token: "token",
				activeOrganizationId: "org-1",
			},
		},
		updateUser: vi.fn(),
		employeeFindFirst,
		dbUpdate: vi.fn(() => ({ set: employeeUpdateSet })),
		employeeUpdateSet,
		employeeUpdateWhere,
	};
});

vi.mock("next/headers", () => ({
	headers: vi.fn(async () => mockState.headers),
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			updateUser: mockState.updateUser,
			changePassword: vi.fn(),
			getSession: vi.fn(),
		},
	},
}));

vi.mock("@/db/schema", async () => {
	const actual = await vi.importActual<typeof import("@/db/schema")>("@/db/schema");

	return {
		...actual,
		employee: {
			id: "employee.id",
			isActive: "employee.isActive",
			userId: "employee.userId",
			organizationId: "employee.organizationId",
			firstName: "employee.firstName",
			lastName: "employee.lastName",
		},
	};
});

vi.mock("@/db", async () => {
	const actual = await vi.importActual<typeof import("@/db")>("@/db");

	return {
		...actual,
		db: {
			query: {
				employee: {
					findFirst: mockState.employeeFindFirst,
				},
				userSettings: {
					findFirst: vi.fn(),
				},
			},
			update: mockState.dbUpdate,
			insert: vi.fn(),
		},
	};
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
						employee: {
							findFirst: mockState.employeeFindFirst,
						},
					},
					update: mockState.dbUpdate,
				} as unknown as InstanceType<typeof DatabaseService>["Type"]["db"],
				query: (_name: string, fn: () => Promise<unknown>) =>
					Effect.tryPromise({
						try: fn,
						catch: (error) => error,
					}) as unknown as ReturnType<InstanceType<typeof DatabaseService>["Type"]["query"]>,
			}),
		),
	};
});

vi.mock("@/lib/effect/result", async () => {
	const { Cause, Effect, Exit, Option } = await import("effect");

	const toServerActionResult = <T>(exit: unknown) =>
		Exit.match(exit as never, {
			onFailure: (cause) => {
				const defects = Cause.defects(cause);
				const defect = [...defects][0] ?? null;
				const failure = Option.getOrNull(Cause.failureOption(cause));
				const error = defect ?? failure ?? cause;

				if (error && typeof error === "object" && "_tag" in error) {
					return {
						success: false as const,
						error: (error as unknown as { message: string }).message,
						code: (error as unknown as { _tag: string })._tag,
					};
				}

				if (error instanceof Error) {
					return {
						success: false as const,
						error: error.message || "An unexpected error occurred",
						code: "UNKNOWN_ERROR",
					};
				}

				return {
					success: false as const,
					error: "An unexpected error occurred",
					code: "UNKNOWN_ERROR",
				};
			},
			onSuccess: (data) => ({ success: true as const, data }),
		});

	return {
		runServerActionSafe: async <T>(effect: unknown) => {
			const exit = await Effect.runPromiseExit(effect as never);
			return toServerActionResult(exit);
		},
		toServerActionResult,
	};
});

const { updateProfile, updateProfileDetails, updateProfileImage } = await import("./actions");

describe("profile actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.session.user.name = "Existing Name";
		mockState.session.user.firstName = "Stored";
		mockState.session.user.lastName = "User";
		mockState.session.user.image = "/avatars/original.png";
		mockState.session.session.activeOrganizationId = "org-1";
		mockState.employeeFindFirst.mockResolvedValue(null);
		mockState.employeeUpdateWhere.mockResolvedValue(undefined);
	});

	it("derives the Better Auth name from structured profile details", async () => {
		const result = await updateProfileDetails({
			firstName: "  Ada ",
			lastName: " Lovelace  ",
			gender: "female",
			birthday: new Date("1815-12-10T00:00:00.000Z"),
			image: "/avatars/ada.png",
		});

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.updateUser).toHaveBeenCalledWith({
			body: {
				firstName: "Ada",
				lastName: "Lovelace",
				name: "Ada Lovelace",
				image: "/avatars/ada.png",
			},
			headers: mockState.headers,
		});
	});

	it("uses stored structured names when only the profile image changes", async () => {
		const result = await updateProfileImage({
			image: null,
		});

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.updateUser).toHaveBeenCalledWith({
			body: {
				firstName: "Stored",
				lastName: "User",
				name: "Stored User",
				image: null,
			},
			headers: mockState.headers,
		});
	});

	it("syncs the active organization employee record when profile details change", async () => {
		mockState.employeeFindFirst.mockResolvedValue({
			id: "employee-1",
		});

		const result = await updateProfileDetails({
			firstName: "Grace",
			lastName: "Hopper",
			gender: "female",
			birthday: new Date("1906-12-09T00:00:00.000Z"),
			image: "/avatars/grace.png",
		});

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.employeeFindFirst).toHaveBeenCalledTimes(1);
		expect(mockState.dbUpdate).toHaveBeenCalledTimes(1);
		expect(mockState.employeeUpdateSet).toHaveBeenCalledWith({
			firstName: "Grace",
			lastName: "Hopper",
			gender: "female",
			birthday: new Date("1906-12-09T00:00:00.000Z"),
		});
		expect(JSON.stringify(mockState.employeeFindFirst.mock.calls[0][0])).toContain("employee.isActive");
		expect(mockState.employeeUpdateWhere).toHaveBeenCalledTimes(1);
	});

	it("rejects a structured-name save when both name fields are blank", async () => {
		const result = await updateProfileDetails({
			firstName: "   ",
			lastName: "   ",
			gender: null,
			birthday: null,
			image: "/avatars/blank.png",
		});

		expect(result).toEqual({
			success: false,
			error: "Enter a first or last name",
			code: "ValidationError",
		});
		expect(mockState.updateUser).not.toHaveBeenCalled();
		expect(mockState.dbUpdate).not.toHaveBeenCalled();
	});

	it("keeps the legacy updateProfile caller working by treating it as image-only", async () => {
		const result = await updateProfile({
			name: "Legacy Display Name",
			image: "/avatars/compat.png",
		});

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.updateUser).toHaveBeenCalledWith({
			body: {
				firstName: "Stored",
				lastName: "User",
				name: "Stored User",
				image: "/avatars/compat.png",
			},
			headers: mockState.headers,
		});
	});

	it("rolls back the auth update if employee sync fails", async () => {
		mockState.employeeFindFirst.mockResolvedValue({ id: "employee-1" });
		mockState.employeeUpdateWhere.mockRejectedValueOnce(new Error("employee sync failed"));

		const result = await updateProfileDetails({
			firstName: "Grace",
			lastName: "Hopper",
			gender: "female",
			birthday: new Date("1906-12-09T00:00:00.000Z"),
			image: "/avatars/grace.png",
		});

		expect(result).toEqual({
			success: false,
			error: "Failed to update profile",
			code: "ValidationError",
		});
		expect(mockState.updateUser).toHaveBeenCalledTimes(2);
		expect(mockState.updateUser).toHaveBeenNthCalledWith(2, {
			body: {
				firstName: "Stored",
				lastName: "User",
				name: "Stored User",
				image: "/avatars/original.png",
			},
			headers: mockState.headers,
		});
	});

	it("rejects non-http avatar URLs", async () => {
		const result = await updateProfileImage({
			image: "javascript:alert(1)",
		});

		expect(result).toEqual({
			success: false,
			error: "Invalid image URL or path",
			code: "ValidationError",
		});
		expect(mockState.updateUser).not.toHaveBeenCalled();
	});
});
