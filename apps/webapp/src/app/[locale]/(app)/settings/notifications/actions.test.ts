import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => {
	const findFirst = vi.fn(async () => null);
	const query = vi.fn((_name: string, fn: () => Promise<unknown>) => fn());

	return {
		findFirst,
		query,
		session: {
			session: { activeOrganizationId: "org-1" },
			user: { id: "user-1" },
		},
	};
});

vi.mock("drizzle-orm", async () => {
	const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");

	return {
		...actual,
		eq: vi.fn((left: unknown, right: unknown) => ({ eq: [left, right] })),
	};
});

vi.mock("@/db/schema", () => ({
	notificationPreference: {
		channel: "notificationPreference.channel",
		enabled: "notificationPreference.enabled",
		id: "notificationPreference.id",
		notificationType: "notificationPreference.notificationType",
		userId: "notificationPreference.userId",
	},
}));

vi.mock("@/db", () => ({
	db: {},
}));

vi.mock("@/lib/auth", () => ({
	auth: {
		api: {
			getSession: vi.fn(),
		},
	},
}));

vi.mock("next/headers", () => ({
	headers: vi.fn(async () => new Headers()),
}));

vi.mock("@/lib/telegram", () => ({
	isTelegramEnabledForOrganization: vi.fn(async () => false),
}));

vi.mock("@/lib/teams", () => ({
	isTeamsEnabledForOrganization: vi.fn(async () => false),
}));

vi.mock("@/lib/discord", () => ({
	isDiscordEnabledForOrganization: vi.fn(async () => false),
}));

vi.mock("@/lib/slack", () => ({
	isSlackEnabledForOrganization: vi.fn(async () => false),
}));

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
					insert: vi.fn(() => ({ values: vi.fn(async () => undefined) })),
					query: {
						notificationPreference: {
							findFirst: mockState.findFirst,
						},
					},
					select: vi.fn(() => ({
						from: vi.fn(() => ({ where: vi.fn(async () => []) })),
					})),
					update: vi.fn(() => ({
						set: vi.fn(() => ({ where: vi.fn(async () => undefined) })),
					})),
				} as unknown as InstanceType<typeof DatabaseService>["Type"]["db"],
				query: (name: string, fn: () => Promise<unknown>) =>
					Effect.tryPromise({
						try: () => mockState.query(name, fn),
						catch: (error) => error,
					}) as unknown as ReturnType<InstanceType<typeof DatabaseService>["Type"]["query"]>,
			}),
		),
	};
});

vi.mock("@/lib/effect/result", async () => {
	const { Cause, Effect, Exit, Option } = await import("effect");

	const toServerActionResult = (exit: unknown) =>
		Exit.match(exit as never, {
			onFailure: (cause) => {
				const defects = Cause.defects(cause);
				const defect = [...defects][0] ?? null;
				const failure = Option.getOrNull(Cause.failureOption(cause));
				const error = defect ?? failure ?? cause;

				if (error && typeof error === "object" && "_tag" in error) {
					return {
						code: (error as unknown as { _tag: string })._tag,
						error: (error as unknown as { message: string }).message,
						success: false as const,
					};
				}

				return {
					code: "UNKNOWN_ERROR",
					error: error instanceof Error ? error.message : "An unexpected error occurred",
					success: false as const,
				};
			},
			onSuccess: (data) => ({ data, success: true as const }),
		});

	return {
		runServerActionSafe: async <T>(effect: unknown) => {
			const exit = await Effect.runPromiseExit(effect as never);
			return toServerActionResult<T>(exit);
		},
		toServerActionResult,
	};
});

const { isTelegramEnabledForOrganization } = await import("@/lib/telegram");
const { isTeamsEnabledForOrganization } = await import("@/lib/teams");
const { isDiscordEnabledForOrganization } = await import("@/lib/discord");
const { isSlackEnabledForOrganization } = await import("@/lib/slack");
const { getNotificationPreferences, updateNotificationPreference } = await import("./actions");

describe("notification settings actions", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.findFirst.mockResolvedValue(null);
	});

	it("keeps baseline channels available when no organization channels are configured", async () => {
		vi.mocked(isTelegramEnabledForOrganization).mockResolvedValue(false);
		vi.mocked(isTeamsEnabledForOrganization).mockResolvedValue(false);
		vi.mocked(isDiscordEnabledForOrganization).mockResolvedValue(false);
		vi.mocked(isSlackEnabledForOrganization).mockResolvedValue(false);

		const result = await getNotificationPreferences();

		expect(result).toMatchObject({
			success: true,
			data: {
				availableChannels: {
					in_app: true,
					push: true,
					email: true,
					teams: false,
					telegram: false,
					discord: false,
					slack: false,
				},
			},
		});
	});

	it("marks configured organization channels as available", async () => {
		vi.mocked(isTelegramEnabledForOrganization).mockResolvedValue(true);
		vi.mocked(isTeamsEnabledForOrganization).mockResolvedValue(true);
		vi.mocked(isDiscordEnabledForOrganization).mockResolvedValue(true);
		vi.mocked(isSlackEnabledForOrganization).mockResolvedValue(true);

		const result = await getNotificationPreferences();

		expect(result).toMatchObject({
			success: true,
			data: {
				availableChannels: {
					in_app: true,
					push: true,
					email: true,
					teams: true,
					telegram: true,
					discord: true,
					slack: true,
				},
			},
		});
	});

	it("rejects updates when enabled is not boolean", async () => {
		const result = await updateNotificationPreference({
			channel: "email",
			enabled: "false",
			notificationType: "approval_request_submitted",
		} as never);

		expect(result).toMatchObject({
			code: "ValidationError",
			error: "Invalid enabled value",
			success: false,
		});
		expect(mockState.query).not.toHaveBeenCalledWith(
			"updateNotificationPreference",
			expect.any(Function),
		);
	});
});
