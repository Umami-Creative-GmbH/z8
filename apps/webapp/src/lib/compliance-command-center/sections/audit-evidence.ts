import { and, desc, eq, gte } from "drizzle-orm";
import { DateTime } from "luxon";
import { db } from "@/db";
import { auditExportPackage, auditVerificationLog } from "@/db/schema";
import { configurationService } from "@/lib/audit-export";
import { auditPackRequestRepository } from "@/lib/audit-pack/application/request-repository";
import type { ComplianceSectionResult } from "../types";

export interface AuditEvidenceSnapshot {
	hasConfig: boolean;
	activeKeyFingerprint: string | null;
	recentFailedRequests: number;
	recentInvalidVerifications: number;
	latestSuccessAt: string | null;
}

export function deriveAuditEvidenceSection(
	snapshot: AuditEvidenceSnapshot,
): ComplianceSectionResult {
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
			status === "critical"
				? [
						{
							id: "audit-pack-failure",
							sectionKey: "auditEvidence",
							severity: "critical",
							title: "Audit pack generation failed",
							description: `Recent failed jobs: ${snapshot.recentFailedRequests}`,
							occurredAt: DateTime.utc().toISO()!,
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
	const [config, requests, invalidVerifications] = await Promise.all([
		configurationService.getConfig(organizationId),
		auditPackRequestRepository.listRequests({ organizationId, limit: 10 }),
		db
			.select({ id: auditVerificationLog.id })
			.from(auditVerificationLog)
			.innerJoin(auditExportPackage, eq(auditVerificationLog.packageId, auditExportPackage.id))
			.where(
				and(
					eq(auditExportPackage.organizationId, organizationId),
					eq(auditVerificationLog.isValid, false),
					gte(
						auditVerificationLog.verifiedAt,
						DateTime.utc().minus({ days: 7 }).toJSDate(),
					),
				),
			)
			.orderBy(desc(auditVerificationLog.verifiedAt))
			.limit(10),
	]);

	return deriveAuditEvidenceSection({
		hasConfig: Boolean(config),
		activeKeyFingerprint: config?.signingKeyFingerprint ?? null,
		recentFailedRequests: requests.filter((request) => request.status === "failed").length,
		recentInvalidVerifications: invalidVerifications.length,
		latestSuccessAt:
			requests.find((request) => request.status === "completed")?.completedAt?.toISOString() ??
			null,
	});
}
