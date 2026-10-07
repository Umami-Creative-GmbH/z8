/* @vitest-environment jsdom */

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GERMAN_MILEAGE_DEFAULT } from "@/lib/travel-expenses/statutory-allowance-defaults";

const actions = vi.hoisted(() => ({
	getMileagePolicySettings: vi.fn(),
	activateMileagePolicyVersionAction: vi.fn(),
	withdrawMileagePolicyVersionAction: vi.fn(),
}));
vi.mock("@/app/[locale]/(app)/settings/travel-expenses/mileage-policy-actions", () => actions);
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@tolgee/react", () => ({
	useTranslate: () => ({
		t: (_key: string, fallback: string, params?: Record<string, unknown>) =>
			fallback.replace(/\{(\w+)\}/g, (match, name) => String(params?.[name] ?? match)),
	}),
}));
vi.mock("next-intl", () => ({ useLocale: () => "en-US" }));

import { MileagePolicySettingsCard } from "./mileage-policy-settings";

const version = {
	id: "6a060000-0000-4000-8000-0000000000b1",
	policyId: "6a060000-0000-4000-8000-0000000000b0",
	effectiveFrom: "2026-01-01",
	currency: "EUR",
	source: { kind: "organization", reference: "Travel policy", version: null, defaultKey: null },
	withdrawnAt: null,
	ratesPerKm: { car: "0.3500" },
	note: null,
	replacesVersionId: null,
	createdAt: "2026-01-02T08:00:00.000Z",
	effectiveUntil: null,
};

function mount() {
	const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
	render(
		<QueryClientProvider client={client}>
			<MileagePolicySettingsCard />
		</QueryClientProvider>,
	);
}

beforeEach(() => {
	actions.getMileagePolicySettings.mockResolvedValue({
		success: true,
		data: { timeline: [], withdrawn: [], defaults: [GERMAN_MILEAGE_DEFAULT] },
	});
});
afterEach(() => {
	cleanup();
	vi.clearAllMocks();
});

describe("mileage rate settings (#606)", () => {
	it("explains missing coverage and offers the verified statutory rates with their sources", async () => {
		mount();
		expect(await screen.findByText("No mileage rate is set up")).toBeTruthy();
		const defaults = screen.getByRole("region", { name: "German statutory flat rates" });
		expect(
			within(defaults).getByText(
				"Car: €0.30 per km · Other motor vehicle (e.g. motorcycle): €0.20 per km",
			),
		).toBeTruthy();
		expect(
			within(defaults)
				.getByRole("link", { name: "LStH 2026, Anhang 25 III (BMF 25.11.2020, Rz. 37)" })
				.getAttribute("href"),
		).toBe(
			"https://lsth.bundesfinanzministerium.de/lsth/2026/B-Anhaenge/Anhang-25/III/inhalt.html",
		);
	});

	it("adopts the default by its key only; rates and source come from the server catalog", async () => {
		actions.activateMileagePolicyVersionAction.mockResolvedValue({
			success: true,
			data: { status: "activated", versionId: version.id },
		});
		mount();
		fireEvent.click(await screen.findByRole("button", { name: "Adopt these rates" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.click(within(dialog).getByRole("button", { name: "Activate version" }));
		await waitFor(() =>
			expect(actions.activateMileagePolicyVersionAction).toHaveBeenCalledWith({
				source: "statutory_default",
				defaultKey: GERMAN_MILEAGE_DEFAULT.key,
				effectiveFrom: "2026-01-01",
				note: "",
				replacesVersionId: null,
			}),
		);
	});

	describe("adopted statutory catalog (#689)", () => {
		const adopted = (overrides: Partial<typeof version> & { defaultKey?: string }) => {
			const { defaultKey = GERMAN_MILEAGE_DEFAULT.key, ...rest } = overrides;
			return {
				...version,
				source: {
					kind: "statutory_default",
					reference: GERMAN_MILEAGE_DEFAULT.reference,
					version: GERMAN_MILEAGE_DEFAULT.version,
					defaultKey,
				},
				...rest,
			};
		};

		function settings(timeline: unknown[], withdrawn: unknown[] = []) {
			actions.getMileagePolicySettings.mockResolvedValue({
				success: true,
				data: { timeline, withdrawn, defaults: [GERMAN_MILEAGE_DEFAULT] },
			});
		}

		it("shows when the catalog was adopted instead of offering it again", async () => {
			settings([
				adopted({ id: "v2", effectiveFrom: "2026-07-01", createdAt: "2026-06-20T09:30:00.000Z" }),
				adopted({ id: "v1", effectiveFrom: "2026-01-01", createdAt: "2026-01-02T08:00:00.000Z" }),
			]);
			mount();
			const catalog = await screen.findByRole("region", { name: "German statutory flat rates" });
			expect(
				within(catalog).getByText(/^Adopted on Jun 20, 2026.*UTC, valid from Jul 1, 2026$/),
			).toBeTruthy();
			expect(within(catalog).queryByRole("button", { name: "Adopt these rates" })).toBeNull();
		});

		it("offers the catalog again once its version is withdrawn", async () => {
			settings(
				[adopted({ id: "v1", withdrawnAt: "2026-03-01T10:00:00.000Z" })],
				[adopted({ id: "v0", withdrawnAt: "2026-02-01T10:00:00.000Z" })],
			);
			mount();
			const catalog = await screen.findByRole("region", { name: "German statutory flat rates" });
			expect(within(catalog).getByRole("button", { name: "Adopt these rates" })).toBeTruthy();
			expect(within(catalog).queryByText(/^Adopted on/)).toBeNull();
		});

		it("does not count organization rates or another catalog's key", async () => {
			settings([version, adopted({ id: "v1", defaultKey: "de-mileage-other-edition" })]);
			mount();
			const catalog = await screen.findByRole("region", { name: "German statutory flat rates" });
			expect(within(catalog).getByRole("button", { name: "Adopt these rates" })).toBeTruthy();
		});
	});

	it("replaces a version starting the same day only after an explicit second confirmation", async () => {
		actions.getMileagePolicySettings.mockResolvedValue({
			success: true,
			data: { timeline: [version], withdrawn: [], defaults: [] },
		});
		actions.activateMileagePolicyVersionAction
			.mockResolvedValueOnce({
				success: true,
				data: { status: "start_taken", existingVersionId: version.id },
			})
			.mockResolvedValueOnce({ success: true, data: { status: "activated", versionId: "new" } });
		mount();
		fireEvent.click(await screen.findByRole("button", { name: "Add rate version" }));
		const dialog = await screen.findByRole("dialog");
		fireEvent.change(within(dialog).getByLabelText("Rate per km: Car"), {
			target: { value: "0.40" },
		});
		// No start date chosen in this test: the server answers that one already starts that day.
		fireEvent.click(within(dialog).getByRole("button", { name: "Activate version" }));
		expect(await within(dialog).findByText("Replace the version starting that day")).toBeTruthy();
		fireEvent.click(within(dialog).getByRole("button", { name: "Replace version" }));
		await waitFor(() =>
			expect(actions.activateMileagePolicyVersionAction).toHaveBeenLastCalledWith(
				expect.objectContaining({
					source: "organization",
					ratesPerKm: { car: "0.40", other_motor_vehicle: "" },
					replacesVersionId: version.id,
				}),
			),
		);
	});
});
