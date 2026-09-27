import { createHash, randomUUID } from "node:crypto";
import type { OperationIdentity } from "@/lib/time-tracking/clocking/types";
import type { BotCommandContext } from "./types";

const NAMESPACE = "z8:bot-clock-operation:v1";

/** A canonical version-5-shaped UUID from a SHA-1 digest of the name. */
function uuidFromName(name: string): string {
	const bytes = createHash("sha1").update(name).digest().subarray(0, 16);
	bytes[6] = ((bytes[6] as number) & 0x0f) | 0x50;
	bytes[8] = ((bytes[8] as number) & 0x3f) | 0x80;
	const hex = bytes.toString("hex");
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

/**
 * The operation identity of one bot clock command. Where the platform names the
 * invocation, the identity derives from it, so a redelivery replays the committed
 * result; otherwise it is a server identity, and a repeat is a fresh command.
 * The derived identity becomes the entry and receipt ID, so it is a canonical UUID.
 */
export function botOperationIdentity(
	ctx: Pick<BotCommandContext, "platform" | "organizationId" | "invocationId">,
	command: "clockin" | "clockout",
): OperationIdentity {
	if (!ctx.invocationId) return { origin: "server", id: randomUUID() };
	return {
		origin: "derived",
		id: uuidFromName(
			[NAMESPACE, ctx.platform, ctx.organizationId, command, ctx.invocationId].join("\0"),
		),
	};
}
