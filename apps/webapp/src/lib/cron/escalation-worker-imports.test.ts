import { describe, expect, it, vi } from "vitest";

// Workers use plain Node, where server-only throws rather than using the
// no-op alias configured for the webapp's other tests.
vi.mock("server-only", () => {
	throw new Error(
		"This module cannot be imported from a Client Component module. It should only be used from a Server Component.",
	);
});

// Importing a processor must not require a live database connection.
vi.mock("@/db", () => ({ db: {} }));

describe("escalation worker imports", () => {
	// Cold transforms of the command graph compete with the full suite.
	it("loads shared bot exports without server-only decision dependencies", async () => {
		await expect(import("@/lib/bot-platform")).resolves.toHaveProperty(
			"executeCommand",
			expect.any(Function),
		);
	}, 30_000);

	it.each([
		[
			"Slack",
			() => import("@/lib/slack/jobs/escalation-checker"),
			"runSlackEscalationCheckerJob",
		],
		[
			"Discord",
			() => import("@/lib/discord/jobs/escalation-checker"),
			"runDiscordEscalationCheckerJob",
		],
		[
			"Telegram",
			() => import("@/lib/telegram/jobs/escalation-checker"),
			"runTelegramEscalationCheckerJob",
		],
		[
			"Teams",
			() => import("@/lib/teams/jobs/escalation-checker"),
			"runEscalationCheckerJob",
		],
	] as const)(
		"loads the %s processor in a plain Node worker",
		async (_platform, load, exportName) => {
			await expect(load()).resolves.toHaveProperty(
				exportName,
				expect.any(Function),
			);
		},
	);
});
