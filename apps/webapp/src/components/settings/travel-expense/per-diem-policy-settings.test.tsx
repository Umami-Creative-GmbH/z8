/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
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
vi.mock("@/components/ui/date-picker", () => ({
	DatePicker: ({
		id,
		name,
		value,
		onChange,
	}: {
		id?: string;
		name: string;
		value: string;
		onChange: (value: string) => void;
	}) => <input id={id} name={name} value={value} onChange={(e) => onChange(e.target.value)} />,
}));

import { PerDiemPolicySettingsCard } from "./per-diem-policy-settings";

beforeAll(() => {
	vi.stubGlobal(
		"ResizeObserver",
		class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	);
	HTMLElement.prototype.scrollIntoView = vi.fn();
});

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

describe("per diem eligibility rules (#891)", () => {
	it("states that the domestic rules apply until the law changes", async () => {
		mount();
		expect(
			await screen.findByText(/verified for travel days from Jan 1, 2026 until the law changes\./),
		).toBeTruthy();
	});

	it("states the last day of a dated rule edition", async () => {
		actions.getPerDiemPolicySettings.mockResolvedValue({
			success: true,
			data: {
				timeline: [],
				withdrawn: [],
				defaults: [GERMAN_DOMESTIC_PER_DIEM_DEFAULT],
				rules: { ...GERMAN_DOMESTIC_PER_DIEM_RULES, validThrough: "2026-12-31" },
			},
		});
		mount();
		expect(
			await screen.findByText(/verified for travel days from Jan 1, 2026 to Dec 31, 2026\./),
		).toBeTruthy();
	});
});

describe("per diem version dialog (#688)", () => {
	const exceeds = "This amount cannot exceed the full-day allowance.";
	const amountError = "Enter an amount with at most two decimals, e.g. 14.00.";

	async function openAddDialog() {
		mount();
		fireEvent.click(await screen.findByRole("button", { name: "Add rate version" }));
		return screen.findByRole("dialog");
	}

	it("clears an amount error once the amount is valid", async () => {
		const dialog = await openAddDialog();
		const partialDay = within(dialog).getByLabelText("Travel day or more than 8 hours away");
		fireEvent.change(partialDay, { target: { value: "abc" } });
		expect(within(dialog).getAllByText(amountError)).toHaveLength(1);
		fireEvent.change(partialDay, { target: { value: "14" } });
		expect(within(dialog).queryByText(amountError)).toBeNull();
	});

	it("re-checks a deduction against the full day when the full day changes", async () => {
		const dialog = await openAddDialog();
		fireEvent.change(within(dialog).getByLabelText("Full day (24 hours away)"), {
			target: { value: "28" },
		});
		fireEvent.change(within(dialog).getByLabelText("Travel day or more than 8 hours away"), {
			target: { value: "30" },
		});
		expect(within(dialog).getAllByText(exceeds)).toHaveLength(1);
		fireEvent.change(within(dialog).getByLabelText("Full day (24 hours away)"), {
			target: { value: "40" },
		});
		expect(within(dialog).queryByText(exceeds)).toBeNull();
	});

	it("keeps a field error the server returned until that field changes", async () => {
		actions.activatePerDiemPolicyVersionAction.mockResolvedValue({
			success: true,
			data: { status: "invalid", errors: { note: "too_long" } },
		});
		const dialog = await openAddDialog();
		fillValidRates(dialog);
		fireEvent.click(within(dialog).getByRole("button", { name: "Activate version" }));
		expect(await within(dialog).findAllByText("This text is too long.")).toHaveLength(1);
		fireEvent.change(within(dialog).getByLabelText("Note (optional)"), {
			target: { value: "Shorter" },
		});
		expect(within(dialog).queryByText("This text is too long.")).toBeNull();
	});

	it("chooses the policy currency from a searchable list", async () => {
		actions.activatePerDiemPolicyVersionAction.mockResolvedValue({
			success: true,
			data: { status: "activated", versionId: "new" },
		});
		const user = userEvent.setup();
		const dialog = await openAddDialog();
		const currency = within(dialog).getByRole("combobox", { name: "Currency" });
		await user.click(currency);
		await user.keyboard("chf");
		await user.click(await screen.findByRole("option", { name: /^CHF/ }));
		fillValidRates(dialog);
		fireEvent.click(within(dialog).getByRole("button", { name: "Activate version" }));
		await waitFor(() =>
			expect(actions.activatePerDiemPolicyVersionAction).toHaveBeenCalledWith(
				expect.objectContaining({ source: "organization", currency: "CHF" }),
			),
		);
	});
});

function fillValidRates(dialog: HTMLElement) {
	const values: Record<string, string> = {
		"Valid from": "2026-03-01",
		"Full day (24 hours away)": "28",
		"Travel day or more than 8 hours away": "14",
		"Deduction for a provided breakfast": "5.60",
		"Deduction for a provided lunch": "11.20",
		"Deduction for a provided dinner": "11.20",
	};
	for (const [label, value] of Object.entries(values)) {
		fireEvent.change(within(dialog).getByLabelText(label), { target: { value } });
	}
}
