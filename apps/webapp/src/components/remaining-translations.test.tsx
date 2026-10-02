/* @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { act, render, screen } from "@testing-library/react";
import { FormatIcu } from "@tolgee/format-icu";
import { Tolgee, TolgeeProvider } from "@tolgee/react";
import { describe, expect, it, vi } from "vitest";
import { createTestTolgee } from "@/test/render-with-translations";
import extractor from "../../tolgee-extractor.mjs";
import { PublishComplianceDialog } from "./scheduling/scheduler/publish-compliance-dialog";
import { TimezoneMismatchDialog } from "./time-tracking/timezone-mismatch-dialog";
import { LoadingRegion } from "./ui/loading-region";

describe("remaining UI translations", () => {
	it("updates an accessible loading label when the language changes", async () => {
		const tolgee = Tolgee()
			.use(FormatIcu())
			.init({
				language: "en",
				staticData: {
					en: { "common.loadingRegions.dashboard": "Loading dashboard" },
					de: { "common.loadingRegions.dashboard": "Dashboard wird geladen" },
				},
			});
		render(
			<TolgeeProvider tolgee={tolgee}>
				<LoadingRegion
					role="status"
					aria-busy="true"
					label={{
						labelKey: "common.loadingRegions.dashboard",
						labelDefault: "Loading dashboard",
					}}
				/>
			</TolgeeProvider>,
		);
		expect(
			screen.getByRole("status", { name: "Loading dashboard" }),
		).toBeTruthy();
		await act(() => tolgee.changeLanguage("de"));
		expect(
			screen.getByRole("status", { name: "Dashboard wird geladen" }),
		).toBeTruthy();
	});

	it("lets translators reorder the saved and device timezone parameters", () => {
		const tolgee = createTestTolgee("de", {
			"timeTracking.timezoneMismatch.description":
				"Gespeichert: {savedTimezone}; Gerät: {browserTimezone}.",
		});
		render(
			<TolgeeProvider tolgee={tolgee}>
				<TimezoneMismatchDialog
					open
					savedTimezone="Europe/Berlin"
					browserTimezone="America/New_York"
					onCancel={vi.fn()}
					onContinueOnce={vi.fn()}
					onUpdateAndContinue={vi.fn()}
				/>
			</TolgeeProvider>,
		);
		expect(
			screen.getByText("Gespeichert: Europe/Berlin; Gerät: America/New_York."),
		).toBeTruthy();
	});

	it.each([1, 3])("uses ICU plurals for %i compliance findings", (count) => {
		render(
			<TolgeeProvider tolgee={createTestTolgee()}>
				<PublishComplianceDialog
					open
					onOpenChange={vi.fn()}
					onConfirm={vi.fn()}
					isConfirming={false}
					summary={{
						totalFindings: count,
						byType: { restTime: count, maxHours: 0, overtime: 0 },
					}}
				/>
			</TolgeeProvider>,
		);
		expect(
			screen.getByText(`${count} total finding${count === 1 ? "" : "s"}`),
		).toBeTruthy();
	});

	it("extracts streaming fallback keys and defaults into the common namespace", () => {
		const file = "src/app/[locale]/(app)/settings/vacation/page.tsx";
		const source = readFileSync(file, "utf8");
		expect(extractor(source, file).keys).toContainEqual(
			expect.objectContaining({
				keyName: "common.loadingRegions.vacationSettings",
				defaultValue: "Loading vacation settings",
				namespace: "common",
			}),
		);
	});
});
