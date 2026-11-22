import type { SelectableEmployee } from "./types";

export interface SelectableEmployeeSource {
	id: string;
	userId?: string | null;
	name?: string | null;
	firstName?: string | null;
	lastName?: string | null;
	pronouns?: string | null;
	email?: string | null;
	image?: string | null;
	position?: string | null;
	role?: "admin" | "manager" | "employee";
	isActive?: boolean;
	isFormer?: boolean;
	formerSince?: string | null;
	clockStatus?: "clocked-in" | "on-break" | "clocked-out" | "unknown";
	teamId?: string | null;
	teamName?: string | null;
	team?: { id: string; name: string } | null;
	employeeNumber?: string | null;
	secondaryText?: string | null;
	searchKeywords?: string[];
}

export interface ToSelectableEmployeeOverrides {
	isActive?: boolean;
	isFormer?: boolean;
	formerSince?: string | null;
	role?: "admin" | "manager" | "employee";
	position?: string | null;
	secondaryText?: string | null;
	searchKeywords?: string[];
}

/**
 * Normalizes a pre-loaded employee/person record into the `SelectableEmployee`
 * shape expected by the unified employee picker.
 */
export function toSelectableEmployee(
	source: SelectableEmployeeSource,
	overrides?: ToSelectableEmployeeOverrides,
): SelectableEmployee {
	const firstName = source.firstName ?? null;
	const lastName = source.lastName ?? null;
	const fullName =
		source.name?.trim() ||
		[firstName, lastName].filter(Boolean).join(" ").trim() ||
		source.email?.trim() ||
		source.id;
	const userId = source.userId || source.id;
	const isFormer = overrides?.isFormer ?? source.isFormer;
	const isActive = overrides?.isActive ?? source.isActive ?? (isFormer ? false : true);
	const formerSince =
		overrides?.formerSince !== undefined ? overrides.formerSince : source.formerSince;
	const team =
		source.team !== undefined
			? source.team
			: source.teamName
				? { id: source.teamId ?? source.teamName, name: source.teamName }
				: null;
	const secondaryParts = [
		overrides?.secondaryText ?? source.secondaryText,
		source.employeeNumber,
		team?.name,
	].filter((part): part is string => Boolean(part && part.trim()));
	const uniqueSecondary = Array.from(new Set(secondaryParts)).join(" · ") || null;
	const keywords = [
		...(source.searchKeywords ?? []),
		...(overrides?.searchKeywords ?? []),
		...(source.employeeNumber ? [source.employeeNumber] : []),
		...(team?.name ? [team.name] : []),
	].filter((keyword): keyword is string => Boolean(keyword && keyword.trim()));

	return {
		id: source.id,
		userId,
		firstName,
		lastName,
		pronouns: source.pronouns ?? null,
		position: overrides?.position !== undefined ? overrides.position : (source.position ?? null),
		role: overrides?.role ?? source.role ?? "employee",
		isActive,
		...(isFormer !== undefined ? { isFormer } : {}),
		...((!isActive || isFormer) && formerSince !== undefined ? { formerSince } : {}),
		...(source.clockStatus ? { clockStatus: source.clockStatus } : {}),
		teamId: source.teamId ?? team?.id ?? null,
		user: {
			id: userId,
			firstName,
			lastName,
			name: fullName,
			email: source.email ?? "",
			image: source.image ?? null,
		},
		team,
		...(uniqueSecondary ? { secondaryText: uniqueSecondary } : {}),
		...(keywords.length > 0 ? { searchKeywords: keywords } : {}),
	};
}
