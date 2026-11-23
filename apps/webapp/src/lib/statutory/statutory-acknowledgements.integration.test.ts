/**
 * #1988: audited statutory acknowledgements in `contract_review_acknowledgement`: actor, time,
 * reason, legal note and the deterministic input fingerprint; stale as soon as a later evaluation
 * of changed inputs yields another fingerprint; immutable; organization-scoped.
 */
import { and, eq } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { contractReviewAcknowledgement } from "@/db/schema";
import { NotFoundError, ValidationError } from "@/lib/effect/errors";
import { integrationAdminPool } from "@/test/integration-database";
import { statutoryFixture } from "@/test/statutory-fixtures";
import {
	listStatutoryAcknowledgements,
	loadStatutoryAcknowledgementStates,
	recordStatutoryAcknowledgement,
} from "./acknowledgements";
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

		const other = await loadStatutoryAcknowledgementStates(db, {
			organizationId: org.id,
			subjects: [{ ...subject, subjectKey: "2026-04", inputFingerprint: acknowledged }],
		});
		expect(other.get({ ...subject, subjectKey: "2026-04" })).toEqual({
			status: "none",
			latest: null,
		});
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

	it("requires a reason and refuses edits to a recorded acknowledgement", async () => {
		const { org, admin, subject } = await setup();
		const base = {
			organizationId: org.id,
			actorUserId: admin.userId,
			...subject,
			inputFingerprint: marchInputs([240]),
		};

		const withoutReason = recordStatutoryAcknowledgement(db, { ...base, reason: "  " });
		await expect(withoutReason).rejects.toBeInstanceOf(ValidationError);
		await expect(withoutReason).rejects.toMatchObject({ refusal: "statutory_reason_required" });

		const recorded = await recordStatutoryAcknowledgement(db, { ...base, reason: "Documented" });
		await expect(
			db
				.update(contractReviewAcknowledgement)
				.set({ note: "Rewritten" })
				.where(
					and(
						eq(contractReviewAcknowledgement.id, recorded.id),
						eq(contractReviewAcknowledgement.organizationId, org.id),
					),
				),
		).rejects.toThrow();
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
		expect(foreign.get(subject)?.status).toBe("none");
	});
});
