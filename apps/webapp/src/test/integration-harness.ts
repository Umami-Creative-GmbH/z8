/**
 * Standard infrastructure fakes for the `integration` vitest project. The
 * database pool and the `@/db` binding come from `integration-setup.ts`; this
 * module holds the fakes most suites share, so a suite replaces only what its
 * own contract needs.
 *
 * Each export is a `vi.mock` module factory. `vi.mock` is hoisted above the
 * suite's imports, so a suite reaches the harness through a dynamic import:
 *
 *   vi.mock("next/cache", async (importOriginal) =>
 *   	(await import("@/test/integration-harness")).nextCache(importOriginal),
 *   );
 */
import { vi } from "vitest";

type ImportOriginal = <T>() => Promise<T>;

/** `connection()` throws outside a Next request scope. */
export async function nextServer(importOriginal: ImportOriginal) {
	return {
		...(await importOriginal<typeof import("next/server")>()),
		connection: async () => {},
	};
}

export function nextHeaders() {
	return { headers: async () => new Headers() };
}

export async function nextCache(importOriginal: ImportOriginal) {
	return {
		...(await importOriginal<typeof import("next/cache")>()),
		revalidatePath: vi.fn(),
		revalidateTag: vi.fn(),
	};
}

/** Billing always admits the mutation. Pass `importOriginal` to keep the other exports. */
export async function billingGuard(importOriginal?: ImportOriginal) {
	return {
		...(importOriginal ? await importOriginal<typeof import("@/lib/billing/guard")>() : {}),
		requireBillingForMutation: async () => ({ canAccess: true }),
		isBillingMutationAllowed: (access: { canAccess: boolean }) => access.canAccess,
	};
}

/** Silences every notification trigger, or only the named ones. */
export async function notificationTriggers(
	importOriginal: ImportOriginal,
	only?: readonly string[],
) {
	const original = await importOriginal<Record<string, unknown>>();
	return Object.fromEntries(
		Object.entries(original).map(([name, value]) => [
			name,
			typeof value === "function" && (!only || only.includes(name)) ? async () => undefined : value,
		]),
	);
}

/** The best-effort fast path only runs the owner sooner; suites run it explicitly. */
export function deliveryKick(kicks?: { organizationId: string; workflowId?: string | null }[]) {
	return {
		kickApprovalDelivery: (input: { organizationId: string; workflowId?: string | null }) => {
			kicks?.push(input);
		},
	};
}

export async function vault(
	importOriginal: ImportOriginal,
	getOrgSecret: (organizationId: string, key: string) => Promise<string | null>,
) {
	return { ...(await importOriginal<typeof import("@/lib/vault")>()), getOrgSecret };
}

export async function calendarSyncQueue(importOriginal: ImportOriginal) {
	return {
		...(await importOriginal<typeof import("@/lib/queue")>()),
		addCalendarSyncJob: async () => undefined,
	};
}

export function emailService() {
	return { sendEmail: async () => ({ success: true }) };
}

export async function absenceEmailRender(importOriginal: ImportOriginal) {
	return {
		...(await importOriginal<typeof import("@/lib/email/render")>()),
		renderAbsenceRequestSubmitted: async () => "<p>submitted</p>",
		renderAbsenceRequestPendingApproval: async () => "<p>pending</p>",
		renderAbsenceRequestApproved: async () => "<p>approved</p>",
		renderAbsenceRequestRejected: async () => "<p>rejected</p>",
	};
}
