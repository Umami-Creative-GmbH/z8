import "server-only";
import { and, asc, eq, inArray, isNotNull } from "drizzle-orm";
import { user } from "@/db/auth-schema";
import { auditLog, employee } from "@/db/schema";
import { AuditAction } from "@/lib/audit-logger";
import type { AbsenceDaysDatabase } from "@/lib/absences/absence-days-resolver";
import { instantFromDate, plainDateAt } from "@/lib/datetime/temporal-core";
import { personnelNumberKey } from "@/lib/organization/personnel-number";
import {
	assertTrackingDateAdministrator,
	commitReviewedTrackingChange,
} from "@/lib/time-tracking/tracking-date-review";
import { trackingReviewFingerprint } from "@/lib/time-tracking/tracking-date-evidence";
import {
	TrackingDateRefusal,
	type TrackingDateImpact,
} from "@/lib/time-tracking/tracking-date-review-types";
import type { WorkBalanceDatabase } from "@/lib/work-balance/db-client";
import {
	applyReviewedEmploymentDateCorrection,
	loadEmploymentDateCorrectionImpact,
	type EmploymentDateCorrectionScope,
} from "./employment-date-correction";
import { parseEmploymentDateUploadCsv } from "./employment-date-upload-csv";
import type {
	EmploymentDateUploadOutcome,
	EmploymentDateUploadRow,
} from "./employment-date-upload-types";
import { refreshEmploymentDateResults } from "./employment-date-refresh";

type UploadInput = EmploymentDateCorrectionScope & { csv: string };
type ReadyReview = Extract<EmploymentDateUploadOutcome, { status: "ready" }>;
type BatchImpact = TrackingDateImpact & { rows: EmploymentDateUploadRow[] };
class UploadRejected extends Error {
	constructor(readonly outcome: EmploymentDateUploadOutcome) {
		super("The employment correction upload has row errors");
	}
}
const cellMessages: Record<string, string> = {
	employee_number_required: "Enter a personnel number.",
	invalid_date: "Enter a valid actual joining date (YYYY-MM-DD or DD.MM.YYYY).",
	reason_required: "Enter the reason and source for this correction.",
	reason_too_long: "Use at most 1,000 characters for the reason.",
};

