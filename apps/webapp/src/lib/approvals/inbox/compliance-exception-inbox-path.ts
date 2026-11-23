/**
 * The Approval inbox filtered to compliance exceptions (#1977): where notifications, chat
 * digests, Teams cards, the compliance command center and the old `/settings/compliance` route
 * send whoever decides them. Relative to the app; chat messages prefix the app URL.
 */
export const COMPLIANCE_EXCEPTION_INBOX_PATH = "/approvals/inbox?types=compliance_exception";
