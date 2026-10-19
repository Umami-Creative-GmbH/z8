import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { db as appDb } from "@/db";
import {
	employeeDocument,
	type employeeDocumentRequest,
	employeeDocumentRequestDocument,
	employeeDocumentRequestSubmission,
} from "@/db/schema";
import type { Instant } from "@/lib/datetime/temporal-core";
import type { PersonnelFileAccess } from "./access";
import { setCertificateSkillInTransaction } from "./skill-certificate";
import { recomputeCertificateSkillExpiry } from "./skill-certificate-expiry";
import { loadCertificateSkill } from "./skill-certificate-store";

/**
 * Accepting the renewal of a skill certificate links the employee skill
 * (#1405, spec #1307, ADR 0003). When the renewed document of an accepted
 * request is a certificate that names an employee skill, every certificate of
 * the accepted submission is linked to that employee skill with the existing
 * skill-certificate rules, in the accept's transaction, the renewed certificate
 * stops naming the skill (it stays in the file), and the skill expiry date is
 * recomputed once from the certificates that name it then (#1145: the latest
 * dated one; none dated = no expiry date; user decision 2026-10-19). An
 * employee never moves a skill expiry date through a request: only this
 * officer's acceptance does.
 *
 * When the skill requires an expiry date, only the dated certificates are
 * linked; undated ones stay in the file unlinked (user decision 2026-10-18).
 * The accept is refused only when none of them is dated: the officer dates one
 * with the document metadata edit first.
 *
 * Lock order: the request (the caller), then the documents (here, by id), then
 * the employee skills (one recompute, last).
 */

type Database = typeof appDb;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type DocumentRequestRow = typeof employeeDocumentRequest.$inferSelect;

export type RenewalSkillLinkPlan =
	/** Not a renewal of a skill certificate: accepting links nothing. */
	| { kind: "none" }
	/** The skill requires an expiry date and no submitted certificate has one. */
	| { kind: "refused"; reason: "renewal_expiry_date_required" }
	| {
			kind: "link";
			employeeSkillId: string;
			documentIds: string[];
			/** The renewed certificate: it stops naming the skill (it stays in the file). */
			renewedDocumentId: string;
	  };

/**
 * What accepting the request links, read under the documents' locks. Call it
 * with the request locked and before the accept event, so a refusal changes
 * nothing.
 */
export async function planRenewalSkillLink(
	tx: Transaction,
	request: DocumentRequestRow,
): Promise<RenewalSkillLinkPlan> {
	if (!request.renewedDocumentId) return { kind: "none" };
	const organizationId = request.organizationId;
	// The accepted submission is the last one; earlier ones were returned.
	const [submission] = await tx
		.select({ id: employeeDocumentRequestSubmission.id })
		.from(employeeDocumentRequestSubmission)
		.where(
			and(
				eq(employeeDocumentRequestSubmission.organizationId, organizationId),
				eq(employeeDocumentRequestSubmission.requestId, request.id),
			),
		)
		.orderBy(
			desc(employeeDocumentRequestSubmission.submittedAt),
			desc(employeeDocumentRequestSubmission.id),
		)
		.limit(1);
	const submitted = submission
		? await tx
				.select({ documentId: employeeDocumentRequestDocument.documentId })
				.from(employeeDocumentRequestDocument)
				.where(
					and(
						eq(employeeDocumentRequestDocument.organizationId, organizationId),
						eq(employeeDocumentRequestDocument.requestId, request.id),
						eq(employeeDocumentRequestDocument.submissionId, submission.id),
					),
				)
		: [];
	const documents = await tx
		.select()
		.from(employeeDocument)
		.where(
			and(
				eq(employeeDocument.organizationId, organizationId),
				inArray(employeeDocument.id, [
					request.renewedDocumentId,
					...submitted.map((row) => row.documentId),
				]),
			),
		)
		.orderBy(asc(employeeDocument.id))
		.for("update");

	const renewed = documents.find((document) => document.id === request.renewedDocumentId);
	if (
		renewed?.category !== "certificate" ||
		renewed.employeeId !== request.employeeId ||
		!renewed.employeeSkillId
	) {
		return { kind: "none" };
	}
	const skill = await loadCertificateSkill(tx, {
		organizationId,
		employeeId: request.employeeId,
		employeeSkillId: renewed.employeeSkillId,
	});
	if (!skill) return { kind: "none" };

	const certificates = documents.filter(
		(document) =>
			document.id !== renewed.id &&
			document.category === "certificate" &&
			document.employeeId === request.employeeId,
	);
	const linkable = skill.requiresExpiry
		? certificates.filter((document) => document.expiryDate !== null)
		: certificates;
	if (skill.requiresExpiry && linkable.length === 0) {
		return { kind: "refused", reason: "renewal_expiry_date_required" };
	}
	if (linkable.length === 0) return { kind: "none" };
	return {
		kind: "link",
		employeeSkillId: skill.employeeSkillId,
		documentIds: linkable.map((document) => document.id),
		renewedDocumentId: renewed.id,
	};
}

/**
 * Links the planned certificates and unlinks the renewed one (each audited as
 * a skill-certificate link or unlink by the deciding officer, naming the
 * request), then recomputes the skill expiry date once for the employee skill
 * and every skill a certificate stopped naming. The renewed skill's date then
 * comes from the certificates that still name it; when none of them is dated
 * it has no expiry date (user decision 2026-10-19), while other skills keep
 * theirs as usual.
 */
export async function applyRenewalSkillLink(
	tx: Transaction,
	access: PersonnelFileAccess,
	plan: Extract<RenewalSkillLinkPlan, { kind: "link" }>,
	input: { requestId: string; now: Instant },
): Promise<void> {
	const previous: (string | null)[] = [];
	const changes = [
		...plan.documentIds.map((documentId) => ({
			documentId,
			employeeSkillId: plan.employeeSkillId as string | null,
		})),
		{ documentId: plan.renewedDocumentId, employeeSkillId: null },
	].toSorted((a, b) => a.documentId.localeCompare(b.documentId));
	// In id order, under the locks the plan took.
	// react-doctor-disable-next-line react-doctor/async-await-in-loop
	for (const { documentId, employeeSkillId } of changes) {
		const linked = await setCertificateSkillInTransaction(
			tx,
			access,
			{
				documentId,
				employeeSkillId,
				auditMetadata: { documentRequestId: input.requestId },
			},
			input.now,
		);
		// Locked and checked under the request's lock: only a bug gets here.
		if (linked.kind !== "saved") {
			throw new Error(`Failed to link the renewed skill certificate: ${linked.kind}`);
		}
		previous.push(linked.from);
	}
	await recomputeCertificateSkillExpiry(tx, {
		organizationId: access.organizationId,
		employeeSkillIds: [plan.employeeSkillId, ...previous],
		clearWhenUndated: [plan.employeeSkillId],
	});
}
