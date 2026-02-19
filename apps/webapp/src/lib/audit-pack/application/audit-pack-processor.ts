import { auditPackOrchestrator } from "@/lib/audit-pack";
import type { AuditPackJobData } from "@/lib/queue";

export async function processAuditPack(data: AuditPackJobData): Promise<void> {
	if (!data.requestId) {
		throw new Error("Audit pack request ID is required");
	}

	if (!data.organizationId) {
		throw new Error("Audit pack organization ID is required");
	}

	await auditPackOrchestrator.generate({
		requestId: data.requestId,
		organizationId: data.organizationId,
	});
}
