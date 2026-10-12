import "server-only";

import type { PlainDate } from "@/lib/datetime/temporal-core";
import type { CustomFieldReader } from "@/lib/organization/custom-fields/definitions";
import { readCustomFieldReportValues } from "@/lib/organization/custom-fields/report-reads";
import type { CustomFieldReportValue } from "@/lib/organization/custom-fields/report-values";
import { loadCustomFieldViewerLevel } from "@/lib/organization/custom-fields/values";

/**
 * The custom fields a project report shows (#820): the project's and its
 * customer's active fields that the reader's base role sees, as of `asOf`
 * (the period's last day). The caller has checked the reader may read the
 * project's report; the customer is the project's current (active) one.
 */
export async function readProjectReportCustomFields(
	reader: CustomFieldReader,
	input: {
		organizationId: string;
		readerUserId: string;
		projectId: string;
		customerId: string | null;
		asOf: PlainDate;
	},
): Promise<{ project: CustomFieldReportValue[]; customer: CustomFieldReportValue[] | null }> {
	const level = await loadCustomFieldViewerLevel(reader, {
		organizationId: input.organizationId,
		userId: input.readerUserId,
	});
	const read = (entity: "project" | "customer", recordId: string) =>
		readCustomFieldReportValues(reader, {
			organizationId: input.organizationId,
			entity,
			recordIds: [recordId],
			asOf: input.asOf,
			viewer: { kind: "level", level },
		}).then((result) => result.byRecord[recordId] ?? []);
	const [project, customer] = await Promise.all([
		read("project", input.projectId),
		input.customerId ? read("customer", input.customerId) : null,
	]);
	return { project, customer };
}
