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

const RECOVERY_LIMIT = 50;

export interface SCIMMaintenanceResult {
	outbox: SCIMSeatSyncOutboxResult;
	exhausted: number;
	persistenceFailures: number;
	projectionRecovery: { attempted: number; recovered: number; failed: number };
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
	const outbox = await dependencies.runOutbox();
	const organizationIds = await dependencies.listDueRecoveryOrganizations();
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

	return {
		outbox,
		exhausted: outbox.exhausted,
		persistenceFailures: outbox.persistenceFailures,
		projectionRecovery: {
			attempted: organizationIds.length,
			recovered,
			failed,
		},
	};
}
