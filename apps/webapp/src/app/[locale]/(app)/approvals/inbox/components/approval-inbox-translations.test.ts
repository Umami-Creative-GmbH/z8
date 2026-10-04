import { describe, expect, it } from "vitest";
import { ALL_LANGUAGES, loadNamespaces, TolgeeBase } from "@/tolgee/shared";

const interpolationCases: {
	key: string;
	params: Record<string, string | number>;
}[] = [
	{ key: "approvals.openDetailsFor", params: { title: "Vacation request" } },
	{ key: "approvals.selectedCount", params: { selectedCount: 7 } },
	{ key: "approvals.totalCount", params: { totalCount: 11 } },
	...[
		"approveGroup",
		"confirmRejectGroup",
		"expandGroup",
		"rejectGroup",
		"showGroup",
	].map((key) => ({
		key: `fastLanes.${key}`,
		params: { label: "Vacation requests" },
	})),
	{ key: "fastLanes.notEligibleApprove", params: { notApprovableCount: 3 } },
	{ key: "fastLanes.notEligibleReject", params: { notRejectableCount: 5 } },
	{ key: "sprint.age", params: { ageDays: 2 } },
	{ key: "sprint.progress", params: { current: 4, total: 9 } },
];

describe("approval inbox translations", () => {
	it.each(ALL_LANGUAGES)(
		"interpolates the inbox controls in %s",
		async (locale) => {
			const staticData = await loadNamespaces(locale, ["approvals"]);
			const tolgee = TolgeeBase().init({ language: locale, staticData });
			await tolgee.run();

			try {
				for (const { key, params } of interpolationCases) {
					const message = tolgee.t(
						`approvals:${key}`,
						"Missing translation",
						params,
					);
					for (const value of Object.values(params)) {
						expect(message, `${locale}: ${key}`).toContain(String(value));
					}
					expect(message, `${locale}: ${key}`).not.toMatch(/\$|\{[^}]*\}/);
				}
			} finally {
				tolgee.stop();
			}

			expect(tolgee.isRunning()).toBe(false);
		},
	);
});
