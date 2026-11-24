/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MinorContractorReview } from "@/lib/statutory/youth/minor-contractor-review";
import { createTestTolgee } from "@/test/render-with-translations";
import deCatalog from "../../../../messages/settings/workPolicies/de.json";
import enCatalog from "../../../../messages/settings/workPolicies/en.json";

// #2022: minor contractor engagements in Reviews & Conflicts (Youth & Apprentice).

const mocks = vi.hoisted(() => ({
	listMinorContractorReviewsAction: vi.fn(),
	acknowledgeMinorContractorReviewAction: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/app/[locale]/(app)/settings/contracts/minor-contractor-review-actions", () => ({
	listMinorContractorReviewsAction: mocks.listMinorContractorReviewsAction,
	acknowledgeMinorContractorReviewAction: mocks.acknowledgeMinorContractorReviewAction,
}));

const { MinorContractorReviewsSection, minorContractorReviewRefusals } =
	await import("./minor-contractor-reviews-section");

/** `{ a: { b: "x" } }` → `{ "a.b": "x" }`, the keys the section asks for. */
function flatten(value: unknown, prefix = ""): Record<string, string> {
	if (typeof value === "string") return { [prefix]: value };
	return Object.entries(value as Record<string, unknown>).reduce<Record<string, string>>(
		(all, [key, child]) => Object.assign(all, flatten(child, prefix ? `${prefix}.${key}` : key)),
		{},
	);
}

const de = flatten(deCatalog);
const en = flatten(enCatalog);

const review: MinorContractorReview = {
	findingId: "jarbschg_minor_contractor:e1:engagement:p1",
	employeeId: "11111111-1111-4111-8111-111111111111",
	employeeName: "Mia Klein",
	subjectKey: "engagement:p1",
	periodStart: "2027-01-04",
	periodEnd: "2027-04-01",
	contractorAfterEnd: false,
	contractorBeforeStart: false,
	legalReference: "§ 1 Abs. 1 Nr. 3 JArbSchG",
	acknowledgementStatus: "none",
	inputFingerprint: "v1:shown",
};

function show(locale = "en", shown: MinorContractorReview[] = [review], showWhenEmpty = false) {
	mocks.listMinorContractorReviewsAction.mockResolvedValue({ success: true, data: shown });
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<TolgeeProvider tolgee={createTestTolgee(locale, locale === "de" ? de : {})}>
			<QueryClientProvider client={client}>
				<MinorContractorReviewsSection organizationId="org" showWhenEmpty={showWhenEmpty} />
			</QueryClientProvider>
		</TolgeeProvider>,
	);
}

