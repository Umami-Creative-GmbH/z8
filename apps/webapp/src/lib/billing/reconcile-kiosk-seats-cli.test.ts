import { describe, expect, it, vi } from "vitest";
import {
	parseReconcileKioskSeatsCommand,
	runReconcileKioskSeatsCli,
} from "../../../scripts/reconcile-kiosk-seats";
import type { KioskSeatReconciliation } from "./kiosk-seat-reconcile";

const CONFIGURED_ENVIRONMENT = {
	POSTGRES_HOST: "127.0.0.1",
	POSTGRES_PORT: "5432",
	POSTGRES_DB: "z8",
	POSTGRES_USER: "z8",
	POSTGRES_PASSWORD: "secret",
	BILLING_ENABLED: "true",
	STRIPE_PRICE_KIOSK_MONTHLY_ID: "price_kiosk_month",
	STRIPE_PRICE_KIOSK_YEARLY_ID: "price_kiosk_year",
};

const REPORTS: KioskSeatReconciliation[] = [
	{ organizationId: "org-a", outcome: "updated", fullSeats: 3, kioskSeats: 2 },
	{ organizationId: "org-b", outcome: "unchanged", fullSeats: 4, kioskSeats: 0 },
];

function captureOutput() {
	const lines: string[] = [];
	return { lines, output: { log: (line: string) => lines.push(line) } };
}

function database() {
	const end = vi.fn(async () => undefined);
	return { end, loadDatabase: vi.fn(async () => ({ pool: { end } })) };
}

describe("reconcile kiosk seats CLI (deploy step after creating the kiosk seat prices)", () => {
	it("runs for every subscribed organization, or only the one named", () => {
		expect(parseReconcileKioskSeatsCommand([])).toEqual({
			kind: "reconcile",
			organizationId: null,
			json: false,
		});
		expect(parseReconcileKioskSeatsCommand(["--organization-id", "org-a", "--json"])).toEqual({
			kind: "reconcile",
			organizationId: "org-a",
			json: true,
		});
		expect(parseReconcileKioskSeatsCommand(["--help"])).toEqual({ kind: "help" });
		expect(() => parseReconcileKioskSeatsCommand(["--organization-id", "--json"])).toThrow(
			"--organization-id",
		);
		expect(() =>
			parseReconcileKioskSeatsCommand(["--organization-id", "a", "--organization-id", "b"]),
		).toThrow("Duplicate option --organization-id");
		expect(() => parseReconcileKioskSeatsCommand(["--force"])).toThrow();
	});

	it("shows help without a connection", async () => {
		const { loadDatabase } = database();
		const { lines, output } = captureOutput();

		await runReconcileKioskSeatsCli(["--help"], {}, { loadDatabase, output });

		expect(loadDatabase).not.toHaveBeenCalled();
		expect(lines.join("\n")).toContain("pnpm billing:reconcile-kiosk-seats");
	});

	it.each([
		["billing is disabled", { BILLING_ENABLED: "false" }],
		["the monthly kiosk price is unset", { STRIPE_PRICE_KIOSK_MONTHLY_ID: "" }],
		["the yearly kiosk price is unset", { STRIPE_PRICE_KIOSK_YEARLY_ID: undefined }],
		["the yearly kiosk price is blank", { STRIPE_PRICE_KIOSK_YEARLY_ID: "  " }],
	])("refuses before connecting or calling Stripe when %s", async (_case, override) => {
		const { loadDatabase } = database();
		const reconcile = vi.fn(async () => REPORTS);

		await expect(
			runReconcileKioskSeatsCli(
				[],
				{ ...CONFIGURED_ENVIRONMENT, ...override },
				{
					loadDatabase,
					reconcile,
					output: captureOutput().output,
				},
			),
		).rejects.toThrow("Kiosk seats are not configured");
		expect(loadDatabase).not.toHaveBeenCalled();
		expect(reconcile).not.toHaveBeenCalled();
	});

	it("requires the database environment before connecting", async () => {
		const { loadDatabase } = database();

		await expect(
			runReconcileKioskSeatsCli(
				[],
				{ ...CONFIGURED_ENVIRONMENT, POSTGRES_HOST: "" },
				{ loadDatabase },
			),
		).rejects.toThrow("Missing required environment variable POSTGRES_HOST");
		expect(loadDatabase).not.toHaveBeenCalled();
	});

	it("reports each organization's full and kiosk seats and whether Stripe changed", async () => {
		const { end, loadDatabase } = database();
		const reconcile = vi.fn(async () => REPORTS);
		const { lines, output } = captureOutput();

		await runReconcileKioskSeatsCli([], CONFIGURED_ENVIRONMENT, {
			loadDatabase,
			reconcile,
			output,
		});

		expect(reconcile).toHaveBeenCalledWith({});
		expect(end).toHaveBeenCalledOnce();
		expect(lines).toEqual([
			"Organization org-a: updated, 3 full + 2 kiosk seats",
			"Organization org-b: unchanged, 4 full + 0 kiosk seats",
			"",
			"Total over 2 organizations: updated 1, unchanged 1, failed 0",
		]);
	});

	it("scopes the run to one organization and prints JSON for recorded evidence", async () => {
		const { loadDatabase } = database();
		const reconcile = vi.fn(async () => [REPORTS[0] as KioskSeatReconciliation]);
		const { lines, output } = captureOutput();

		await runReconcileKioskSeatsCli(
			["--organization-id", "org-a", "--json"],
			CONFIGURED_ENVIRONMENT,
			{
				loadDatabase,
				reconcile,
				output,
			},
		);

		expect(reconcile).toHaveBeenCalledWith({ organizationIds: ["org-a"] });
		expect(JSON.parse(lines.join("\n"))).toEqual([REPORTS[0]]);
	});

	it("reports a failed organization with the others and then fails the run", async () => {
		const { end, loadDatabase } = database();
		const reconcile = vi.fn(
			async (): Promise<KioskSeatReconciliation[]> => [
				REPORTS[0] as KioskSeatReconciliation,
				{ organizationId: "org-c", outcome: "failed", error: "No such subscription" },
			],
		);
		const { lines, output } = captureOutput();

		await expect(
			runReconcileKioskSeatsCli([], CONFIGURED_ENVIRONMENT, { loadDatabase, reconcile, output }),
		).rejects.toThrow("1 organization failed");
		expect(lines).toEqual([
			"Organization org-a: updated, 3 full + 2 kiosk seats",
			"Organization org-c: FAILED: No such subscription",
			"",
			"Total over 2 organizations: updated 1, unchanged 0, failed 1",
		]);
		expect(end).toHaveBeenCalledOnce();
	});
});
