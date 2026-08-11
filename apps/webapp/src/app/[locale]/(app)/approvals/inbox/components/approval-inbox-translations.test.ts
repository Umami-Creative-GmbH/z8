import { describe, expect, it } from "vitest";
import { ALL_LANGUAGES, loadNamespaces, TolgeeBase } from "@/tolgee/shared";

describe("approval inbox translations", () => {
	it("formats the details label with the request title in every locale", async () => {
		for (const locale of ALL_LANGUAGES) {
			const staticData = await loadNamespaces(locale, ["approvals"]);
			const tolgee = TolgeeBase().init({ language: locale, staticData });
			await tolgee.run();

			try {
				expect(
					tolgee.t(
						"approvals:approvals.openDetailsFor",
						"Open details for Vacation request",
						{
							title: "Vacation request",
						},
					),
					locale,
				).toContain("Vacation request");
			} finally {
				tolgee.stop();
			}

			expect(tolgee.isRunning()).toBe(false);
		}
	});
});
