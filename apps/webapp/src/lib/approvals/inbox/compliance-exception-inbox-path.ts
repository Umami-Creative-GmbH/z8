/**
 * The Approval inbox filtered to compliance exceptions (#1977): where notifications, chat
 * digests, Teams cards, the compliance command center and the old `/settings/compliance` route
 * send whoever decides them. Relative to the app; chat messages prefix the app URL.
 *
 * The request proxy's 308 for `/settings/compliance` redirects to this view as a pathname and a
 * `types` filter, so it can keep the old URL's other query parameters.
 */
export const COMPLIANCE_EXCEPTION_INBOX = {
	pathname: "/approvals/inbox",
	types: "compliance_exception",
} as const;

export const COMPLIANCE_EXCEPTION_INBOX_PATH =
	`${COMPLIANCE_EXCEPTION_INBOX.pathname}?types=${COMPLIANCE_EXCEPTION_INBOX.types}` as const;
