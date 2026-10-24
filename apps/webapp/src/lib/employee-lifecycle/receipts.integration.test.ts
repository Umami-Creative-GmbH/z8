/**
 * PostgreSQL contract: the deactivation ledger (#1440). One row per
 * Deactivate request: a retried request finds its first result, a different
 * payload under the same request ID is refused, and a reactivation stamps the
 * open row of that employee only.
 */
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	DeactivationRequestConflictError,
	insertDeactivation,
	markDeactivationReactivated,
	readDeactivationByRequest,
	readOpenDeactivation,
	recordDeactivationOutcome,
	requestFingerprint,
} from "./receipts";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "./testing/database.test.fixture";

const DEACTIVATED_AT = parseInstant("2026-10-24T09:15:00Z");
const REACTIVATED_AT = parseInstant("2026-11-02T08:00:00Z");

describe("deactivation ledger", () => {
	let fixture: LifecycleDatabaseFixture;

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
	});

	afterAll(async () => {
		await fixture?.close();
	});

	const actor = () => ({ userId: fixture.ownerUserId, organizationId: fixture.organizationId });

	async function deactivate(employeeId: string, employmentPeriodId: string | null) {
		const requestId = randomUUID();
		const fingerprint = requestFingerprint(actor(), "deactivate_employee", {
			employeeId,
			replacementManagers: {},
		});
		const { id } = await fixture.db.transaction((tx) =>
			insertDeactivation(tx, {
				organizationId: fixture.organizationId,
				employeeId,
				employmentPeriodId,
				deactivatedAt: DEACTIVATED_AT,
				createdBy: fixture.ownerUserId,
				reason: "employee_deactivated",
				requestId,
				requestFingerprint: fingerprint,
				replacementManagers: {},
			}),
		);
		return { id, requestId, fingerprint };
	}

	it("replays a request's stored outcome and refuses a different payload", async () => {
		const employee = await fixture.seedEmployee();
		const { id, requestId, fingerprint } = await deactivate(
			employee.employeeId,
			employee.employmentPeriodId,
		);
		await fixture.db.transaction((tx) =>
			recordDeactivationOutcome(tx, {
				organizationId: fixture.organizationId,
				deactivationId: id,
				applied: { shifts: { openedShiftIds: ["s-1"] } },
				result: { changed: true },
			}),
		);

		const replay = await readDeactivationByRequest(fixture.db, {
			organizationId: fixture.organizationId,
			requestId,
			requestFingerprint: fingerprint,
		});
		expect(replay).toMatchObject({
			id,
			employeeId: employee.employeeId,
			employmentPeriodId: employee.employmentPeriodId,
			reason: "employee_deactivated",
			result: { changed: true },
			applied: { shifts: { openedShiftIds: ["s-1"] } },
			reactivatedAt: null,
		});
		expect(replay?.deactivatedAt.equals(DEACTIVATED_AT)).toBe(true);

		await expect(
			readDeactivationByRequest(fixture.db, {
				organizationId: fixture.organizationId,
				requestId,
				requestFingerprint: "another payload",
			}),
		).rejects.toBeInstanceOf(DeactivationRequestConflictError);
		await expect(
			readDeactivationByRequest(fixture.db, {
				organizationId: fixture.organizationId,
				requestId: randomUUID(),
				requestFingerprint: fingerprint,
			}),
		).resolves.toBeNull();
	});

	it("never reads another organization's request", async () => {
		const employee = await fixture.seedEmployee();
		const { requestId, fingerprint } = await deactivate(
			employee.employeeId,
			employee.employmentPeriodId,
		);
		const otherOrganizationId = await fixture.createOrganization();
		await expect(
			readDeactivationByRequest(fixture.db, {
				organizationId: otherOrganizationId,
				requestId,
				requestFingerprint: fingerprint,
			}),
		).resolves.toBeNull();
	});

	it("records an employee without an employment period", async () => {
		const employee = await fixture.seedEmployee({ withPeriod: false });
		const { requestId, fingerprint } = await deactivate(employee.employeeId, null);
		await expect(
			readDeactivationByRequest(fixture.db, {
				organizationId: fixture.organizationId,
				requestId,
				requestFingerprint: fingerprint,
			}),
		).resolves.toMatchObject({ employmentPeriodId: null });
	});

	it("stamps the open deactivation of that employee once on reactivation", async () => {
		const employee = await fixture.seedEmployee();
		const bystander = await fixture.seedEmployee();
		const { id } = await deactivate(employee.employeeId, employee.employmentPeriodId);
		const { id: bystanderDeactivationId } = await deactivate(
			bystander.employeeId,
			bystander.employmentPeriodId,
		);
		const reactivationRequestId = randomUUID();

		const stamped = await fixture.db.transaction((tx) =>
			markDeactivationReactivated(tx, {
				organizationId: fixture.organizationId,
				employeeId: employee.employeeId,
				reactivatedAt: REACTIVATED_AT,
				reactivatedBy: fixture.ownerUserId,
				reactivationRequestId,
			}),
		);
		expect(stamped).toEqual([id]);
		await expect(
			fixture.db.transaction((tx) =>
				markDeactivationReactivated(tx, {
					organizationId: fixture.organizationId,
					employeeId: employee.employeeId,
					reactivatedAt: REACTIVATED_AT,
					reactivatedBy: fixture.ownerUserId,
					reactivationRequestId: randomUUID(),
				}),
			),
		).resolves.toEqual([]);

		await expect(
			readOpenDeactivation(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: employee.employeeId,
			}),
		).resolves.toBeNull();
		await expect(
			readOpenDeactivation(fixture.db, {
				organizationId: fixture.organizationId,
				employeeId: bystander.employeeId,
			}),
		).resolves.toMatchObject({ id: bystanderDeactivationId, reactivatedAt: null });
	});
});
