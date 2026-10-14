/**
 * How the works-council portal's review sections (position capture #834,
 * vehicle use #1130) refer to people under the works council's
 * `identityVisibility`. No I/O.
 */
import type { WorksCouncilIdentityVisibility } from "@/db/schema/works-council";

/** The works council's identity and aggregation rules a review section follows. */
export type WorksCouncilReviewVisibility = {
	identityVisibility: WorksCouncilIdentityVisibility;
	minimumAggregationThreshold: number;
};

/**
 * How a person appears in a section. `named` only under "named" identity
 * visibility; `pseudonym` refs are letters stable within one section's
 * rendering, assigned in id order so they reveal nothing about names.
 */
export type WorksCouncilReviewIdentity =
	| { kind: "named"; name: string }
	| { kind: "pseudonym"; ref: string }
	| { kind: "hidden" };

/**
 * Maps ids to identities under the visibility: names, pseudonym letters given
 * out in sorted id order, or nothing at all.
 */
export function reviewIdentities(
	visibility: WorksCouncilIdentityVisibility,
	ids: readonly string[],
	nameOf: (id: string) => string | undefined,
): (id: string) => WorksCouncilReviewIdentity {
	if (visibility === "aggregated") return () => ({ kind: "hidden" });
	if (visibility === "named") {
		return (id) => {
			const name = nameOf(id)?.trim();
			return name ? { kind: "named", name } : { kind: "hidden" };
		};
	}
	const refs = new Map(
		[...new Set(ids)].sort().map((id, index) => [id, pseudonymRef(index)] as const),
	);
	return (id) => {
		const ref = refs.get(id);
		return ref ? { kind: "pseudonym", ref } : { kind: "hidden" };
	};
}

/** A, B, …, Z, AA, AB, … */
function pseudonymRef(index: number): string {
	let ref = "";
	let rest = index;
	do {
		ref = String.fromCharCode(65 + (rest % 26)) + ref;
		rest = Math.floor(rest / 26) - 1;
	} while (rest >= 0);
	return ref;
}

/** Orders identities by name, or by pseudonym (A before AA). */
export function reviewIdentitySortKey(identity: WorksCouncilReviewIdentity): string {
	if (identity.kind === "named") return identity.name;
	if (identity.kind === "pseudonym") return identity.ref.padStart(4, " ");
	return "";
}

/** An identity as an English CSV cell: the name, "<prefix> <ref>" or "hidden". */
export function csvReviewIdentity(identity: WorksCouncilReviewIdentity, prefix: string): string {
	if (identity.kind === "named") return identity.name;
	if (identity.kind === "pseudonym") return `${prefix} ${identity.ref}`;
	return "hidden";
}
