import { describe, expect, it } from "vitest";
import {
	encodeBoundApprovalCallback,
	parseBoundApprovalCallback,
	telegramInvocationEnvelope,
} from "./bound-approval";

const bindingId = "b2900000-0000-4000-8000-000000000001";

describe("bound approval callback data", () => {
	it("round-trips the binding handle within Telegram's 64-byte limit", () => {
		const approve = encodeBoundApprovalCallback("approve", bindingId);
		const reject = encodeBoundApprovalCallback("reject", bindingId);
		expect(new TextEncoder().encode(approve).length).toBeLessThanOrEqual(64);
		expect(parseBoundApprovalCallback(JSON.parse(approve))).toEqual({
			action: "approve",
			bindingId,
		});
		expect(parseBoundApprovalCallback(JSON.parse(reject))).toEqual({
			action: "reject",
			bindingId,
		});
	});

	it("refuses anything that is not an exact bound action", () => {
		for (const bad of [
			{ a: "ap", id: bindingId },
			{ a: "ba" },
			{ a: "ba", b: "not-a-uuid" },
			{ a: "br", b: bindingId, extra: 1 },
			null,
			"ba",
		]) {
			expect(parseBoundApprovalCallback(bad)).toBeNull();
		}
	});
});

describe("telegram invocation envelope", () => {
	const query = { id: "4382bfdwdsb323b2d9", from: { id: 777 } };

	it("scopes the callback-query ID to the authenticated bot and keeps update_id separate", () => {
		expect(telegramInvocationEnvelope("123456:AAH-secret_part", query, 991)).toEqual({
			scheme: "telegram_callback_query",
			receiverScope: "telegram-bot:123456",
			invocationId: "4382bfdwdsb323b2d9",
			deliveryId: "991",
			providerActorId: "777",
		});
	});

	it("has no identity without a query ID, sender or recognizable bot", () => {
		expect(telegramInvocationEnvelope("123456:AAH", { ...query, id: "" }, 1)).toBeNull();
		expect(telegramInvocationEnvelope("not-a-token", query, 1)).toBeNull();
		expect(
			telegramInvocationEnvelope("123456:AAH", { id: query.id, from: undefined }, 1),
		).toBeNull();
		expect(telegramInvocationEnvelope("123456:AAH", query, undefined)).toMatchObject({
			deliveryId: null,
		});
	});
});
