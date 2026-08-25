import { sql } from "drizzle-orm";
import { Temporal } from "temporal-polyfill";
import { db } from "@/db";
import { reconcileBillingSeatsForOrganization } from "@/lib/billing/seat-sync-trigger";
import {
	createSCIMProjectionRecoveryStore,
	retryDueSCIMProjectionRecovery,
} from "@/lib/scim/projection-recovery";
import {
	createSCIMSeatSyncOutboxStore,
	runSCIMSeatSyncOutbox,
	type SCIMSeatSyncOutboxResult,
} from "@/lib/scim/seat-sync-outbox";
import {
	createSCIMDecommissionStore,
	runDueSCIMDecommission,
} from "@/lib/scim/decommission";

const RECOVERY_LIMIT = 50;
const DECOMMISSION_LIMIT = 50;

export interface SCIMMaintenanceResult {
	outbox: SCIMSeatSyncOutboxResult;
	exhausted: number;
	persistenceFailures: number;
	projectionRecovery: { attempted: number; recovered: number; failed: number };
	decommission: {
		attempted: number;
		completed: number;
		deferred: number;
		failed: number;
	};
}

export class SCIMMaintenanceDegradedError extends Error {
	readonly result: SCIMMaintenanceResult;

	constructor(result: SCIMMaintenanceResult) {
		super(
			`SCIM maintenance degraded: ${result.exhausted} exhausted deliveries, ${result.persistenceFailures} persistence failures`,
		);
		this.name = "SCIMMaintenanceDegradedError";
		this.result = result;
	}
}

interface SCIMMaintenanceDependencies {
	runOutbox: () => Promise<SCIMSeatSyncOutboxResult>;
	listDueRecoveryOrganizations: () => Promise<string[]>;
	retryProjectionRecovery: (organizationId: string) => Promise<boolean>;
	runDecommissions: () => Promise<"skipped" | "completed" | "deferred">;
}

async function listDueRecoveryOrganizations(): Promise<string[]> {
	const result = await db.execute<{ organizationId: string }>(sql`
		SELECT DISTINCT organization_id AS "organizationId"
		FROM scim_projection_recovery
		WHERE status <> 'completed'
			AND available_at <= ${new Date(Temporal.Now.instant().epochMilliseconds)}
		ORDER BY "organizationId"
		LIMIT ${RECOVERY_LIMIT}
	`);
	return result.rows.map((row) => row.organizationId);
}

function getDefaultDependencies(): SCIMMaintenanceDependencies {
	const outboxStore = createSCIMSeatSyncOutboxStore(db);
	const recoveryStore = createSCIMProjectionRecoveryStore(db);
	const decommissionStore = createSCIMDecommissionStore(db);
	return {
		runOutbox: () =>
			runSCIMSeatSyncOutbox({
				store: outboxStore,
				reconcile: reconcileBillingSeatsForOrganization,
			}),
		listDueRecoveryOrganizations,
		retryProjectionRecovery: async (organizationId) =>
			retryDueSCIMProjectionRecovery({
				organizationId,
				store: recoveryStore,
				replay: await getRecoveryReplayer(),
			}),
		runDecommissions: async () => {
			const { auth } = await import("@/lib/auth");
			return runDueSCIMDecommission({ store: decommissionStore, auth });
		},
	};
}

async function getRecoveryReplayer() {
	const [{ auth }, { createSCIMProjectionReplayLoader }] = await Promise.all([
		import("@/lib/auth"),
		import("@/lib/scim/projection-replay-api"),
	]);
	return createSCIMProjectionReplayLoader(auth.api)();
}

export async function runSCIMMaintenance(
	input: Partial<SCIMMaintenanceDependencies> = {},
): Promise<SCIMMaintenanceResult> {
	const dependencies = { ...getDefaultDependencies(), ...input };
	let outbox: SCIMSeatSyncOutboxResult | null = null;
	let outboxError: unknown = null;
	try {
		outbox = await dependencies.runOutbox();
	} catch (error) {
		outboxError = error;
	}
	let organizationIds: string[] = [];
	let recoveryScanError: unknown = null;
	try {
		organizationIds = (await dependencies.listDueRecoveryOrganizations()) ?? [];
	} catch (error) {
		recoveryScanError = error;
	}
	let recovered = 0;
	let failed = 0;

	for (const organizationId of organizationIds) {
		try {
			if (await dependencies.retryProjectionRecovery(organizationId))
				recovered++;
		} catch {
			failed++;
		}
	}
	let decommissionCompleted = 0;
	let decommissionDeferred = 0;
	let decommissionFailed = 0;
	let decommissionAttempted = 0;
	for (let index = 0; index < DECOMMISSION_LIMIT; index++) {
		try {
			const outcome = await dependencies.runDecommissions();
			if (outcome === "skipped") break;
			decommissionAttempted++;
			if (outcome === "completed") decommissionCompleted++;
			else decommissionDeferred++;
		} catch {
			decommissionAttempted++;
			decommissionFailed++;
		}
	}
	if (outboxError) throw outboxError;
	if (recoveryScanError) throw recoveryScanError;
	if (!outbox) throw new Error("SCIM maintenance outbox result is missing");

	return {
		outbox,
		exhausted: outbox.exhausted,
		persistenceFailures: outbox.persistenceFailures,
		projectionRecovery: {
			attempted: organizationIds.length,
			recovered,
			failed,
		},
		decommission: {
			attempted: decommissionAttempted,
			completed: decommissionCompleted,
			deferred: decommissionDeferred,
			failed: decommissionFailed,
		},
	};
}
