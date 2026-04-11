import { beforeEach, describe, expect, it, vi } from "vitest";

const mockState = vi.hoisted(() => ({
	insertValues: vi.fn(),
	updateSet: vi.fn(),
	updateWhere: vi.fn(),
	updateReturning: vi.fn(),
	findFirst: vi.fn(),
}));

vi.mock("@/db", () => ({
	db: {
		insert: vi.fn(() => ({ values: mockState.insertValues })),
		update: vi.fn(() => ({ set: mockState.updateSet })),
		query: {
			appAuthCode: {
				findFirst: mockState.findFirst,
			},
		},
	},
	appAuthCode: {
		app: "app",
		code: "code",
		expiresAt: "expiresAt",
		id: "id",
		status: "status",
	},
}));

import { consumeAppAuthCode, createAppAuthCode } from "./app-auth-code";

describe("app auth code service", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockState.updateSet.mockReturnValue({ where: mockState.updateWhere });
		mockState.updateWhere.mockReturnValue({ returning: mockState.updateReturning });
	});

	it("creates a single-use mobile auth code with expiry metadata", async () => {
		mockState.insertValues.mockResolvedValue(undefined);

		const result = await createAppAuthCode({
			app: "mobile",
			sessionToken: "session-token",
			userId: "user-1",
		});

		expect(result.code).toMatch(/^[A-Z0-9]{32}$/);
		expect(result.expiresAt).toBeInstanceOf(Date);
		expect(mockState.insertValues).toHaveBeenCalledWith(
			expect.objectContaining({
				app: "mobile",
				sessionToken: "session-token",
				userId: "user-1",
				status: "pending",
			}),
		);
	});

	it("consumes a pending code once and returns its session token", async () => {
		mockState.findFirst.mockResolvedValue({
			id: "code-1",
			app: "mobile",
			sessionToken: "session-token",
			status: "pending",
			expiresAt: new Date(Date.now() + 60_000),
		});
		mockState.updateReturning.mockResolvedValue([{ id: "code-1" }]);

		await expect(consumeAppAuthCode({ app: "mobile", code: "ABCD" })).resolves.toEqual({
			sessionToken: "session-token",
			status: "success",
		});

		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ status: "used" }),
		);
	});

	it("rejects missing codes", async () => {
		mockState.findFirst.mockResolvedValue(undefined);

		await expect(consumeAppAuthCode({ app: "mobile", code: "MISSING" })).resolves.toEqual({
			status: "invalid_code",
		});
	});

	it("rejects non-pending codes", async () => {
		mockState.findFirst.mockResolvedValue({
			id: "code-used",
			app: "mobile",
			sessionToken: "session-token",
			status: "used",
			expiresAt: new Date(Date.now() + 60_000),
		});

		await expect(consumeAppAuthCode({ app: "mobile", code: "USED" })).resolves.toEqual({
			status: "invalid_code",
		});
	});

	it("rejects codes when the requested app does not match the stored app lookup", async () => {
		mockState.findFirst.mockResolvedValue(undefined);

		await expect(consumeAppAuthCode({ app: "mobile", code: "DESKTOP-CODE" })).resolves.toEqual({
			status: "invalid_code",
		});
	});

	it("rejects mismatched-app records through the guarded consume path", async () => {
		mockState.findFirst.mockResolvedValue({
			id: "code-desktop",
			app: "desktop",
			sessionToken: "session-token",
			status: "pending",
			expiresAt: new Date(Date.now() + 60_000),
		});
		mockState.updateReturning.mockResolvedValueOnce([]).mockResolvedValueOnce([]);

		await expect(consumeAppAuthCode({ app: "mobile", code: "DESKTOP-STORED" })).resolves.toEqual({
			status: "invalid_code",
		});

		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ status: "used" }),
		);
	});

	it("rejects codes when the guarded update affects no rows", async () => {
		mockState.findFirst.mockResolvedValue({
			id: "code-3",
			app: "mobile",
			sessionToken: "session-token",
			status: "pending",
			expiresAt: new Date(Date.now() + 60_000),
		});
		mockState.updateReturning.mockResolvedValue([]);

		await expect(consumeAppAuthCode({ app: "mobile", code: "RACE" })).resolves.toEqual({
			status: "invalid_code",
		});
	});

	it("rejects codes that expire between read and guarded consume update", async () => {
		mockState.findFirst.mockResolvedValue({
			id: "code-4",
			app: "mobile",
			sessionToken: "session-token",
			status: "pending",
			expiresAt: new Date(Date.now() + 60_000),
		});
		mockState.updateReturning.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "code-4" }]);

		await expect(consumeAppAuthCode({ app: "mobile", code: "EDGE" })).resolves.toEqual({
			status: "invalid_code",
		});

		expect(mockState.updateSet).toHaveBeenNthCalledWith(
			1,
			expect.objectContaining({ status: "used" }),
		);
		expect(mockState.updateSet).toHaveBeenNthCalledWith(
			2,
			expect.objectContaining({ status: "expired" }),
		);
	});

	it("rejects expired or mismatched codes", async () => {
		mockState.findFirst.mockResolvedValue({
			id: "code-2",
			app: "desktop",
			sessionToken: "session-token",
			status: "pending",
			expiresAt: new Date(Date.now() - 60_000),
		});
		mockState.updateReturning.mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "code-2" }]);

		await expect(consumeAppAuthCode({ app: "mobile", code: "EXPIRED" })).resolves.toEqual({
			status: "invalid_code",
		});

		expect(mockState.updateSet).toHaveBeenCalledWith(
			expect.objectContaining({ status: "expired" }),
		);
	});

	it("rejects consume requests exactly at expiry", async () => {
		vi.useFakeTimers();
		try {
			const expiresAt = new Date("2026-04-11T20:10:00.000Z");
			vi.setSystemTime(expiresAt);
			mockState.findFirst.mockResolvedValue({
				id: "code-boundary",
				app: "mobile",
				sessionToken: "session-token",
				status: "pending",
				expiresAt,
			});
			mockState.updateReturning
				.mockResolvedValueOnce([])
				.mockResolvedValueOnce([{ id: "code-boundary" }]);

			await expect(consumeAppAuthCode({ app: "mobile", code: "BOUNDARY" })).resolves.toEqual({
				status: "invalid_code",
			});

			expect(mockState.updateSet).toHaveBeenNthCalledWith(
				1,
				expect.objectContaining({ status: "used" }),
			);
			expect(mockState.updateSet).toHaveBeenNthCalledWith(
				2,
				expect.objectContaining({ status: "expired" }),
			);
		} finally {
			vi.useRealTimers();
		}
	});
});
