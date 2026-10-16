import { and, asc, eq, inArray, ne } from "drizzle-orm";
import {
	drivingAuthorization,
	drivingAuthorizationEvent,
	drivingLicenceCheck,
	drivingLicenceSubject,
} from "@/db/schema/driving-licence-checks";
import { drivingLicenceSupplement } from "@/db/schema/driving-licence-history";
import { drivingImpedimentReport } from "@/db/schema/driving-licence-impediments";
import {
	drivingLicenceParticipant,
	drivingLicencePolicyRevision,
} from "@/db/schema/driving-licence-policy";
import { drivingLicenceVerifierGrant } from "@/db/schema/driving-licence-verifiers";
import { type PersonalDataCollector, tablePart } from "../collector";
import { instantText, loadSubjectEmployee, userNameLookup } from "../values";
import { drivingLicenceFieldGuide } from "./driving-licence-fields";

/** Read-only personal data collection, independent of live verifier privileges or active employment.
 * The pipeline enforces employee/admin access and the former-employee route before collection.
 * Other employees' check contents are never included merely because the subject verified them.
 */
export const drivingLicenceCollector: PersonalDataCollector = {
	category: "driving_licence",
	fields: drivingLicenceFieldGuide,
	async collect(database, scope) {
		await loadSubjectEmployee(database, scope);
		const { organizationId, employeeId } = scope;
		const checks = await database
			.select()
			.from(drivingLicenceCheck)
			.where(
				and(
					eq(drivingLicenceCheck.organizationId, organizationId),
					eq(drivingLicenceCheck.employeeId, employeeId),
				),
			)
			.orderBy(asc(drivingLicenceCheck.controlledAt));
		const supplements = await database
			.select()
			.from(drivingLicenceSupplement)
			.where(
				and(
					eq(drivingLicenceSupplement.organizationId, organizationId),
					eq(drivingLicenceSupplement.employeeId, employeeId),
				),
			)
			.orderBy(asc(drivingLicenceSupplement.recordedAt));
		const events = await database
			.select()
			.from(drivingAuthorizationEvent)
			.where(
				and(
					eq(drivingAuthorizationEvent.organizationId, organizationId),
					eq(drivingAuthorizationEvent.employeeId, employeeId),
				),
			)
			.orderBy(asc(drivingAuthorizationEvent.effectiveAt));
		const authorizations = await database
			.select()
			.from(drivingAuthorization)
			.where(
				and(
					eq(drivingAuthorization.organizationId, organizationId),
					eq(drivingAuthorization.employeeId, employeeId),
				),
			);
		const participation = await database
			.select()
			.from(drivingLicenceParticipant)
			.where(
				and(
					eq(drivingLicenceParticipant.organizationId, organizationId),
					eq(drivingLicenceParticipant.employeeId, employeeId),
				),
			);
		const suspension = await database
			.select()
			.from(drivingLicenceSubject)
			.where(
				and(
					eq(drivingLicenceSubject.organizationId, organizationId),
					eq(drivingLicenceSubject.employeeId, employeeId),
				),
			);
		const reports = await database
			.select()
			.from(drivingImpedimentReport)
			.where(
				and(
					eq(drivingImpedimentReport.organizationId, organizationId),
					eq(drivingImpedimentReport.employeeId, employeeId),
				),
			)
			.orderBy(asc(drivingImpedimentReport.reportedAt));
		const grants = await database
			.select()
			.from(drivingLicenceVerifierGrant)
			.where(
				and(
					eq(drivingLicenceVerifierGrant.organizationId, organizationId),
					eq(drivingLicenceVerifierGrant.verifierEmployeeId, employeeId),
				),
			);
		const performed = await database
			.select({
				id: drivingLicenceCheck.id,
				employeeId: drivingLicenceCheck.employeeId,
				controlledAt: drivingLicenceCheck.controlledAt,
			})
			.from(drivingLicenceCheck)
			.where(
				and(
					eq(drivingLicenceCheck.organizationId, organizationId),
					eq(drivingLicenceCheck.verifierEmployeeId, employeeId),
					ne(drivingLicenceCheck.employeeId, employeeId),
				),
			);
		const authored = await database
			.select({
				id: drivingLicenceSupplement.id,
				employeeId: drivingLicenceSupplement.employeeId,
				checkId: drivingLicenceSupplement.checkId,
				recordedAt: drivingLicenceSupplement.recordedAt,
				reason: drivingLicenceSupplement.reason,
			})
			.from(drivingLicenceSupplement)
			.where(
				and(
					eq(drivingLicenceSupplement.organizationId, organizationId),
					eq(drivingLicenceSupplement.authorEmployeeId, employeeId),
					ne(drivingLicenceSupplement.employeeId, employeeId),
				),
			);
		const versions = new Set(checks.map((c) => c.policyVersion));
		for (const event of events)
			if (event.reason?.startsWith("policy_version:")) {
				const version = Number(event.reason.slice("policy_version:".length));
				if (Number.isSafeInteger(version)) versions.add(version);
			}
		const policies = versions.size
			? await database
					.select()
					.from(drivingLicencePolicyRevision)
					.where(
						and(
							eq(drivingLicencePolicyRevision.organizationId, organizationId),
							inArray(drivingLicencePolicyRevision.version, [...versions]),
						),
					)
					.orderBy(asc(drivingLicencePolicyRevision.version))
			: [];
		const name = await userNameLookup(database, [
			...events.map((e) => e.actorUserId),
			...reports.flatMap((r) => [r.reporterUserId, r.resolvedByUserId]),
			...policies.map((p) => p.changedBy),
			...participation.map((p) => p.enrolledBy),
			...grants.flatMap((g) => [g.grantedBy, g.revokedBy]),
		]);
		return {
			category: "driving_licence",
			parts: [
				tablePart(
					"checks",
					[
						"id",
						"employment_period_id",
						"controlled_at",
						"verifier_name",
						"document_issued_on",
						"document_expires_on",
						"original_inspected",
						"identity_confirmed",
						"employee_declaration",
						"declaration_text",
						"verifier_confirmed",
						"failure_scope",
						"policy_version",
						"interval_months",
						"deadline_timezone",
					],
					checks.map((c) => ({
						id: c.id,
						employment_period_id: c.employmentPeriodId,
						controlled_at: instantText(c.controlledAt),
						verifier_name: c.verifierName,
						document_issued_on: c.documentIssuedOn,
						document_expires_on: c.documentExpiresOn,
						original_inspected: c.originalInspected,
						identity_confirmed: c.identityConfirmed,
						employee_declaration: c.employeeDeclaration,
						declaration_text: c.declarationText,
						verifier_confirmed: c.verifierConfirmed,
						failure_scope: c.failureScope,
						policy_version: c.policyVersion,
						interval_months: c.intervalMonths,
						deadline_timezone: c.deadlineTimezone,
					})),
				),
				tablePart(
					"checked_classes",
					["check_id", "class_code", "result", "expiry_date", "restrictions"],
					checks.flatMap((c) =>
						c.classes.map((v) => ({
							check_id: c.id,
							class_code: v.code,
							result: v.result,
							expiry_date: v.expiryDate,
							restrictions: v.restrictions,
						})),
					),
				),
				tablePart(
					"supplements",
					[
						"id",
						"check_id",
						"recorded_at",
						"author_name",
						"reason",
						"field",
						"class_code",
						"value",
					],
					supplements.map((s) => ({
						id: s.id,
						check_id: s.checkId,
						recorded_at: instantText(s.recordedAt),
						author_name: s.authorName,
						reason: s.reason,
						field: s.correction.field,
						class_code:
							"classCode" in s.correction ? s.correction.classCode : null,
						value: s.correction.value,
					})),
				),
				tablePart(
					"authorization_events",
					[
						"id",
						"employment_period_id",
						"class_code",
						"check_id",
						"kind",
						"reason",
						"effective_at",
						"recorded_at",
						"actor_name",
					],
					events.map((e) => ({
						id: e.id,
						employment_period_id: e.employmentPeriodId,
						class_code: e.classCode,
						check_id: e.checkId,
						kind: e.kind,
						reason: e.reason,
						effective_at: instantText(e.effectiveAt),
						recorded_at: instantText(e.recordedAt),
						actor_name: name(e.actorUserId),
					})),
				),
				tablePart(
					"authorizations",
					[
						"id",
						"employment_period_id",
						"class_code",
						"check_id",
						"last_successful_at",
						"routine_valid_through",
						"document_valid_through",
						"class_valid_through",
						"valid_through",
						"deadline_timezone",
						"expires_at",
						"restrictions",
						"state",
						"reason",
						"suspended_at",
					],
					authorizations.map((a) => ({
						id: a.id,
						employment_period_id: a.employmentPeriodId,
						class_code: a.classCode,
						check_id: a.supportingCheckId,
						last_successful_at: instantText(a.lastSuccessfulAt),
						routine_valid_through: a.routineValidThrough,
						document_valid_through: a.documentValidThrough,
						class_valid_through: a.classValidThrough,
						valid_through: a.validThrough,
						deadline_timezone: a.deadlineTimezone,
						expires_at: instantText(a.expiresAt),
						restrictions: a.restrictions,
						state: a.state,
						reason: a.suspensionReason,
						suspended_at: instantText(a.suspendedAt),
					})),
				),
				tablePart(
					"impediment_reports",
					[
						"id",
						"employment_period_id",
						"scope",
						"reported_at",
						"reporter_name",
						"resolved_at",
						"resolved_by",
						"check_id",
					],
					reports.map((r) => ({
						id: r.id,
						employment_period_id: r.employmentPeriodId,
						scope: r.scope,
						reported_at: instantText(r.reportedAt),
						reporter_name: name(r.reporterUserId),
						resolved_at: instantText(r.resolvedAt),
						resolved_by: name(r.resolvedByUserId),
						check_id: r.resolutionCheckId,
					})),
				),
				tablePart(
					"participation",
					["id", "enrolled_at", "actor_name"],
					participation.map((p) => ({
						id: p.id,
						enrolled_at: instantText(p.enrolledAt),
						actor_name: name(p.enrolledBy),
					})),
				),
				tablePart(
					"suspension",
					["employment_period_id", "kind", "suspended_at", "check_id"],
					suspension.map((s) => ({
						employment_period_id: s.employmentPeriodId,
						kind: s.suspensionKind,
						suspended_at: instantText(s.suspendedAt),
						check_id: s.sourceCheckId,
					})),
				),
				tablePart(
					"verifier_grants",
					[
						"id",
						"employment_period_id",
						"scope",
						"team_ids",
						"employee_ids",
						"granted_at",
						"granted_by",
						"expires_at",
						"revoked_at",
						"revoked_by",
					],
					grants.map((g) => ({
						id: g.id,
						employment_period_id: g.employmentPeriodId,
						scope: g.scope,
						team_ids: JSON.stringify(g.teamIds),
						employee_ids: JSON.stringify(g.employeeIds),
						granted_at: instantText(g.grantedAt),
						granted_by: name(g.grantedBy),
						expires_at: instantText(g.expiresAt),
						revoked_at: instantText(g.revokedAt),
						revoked_by: name(g.revokedBy),
					})),
				),
				tablePart(
					"checks_performed",
					["id", "employee_id", "controlled_at"],
					performed.map((c) => ({
						id: c.id,
						employee_id: c.employeeId,
						controlled_at: instantText(c.controlledAt),
					})),
				),
				tablePart(
					"supplements_authored",
					["id", "employee_id", "check_id", "recorded_at", "reason"],
					authored.map((s) => ({
						id: s.id,
						employee_id: s.employeeId,
						check_id: s.checkId,
						recorded_at: instantText(s.recordedAt),
						reason: s.reason,
					})),
				),
				tablePart(
					"policies",
					[
						"policy_version",
						"enabled",
						"interval_months",
						"deadline_timezone",
						"reminder_lead_days",
						"retention_months",
						"retention_justification",
						"changed_at",
						"actor_name",
					],
					policies.map((p) => ({
						policy_version: p.version,
						enabled: p.policy.enabled,
						interval_months: p.policy.intervalMonths,
						deadline_timezone: p.policy.timezone,
						reminder_lead_days: JSON.stringify(p.policy.reminderLeadDays),
						retention_months: p.policy.retentionMonths,
						retention_justification: p.policy.retentionJustification,
						changed_at: instantText(p.changedAt),
						actor_name: name(p.changedBy),
					})),
				),
			],
		};
	},
};
