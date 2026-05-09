import { Effect, Layer } from "effect";
import { headers } from "next/headers";
import { describe, expect, it, vi } from "vitest";
import { auth } from "@/lib/auth";
import { ValidationError } from "../errors";
import { AuthService } from "./auth.service";
import { DatabaseService } from "./database.service";
import { OnboardingService, OnboardingServiceLive } from "./onboarding.service";

vi.mock("next/headers", () => ({
	headers: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: vi.fn(), updateUser: vi.fn() } },
}));

describe("OnboardingService.updateProfile", () => {
	it("updates Better Auth structured names and keeps employee updates to employee-owned fields", async () => {
		const employeeSet = vi.fn();
		const mockHeaders = new Headers();
		vi.mocked(headers).mockResolvedValue(mockHeaders);
		vi.mocked(auth.api.updateUser).mockResolvedValue({} as never);

		const mockDb = {
			query: {
				employee: {
					findFirst: vi.fn(async () => ({ id: "emp-1" })),
				},
				member: {
					findFirst: vi.fn(async () => ({ role: "member" })),
				},
			},
			update: vi.fn(() => ({
				set: (values: unknown) => {
					employeeSet(values);

					return { where: vi.fn(async () => undefined) };
				},
			})),
			insert: vi.fn(() => ({
				values: () => ({ onConflictDoUpdate: vi.fn(async () => undefined) }),
			})),
		};

		const authLayer = Layer.succeed(
			AuthService,
			AuthService.of({
				getSession: () =>
					Effect.succeed({
						user: { id: "user-1", name: "Existing Name" },
						session: { activeOrganizationId: "org-1" },
					} as never),
			}),
		);
		const dbLayer = Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: mockDb as never,
				query: (_name, query) => Effect.promise(query) as never,
			}),
		);
		const layer = OnboardingServiceLive.pipe(Layer.provide(authLayer), Layer.provide(dbLayer));

		await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* OnboardingService;

				return yield* service.updateProfile({
					firstName: " Ada ",
					lastName: " Lovelace ",
					gender: "female",
					birthday: "1815-12-10",
					weekStartDay: "monday",
					timeFormat: "12h",
				});
			}).pipe(Effect.provide(layer)),
		);

		expect(auth.api.updateUser).toHaveBeenCalledWith({
			body: { firstName: "Ada", lastName: "Lovelace", name: "Ada Lovelace" },
			headers: mockHeaders,
		});
		expect(employeeSet).toHaveBeenCalledWith({
			gender: "female",
			birthday: "1815-12-10",
		});
		expect(employeeSet).toHaveBeenCalledWith(
			expect.not.objectContaining({ firstName: expect.anything() }),
		);
		expect(employeeSet).toHaveBeenCalledWith(
			expect.not.objectContaining({ lastName: expect.anything() }),
		);
	});

	it("creates an active organization employee instead of updating a fallback employee", async () => {
		const insertedValues = vi.fn();
		const employeeSet = vi.fn();
		vi.mocked(headers).mockResolvedValue(new Headers());
		vi.mocked(auth.api.updateUser).mockResolvedValue({} as never);
		const findEmployee = vi
			.fn()
			.mockResolvedValueOnce(null)
			.mockResolvedValueOnce({ id: "emp-fallback", organizationId: "org-other" });

		const mockDb = {
			query: {
				employee: {
					findFirst: findEmployee,
				},
				member: {
					findFirst: vi.fn(async () => ({ role: "member" })),
				},
			},
			update: vi.fn(() => ({
				set: (values: unknown) => {
					employeeSet(values);

					return { where: vi.fn(async () => undefined) };
				},
			})),
			insert: vi.fn(() => ({
				values: (values: unknown) => {
					insertedValues(values);

					return { onConflictDoUpdate: vi.fn(async () => undefined) };
				},
			})),
		};

		const authLayer = Layer.succeed(
			AuthService,
			AuthService.of({
				getSession: () =>
					Effect.succeed({
						user: { id: "user-1", name: "Existing Name" },
						session: { activeOrganizationId: "org-active" },
					} as never),
			}),
		);
		const dbLayer = Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: mockDb as never,
				query: (_name, query) => Effect.promise(query) as never,
			}),
		);
		const layer = OnboardingServiceLive.pipe(Layer.provide(authLayer), Layer.provide(dbLayer));

		await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* OnboardingService;

				return yield* service.updateProfile({
					firstName: "Ada",
					lastName: "Lovelace",
					gender: "female",
					birthday: "1815-12-10",
					weekStartDay: "monday",
					timeFormat: "12h",
				});
			}).pipe(Effect.provide(layer)),
		);

		expect(insertedValues).toHaveBeenCalledWith({
			userId: "user-1",
			organizationId: "org-active",
			gender: "female",
			birthday: "1815-12-10",
		});
		expect(insertedValues).toHaveBeenCalledWith(
			expect.not.objectContaining({ firstName: expect.anything() }),
		);
		expect(insertedValues).toHaveBeenCalledWith(
			expect.not.objectContaining({ lastName: expect.anything() }),
		);
		expect(employeeSet).not.toHaveBeenCalled();
	});

	it("persists selected profile preferences in user settings", async () => {
		const insertedValues = vi.fn();
		const conflictUpdate = vi.fn();
		const mockDb = {
			query: {
				employee: {
					findFirst: vi.fn(async () => null),
				},
			},
			insert: vi.fn(() => ({
				values: (values: unknown) => {
					insertedValues(values);

					return {
						onConflictDoUpdate: async (config: unknown) => {
							conflictUpdate(config);
						},
					};
				},
			})),
		};

		const authLayer = Layer.succeed(
			AuthService,
			AuthService.of({
				getSession: () =>
					Effect.succeed({
						user: { id: "user-1" },
						session: { activeOrganizationId: null },
					} as never),
			}),
		);
		const dbLayer = Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: mockDb as never,
				query: (_name, query) => Effect.promise(query) as never,
			}),
		);
		const layer = OnboardingServiceLive.pipe(Layer.provide(authLayer), Layer.provide(dbLayer));

		await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* OnboardingService;

				return yield* service.updateProfile({
					firstName: "Ada",
					lastName: "Lovelace",
					weekStartDay: "monday",
					timeFormat: "12h",
				});
			}).pipe(Effect.provide(layer)),
		);

		expect(insertedValues).toHaveBeenCalledWith(
			expect.objectContaining({ weekStartDay: "monday", timeFormat: "12h" }),
		);
		expect(conflictUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				set: expect.objectContaining({ weekStartDay: "monday", timeFormat: "12h" }),
			}),
		);
	});

	it("rejects invalid week start day values before writing", async () => {
		const mockDb = {
			query: {
				employee: {
					findFirst: vi.fn(async () => null),
				},
			},
			insert: vi.fn(),
		};

		const authLayer = Layer.succeed(
			AuthService,
			AuthService.of({
				getSession: () =>
					Effect.succeed({
						user: { id: "user-1" },
						session: { activeOrganizationId: null },
					} as never),
			}),
		);
		const dbLayer = Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: mockDb as never,
				query: (_name, query) => Effect.promise(query) as never,
			}),
		);
		const layer = OnboardingServiceLive.pipe(Layer.provide(authLayer), Layer.provide(dbLayer));

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* OnboardingService;

					return yield* service.updateProfile({
						firstName: "Ada",
						lastName: "Lovelace",
						weekStartDay: "friday",
					} as never);
				}).pipe(Effect.provide(layer)),
			),
		);

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.any(ValidationError),
		});
		expect(result).toMatchObject({
			left: {
				message: "Week start day must be Sunday or Monday",
				field: "weekStartDay",
			},
		});
		expect(mockDb.insert).not.toHaveBeenCalled();
	});

	it("rejects invalid time format values before writing", async () => {
		const mockDb = {
			query: {
				employee: {
					findFirst: vi.fn(async () => null),
				},
			},
			insert: vi.fn(),
		};

		const authLayer = Layer.succeed(
			AuthService,
			AuthService.of({
				getSession: () =>
					Effect.succeed({
						user: { id: "user-1" },
						session: { activeOrganizationId: null },
					} as never),
			}),
		);
		const dbLayer = Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: mockDb as never,
				query: (_name, query) => Effect.promise(query) as never,
			}),
		);
		const layer = OnboardingServiceLive.pipe(Layer.provide(authLayer), Layer.provide(dbLayer));

		const result = await Effect.runPromise(
			Effect.either(
				Effect.gen(function* () {
					const service = yield* OnboardingService;

					return yield* service.updateProfile({
						firstName: "Ada",
						lastName: "Lovelace",
						weekStartDay: "sunday",
						timeFormat: "locale",
					} as never);
				}).pipe(Effect.provide(layer)),
			),
		);

		expect(result).toMatchObject({
			_tag: "Left",
			left: expect.any(ValidationError),
		});
		expect(result).toMatchObject({
			left: {
				message: "Time format must be 12h or 24h",
				field: "timeFormat",
			},
		});
		expect(mockDb.insert).not.toHaveBeenCalled();
	});
});

