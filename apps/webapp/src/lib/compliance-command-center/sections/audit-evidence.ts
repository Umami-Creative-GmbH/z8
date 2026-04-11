import { and, desc, eq, gte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { auditExportPackage, auditPackRequest, auditVerificationLog } from "@/db/schema";
import { configurationService } from "@/lib/audit-export";
import type { ComplianceSectionResult } from "../types";

const AUDIT_EVIDENCE_LOOKBACK_DAYS = 7;

export interface AuditEvidenceSnapshot {
	hasConfig: boolean;
	activeKeyFingerprint: string | null;
	recentFailedRequests: number;
	recentInvalidVerifications: number;
	latestIncidentAt: string | null;
	latestSuccessAt: string | null;
}

export function deriveAuditEvidenceSection(
	snapshot: AuditEvidenceSnapshot,
): ComplianceSectionResult {
	const criticalEvent =
		snapshot.recentFailedRequests > 0 && snapshot.recentInvalidVerifications > 0
			? {
				id: "audit-evidence-failure",
				title: "Audit evidence failures detected",
				description: `Recent failed jobs: ${snapshot.recentFailedRequests}; recent invalid verifications: ${snapshot.recentInvalidVerifications}`,
			}
			: snapshot.recentFailedRequests > 0
				? {
					id: "audit-pack-failure",
					title: "Audit pack generation failed",
					description: `Recent failed jobs: ${snapshot.recentFailedRequests}`,
				}
				: snapshot.recentInvalidVerifications > 0
					? {
						id: "audit-verification-failure",
						title: "Audit verification failed",
						description: `Recent invalid verifications: ${snapshot.recentInvalidVerifications}`,
					}
					: null;

	const status =
		snapshot.recentFailedRequests > 0 || snapshot.recentInvalidVerifications > 0
			? "critical"
			: !snapshot.hasConfig || !snapshot.activeKeyFingerprint
				? "warning"
				: "healthy";

	const facts = [
		snapshot.activeKeyFingerprint
			? `Active signing key: ${snapshot.activeKeyFingerprint}`
			: "Signing keys are not configured yet.",
		`Recent failed audit-pack jobs: ${snapshot.recentFailedRequests}`,
		`Recent invalid verification attempts: ${snapshot.recentInvalidVerifications}`,
		snapshot.latestSuccessAt
			? `Last successful audit pack: ${snapshot.latestSuccessAt}`
			: "No successful audit pack has been recorded yet.",
	];

	return {
		card: {
			key: "auditEvidence",
			status,
			headline:
				status === "critical"
					? "Audit evidence needs attention"
					: status === "warning"
						? "Audit evidence is only partially ready"
						: "Audit evidence signals look healthy",
			facts,
			updatedAt: DateTime.utc().toISO(),
			primaryLink: { label: "Open Audit Export", href: "/settings/audit-export" },
		},
			recentCriticalEvents:
				status === "critical" && criticalEvent
					? [
						{
							id: criticalEvent.id,
							sectionKey: "auditEvidence",
							severity: "critical",
							title: criticalEvent.title,
							description: criticalEvent.description,
							occurredAt: snapshot.latestIncidentAt ?? DateTime.utc().toISO()!,
							primaryLink: {
								label: "Review audit export",
								href: "/settings/audit-export",
							},
						},
					]
				: [],
	};
}

export async function getAuditEvidenceSection(
	organizationId: string,
): Promise<ComplianceSectionResult> {
	const lookbackStart = DateTime.utc()
		.minus({ days: AUDIT_EVIDENCE_LOOKBACK_DAYS })
		.toJSDate();
	const [config, recentFailedRequests, latestSuccess, invalidVerifications] = await Promise.all([
		configurationService.getConfig(organizationId),
		db.query.auditPackRequest.findMany({
			where: and(
				eq(auditPackRequest.organizationId, organizationId),
				eq(auditPackRequest.status, "failed"),
				gte(auditPackRequest.completedAt, lookbackStart),
			),
			columns: { id: true, completedAt: true },
		}),
		db.query.auditPackRequest.findFirst({
			where: and(
				eq(auditPackRequest.organizationId, organizationId),
				eq(auditPackRequest.status, "completed"),
			),
			columns: { completedAt: true },
			orderBy: [desc(auditPackRequest.completedAt)],
		}),
		db
			.select({ id: auditVerificationLog.id, verifiedAt: auditVerificationLog.verifiedAt })
			.from(auditVerificationLog)
			.innerJoin(auditExportPackage, eq(auditVerificationLog.packageId, auditExportPackage.id))
			.where(
				and(
					eq(auditExportPackage.organizationId, organizationId),
					eq(auditVerificationLog.isValid, false),
					gte(auditVerificationLog.verifiedAt, lookbackStart),
				),
			)
			.orderBy(desc(auditVerificationLog.verifiedAt))
			.limit(10),
	]);

	const latestFailedRequestAt = recentFailedRequests.reduce<Date | null>(
		(latest, request) => {
			if (!(request.completedAt instanceof Date)) {
				return latest;
			}

			if (!latest || request.completedAt.getTime() > latest.getTime()) {
				return request.completedAt;
			}

			return latest;
		},
		null,
	);
	const latestInvalidVerificationAt = invalidVerifications.reduce<Date | null>(
		(latest, verification) => {
			if (!(verification.verifiedAt instanceof Date)) {
				return latest;
			}

			if (!latest || verification.verifiedAt.getTime() > latest.getTime()) {
				return verification.verifiedAt;
			}

			return latest;
		},
		null,
	);
	const latestIncidentAt = [latestFailedRequestAt, latestInvalidVerificationAt]
		.filter((value): value is Date => value instanceof Date)
		.sort((left, right) => right.getTime() - left.getTime())[0]
		?.toISOString();

	return deriveAuditEvidenceSection({
		hasConfig: Boolean(config),
		activeKeyFingerprint: config?.signingKeyFingerprint ?? null,
		recentFailedRequests: recentFailedRequests.length,
		recentInvalidVerifications: invalidVerifications.length,
		latestIncidentAt: latestIncidentAt ?? null,
		latestSuccessAt: latestSuccess?.completedAt?.toISOString() ?? null,
	});
}
