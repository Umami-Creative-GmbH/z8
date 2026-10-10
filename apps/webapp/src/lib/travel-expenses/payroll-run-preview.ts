import "server-only";

import { eq } from "drizzle-orm";
import { db as appDb } from "@/db";
import { travelExpensePayrollRunPreviewControl } from "@/db/schema";

/**
 * The preview gate of the payroll run reimbursement channel (#849). It stays
 * closed until the activation ticket (#856) sets the organization's control row
 * to `active`; the application never opens it.
 */
export async function isPayrollRunPreviewOpen(
	organizationId: string,
	options: { database?: Pick<typeof appDb, "select"> } = {},
): Promise<boolean> {
	const [control] = await (options.database ?? appDb)
		.select({ mode: travelExpensePayrollRunPreviewControl.mode })
		.from(travelExpensePayrollRunPreviewControl)
		.where(eq(travelExpensePayrollRunPreviewControl.organizationId, organizationId))
		.limit(1);
	return control?.mode === "active";
}
