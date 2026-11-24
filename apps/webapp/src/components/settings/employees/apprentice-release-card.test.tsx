/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ApprenticeReleaseCreditView } from "@/lib/statutory/apprenticeship/release-credit-view";
import { createTestTolgee } from "@/test/render-with-translations";
import deCatalog from "../../../../messages/settings/generic/de.json";
import enCatalog from "../../../../messages/settings/generic/en.json";

const mocks = vi.hoisted(() => ({
	getApprenticeReleaseCreditsAction: vi.fn(),
	getOwnApprenticeReleaseCreditsAction: vi.fn(),
	recordApprenticeReleaseAction: vi.fn(),
	voidApprenticeReleaseAction: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/app/[locale]/(app)/settings/employees/apprentice-release-actions", () => ({
	getApprenticeReleaseCreditsAction: mocks.getApprenticeReleaseCreditsAction,
	getOwnApprenticeReleaseCreditsAction: mocks.getOwnApprenticeReleaseCreditsAction,
	recordApprenticeReleaseAction: mocks.recordApprenticeReleaseAction,
	voidApprenticeReleaseAction: mocks.voidApprenticeReleaseAction,
}));

const { ApprenticeReleaseCard, apprenticeReleaseRefusals } =
	await import("./apprentice-release-card");

/** `{ a: { b: "x" } }` → `{ "a.b": "x" }`, the keys the card asks for. */
function flatten(value: unknown, prefix = ""): Record<string, string> {
	if (typeof value === "string") return { [prefix]: value };
	return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
		(all, [key, child]) => Object.assign(all, flatten(child, prefix ? `${prefix}.${key}` : key)),
		{},
	);
}

const de = flatten(deCatalog);
const en = flatten(enCatalog);

function release(overrides: Partial<ApprenticeReleaseCreditView>): ApprenticeReleaseCreditView {
	return {
		id: "11111111-1111-4111-8111-111111111111",
		releaseKind: "vocational_school_day",
		startsOn: "2027-03-02",
		endsOn: "2027-03-02",
		lessonCount: null,
		schoolMinutes: null,
		examStartTime: null,
		schoolStartTime: null,
		schoolEndTime: null,
		note: null,
		fullDays: 1,
		creditedMinutes: 0,
		flagsWorkplaceReturn: false,
		...overrides,
	};
}

function show(releases: ApprenticeReleaseCreditView[], locale = "de") {
	mocks.getApprenticeReleaseCreditsAction.mockResolvedValue({
		success: true,
		data: { isApprentice: true, releases },
	});
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<TolgeeProvider tolgee={createTestTolgee(locale, locale === "de" ? de : {})}>
			<QueryClientProvider client={client}>
				<ApprenticeReleaseCard
					organizationId="org"
					view="employee"
					employeeId="22222222-2222-4222-8222-222222222222"
					canManage
				/>
			</QueryClientProvider>
		</TolgeeProvider>,
	);
}

