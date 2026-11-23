import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

/**
 * `/settings/compliance` once rendered a standalone ArbZG compliance exception queue; the
 * Approval inbox lists them now (#1977, Approvals ADR-0005). The request proxy answers the
 * old URL with a 308 already; this keeps the route itself pointing at the inbox too.
 */
export async function ComplianceExceptionsRedirect(): Promise<never> {
	return redirectWithLocale("/approvals/inbox?types=compliance_exception");
}
