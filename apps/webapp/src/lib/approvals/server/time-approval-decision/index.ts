/**
 * The time approval decision (spec #1673): its one public interface. Entry
 * points import only from here. The two owners it routes to (the time
 * correction owner and the ordinary work-period owner) and the runtime it
 * builds are internal to this module; `boundary.test.ts` fails on any other
 * caller of them.
 */
export {
	type CardDecisionRight,
	decideTimeApproval,
	type TimeApprovalCard,
	type TimeApprovalDecisionInput,
	type TimeApprovalDecisionReceipt,
	type TimeApprovalDecisionRefusal,
	type TimeApprovalDecisionRefusalReason,
	type TimeApprovalDecisionResult,
	type TimeApprovalRefusalDetail,
} from "./decision";
