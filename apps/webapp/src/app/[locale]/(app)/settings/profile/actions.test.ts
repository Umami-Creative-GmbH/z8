import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const employeeFindFirst = vi.fn();
	const employeeUpdateWhere = vi.fn();
	const employeeUpdateSet = vi.fn(() => ({ where: employeeUpdateWhere }));
	const userSettingsOnConflictDoUpdate = vi.fn();
	const userSettingsValues = vi.fn(() => ({ onConflictDoUpdate: userSettingsOnConflictDoUpdate }));
	const dbInsert = vi.fn(() => ({ values: userSettingsValues }));
	const transactionClient = { insert: dbInsert };
	const dbTransaction = vi.fn(
		async (callback: (tx: typeof transactionClient) => Promise<unknown>) =>
			callback(transactionClient),
	);

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
		dbInsert,
		dbTransaction,
		transactionClient,
		employeeUpdateSet,
		employeeUpdateWhere,
		userSettingsValues,
		userSettingsOnConflictDoUpdate,
		writeUserSettings: vi.fn(),
		changeUserTimezone: vi.fn(),
		processWorkBalanceRebuildIntents: vi.fn(),
		loggerWarn: vi.fn(),
		loggerError: vi.fn(),
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

vi.mock("@/lib/user-preferences/user-settings-mutation", () => ({
	writeUserSettings: mockState.writeUserSettings,
}));

vi.mock("@/lib/timezone/user-timezone-change", () => ({
	changeUserTimezone: mockState.changeUserTimezone,
}));

vi.mock("@/lib/work-balance/rebuild-intents", () => ({
	processWorkBalanceRebuildIntents: mockState.processWorkBalanceRebuildIntents,
	failureMessage: (error: unknown) => (error instanceof Error ? error.message : String(error)),
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => ({
		warn: mockState.loggerWarn,
		error: mockState.loggerError,
		info: vi.fn(),
		debug: vi.fn(),
	}),
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
			gender: "employee.gender",
			pronouns: "employee.pronouns",
			birthday: "employee.birthday",
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
			insert: mockState.dbInsert,
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
					insert: mockState.dbInsert,
					transaction: mockState.dbTransaction,
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

	const toServerActionResult = <_T>(exit: unknown) =>
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
		runServerActionSafe: async <_T>(effect: unknown) => {
			const exit = await Effect.runPromiseExit(effect as never);
			return toServerActionResult(exit);
		},
		toServerActionResult,
	};
});

