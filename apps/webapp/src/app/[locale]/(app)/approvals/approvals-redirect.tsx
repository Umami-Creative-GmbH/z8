import { redirectWithLocale } from "@/lib/navigation/locale-redirect";

export type ApprovalsSearchParams = Record<string, string | string[] | undefined>;

/**
 * `/approvals` once rendered a two-tab workspace; the Approval inbox replaced it (#1976).
 * Bookmarks and old links land on the inbox with their query intact.
 */
export async function ApprovalsRedirect({
	searchParams,
}: {
	searchParams: Promise<ApprovalsSearchParams>;
}): Promise<never> {
	const query = new URLSearchParams();
	for (const [key, value] of Object.entries(await searchParams)) {
		for (const entry of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
			query.append(key, entry);
		}
	}
	const search = query.toString();
	return redirectWithLocale(search ? `/approvals/inbox?${search}` : "/approvals/inbox");
}