/** Every match and every single-employee impact is read before any batch application. */
async function loadUploadReview(
	client: AbsenceDaysDatabase,
	input: UploadInput,
): Promise<EmploymentDateUploadOutcome> {
	const parsed = parseEmploymentDateUploadCsv(input.csv);
	if (!parsed.ok)
		return { status: "invalid_file", code: parsed.code, missingColumns: parsed.missingColumns };
	const candidates = await client
		.select({
			id: employee.id,
			employeeNumber: employee.employeeNumber,
			name: user.name,
			isActive: employee.isActive,
			employmentStartDate: employee.startDate,
		})
		.from(employee)
		.innerJoin(user, eq(user.id, employee.userId))
		.where(
			and(eq(employee.organizationId, input.organizationId), isNotNull(employee.employeeNumber)),
		);
	const byNumber = new Map<string, typeof candidates>();
	for (const candidate of candidates) {
		const key = personnelNumberKey(candidate.employeeNumber);
		if (key) byNumber.set(key, [...(byNumber.get(key) ?? []), candidate]);
	}
	const rows: EmploymentDateUploadRow[] = parsed.rows.map((parsed) => {
		const matches = byNumber.get(personnelNumberKey(parsed.employeeNumber) ?? "") ?? [];
		const errors: EmploymentDateUploadRow["errors"] = parsed.errors.map((code) => ({
			code,
			message: cellMessages[code] ?? code,
		}));
		if (parsed.employeeNumber && !matches.length)
			errors.push({
				code: "unknown_employee",
				message: "No employee in this organization has this personnel number.",
			});
		if (matches.length > 1)
			errors.push({
				code: "ambiguous_employee",
				message:
					"This personnel number matches more than one employee. Resolve the identifiers first.",
			});
		const match = matches.length === 1 ? matches[0] : null;
		return {
			...parsed,
			employee: match
				? {
						id: match.id,
						name: match.name,
						isActive: match.isActive,
						employmentStartDate: match.employmentStartDate
							? plainDateAt(instantFromDate(match.employmentStartDate), "UTC").toString()
							: null,
					}
				: null,
			impact: null,
			errors,
		};
	});
	const counts = new Map<string, number>();
	for (const row of rows)
		if (row.employee) counts.set(row.employee.id, (counts.get(row.employee.id) ?? 0) + 1);
	for (const row of rows) {
		if (row.employee && (counts.get(row.employee.id) ?? 0) > 1)
			row.errors.push({
				code: "duplicate_employee",
				message: "This employee appears more than once in the upload.",
			});
		if (row.errors.length || !row.employee || !row.employmentStartDate) continue;
		try {
			row.impact = await loadEmploymentDateCorrectionImpact(client, {
				...input,
				employeeId: row.employee.id,
				employmentStartDate: row.employmentStartDate,
			});
			for (const blocker of row.impact.employmentBlockers)
				row.errors.push({ code: blocker.code, message: blocker.message });
			for (const blocker of row.impact.blockers)
				row.errors.push(
					blocker.kind === "month_closed"
						? {
								code: "month_closed",
								message: `Month ${blocker.month} is closed. Reopen it separately, then generate a new preview.`,
							}
						: {
								code: "employee_exception_conflict",
								message: `The employee tracking exception ${blocker.exceptionDate} precedes the new minimum ${blocker.minimumDate}. Resolve the exception separately.`,
							},
				);
		} catch (error) {
			if (!(error instanceof TrackingDateRefusal)) throw error;
			row.errors.push({ code: error.code, message: error.message });
		}
	}
	if (rows.some((row) => row.errors.length)) return { status: "has_errors", rows };
	// A successful correction always appends its existing individual audit record. Bind those IDs
	// so an unchanged-date review is consumed even when source timestamps have the same precision.
	const correctionEvidence = await client
		.select({ id: auditLog.id })
		.from(auditLog)
		.where(
			and(
				eq(auditLog.organizationId, input.organizationId),
				eq(auditLog.action, AuditAction.EMPLOYEE_EMPLOYMENT_START_CORRECTED),
				inArray(
					auditLog.entityId,
					rows.flatMap((row) => (row.employee ? [row.employee.id] : [])),
				),
			),
		)
		.orderBy(asc(auditLog.id));
	const fingerprint = trackingReviewFingerprint({
		kind: "bulk_employment_date_correction",
		correctionEvidence,
		organizationId: input.organizationId,
		actorUserId: input.actorUserId,
		csv: input.csv,
		rows: rows.map((row) => ({
			row: row.row,
			employeeId: row.employee?.id,
			reason: row.reason,
			fingerprint: row.impact?.fingerprint,
		})),
	});
	return { status: "ready", rows, fingerprint };
}
function batchImpact(review: ReadyReview): BatchImpact {
	const first = review.rows[0]?.impact;
	if (!first) throw new Error("A valid upload needs an employment impact");
	return {
		kind: first.kind,
		currentDate: first.currentDate,
		proposedDate: first.proposedDate,
		fingerprint: review.fingerprint,
		employees: review.rows.flatMap((row) => row.impact?.employees ?? []),
		blockers: review.rows.flatMap((row) => row.impact?.blockers ?? []),
		rows: review.rows,
	};
}
export async function previewEmploymentDateUpload(
	database: WorkBalanceDatabase,
	input: UploadInput,
): Promise<EmploymentDateUploadOutcome> {
	return database.transaction(
		async (tx) => {
			await assertTrackingDateAdministrator(tx, input);
			return loadUploadReview(tx, input);
		},
		{ isolationLevel: "repeatable read", accessMode: "read only" },
	);
}
export async function commitEmploymentDateUpload(
	database: WorkBalanceDatabase,
	input: UploadInput & { fingerprint: string },
): Promise<EmploymentDateUploadOutcome> {
	if (typeof input.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(input.fingerprint))
		throw new TrackingDateRefusal(
			"invalid_input",
			"Review the complete upload before committing it.",
		);
	let impact: BatchImpact;
	try {
		impact = await commitReviewedTrackingChange(database, {
			...input,
			plan: async (client) => {
				const review = await loadUploadReview(client, input);
				if (review.status !== "ready") throw new UploadRejected(review);
				return batchImpact(review);
			},
			write: async (client, reviewed, audit) => {
				// All current source plans and the batch fingerprint were checked under the shared guards above.
				// Applying one row changes org-wide evidence; never revalidate a later row after writing an earlier one.
				for (const row of [...reviewed.rows].sort((a, b) =>
					(a.employee?.id ?? "").localeCompare(b.employee?.id ?? ""),
				)) {
					if (!row.impact) throw new Error("Missing reviewed employee impact");
					await applyReviewedEmploymentDateCorrection(
						client,
						{ ...input, reviewedImpact: row.impact, reason: row.reason },
						audit,
					);
				}
			},
		});
	} catch (error) {
		if (error instanceof UploadRejected) return error.outcome;
		throw error;
	}
	return {
		status: "committed",
		rows: impact.rows,
		corrected: impact.rows.length,
		refreshPending: await refreshEmploymentDateResults(input.organizationId, impact),
	};
}
