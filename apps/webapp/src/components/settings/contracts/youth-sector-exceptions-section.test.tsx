/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { TolgeeProvider } from "@tolgee/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenYouthSectorException } from "@/lib/statutory/youth/sector-exception-review";
import { createTestTolgee } from "@/test/render-with-translations";
import deCatalog from "../../../../messages/settings/workPolicies/de.json";
import enCatalog from "../../../../messages/settings/workPolicies/en.json";

const mocks = vi.hoisted(() => ({
	listYouthSectorExceptionsAction: vi.fn(),
	acknowledgeYouthSectorExceptionAction: vi.fn(),
	toastSuccess: vi.fn(),
	toastError: vi.fn(),
}));

vi.mock("sonner", () => ({
	toast: { success: mocks.toastSuccess, error: mocks.toastError },
}));

vi.mock("@/app/[locale]/(app)/settings/contracts/youth-sector-exception-actions", () => ({
	listYouthSectorExceptionsAction: mocks.listYouthSectorExceptionsAction,
	acknowledgeYouthSectorExceptionAction: mocks.acknowledgeYouthSectorExceptionAction,
}));

const { YouthSectorExceptionsSection, youthSectorExceptionRefusals } =
	await import("./youth-sector-exceptions-section");

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

const finding: OpenYouthSectorException = {
	findingId: "jarbschg_sunday_work:e1:shift:s1",
	employeeId: "11111111-1111-4111-8111-111111111111",
	employeeName: "Mia Klein",
	findingKind: "jarbschg_sunday_work",
	subjectKey: "shift:s1",
	periodStart: "2027-03-07",
	periodEnd: "2027-03-08",
	severity: "critical",
	legalReference: "§ 17 JArbSchG",
	used: null,
	acknowledgementStatus: "none",
	inputFingerprint: "v1:shown",
};

function show(locale = "de", shown: OpenYouthSectorException = finding) {
	mocks.listYouthSectorExceptionsAction.mockResolvedValue({ success: true, data: [shown] });
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	return render(
		<TolgeeProvider tolgee={createTestTolgee(locale, locale === "de" ? de : {})}>
			<QueryClientProvider client={client}>
				<YouthSectorExceptionsSection organizationId="org" />
			</QueryClientProvider>
		</TolgeeProvider>,
	);
}

describe("YouthSectorExceptionsSection (#1993)", () => {
	afterEach(cleanup);
	beforeEach(() => vi.clearAllMocks());

	it("writes the finding's day the way German readers do", async () => {
		show();

		expect(await screen.findByText("7. März 2027")).toBeTruthy();
		expect(screen.queryByText("2027-03-07")).toBeNull();
	});

	it("names a § 12 shift span of up to 11 h as a sector exception, in German", async () => {
		show("de", {
			...finding,
			findingId: "jarbschg_shift_span:e1:shift:s1",
			findingKind: "jarbschg_shift_span",
			legalReference: "§ 12 JArbSchG",
			used: { unit: "minutes", value: 630 },
		});

		const label = de["settings.contracts.reviews.youth.kind.shiftSpan"];
		expect(label).toBeTruthy();
		expect(label).not.toBe(en["settings.contracts.reviews.youth.kind.shiftSpan"]);
		expect(await screen.findByText(label)).toBeTruthy();
	});

	it("shows a § 12 finding's minutes as its shift span, not as night minutes", async () => {
		show("en", {
			...finding,
			findingId: "jarbschg_shift_span:e1:shift:s1",
			findingKind: "jarbschg_shift_span",
			legalReference: "§ 12 JArbSchG",
			used: { unit: "minutes", value: 630 },
		});

		expect(await screen.findByText("630 min shift span")).toBeTruthy();
		expect(screen.queryByText("630 min at night")).toBeNull();
	});

	it("keeps a night finding's minutes at night", async () => {
		show("en", {
			...finding,
			findingId: "jarbschg_night_work:e1:shift:s1",
			findingKind: "jarbschg_night_work",
			legalReference: "§ 14 JArbSchG",
			used: { unit: "minutes", value: 90 },
		});

		expect(await screen.findByText("90 min at night")).toBeTruthy();
	});

	it("has a German text for the shift span figure", () => {
		const key = "settings.contracts.reviews.youth.shiftSpanMinutes";
		expect(en[key]).toBe("{minutes} min shift span");
		expect(de[key]).toBeTruthy();
		expect(de[key]).not.toBe(en[key]);
	});

	it("words a refused acknowledgement in German, not with the server's English text", async () => {
		mocks.acknowledgeYouthSectorExceptionAction.mockResolvedValue({
			success: false,
			error: "The finding changed since it was shown; review it again",
			code: "ValidationError",
			refusal: "statutory_finding_changed",
		});
		show();

		fireEvent.click(
			await screen.findByRole("button", {
				name: de["settings.contracts.reviews.youth.acknowledge"],
			}),
		);
		fireEvent.change(screen.getByLabelText(de["settings.contracts.reviews.youth.reason"]), {
			target: { value: "Gastronomie, § 17 Abs. 2 Nr. 6" },
		});
		fireEvent.click(
			screen.getByRole("button", { name: de["settings.contracts.reviews.youth.confirm"] }),
		);

		await waitFor(() =>
			expect(mocks.toastError).toHaveBeenCalledWith(
				de["settings.contracts.reviews.youth.refusal.changed"],
			),
		);
		expect(de["settings.contracts.reviews.youth.refusal.changed"]).not.toBe(
			en["settings.contracts.reviews.youth.refusal.changed"],
		);
	});

	it("has an English and a German text for every refusal", () => {
		for (const message of Object.values(youthSectorExceptionRefusals)) {
			if (typeof message === "function") throw new Error("expected a [key, default] tuple");
			const [key, fallback] = message;
			expect(en[key], key).toBe(fallback);
			expect(de[key], key).toBeTruthy();
			expect(de[key], key).not.toBe(en[key]);
		}
	});
});
