import { sql } from "drizzle-orm";
import { dateFromInstant } from "@/lib/datetime/temporal-core";
import type {
	ApprovalDbService,
	ApprovalProjectionWriter,
} from "../workflow/ports";
import type { ApprovalProjectionWriteInput } from "./contracts";

export function createApprovalProjectionWriter(
	dbService: ApprovalDbService,
): ApprovalProjectionWriter {
	return {
		async write(input: ApprovalProjectionWriteInput): Promise<void> {
			const updatedAt = dateFromInstant(input.updatedAt);
			const displayPayload = JSON.stringify(input.displayPayload);
			await dbService.db.execute(sql`
				insert into approval_requester_projection (
					organization_id, workflow_id, requester_employee_id, source_type,
					source_id, status, current_stage_order, display_payload, search_text,
					created_at, updated_at
				) values (
					${input.organizationId}, ${input.workflowId}, ${input.requesterEmployeeId},
					${input.sourceType}, ${input.sourceId}, ${input.status},
					${input.currentStageOrder}, ${displayPayload}::jsonb, ${input.searchText},
					${updatedAt}, ${updatedAt}
				)
				on conflict (organization_id, workflow_id) do update set
					requester_employee_id = excluded.requester_employee_id,
					source_type = excluded.source_type,
					source_id = excluded.source_id,
					status = excluded.status,
					current_stage_order = excluded.current_stage_order,
					display_payload = excluded.display_payload,
					search_text = excluded.search_text,
					updated_at = excluded.updated_at
			`);

			if (!input.activeInboxStage || input.status !== "pending") {
				await dbService.db.execute(sql`
					delete from approval_inbox_projection
					where organization_id = ${input.organizationId}
						and workflow_id = ${input.workflowId}
				`);
				return;
			}

			await dbService.db.execute(sql`
				with removed_stale_stage as (
					delete from approval_inbox_projection
					where organization_id = ${input.organizationId}
						and workflow_id = ${input.workflowId}
						and active_stage_id <> ${input.activeInboxStage.stageId}
				)
				insert into approval_inbox_projection (
					organization_id, workflow_id, active_stage_id, source_type, source_id,
					status, display_payload, search_text, created_at, updated_at
				) values (
					${input.organizationId}, ${input.workflowId}, ${input.activeInboxStage.stageId},
					${input.sourceType}, ${input.sourceId}, ${input.status},
					${displayPayload}::jsonb, ${input.searchText}, ${updatedAt}, ${updatedAt}
				)
				on conflict (organization_id, workflow_id, active_stage_id) do update set
					source_type = excluded.source_type,
					source_id = excluded.source_id,
					status = excluded.status,
					display_payload = excluded.display_payload,
					search_text = excluded.search_text,
					updated_at = excluded.updated_at
			`);
		},
	};
}