describe("ApprenticeReleaseCard (#1993)", () => {
	afterEach(cleanup);
	beforeEach(() => vi.clearAllMocks());

	it("writes release days and school and exam times the way German readers do", async () => {
		show([
			release({
				id: "a",
				releaseKind: "exam_day",
				startsOn: "2027-03-02",
				endsOn: "2027-03-02",
				examStartTime: "09:00",
				creditedMinutes: 180,
			}),
			release({
				id: "b",
				releaseKind: "vocational_school_block_week",
				startsOn: "2027-03-08",
				endsOn: "2027-03-12",
				fullDays: 5,
			}),
			release({
				id: "c",
				startsOn: "2027-03-16",
				endsOn: "2027-03-16",
				schoolStartTime: "07:45",
				schoolEndTime: "11:15",
				creditedMinutes: 210,
			}),
		]);

		expect(await screen.findByText("2. März 2027")).toBeTruthy();
		expect(screen.getByText("8.–12. März 2027")).toBeTruthy();
		expect(screen.getByText("16. März 2027")).toBeTruthy();
		expect(screen.queryByText(/2027-03/)).toBeNull();
		expect(screen.getByText("Prüfung ab 09:00: 180 Min. angerechnet")).toBeTruthy();
		expect(screen.getByText("Unterricht 07:45–11:15: 210 Min. angerechnet")).toBeTruthy();
	});

	it("says why a full block week's training allowance stays outside a minor's 40-hour week (#2023)", async () => {
		show(
			[
				release({
					id: "b",
					releaseKind: "vocational_school_block_week",
					startsOn: "2027-03-08",
					endsOn: "2027-03-12",
					fullDays: 5,
				}),
				release({ id: "c", startsOn: "2027-03-16", endsOn: "2027-03-16" }),
			],
			"en",
		);

		expect(
			await screen.findAllByText(
				"Up to 2 hours of in-company training a week are allowed on these block days (§ 9 Abs. 1 Nr. 3 JArbSchG, § 15 Abs. 1 Satz 2 Nr. 3 BBiG). For an employee under 18, these hours come on top of the block week, which counts with the average weekly working time (§ 9 Abs. 2 Nr. 2 JArbSchG), and do not count towards the § 8 weekly limit.",
			),
		).toHaveLength(1);
	});

	it("words the block-week training note in German", async () => {
		show([
			release({
				releaseKind: "vocational_school_block_week",
				startsOn: "2027-03-08",
				endsOn: "2027-03-12",
				fullDays: 5,
			}),
		]);

		expect(
			await screen.findByText(
				"An diesen Blockunterrichtstagen sind bis zu 2 Stunden betriebliche Ausbildungsveranstaltungen pro Woche erlaubt (§ 9 Abs. 1 Nr. 3 JArbSchG, § 15 Abs. 1 Satz 2 Nr. 3 BBiG). Bei Beschäftigten unter 18 kommen sie zur Blockwoche hinzu, die mit der durchschnittlichen wöchentlichen Arbeitszeit angerechnet wird (§ 9 Abs. 2 Nr. 2 JArbSchG), und zählen nicht zur Wochenhöchstgrenze nach § 8.",
			),
		).toBeTruthy();
	});

	it("adds no training note to a block week that is not released in full", async () => {
		show(
			[
				release({
					releaseKind: "vocational_school_block_week",
					startsOn: "2027-03-08",
					endsOn: "2027-03-10",
					fullDays: 0,
					creditedMinutes: 900,
				}),
			],
			"en",
		);

		expect(await screen.findByText("900 min of school time credited")).toBeTruthy();
		expect(screen.queryByText(/in-company training/)).toBeNull();
	});

	it("words a refused removal in German, not with the server's English text", async () => {
		mocks.voidApprenticeReleaseAction.mockResolvedValue({
			success: false,
			error: "Record why this entry is voided",
			code: "ValidationError",
			refusal: "statutory_note_required",
		});
		show([release({})]);

		fireEvent.click(
			await screen.findByRole("button", { name: de["settings.apprenticeRelease.void"] }),
		);
		fireEvent.submit(
			screen.getByRole("button", { name: de["settings.apprenticeRelease.voidConfirm"] }),
		);

		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenCalledWith(
				de["settings.apprenticeRelease.refusal.reasonRequired"],
			),
		);
		expect(de["settings.apprenticeRelease.refusal.reasonRequired"]).not.toBe(
			en["settings.apprenticeRelease.refusal.reasonRequired"],
		);
	});

	it("has an English and a German text for every refusal", () => {
		for (const message of Object.values(apprenticeReleaseRefusals)) {
			if (typeof message === "function") throw new Error("expected a [key, default] tuple");
			const [key, fallback] = message;
			expect(en[key], key).toBe(fallback);
			expect(de[key], key).toBeTruthy();
			expect(de[key], key).not.toBe(en[key]);
		}
	});
});
