/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	findForeignPerDiemTable,
	foreignTableRates,
} from "@/lib/travel-expenses/statutory-foreign-per-diem";
import {
	GERMAN_DOMESTIC_PER_DIEM_DEFAULT,
	GERMAN_DOMESTIC_PER_DIEM_RULES,
	GERMAN_PER_DIEM_WITH_FOREIGN_2026_DEFAULT,
} from "@/lib/travel-expenses/statutory-per-diem-defaults";

const actions = vi.hoisted(() => ({
	getPerDiemPolicySettings: vi.fn(),
	activatePerDiemPolicyVersionAction: vi.fn(),
	withdrawPerDiemPolicyVersionAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/travel-expenses/per-diem-policy-actions", () => actions);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));

import { PerDiemPolicySettingsCard } from "./per-diem-policy-settings";

const DOMESTIC = "German statutory domestic per diem";
const FOREIGN = "German statutory per diem with the official foreign rates";

function adoptedVersion(defaultKey: string, overrides: Record<string, unknown> = {}) {
	return {
		id: `version-${defaultKey}`,
		policyId: "6a090000-0000-4000-8000-0000000000b0",
		effectiveFrom: "2026-01-01",
		currency: "EUR",
		source: { kind: "statutory_default", reference: "EStG", version: "LStH 2026", defaultKey },
		withdrawnAt: null,
		rates: { DE: GERMAN_DOMESTIC_PER_DIEM_DEFAULT.rates },
		note: null,
		replacesVersionId: null,
		createdAt: "2026-01-02T08:00:00.000Z",
		effectiveUntil: null,
		...overrides,
	};
}

function settings(timeline: unknown[]) {
	actions.getPerDiemPolicySettings.mockResolvedValue({
		success: true,
		data: {
			timeline,
			withdrawn: [],
			defaults: [GERMAN_DOMESTIC_PER_DIEM_DEFAULT, GERMAN_PER_DIEM_WITH_FOREIGN_2026_DEFAULT],
			rules: GERMAN_DOMESTIC_PER_DIEM_RULES,
		},
	});
}

function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<PerDiemPolicySettingsCard />
		</QueryClientProvider>,
	);
}

beforeEach(() => settings([]));
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("per diem statutory catalogs (#689)", () => {
	it("marks only the domestic catalog adopted when its key was adopted", async () => {
		settings([adoptedVersion(GERMAN_DOMESTIC_PER_DIEM_DEFAULT.key)]);
		mount();
		const domestic = await screen.findByRole("region", { name: DOMESTIC });
		expect(
			within(domestic).getByText(/^Adopted on Jan 2, 2026.*UTC, valid from Jan 1, 2026$/),
		).toBeTruthy();
		expect(within(domestic).queryByRole("button", { name: "Adopt these amounts" })).toBeNull();
		const foreign = screen.getByRole("region", { name: FOREIGN });
		expect(within(foreign).getByRole("button", { name: "Adopt these amounts" })).toBeTruthy();
		expect(within(foreign).queryByText(/^Adopted on/)).toBeNull();
	});

	it("marks only the foreign catalog adopted when its key was adopted", async () => {
		settings([adoptedVersion(GERMAN_PER_DIEM_WITH_FOREIGN_2026_DEFAULT.key)]);
		mount();
		const foreign = await screen.findByRole("region", { name: FOREIGN });
		expect(within(foreign).getByText(/^Adopted on/)).toBeTruthy();
		expect(within(foreign).queryByRole("button", { name: "Adopt these amounts" })).toBeNull();
		const domestic = screen.getByRole("region", { name: DOMESTIC });
		expect(within(domestic).getByRole("button", { name: "Adopt these amounts" })).toBeTruthy();
	});

	it("titles the adopt dialog after the catalog being adopted", async () => {
		mount();
		const domestic = await screen.findByRole("region", { name: DOMESTIC });
		fireEvent.click(within(domestic).getByRole("button", { name: "Adopt these amounts" }));
		expect(
			await screen.findByRole("dialog", { name: "Adopt the German statutory per diem" }),
		).toBeTruthy();
		fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

		const foreign = screen.getByRole("region", { name: FOREIGN });
		fireEvent.click(within(foreign).getByRole("button", { name: "Adopt these amounts" }));
		expect(
			await screen.findByRole("dialog", {
				name: "Adopt the German statutory per diem with the official foreign rates",
			}),
		).toBeTruthy();
	});

	it("counts the adopted foreign rates the way the catalog summary does", async () => {
		const table = findForeignPerDiemTable(
			GERMAN_PER_DIEM_WITH_FOREIGN_2026_DEFAULT.foreignTableKey ?? "",
		);
		if (!table) throw new Error("foreign table missing");
		settings([
			adoptedVersion(GERMAN_PER_DIEM_WITH_FOREIGN_2026_DEFAULT.key, {
				rates: { DE: GERMAN_DOMESTIC_PER_DIEM_DEFAULT.rates, ...foreignTableRates(table) },
			}),
		]);
		mount();
		expect(await screen.findByText("Foreign rates: 166 countries and 48 cities")).toBeTruthy();
		const foreign = screen.getByRole("region", { name: FOREIGN });
		expect(within(foreign).getByText(/for 166 countries and 48 cities,/)).toBeTruthy();
	});
});
