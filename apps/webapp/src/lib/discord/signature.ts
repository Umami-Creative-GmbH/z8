import type { DiscordCallFailure } from "./delivery-outcome";

const HEX_PUBLIC_KEY_PATTERN = /^[0-9a-fA-F]{64}$/;
const HEX_SIGNATURE_PATTERN = /^[0-9a-fA-F]{128}$/;

function hexToUint8Array(hex: string): Uint8Array {
	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = Number.parseInt(hex.substring(i, i + 2), 16);
	}
	return bytes;
}

/**
 * Verifies a Discord interaction Ed25519 signature (`X-Signature-Ed25519` over
 * `X-Signature-Timestamp + rawBody`) against a 64-character hex public key.
 * Returns `false` for malformed keys, signatures, or empty timestamps without throwing.
 */
export async function verifyDiscordSignature(
	publicKey: string,
	signature: string,
	timestamp: string,
	rawBody: string,
): Promise<boolean> {
	const trimmedKey = publicKey.trim();
	const trimmedSignature = signature.trim();
	const trimmedTimestamp = timestamp.trim();

	if (
		!trimmedTimestamp ||
		!HEX_PUBLIC_KEY_PATTERN.test(trimmedKey) ||
		!HEX_SIGNATURE_PATTERN.test(trimmedSignature)
	) {
		return false;
	}

	try {
		const encoder = new TextEncoder();
		const keyBytes = hexToUint8Array(trimmedKey);
		const cryptoKey = await crypto.subtle.importKey(
			"raw",
			keyBytes.buffer as ArrayBuffer,
			{ name: "Ed25519", namedCurve: "Ed25519" },
			false,
			["verify"],
		);
		const signatureBytes = hexToUint8Array(trimmedSignature);
		const message = encoder.encode(trimmedTimestamp + rawBody);

		return await crypto.subtle.verify(
			"Ed25519",
			cryptoKey,
			signatureBytes.buffer as ArrayBuffer,
			message,
		);
	} catch {
		return false;
	}
}

export type DiscordDmFailureCode =
	| "discord_dm_blocked_50007"
	| "discord_missing_access"
	| "discord_unknown_user"
	| "discord_bot_token_invalid"
	| "discord_rate_limited"
	| "discord_unavailable"
	| "discord_dm_failed";

export type DiscordDmRecoveryHint =
	| "discord_enable_server_dms"
	| "discord_share_server_with_bot"
	| "discord_check_user_id"
	| "discord_check_bot_token"
	| "discord_retry_later";

export interface ClassifiedDiscordDmFailure {
	code: DiscordDmFailureCode;
	recoveryHint: DiscordDmRecoveryHint;
	isPrivacyOrPrerequisiteBlock: boolean;
	message: string;
}

const DISCORD_ERROR_UNKNOWN_USER = 10013;
const DISCORD_ERROR_MISSING_ACCESS = 50001;
const DISCORD_ERROR_CANNOT_SEND_TO_USER = 50007;

/**
 * Classifies a failed Discord private DM open/send call into an actionable code
 * and recovery hint, explicitly surfacing Discord error `50007` (privacy controls
 * blocking DMs or no shared server) and `50001` (missing server access).
 */
export function classifyDiscordDmFailure(failure: DiscordCallFailure): ClassifiedDiscordDmFailure {
	if (failure.kind === "unknown") {
		return {
			code: "discord_unavailable",
			recoveryHint: "discord_retry_later",
			isPrivacyOrPrerequisiteBlock: false,
			message:
				"Discord did not respond in time while verifying direct message delivery. Please try again shortly.",
		};
	}

	if (failure.code === DISCORD_ERROR_CANNOT_SEND_TO_USER) {
		return {
			code: "discord_dm_blocked_50007",
			recoveryHint: "discord_enable_server_dms",
			isPrivacyOrPrerequisiteBlock: true,
			message:
				"Discord blocked this direct message (error 50007). Ensure you share a Discord server with this bot, have not blocked the bot, and enable 'Direct Messages' for that server in Discord Privacy Settings, then retry.",
		};
	}

	if (failure.code === DISCORD_ERROR_MISSING_ACCESS) {
		return {
			code: "discord_missing_access",
			recoveryHint: "discord_share_server_with_bot",
			isPrivacyOrPrerequisiteBlock: true,
			message:
				"The Discord bot cannot open a direct message because it does not share a server with this user (error 50001). Invite the bot to a shared server and allow server direct messages, then retry.",
		};
	}

	if (failure.code === DISCORD_ERROR_UNKNOWN_USER) {
		return {
			code: "discord_unknown_user",
			recoveryHint: "discord_check_user_id",
			isPrivacyOrPrerequisiteBlock: false,
			message:
				"Discord could not find that user ID (error 10013). Verify the numeric Discord user ID (enable Developer Mode in Discord to copy your User ID) and try again.",
		};
	}

	if (failure.status === 401) {
		return {
			code: "discord_bot_token_invalid",
			recoveryHint: "discord_check_bot_token",
			isPrivacyOrPrerequisiteBlock: false,
			message:
				"Discord rejected the bot token while attempting to send a direct message. Verify or rotate your Discord bot token.",
		};
	}

	if (failure.status === 429) {
		return {
			code: "discord_rate_limited",
			recoveryHint: "discord_retry_later",
			isPrivacyOrPrerequisiteBlock: false,
			message: "Discord rate-limited the direct message check. Wait a moment and retry.",
		};
	}

	return {
		code: "discord_dm_failed",
		recoveryHint: "discord_retry_later",
		isPrivacyOrPrerequisiteBlock: false,
		message:
			"Could not deliver the Discord private test message. Confirm the bot shares a server with the recipient and allows direct messages, then retry.",
	};
}
