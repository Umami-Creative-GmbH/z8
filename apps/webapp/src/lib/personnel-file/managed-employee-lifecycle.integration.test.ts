import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { employeeDocument, workPolicy } from "@/db/schema";
import { type Instant, parseInstant } from "@/lib/datetime/temporal-core";
import { resolveEmployeeOrganizationAccess } from "@/lib/employee-lifecycle/access";
import { createDepartureCommands } from "@/lib/employee-lifecycle/commands";
import {
	createLifecycleDatabaseFixture,
	type LifecycleDatabaseFixture,
} from "@/lib/employee-lifecycle/testing/database.test.fixture";
import { listManagedEmployees, resolvePersonnelFileAccess } from "./access-store";
import { listExpiringDocuments } from "./expiry-store";

describe("managed personnel-file employee status", () => {
	let fixture: LifecycleDatabaseFixture;
	let now: Instant = parseInstant("2026-05-01T08:00:00Z");

	beforeAll(async () => {
		fixture = await createLifecycleDatabaseFixture();
		// Initial synthetic organization configuration; authority changes use commands below.
		await fixture.pool.query(
			"update organization set timezone = 'UTC', personnel_files_enabled = true where id = $1",
			[fixture.organizationId],
		);
	});

	afterAll(async () => {
		if (!fixture) return;
		await fixture.close();
		// This test seeds metadata, not an actual stored object. Do not leave its
		// synthetic cleanup ledger for a later suite's global cleanup worker.
		await fixture.pool.query("delete from personnel_file_upload where organization_id = $1", [
			fixture.organizationId,
		]);
	});

	async function accessAt(at: Instant) {
		const access = await resolvePersonnelFileAccess(fixture.db, {
			organizationId: fixture.organizationId,
			userId: fixture.ownerUserId,
			now: at,
		});
		if (!access) throw new Error("Synthetic owner must retain canonical personnel-file access");
		return access;
	}

	it("marks a retained file former at the cutoff before materialization and current after rehire", async () => {
		const target = await fixture.seedEmployee();
		const policyId = randomUUID();
		await fixture.db.insert(workPolicy).values({
			id: policyId,
			organizationId: fixture.organizationId,
			name: "Synthetic rehire policy",
			createdBy: fixture.ownerUserId,
		});
		await fixture.db.insert(employeeDocument).values({
			id: randomUUID(),
			organizationId: fixture.organizationId,
			employeeId: target.employeeId,
			category: "certificate",
			title: "Retained synthetic certificate",
			documentDate: "2026-04-01",
			expiryDate: "2026-05-03",
			visibility: "shared",
			storageProvider: "s3",
			storageKey: `synthetic/${randomUUID()}`,
			fileName: "certificate.pdf",
			mimeType: "application/pdf",
			sizeBytes: 1,
			checksumSha256: "0".repeat(64),
		});
		const actor = { userId: fixture.ownerUserId, organizationId: fixture.organizationId };
		const commands = createDepartureCommands({
			db: fixture.db,
			clock: { nowInstant: () => now },
			clockOut: {
				async close() {
					return { kind: "not_running" };
				},
			},
		});
		const snapshot = async () => {
			const access = await accessAt(now);
			const employees = await listManagedEmployees(fixture.db, access, { now });
			const expiry = await listExpiringDocuments(fixture.db, access, { now });
			return {
				employee: employees.find((row) => row.id === target.employeeId),
				expiring: expiry.filter((row) => row.employeeId === target.employeeId),
				access: await resolveEmployeeOrganizationAccess(fixture.db, {
					organizationId: fixture.organizationId,
					userId: target.userId,
					now,
				}),
			};
		};
		const before = await snapshot();
		expect(before.employee?.isActive).toBe(true);
		expect(before.expiring).toHaveLength(1);
		expect(before.access.allowed).toBe(true);
		const scheduled = await commands.scheduleDeparture(actor, {
			employeeId: target.employeeId,
			requestId: randomUUID(),
			expectedRevision: null,
			lastWorkingDay: "2026-05-01",
			replacementEmployeeId: null,
			acknowledgeUnassignedDuties: true,
		});
		now = parseInstant("2026-05-02T00:00:00Z");
		const cutoff = await snapshot();
		const stored = await fixture.pool.query(
			"select e.is_active, d.status from employee e join employee_departure d on d.employee_id=e.id where e.id=$1 and d.id=$2",
			[target.employeeId, scheduled.departureId],
		);
		expect(stored.rows).toEqual([{ is_active: true, status: "pending" }]);
		expect(cutoff.employee?.id).toBe(target.employeeId);
		expect(cutoff.employee?.isActive, "A due departure marks the retained file former").toBe(false);
		expect(cutoff.expiring).toHaveLength(0);
		expect(cutoff.access).toEqual({ allowed: false, reason: "offboarded" });
		expect(
			await commands.executeDeparture({
				organizationId: fixture.organizationId,
				employeeId: target.employeeId,
				employmentPeriodId: target.employmentPeriodId,
				departureId: scheduled.departureId,
				revision: scheduled.revision,
			}),
		).toMatchObject({ status: "effective" });
		expect((await snapshot()).employee?.isActive).toBe(false);
		now = now.add({ hours: 24 });
		await commands.rehireEmployee(actor, {
			employeeId: target.employeeId,
			requestId: randomUUID(),
			previousEmploymentPeriodId: target.employmentPeriodId,
			role: "employee",
			teamId: null,
			primaryManagerId: null,
			workPolicyId: policyId,
			weeklyContractMinutes: 2400,
			contractType: "fixed",
			workModel: "hybrid",
			hourlyRate: null,
			currency: "EUR",
			probationStartsOn: null,
			probationEndsOn: null,
			changeReason: "Synthetic lifecycle regression",
		});
		const rehired = await snapshot();
		expect(rehired.employee?.isActive).toBe(true);
		expect(rehired.expiring).toHaveLength(1);
		expect(rehired.access.allowed).toBe(true);
	});

	it("retains deactivated files but excludes the actor's own and another tenant's employee", async () => {
		const former = await fixture.seedEmployee({ isActive: false });
		const other = await fixture.seedEmployee({
			organizationId: await fixture.createOrganization(),
		});
		const access = await accessAt(now);
		expect(
			await listManagedEmployees(fixture.db, access, { employeeId: former.employeeId, now }),
		).toMatchObject([{ id: former.employeeId, isActive: false }]);
		for (const employeeId of [fixture.ownerEmployeeId, other.employeeId]) {
			expect(
				await listManagedEmployees(fixture.db, access, {
					employeeId,
					category: "certificate",
					now,
				}),
			).toEqual([]);
		}
	});
});
