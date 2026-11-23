/**
 * #1988: audited statutory acknowledgements in `contract_review_acknowledgement`: actor, time,
 * reason, legal note and the deterministic input fingerprint; stale as soon as a later evaluation
 * of changed inputs yields another fingerprint; one subject per finding; immutable (no updates,
 * no direct deletes); organization-scoped.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { contractReviewAcknowledgement, employee } from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import {
	attachAcknowledgementStates,
	listStatutoryAcknowledgements,
	loadStatutoryAcknowledgementStates,
	recordStatutoryAcknowledgement,
} from "./acknowledgements";
import { type StatutoryFinding, statutoryFindingId } from "./finding";
import { statutoryInputFingerprint } from "./fingerprint";

describe("statutory acknowledgements (PostgreSQL)", () => {
	vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 });
	const fx = statutoryFixture(integrationAdminPool(), "t1988-ack");

	beforeEach(fx.cleanup);
	afterAll(fx.cleanup);

	/** What a Minijob monitor would fingerprint for March 2026. */
	function marchInputs(workMinutes: number[]) {
		return statutoryInputFingerprint({
			month: "2026-03",
			capCents: 60_300,
			workPeriods: workMinutes.map((minutes, index) => ({ day: `2026-03-${10 + index}`, minutes })),
		});
	}

	async function setup() {
		const org = await fx.organization("a");
		const admin = await fx.user("admin");
		const worker = await fx.employee(org, "worker");
		const subject = {
			employeeId: worker.employeeId,
			kind: "minijob_unforeseeable_exceedance" as const,
			findingKind: "minijob_monthly_cap",
			subjectKey: "2026-03",
		};
		return { org, admin, worker, subject };
	}

	it("is current while the evaluated inputs are unchanged and stale once work is added", async () => {
		const { org, admin, subject } = await setup();
		const acknowledged = marchInputs([240, 300]);

		await recordStatutoryAcknowledgement(db, {
			organizationId: org.id,
			actorUserId: admin.userId,
			...subject,
			inputFingerprint: acknowledged,
			reason: "Covered an unplanned sick absence",
			legalNote: "§ 8 Abs. 1b SGB IV",
		});

		const unchanged = await loadStatutoryAcknowledgementStates(db, {
			organizationId: org.id,
			subjects: [{ ...subject, inputFingerprint: marchInputs([240, 300]) }],
		});
		expect(unchanged.get(subject)).toMatchObject({
			status: "current",
			latest: {
				acknowledgedBy: admin.userId,
				reason: "Covered an unplanned sick absence",
				legalNote: "§ 8 Abs. 1b SGB IV",
				findingKind: "minijob_monthly_cap",
				inputFingerprint: acknowledged,
			},
		});

		const changed = await loadStatutoryAcknowledgementStates(db, {
			organizationId: org.id,
			subjects: [{ ...subject, inputFingerprint: marchInputs([240, 300, 180]) }],
		});
		expect(changed.get(subject)).toMatchObject({
			status: "stale",
			latest: { inputFingerprint: acknowledged },
		});

		const april = { ...subject, subjectKey: "2026-04" };
		const other = await loadStatutoryAcknowledgementStates(db, {
			organizationId: org.id,
			subjects: [{ ...april, inputFingerprint: acknowledged }],
		});
		expect(other.get(april)).toEqual({ status: "none", latest: null });
	});

	it("keeps the history when the changed inputs are acknowledged again", async () => {
		const { org, admin, subject } = await setup();
		const base = { organizationId: org.id, actorUserId: admin.userId, ...subject };
		await recordStatutoryAcknowledgement(db, {
			...base,
			inputFingerprint: marchInputs([240]),
			reason: "First exceedance",
		});
		await recordStatutoryAcknowledgement(db, {
			...base,
			inputFingerprint: marchInputs([240]),
			reason: "Same inputs submitted twice",
		});
		await recordStatutoryAcknowledgement(db, {
			...base,
			inputFingerprint: marchInputs([240, 60]),
			reason: "Re-acknowledged after extra shift",
		});

		const states = await loadStatutoryAcknowledgementStates(db, {
			organizationId: org.id,
			subjects: [{ ...subject, inputFingerprint: marchInputs([240, 60]) }],
		});
		expect(states.get(subject)).toMatchObject({
			status: "current",
			latest: { reason: "Re-acknowledged after extra shift" },
		});
		expect(
			(await listStatutoryAcknowledgements(db, { organizationId: org.id, ...subject })).map(
				(row) => row.reason,
			),
		).toEqual(["Re-acknowledged after extra shift", "First exceedance"]);
	});

	it("acknowledges each finding on its own when findings share a kind and subject", async () => {
		const { org, admin, worker } = await setup();
		const shift = (kind: string, fingerprint: string): StatutoryFinding => ({
			id: statutoryFindingId(kind, worker.employeeId, "shift:s1"),
			organizationId: org.id,
			employeeId: worker.employeeId,
			domain: "youth_protection",
			kind,
			severity: "critical",
			subjectKey: "shift:s1",
			periodStart: "2026-03-08",
			periodEnd: "2026-03-09",
			legalReference: "JArbSchG",
			summary: {},
			adminDetail: null,
			inputFingerprint: fingerprint,
			acknowledgementKind: "jarbschg_sector_exception",
		});
		const night = shift("jarbschg_night_work", statutoryInputFingerprint({ start: "21:00" }));
		const sunday = shift("jarbschg_sunday_work", statutoryInputFingerprint({ day: "2026-03-08" }));
		await recordStatutoryAcknowledgement(db, {
			organizationId: org.id,
			actorUserId: admin.userId,
			employeeId: worker.employeeId,
			kind: "jarbschg_sector_exception",
			findingKind: night.kind,
			subjectKey: night.subjectKey,
			inputFingerprint: night.inputFingerprint,
			reason: "Hospitality sector exception for late service",
		});

		const [nightState, sundayState] = await attachAcknowledgementStates(db, org.id, [
			night,
			sunday,
		]);

		expect(nightState?.acknowledgement?.status).toBe("current");
		expect(sundayState?.acknowledgement).toEqual({
			status: "none",
			acknowledgedAt: null,
			acknowledgedBy: null,
			reason: null,
		});
	});

	it("requires a reason, subject and fingerprint", async () => {
		const { org, admin, subject } = await setup();
		const base = {
			organizationId: org.id,
			actorUserId: admin.userId,
			...subject,
			inputFingerprint: marchInputs([240]),
			reason: "Documented",
		};

		const withoutReason = recordStatutoryAcknowledgement(db, { ...base, reason: "  " });
		await expect(withoutReason).rejects.toBeInstanceOf(ValidationError);
		await expect(withoutReason).rejects.toMatchObject({ refusal: "statutory_reason_required" });
		for (const field of ["subjectKey", "findingKind", "inputFingerprint"] as const) {
			await expect(
				recordStatutoryAcknowledgement(db, { ...base, [field]: " " }),
			).rejects.toMatchObject({ refusal: "statutory_subject_required", field });
		}
		expect(await listStatutoryAcknowledgements(db, { organizationId: org.id })).toEqual([]);
	});

	it("refuses edits, direct deletes and backdating, but follows employee deletion", async () => {
		const { org, admin, worker, subject } = await setup();
		const recorded = await recordStatutoryAcknowledgement(db, {
			organizationId: org.id,
			actorUserId: admin.userId,
			...subject,
			inputFingerprint: marchInputs([240]),
			reason: "Documented",
		});
		const thisRow = and(
			eq(contractReviewAcknowledgement.id, recorded.id),
			eq(contractReviewAcknowledgement.organizationId, org.id),
		);

		await expect(
			db.update(contractReviewAcknowledgement).set({ note: "Rewritten" }).where(thisRow),
		).rejects.toThrow();
		await expect(db.delete(contractReviewAcknowledgement).where(thisRow)).rejects.toThrow();

		// A non-statutory row cannot be turned into a (backdated) statutory acknowledgement.
		const [plain] = await db
			.insert(contractReviewAcknowledgement)
			.values({
				organizationId: org.id,
				employeeId: worker.employeeId,
				reviewKind: "contract_review",
				dedupeKey: "plain-review",
				acknowledgedBy: admin.userId,
				acknowledgedAt: new Date("2025-01-01T00:00:00Z"),
				note: "Reviewed",
			})
			.returning();
		await expect(
			db
				.update(contractReviewAcknowledgement)
				.set({
					reviewKind: subject.kind,
					findingKind: subject.findingKind,
					subjectKey: subject.subjectKey,
					inputFingerprint: marchInputs([240, 60]),
				})
				.where(
					and(
						eq(contractReviewAcknowledgement.id, plain.id),
						eq(contractReviewAcknowledgement.organizationId, org.id),
					),
				),
		).rejects.toThrow();

		await db
			.delete(employee)
			.where(and(eq(employee.id, worker.employeeId), eq(employee.organizationId, org.id)));
		expect(await listStatutoryAcknowledgements(db, { organizationId: org.id })).toEqual([]);
	});

	it("keeps acknowledgements inside their organization", async () => {
		const { org, admin, subject } = await setup();
		const foreignOrg = await fx.organization("b");
		const foreignAdmin = await fx.user("foreign-admin");
		const fingerprint = marchInputs([240]);
		await recordStatutoryAcknowledgement(db, {
			organizationId: org.id,
			actorUserId: admin.userId,
			...subject,
			inputFingerprint: fingerprint,
			reason: "Documented",
		});

		await expect(
			recordStatutoryAcknowledgement(db, {
				organizationId: foreignOrg.id,
				actorUserId: foreignAdmin.userId,
				...subject,
				inputFingerprint: fingerprint,
				reason: "Foreign",
			}),
		).rejects.toBeInstanceOf(NotFoundError);
		const foreign = await loadStatutoryAcknowledgementStates(db, {
			organizationId: foreignOrg.id,
			subjects: [{ ...subject, inputFingerprint: fingerprint }],
		});
		expect(foreign.get(subject).status).toBe("none");
	});
});