describe("OnboardingService.getOnboardingSummary", () => {
	it("marks profile complete from Better Auth structured names instead of employee names", async () => {
		const mockDb = {
			query: {
				user: {
					findFirst: vi.fn(async () => ({ invitedVia: null })),
				},
				member: {
					findFirst: vi.fn(async () => null),
				},
				employee: {
					findFirst: vi.fn(async () => null),
				},
				notificationPreference: {
					findFirst: vi.fn(async () => null),
				},
				userSettings: {
					findFirst: vi.fn(async () => null),
				},
			},
		};

		const authLayer = Layer.succeed(
			AuthService,
			AuthService.of({
				getSession: () =>
					Effect.succeed({
						user: {
							id: "user-1",
							firstName: "Ada",
							lastName: "Lovelace",
						},
						session: { activeOrganizationId: null },
					} as never),
			}),
		);
		const dbLayer = Layer.succeed(
			DatabaseService,
			DatabaseService.of({
				db: mockDb as never,
				query: (_name, query) => Effect.promise(query) as never,
			}),
		);
		const layer = OnboardingServiceLive.pipe(Layer.provide(authLayer), Layer.provide(dbLayer));

		const summary = await Effect.runPromise(
			Effect.gen(function* () {
				const service = yield* OnboardingService;

				return yield* service.getOnboardingSummary();
			}).pipe(Effect.provide(layer)),
		);

		expect(summary.profileCompleted).toBe(true);
	});
});
