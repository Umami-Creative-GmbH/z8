import type { Job } from "bullmq";
import { addAuditPackJob as addAuditPackQueueJob, type JobData, type JobResult } from "@/lib/queue";

export interface AddAuditPackJobInput {
	requestId: string;
	organizationId: string;
}

export async function addAuditPackJob(
	input: AddAuditPackJobInput,
): Promise<Job<JobData, JobResult>> {
	return addAuditPackQueueJob({
		requestId: input.requestId,
		organizationId: input.organizationId,
	});
}
