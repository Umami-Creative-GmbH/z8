import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { loggerMock } = vi.hoisted(() => ({
	loggerMock: {
		error: vi.fn(),
		info: vi.fn(),
	},
}));

vi.mock("@/lib/logger", () => ({
	createLogger: () => loggerMock,
}));

import {
	answerCallbackQuery,
	deleteWebhook,
	editMessageText,
	getMe,
	sendMessage,
	setMyCommands,
	setWebhook,
} from "./api";

const botToken = "123456789:ABCDEF_secret";
const pastedBotToken = `  bot${botToken}  `;

describe("Telegram API response handling", () => {
	beforeEach(() => {
		loggerMock.error.mockReset();
		loggerMock.info.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("preserves a structured Telegram failure from a non-2xx response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						ok: false,
						error_code: 401,
						description: "Unauthorized",
					}),
					{ status: 401 },
				),
			),
		);

		await expect(getMe(botToken)).resolves.toBeNull();
		expect(loggerMock.error).toHaveBeenCalledWith(
			expect.objectContaining({
				httpStatus: 401,
				errorCode: 401,
				description: "Unauthorized",
			}),
			"Telegram API error",
		);
	});

	it("preserves a partial Telegram failure from a non-2xx response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ ok: false, description: "Denied" }), {
					status: 403,
				}),
			),
		);

		await expect(getMe(botToken)).resolves.toBeNull();
		expect(loggerMock.error).toHaveBeenCalledWith(
			expect.objectContaining({
				httpStatus: 403,
				errorCode: undefined,
				description: "Denied",
			}),
			"Telegram API error",
		);
	});

	it("preserves a partial Telegram failure from a 2xx response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ ok: false, error_code: 409 }), {
					status: 200,
				}),
			),
		);

		await expect(getMe(botToken)).resolves.toBeNull();
		expect(loggerMock.error).toHaveBeenCalledWith(
			expect.objectContaining({
				httpStatus: 200,
				errorCode: 409,
				description: "",
			}),
			"Telegram API error",
		);
	});

	it("does not return a message result from a failure envelope", async () => {
		const message = {
			message_id: 7,
			chat: { id: 42, type: "private" },
			date: 1_700_000_000,
		};
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ ok: false, result: message }), {
					status: 200,
				}),
			),
		);

		await expect(
			sendMessage(botToken, { chat_id: 42, text: "Hello" }),
		).resolves.toBeNull();
	});

	it("does not return bot info from a failure envelope", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						ok: false,
						result: { id: 42, first_name: "Failure Bot" },
					}),
					{ status: 200 },
				),
			),
		);

		await expect(getMe(botToken)).resolves.toBeNull();
	});

	it("uses the HTTP fallback for invalid non-2xx failure fields", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ ok: false, error_code: "401" }), {
					status: 401,
				}),
			),
		);

		await expect(getMe(botToken)).resolves.toBeNull();
		expect(loggerMock.error).toHaveBeenCalledWith(
			expect.objectContaining({ errorCode: 401, description: "HTTP 401" }),
			"Telegram API error",
		);
	});

	it("uses the safe response fallback for invalid 2xx failure fields", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ ok: false, description: 123 }), {
					status: 200,
				}),
			),
		);

		await expect(getMe(botToken)).resolves.toBeNull();
		expect(loggerMock.error).toHaveBeenCalledWith(
			expect.objectContaining({
				errorCode: 200,
				description: "Invalid Telegram API response",
			}),
			"Telegram API error",
		);
	});

	it("synthesizes a Telegram failure from a non-JSON non-2xx response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("Bad gateway", { status: 502 })),
		);

		await expect(getMe(botToken)).resolves.toBeNull();
		expect(loggerMock.error).toHaveBeenCalledWith(
			expect.objectContaining({
				httpStatus: 502,
				errorCode: 502,
				description: "HTTP 502",
			}),
			"Telegram API error",
		);
	});

	it("returns the wrapper's safe failure value for a malformed 2xx response", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("not json", { status: 200 })),
		);

		await expect(
			editMessageText(botToken, {
				chat_id: 42,
				message_id: 7,
				text: "Updated",
			}),
		).resolves.toBe(false);
		expect(loggerMock.error).toHaveBeenCalledWith(
			expect.objectContaining({
				httpStatus: 200,
				errorCode: 200,
				description: "Invalid Telegram API response",
			}),
			"Telegram API error",
		);
	});

	it("returns a successful payload and preserves the request method and body", async () => {
		const message = {
			message_id: 7,
			chat: { id: 42, type: "private" as const },
			date: 1_700_000_000,
			text: "Hello",
		};
		const fetchMock = vi.fn().mockResolvedValue(
			new Response(JSON.stringify({ ok: true, result: message }), {
				status: 200,
			}),
		);
		vi.stubGlobal("fetch", fetchMock);

		await expect(
			sendMessage(pastedBotToken, { chat_id: 42, text: "Hello" }),
		).resolves.toEqual(message);
		expect(fetchMock).toHaveBeenCalledWith(
			`https://api.telegram.org/bot${botToken}/sendMessage`,
			{
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ chat_id: 42, text: "Hello" }),
			},
		);
	});

	it("rejects an invalid sendMessage success result", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ ok: true, result: "not a message" }), {
					status: 200,
				}),
			),
		);

		await expect(
			sendMessage(botToken, { chat_id: 42, text: "Hello" }),
		).resolves.toBeNull();
		expect(loggerMock.error).toHaveBeenCalledWith(
			expect.objectContaining({ description: "Invalid Telegram API response" }),
			"Telegram API error",
		);
	});

	it("rejects an invalid getMe success result", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					new Response(
						JSON.stringify({ ok: true, result: { id: "42", first_name: 123 } }),
						{ status: 200 },
					),
				),
		);

		await expect(getMe(botToken)).resolves.toBeNull();
		expect(loggerMock.error).toHaveBeenCalledWith(
			expect.objectContaining({ description: "Invalid Telegram API response" }),
			"Telegram API error",
		);
	});

	it.each([
		{ ok: true },
		{ ok: true, result: "not a boolean" },
		{ ok: true, result: { unrelated: true } },
	])("rejects an invalid boolean success envelope %#", async (payload) => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify(payload), {
					status: 200,
				}),
			),
		);

		await expect(
			editMessageText(botToken, {
				chat_id: 42,
				message_id: 7,
				text: "Updated",
			}),
		).resolves.toBe(false);
		expect(loggerMock.error).toHaveBeenCalledWith(
			expect.objectContaining({ description: "Invalid Telegram API response" }),
			"Telegram API error",
		);
	});

	it.each([
		true,
		{
			message_id: 7,
			chat: { id: 42, type: "private" },
			date: 1_700_000_000,
			text: "Updated",
		},
	])("accepts a valid editMessageText result %#", async (apiResult) => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ ok: true, result: apiResult }), {
					status: 200,
				}),
			),
		);

		await expect(
			editMessageText(botToken, {
				chat_id: 42,
				message_id: 7,
				text: "Updated",
			}),
		).resolves.toBe(true);
		expect(loggerMock.error).not.toHaveBeenCalled();
	});

	it("rejects false as an editMessageText success result", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ ok: true, result: false }), {
					status: 200,
				}),
			),
		);

		await expect(
			editMessageText(botToken, {
				chat_id: 42,
				message_id: 7,
				text: "Updated",
			}),
		).resolves.toBe(false);
		expect(loggerMock.error).toHaveBeenCalledWith(
			expect.objectContaining({ description: "Invalid Telegram API response" }),
			"Telegram API error",
		);
	});

	it.each([
		["answerCallbackQuery", () => answerCallbackQuery(botToken, "callback-1")],
		["setWebhook", () => setWebhook(botToken, "https://example.com/webhook")],
		[
			"setMyCommands",
			() =>
				setMyCommands(botToken, [{ command: "start", description: "Start" }]),
		],
		["deleteWebhook", () => deleteWebhook(botToken)],
	])("rejects false as a %s success result", async (_method, invoke) => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ ok: true, result: false }), {
					status: 200,
				}),
			),
		);

		await expect(invoke()).resolves.toBe(false);
		expect(loggerMock.error).toHaveBeenCalledWith(
			expect.objectContaining({ description: "Invalid Telegram API response" }),
			"Telegram API error",
		);
	});

	it("redacts normalized tokens from logger metadata and messages", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(
					JSON.stringify({
						ok: false,
						error_code: 401,
						description: `Invalid token bot${botToken}`,
					}),
					{ status: 401 },
				),
			),
		);

		await getMe(pastedBotToken);

		const serializedLogs = JSON.stringify(loggerMock.error.mock.calls);
		expect(serializedLogs).not.toContain(botToken);
		expect(serializedLogs).not.toContain(pastedBotToken.trim());
		expect(serializedLogs).toContain("1234***:AB***");
	});

	it("logs a fixed webhook label without token, secret, or credential path", async () => {
		const webhookSecret = "unique-webhook-secret";
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ ok: true, result: true }), {
					status: 200,
				}),
			),
		);

		await expect(
			setWebhook(
				pastedBotToken,
				`https://example.com/credential/${botToken}/${webhookSecret}`,
				webhookSecret,
			),
		).resolves.toBe(true);

		const serializedLogs = JSON.stringify(loggerMock.info.mock.calls);
		expect(serializedLogs).not.toContain(botToken);
		expect(serializedLogs).not.toContain(pastedBotToken.trim());
		expect(serializedLogs).not.toContain(webhookSecret);
		expect(serializedLogs).not.toContain("credential");
		expect(serializedLogs).toContain(
			"https://example.com/api/telegram/webhook/***",
		);
	});

	it("logs a fixed placeholder for an invalid webhook URL", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(
				new Response(JSON.stringify({ ok: true, result: true }), {
					status: 200,
				}),
			),
		);

		await expect(setWebhook(botToken, "not a URL/secret-value")).resolves.toBe(
			true,
		);
		expect(loggerMock.info).toHaveBeenCalledWith(
			{ url: "invalid webhook URL" },
			"Telegram webhook registered",
		);
	});
});
