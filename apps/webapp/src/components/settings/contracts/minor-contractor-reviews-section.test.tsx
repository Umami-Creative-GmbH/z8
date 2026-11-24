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
	openEnded: false,
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
		show("de", [{ ...review, openEnded: true }]);

		expect(await screen.findByText("Beauftragt seit 4. Jan. 2027")).toBeTruthy();
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
