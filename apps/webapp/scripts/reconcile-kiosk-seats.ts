import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import type { KioskSeatReconciliation } from "@/lib/billing/kiosk-seat-reconcile";
// Environment-free, so the script can refuse before it loads the app or connects.
import {
	KIOSK_SEATS_NOT_CONFIGURED_MESSAGE,
	kioskSeatReconcileConfigured,
} from "@/lib/effect/services/billing/seat-items";

const HELP = `Reconcile existing subscriptions into kiosk seats (one-time deploy step, spec #886)

  pnpm billing:reconcile-kiosk-seats [--organization-id <org-id>] [--json]

Run once, right after STRIPE_PRICE_KIOSK_MONTHLY_ID and STRIPE_PRICE_KIOSK_YEARLY_ID
are set on the webapp and the worker. Runs billing seat sync for every
organization with a Stripe subscription that has not ended (or only the one
named), one at a time: kiosk-only employees move from full seats to kiosk
seats, the kiosk seat item is added, the full seat quantity drops, and Stripe
prorates the credit.
Safe to run again: an organization already billed at its split is left alone.

Refuses, without connecting or calling Stripe, unless BILLING_ENABLED=true and
both kiosk seat price IDs are set. One organization's failure is reported and
the others still run; the run then exits non-zero, and a second run retries
only what still differs.

Options:
  --organization-id  Only this organization
  --json             Print the full report as JSON (for recorded evidence)
  --help             Show this help without connecting to the database
`;

type ReconcileKioskSeatsCommand =
	| { kind: "help" }
	| { kind: "reconcile"; organizationId: string | null; json: boolean };

export function parseReconcileKioskSeatsCommand(args: string[]): ReconcileKioskSeatsCommand {
	const { values, tokens } = parseArgs({
		args,
		options: {
			"organization-id": { type: "string" },
			json: { type: "boolean" },
			help: { type: "boolean" },
		},
		strict: true,
		allowPositionals: false,
		tokens: true,
	});
	const seen = new Set<string>();
	for (const token of tokens) {
		if (token.kind !== "option") continue;
		if (seen.has(token.name)) throw new Error(`Duplicate option --${token.name}`);
		seen.add(token.name);
	}
	if (values.help) return { kind: "help" };
	const organizationId = values["organization-id"];
	if (organizationId !== undefined && (!organizationId.trim() || organizationId.startsWith("--"))) {
		throw new Error("--organization-id needs an organization id");
	}
	return { kind: "reconcile", organizationId: organizationId ?? null, json: values.json === true };
}

export function formatKioskSeatReconciliation(
	reports: readonly KioskSeatReconciliation[],
): string[] {
	const lines = reports.map((report) =>
		report.outcome === "failed"
			? `Organization ${report.organizationId}: FAILED: ${report.error}`
			: `Organization ${report.organizationId}: ${report.outcome}, ${report.fullSeats} full + ${report.kioskSeats} kiosk seats`,
	);
	const count = (outcome: KioskSeatReconciliation["outcome"]) =>
		reports.filter((report) => report.outcome === outcome).length;
	lines.push(
		"",
		`Total over ${reports.length} organizations: updated ${count("updated")}, unchanged ${count("unchanged")}, failed ${count("failed")}`,
	);
	return lines;
}

interface ReconcileKioskSeatsDependencies {
	loadDatabase?: () => Promise<{ pool: { end(): Promise<void> } }>;
	reconcile?: (options: {
		organizationIds?: readonly string[];
	}) => Promise<KioskSeatReconciliation[]>;
	output?: { log(line: string): void };
}

/** The reconcile's own configuration check, applied to the environment before the app loads. */
function kioskSeatsConfigured(environment: NodeJS.ProcessEnv): boolean {
	return kioskSeatReconcileConfigured({
		enabled: environment.BILLING_ENABLED === "true",
		priceKioskMonthlyId: environment.STRIPE_PRICE_KIOSK_MONTHLY_ID,
		priceKioskYearlyId: environment.STRIPE_PRICE_KIOSK_YEARLY_ID,
	});
}

export async function runReconcileKioskSeatsCli(
	args: string[],
	environment: NodeJS.ProcessEnv = process.env,
	dependencies: ReconcileKioskSeatsDependencies = {},
): Promise<void> {
	const output = dependencies.output ?? console;
	const command = parseReconcileKioskSeatsCommand(args);
	if (command.kind === "help") {
		output.log(HELP);
		return;
	}
	if (!kioskSeatsConfigured(environment)) throw new Error(KIOSK_SEATS_NOT_CONFIGURED_MESSAGE);
	for (const name of [
		"POSTGRES_HOST",
		"POSTGRES_PORT",
		"POSTGRES_DB",
		"POSTGRES_USER",
		"POSTGRES_PASSWORD",
	]) {
		if (!environment[name]?.trim()) {
			throw new Error(`Missing required environment variable ${name}`);
		}
	}
	const { pool } = await (dependencies.loadDatabase ?? (() => import("@/db")))();
	try {
		const reconcile =
			dependencies.reconcile ??
			(await import("@/lib/billing/kiosk-seat-reconcile")).reconcileKioskSeatsInEveryOrganization;
		const reports = await reconcile(
			command.organizationId ? { organizationIds: [command.organizationId] } : {},
		);
		if (command.json) {
			output.log(JSON.stringify(reports, null, 2));
		} else {
			for (const line of formatKioskSeatReconciliation(reports)) output.log(line);
		}
		const failed = reports.filter((report) => report.outcome === "failed").length;
		if (failed > 0) {
			throw new Error(
				`${failed} organization${failed === 1 ? "" : "s"} failed; fix the cause and run again`,
			);
		}
	} finally {
		await pool.end();
	}
}

const invokedPath = process.argv[1];
if (invokedPath && fileURLToPath(import.meta.url) === resolve(invokedPath)) {
	runReconcileKioskSeatsCli(process.argv.slice(2))
		.then(() => process.exit(0))
		.catch((error: unknown) => {
			console.error(error instanceof Error ? error.message : String(error));
			process.exit(1);
		});
}