const {
	updateProfile,
	updateProfileDetails,
	updateProfileImage,
	updateTimeFormat,
	updateTimezone,
	updateWeekStartDay,
} = await import("./actions");

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
		mockState.userSettingsOnConflictDoUpdate.mockResolvedValue(undefined);
		mockState.writeUserSettings.mockResolvedValue(undefined);
		mockState.changeUserTimezone.mockResolvedValue({
			status: "changed",
			rebuildOrganizationIds: [],
		});
		mockState.processWorkBalanceRebuildIntents.mockResolvedValue({
			organizationsRebuilt: 1,
			failures: [],
		});
		mockState.dbTransaction.mockClear();
	});

	describe("updateTimezone", () => {
		it("delegates the change to the protected user timezone writer", async () => {
			await expect(updateTimezone("America/New_York")).resolves.toEqual({
				success: true,
				data: undefined,
			});
			expect(mockState.changeUserTimezone).toHaveBeenCalledWith({
				userId: "user-1",
				timezone: "America/New_York",
			});
			expect(mockState.processWorkBalanceRebuildIntents).not.toHaveBeenCalled();
		});

		it("runs each adopted organization's rebuild only after the change committed", async () => {
			mockState.changeUserTimezone.mockResolvedValue({
				status: "changed",
				rebuildOrganizationIds: ["org-a", "org-b"],
			});

			await expect(updateTimezone("America/New_York")).resolves.toMatchObject({ success: true });

			expect(mockState.processWorkBalanceRebuildIntents.mock.calls).toEqual([
				[{ organizationId: "org-a" }],
				[{ organizationId: "org-b" }],
			]);
			expect(mockState.changeUserTimezone.mock.invocationCallOrder[0]).toBeLessThan(
				mockState.processWorkBalanceRebuildIntents.mock.invocationCallOrder[0] ?? 0,
			);
		});

		it("keeps a committed change saved when its rebuild fails or throws", async () => {
			mockState.changeUserTimezone.mockResolvedValue({
				status: "changed",
				rebuildOrganizationIds: ["org-a", "org-b"],
			});
			mockState.processWorkBalanceRebuildIntents
				.mockResolvedValueOnce({
					organizationsRebuilt: 0,
					failures: [{ organizationId: "org-a", error: "deadlock detected" }],
				})
				.mockRejectedValueOnce(new Error("connection terminated"));

			await expect(updateTimezone("America/New_York")).resolves.toEqual({
				success: true,
				data: undefined,
			});
			// The second organization still ran after the first failed.
			expect(mockState.processWorkBalanceRebuildIntents).toHaveBeenCalledTimes(2);
			expect(mockState.loggerWarn).toHaveBeenCalledTimes(2);
		});

		it("creates no rebuild work when the zone is unchanged", async () => {
			mockState.changeUserTimezone.mockResolvedValue({ status: "unchanged" });

			await expect(updateTimezone("Europe/Berlin")).resolves.toMatchObject({ success: true });
			expect(mockState.processWorkBalanceRebuildIntents).not.toHaveBeenCalled();
		});

		it("reports a rolled-back change without the database message", async () => {
			mockState.changeUserTimezone.mockRejectedValue(
				new Error('insert into "work_balance_rebuild_intent" failed: injected'),
			);

			const result = await updateTimezone("America/New_York");

			expect(result).toMatchObject({
				success: false,
				code: "ValidationError",
				error: "Failed to update timezone",
			});
			expect(mockState.processWorkBalanceRebuildIntents).not.toHaveBeenCalled();
		});

		it("rejects an invalid zone before the writer", async () => {
			await expect(updateTimezone("Mars/Olympus_Mons")).resolves.toMatchObject({
				success: false,
				code: "ValidationError",
			});
			expect(mockState.changeUserTimezone).not.toHaveBeenCalled();
		});
	});

	it("saves week start and time format through the protected settings writer", async () => {
		await expect(updateWeekStartDay("monday")).resolves.toMatchObject({ success: true });
		await expect(updateTimeFormat("12h")).resolves.toMatchObject({ success: true });

		expect(mockState.writeUserSettings.mock.calls).toEqual([
			[expect.anything(), "user-1", { weekStartDay: "monday" }],
			[expect.anything(), "user-1", { timeFormat: "12h" }],
		]);
		expect(mockState.dbInsert).not.toHaveBeenCalled();
	});

	it("derives the Better Auth name from structured profile details", async () => {
		const result = await updateProfileDetails({
			firstName: "  Ada ",
			lastName: " Lovelace  ",
			gender: "female",
			pronouns: "she/her",
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

	it("persists the product improvement preference with profile details", async () => {
		const result = await updateProfileDetails({
			firstName: "Ada",
			lastName: "Lovelace",
			gender: "female",
			pronouns: "she/her",
			birthday: new Date("1815-12-10T00:00:00.000Z"),
			image: "/avatars/ada.png",
			helpImproveProduct: false,
		});

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.writeUserSettings).toHaveBeenCalledWith(expect.anything(), "user-1", {
			helpImproveProduct: false,
		});
		expect(mockState.dbInsert).not.toHaveBeenCalled();
	});

	it("preserves the product improvement preference when omitted", async () => {
		const result = await updateProfileDetails({
			firstName: "Ada",
			lastName: "Lovelace",
			gender: "female",
			pronouns: "she/her",
			birthday: new Date("1815-12-10T00:00:00.000Z"),
			image: "/avatars/ada.png",
		});

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.writeUserSettings).not.toHaveBeenCalled();
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
			pronouns: "she/her",
			birthday: new Date("1906-12-09T00:00:00.000Z"),
			image: "/avatars/grace.png",
		});

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.employeeFindFirst).toHaveBeenCalledTimes(1);
		expect(mockState.dbUpdate).toHaveBeenCalledTimes(1);
		expect(mockState.employeeUpdateSet).toHaveBeenCalledWith({
			gender: "female",
			pronouns: "she/her",
			birthday: new Date("1906-12-09T00:00:00.000Z"),
		});
		expect(JSON.stringify(mockState.employeeFindFirst.mock.calls[0][0])).toContain(
			"employee.isActive",
		);
		expect(mockState.employeeUpdateWhere).toHaveBeenCalledTimes(1);
	});

	it("persists birthday date strings as the selected calendar day in UTC", async () => {
		mockState.employeeFindFirst.mockResolvedValue({
			id: "employee-1",
		});

		const result = await updateProfileDetails({
			firstName: "Grace",
			lastName: "Hopper",
			gender: "female",
			pronouns: "she/her",
			birthday: "1906-12-09" as unknown as Date,
			image: "/avatars/grace.png",
		});

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.employeeUpdateSet).toHaveBeenCalledWith({
			gender: "female",
			pronouns: "she/her",
			birthday: new Date("1906-12-09T00:00:00.000Z"),
		});
	});

	it("rejects a structured-name save when both name fields are blank", async () => {
		const result = await updateProfileDetails({
			firstName: "   ",
			lastName: "   ",
			gender: null,
			pronouns: null,
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

	it("rejects profile pronouns longer than 50 characters", async () => {
		const result = await updateProfileDetails({
			firstName: "Ada",
			lastName: "Lovelace",
			gender: null,
			pronouns: "a".repeat(51),
			birthday: null,
			image: null,
		});

		expect(result).toEqual({
			success: false,
			error: "Pronouns must be 50 characters or less",
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
			pronouns: "she/her",
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

	it.each([
		"",
		" Europe/Berlin",
		"Europe/Berlin ",
		"+05:45",
		"Not/A_Zone",
	])("rejects invalid timezone %j before the timezone writer", async (timezone) => {
		const result = await updateTimezone(timezone);

		expect(result).toEqual({
			success: false,
			error: timezone === "" ? "Timezone is required" : "Timezone must be a valid timezone",
			code: "ValidationError",
		});
		expect(mockState.changeUserTimezone).not.toHaveBeenCalled();
	});

	it.each([
		"UTC",
		"Europe/Berlin",
		"America/New_York",
	])("saves valid timezone %s", async (timezone) => {
		const result = await updateTimezone(timezone);

		expect(result).toEqual({ success: true, data: undefined });
		expect(mockState.changeUserTimezone).toHaveBeenCalledWith({ userId: "user-1", timezone });
	});
});
