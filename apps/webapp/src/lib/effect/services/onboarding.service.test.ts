import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { ValidationError } from "../errors";
import { AuthService } from "./auth.service";
import { DatabaseService } from "./database.service";
import { OnboardingService, OnboardingServiceLive } from "./onboarding.service";

vi.mock("next/headers", () => ({
	headers: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
	auth: { api: { getSession: vi.fn() } },
}));

describe("OnboardingService.updateProfile", () => {
	it("persists the selected week start day in user settings", async () => {
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
				});
			}).pipe(Effect.provide(layer)),
		);

		expect(insertedValues).toHaveBeenCalledWith(
			expect.objectContaining({ weekStartDay: "monday" }),
		);
		expect(conflictUpdate).toHaveBeenCalledWith(
			expect.objectContaining({
				set: expect.objectContaining({ weekStartDay: "monday" }),
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
});
