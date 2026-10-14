import { ConflictError } from "@/lib/effect/errors";
import type { MessageTranslate } from "@/lib/i18n/message-translate";
import {
	describePersonnelIdentifierClashes,
	type PayrollIdentifierDuplicateError,
} from "./personnel-identifier";

/**
 * The refusal of an export that would write two employees under one personnel
 * identifier (#1198, #1199), as every interactive export action returns it: a
 * conflict whose message, in the user's language, names the employees. They
 * are in the requester's export scope.
 */
export function payrollIdentifierDuplicateConflict(
	error: PayrollIdentifierDuplicateError,
	t: MessageTranslate,
): ConflictError {
	return new ConflictError({
		message: t(
			"payroll.errors.exportBlockedByDuplicateIdentifier",
			"Export blocked: several employees share a personnel identifier. Give each employee their own: {employees}",
			{ employees: describePersonnelIdentifierClashes(error.clashes) },
		),
		conflictType: "payroll_identifier_duplicate",
		details: {
			organizationId: error.organizationId,
			clashes: error.clashes.map((clash) =>
				clash.employees.map(({ employeeId, identifier }) => ({ employeeId, identifier })),
			),
		},
	});
}
