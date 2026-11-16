/**
 * Why one person may decide one approval, and as whom (Approvals ADR 0003).
 *
 * A decision is made under exactly one claimed right. The decision's own
 * transaction verifies it from the database and never exchanges it for
 * another right the person may also hold. Kind-neutral: time approvals use it
 * first; the approval inbox and the other kinds follow.
 */
export type DecisionRight =
	| { as: "approver" }
	| { as: "eligible_manager" }
	| { as: "approval_manager" }
	| { as: "covering_deputy"; forEmployeeId: string };

export type DecisionRightName = DecisionRight["as"];