describe("MinorContractorReviewsSection (#2022)", () => {
	afterEach(cleanup);
	beforeEach(() => vi.clearAllMocks());

	it("shows the engagement as a review item with its period", async () => {
		show();

		expect(await screen.findByText("Mia Klein")).toBeTruthy();
		expect(
			screen.getByText(
				"Contractor under 18: check whether the work falls under § 1 Abs. 1 Nr. 3 JArbSchG",
			),
		).toBeTruthy();
		expect(screen.getByText("Engaged Jan 4, 2027 – Mar 31, 2027")).toBeTruthy();
	});

	it("names an open-ended engagement by its start, in German", async () => {
		show("de", [{ ...review, periodEnd: null }]);

		expect(await screen.findByText("Beauftragt seit 4. Jan. 2027")).toBeTruthy();
	});

	it("says an engagement's start was not recorded instead of showing a date", async () => {
		show("en", [
			{ ...review, periodStart: null, periodEnd: null },
			{ ...review, findingId: "f2", employeeName: "Ben Roth", periodStart: null },
		]);

		expect(await screen.findByText("Engagement start not recorded")).toBeTruthy();
		expect(screen.getByText("Engaged until Mar 31, 2027 (start not recorded)")).toBeTruthy();
		expect(screen.queryByText(/Engaged since/)).toBeNull();
	});

	it("says an engagement's start was not recorded, in German", async () => {
		show("de", [
			{ ...review, periodStart: null, periodEnd: null },
			{ ...review, findingId: "f2", employeeName: "Ben Roth", periodStart: null },
		]);

		expect(await screen.findByText("Beginn der Beauftragung nicht erfasst")).toBeTruthy();
		expect(screen.getByText("Beauftragt bis 31. März 2027 (Beginn nicht erfasst)")).toBeTruthy();
	});

	// The flags turn true while the window still lies partly inside the engagement, so the notices
	// name the day instead of saying the engagement has ended or not started yet.
	it("says from which day the person is on the roster as a contractor outside the engagement", async () => {
		show("en", [
			{ ...review, contractorAfterEnd: true },
			{ ...review, findingId: "f2", employeeName: "Ben Roth", contractorBeforeStart: true },
		]);

		expect(
			await screen.findByText(
				"After the engagement ends on Mar 31, 2027, the person stays on the roster as a contractor. Their shifts and work after that day are not judged under youth protection either.",
			),
		).toBeTruthy();
		expect(
			screen.getByText(
				"Before the engagement starts on Jan 4, 2027, the person is on the roster as a contractor. Their shifts and work before that day are not judged under youth protection either.",
			),
		).toBeTruthy();
		expect(screen.queryByText(/has ended|not started yet/)).toBeNull();
	});

	it("says it in German", async () => {
		show("de", [
			{ ...review, contractorAfterEnd: true },
			{ ...review, findingId: "f2", employeeName: "Ben Roth", contractorBeforeStart: true },
		]);

		expect(
			await screen.findByText(
				"Nach dem Ende der Beauftragung am 31. März 2027 bleibt die Person als Externer Dienstleister erfasst. Ihre Schichten und Arbeit nach diesem Tag werden ebenfalls nicht nach dem Jugendarbeitsschutz beurteilt.",
			),
		).toBeTruthy();
		expect(
			screen.getByText(
				"Vor dem Beginn der Beauftragung am 4. Jan. 2027 ist die Person bereits als Externer Dienstleister erfasst. Ihre Schichten und Arbeit vor diesem Tag werden ebenfalls nicht nach dem Jugendarbeitsschutz beurteilt.",
			),
		).toBeTruthy();
	});

	it("names every change that opens a recorded assessment again", async () => {
		show();

		expect(
			await screen.findByText(
				/It opens again when the engagement period or the birthday changes, or once the person is on the roster as a contractor after the engagement ends\.$/,
			),
		).toBeTruthy();
		expect(minorContractorReviewRefusals.statutory_finding_changed[1]).toBe(
			"The engagement or the birthday changed since this list was loaded, or the person is now on the roster as a contractor after the engagement ends. Review it again.",
		);
		expect(de["settings.contracts.reviews.minorContractors.description"]).toMatch(
			/oder die Person nach dem Ende der Beauftragung als Externer Dienstleister erfasst ist\.$/,
		);
		expect(de["settings.contracts.reviews.minorContractors.refusal.changed"]).toMatch(
			/nach dem Ende der Beauftragung als Externer Dienstleister erfasst/,
		);
	});

	it("documents the engagement the admin was shown, with a reason", async () => {
		mocks.acknowledgeMinorContractorReviewAction.mockResolvedValue({
			success: true,
			data: { id: "ack-1", acknowledgedAt: new Date() },
		});
		show();

		fireEvent.click(await screen.findByRole("button", { name: "Record assessment…" }));
		fireEvent.click(screen.getByRole("button", { name: "Record assessment" }));
		expect(
			await screen.findByText("Explain why the work does or does not fall under youth protection."),
		).toBeTruthy();
		expect(mocks.acknowledgeMinorContractorReviewAction).not.toHaveBeenCalled();

		fireEvent.change(screen.getByLabelText("Your assessment of the engagement"), {
			target: { value: "Own clients, sets own hours" },
		});
		fireEvent.click(screen.getByRole("button", { name: "Record assessment" }));

		await waitFor(() =>
			expect(mocks.acknowledgeMinorContractorReviewAction).toHaveBeenCalledWith({
				employeeId: review.employeeId,
				subjectKey: "engagement:p1",
				expectedFingerprint: "v1:shown",
				reason: "Own clients, sets own hours",
				legalNote: null,
			}),
		);
		await waitFor(() => expect(mocks.toastSuccess).toHaveBeenCalledWith("Assessment recorded"));
	});

	it("shows nothing without engagements, unless its domain is selected", async () => {
		show("en", []);
		await waitFor(() => expect(mocks.listMinorContractorReviewsAction).toHaveBeenCalled());
		expect(screen.queryByText("Youth protection: contractors under 18")).toBeNull();
		cleanup();

		show("en", [], true);
		expect(await screen.findByText("No contractor under 18 needs a review.")).toBeTruthy();
	});

	it("has an English and a German text for every refusal", () => {
		for (const message of Object.values(minorContractorReviewRefusals)) {
			const [key, fallback] = message;
			expect(en[key], key).toBe(fallback);
			expect(de[key], key).toBeTruthy();
			expect(de[key], key).not.toBe(en[key]);
		}
	});
});
