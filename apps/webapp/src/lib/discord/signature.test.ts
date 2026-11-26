import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import { classifyDiscordDmFailure, verifyDiscordSignature } from "./signature";

function createTestEd25519KeyPair() {
	const { publicKey, privateKey } = generateKeyPairSync("ed25519");
	const spkiDer = publicKey.export({ type: "spki", format: "der" });
	// Ed25519 SPKI DER ends with the raw 32-byte public key.
	const rawPublicKeyHex = spkiDer.subarray(spkiDer.length - 32).toString("hex");
	return { rawPublicKeyHex, privateKey };
}

function signDiscordPayload(
	privateKey: ReturnType<typeof generateKeyPairSync>["privateKey"],
	timestamp: string,
	rawBody: string,
): string {
	const signature = sign(null, Buffer.from(`${timestamp}${rawBody}`, "utf8"), privateKey);
	return signature.toString("hex");
}

describe("verifyDiscordSignature", () => {
	it("accepts a valid Ed25519 signature over timestamp + rawBody", async () => {
		const { rawPublicKeyHex, privateKey } = createTestEd25519KeyPair();
		const timestamp = "1732620000";
		const rawBody = JSON.stringify({ type: 1, application_id: "123456789012345678" });
		const signature = signDiscordPayload(privateKey, timestamp, rawBody);

		await expect(
			verifyDiscordSignature(rawPublicKeyHex, signature, timestamp, rawBody),
		).resolves.toBe(true);
	});

	it("rejects tampered body, wrong key, or malformed hex without throwing", async () => {
		const pairA = createTestEd25519KeyPair();
		const pairB = createTestEd25519KeyPair();
		const timestamp = "1732620000";
		const rawBody = JSON.stringify({ type: 1 });
		const signature = signDiscordPayload(pairA.privateKey, timestamp, rawBody);

		await expect(
			verifyDiscordSignature(pairA.rawPublicKeyHex, signature, timestamp, '{"type":2}'),
		).resolves.toBe(false);
		await expect(
			verifyDiscordSignature(pairB.rawPublicKeyHex, signature, timestamp, rawBody),
		).resolves.toBe(false);
		await expect(verifyDiscordSignature("not-hex", signature, timestamp, rawBody)).resolves.toBe(
			false,
		);
		await expect(
			verifyDiscordSignature(pairA.rawPublicKeyHex, "abcd", timestamp, rawBody),
		).resolves.toBe(false);
		await expect(
			verifyDiscordSignature(pairA.rawPublicKeyHex, signature, "", rawBody),
		).resolves.toBe(false);
	});
});

describe("classifyDiscordDmFailure", () => {
	it("explicitly classifies Discord 50007 privacy block with actionable recovery hint", () => {
		const classified = classifyDiscordDmFailure({ kind: "failed", status: 403, code: 50007 });

		expect(classified.code).toBe("discord_dm_blocked_50007");
		expect(classified.isPrivacyOrPrerequisiteBlock).toBe(true);
		expect(classified.recoveryHint).toBe("discord_enable_server_dms");
		expect(classified.message).toMatch(/50007|direct messages|privacy/i);
	});

	it("classifies missing shared server / access (50001) as prerequisite block", () => {
		const classified = classifyDiscordDmFailure({ kind: "failed", status: 403, code: 50001 });

		expect(classified.code).toBe("discord_missing_access");
		expect(classified.isPrivacyOrPrerequisiteBlock).toBe(true);
		expect(classified.recoveryHint).toBe("discord_share_server_with_bot");
	});

	it("classifies unknown user (10013), invalid token (401), rate limit (429), and timeouts", () => {
		expect(classifyDiscordDmFailure({ kind: "failed", status: 404, code: 10013 }).code).toBe(
			"discord_unknown_user",
		);
		expect(classifyDiscordDmFailure({ kind: "failed", status: 401, code: null }).code).toBe(
			"discord_bot_token_invalid",
		);
		expect(classifyDiscordDmFailure({ kind: "failed", status: 429, code: null }).code).toBe(
			"discord_rate_limited",
		);
		expect(classifyDiscordDmFailure({ kind: "unknown", reason: "timeout" }).code).toBe(
			"discord_unavailable",
		);
	});
});
