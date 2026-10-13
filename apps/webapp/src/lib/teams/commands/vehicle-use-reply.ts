import type { BotTranslateFn } from "@/lib/bot-platform/i18n";
import type { BotCommandContext, BotCommandResponse } from "@/lib/bot-platform/types";
import { createLogger } from "@/lib/logger";

const logger = createLogger("BotCommand:VehicleUse");

/**
 * A committed clock command's reply, with the Teams vehicle use card where the
 * card asks anything (#1125). The clock command never waits for vehicle use: it
 * has committed without it, and the card records it afterwards. Other
 * platforms keep their text reply. The command is committed, so failing to add
 * the card never turns the reply into an error.
 */
export async function withVehicleUsePrompt(
	ctx: BotCommandContext,
	reply: BotCommandResponse,
	target: {
		organizationId: string;
		employeeId: string;
		stage: "clock_in" | "clock_out";
		entryId: string;
	},
	t: BotTranslateFn,
): Promise<BotCommandResponse> {
	if (ctx.platform !== "teams") return reply;
	try {
		// Keep server-only dependencies out of shared bot registry imports.
		const { withTeamsVehicleUsePrompt } = await import("@/lib/teams/vehicle-use-prompt");
		return await withTeamsVehicleUsePrompt(reply, target, t);
	} catch (error) {
		logger.error({ error, stage: target.stage }, "Failed to add the vehicle use card");
		return reply;
	}
}
