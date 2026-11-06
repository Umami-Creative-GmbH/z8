import { normalizePronouns } from "@/lib/employee-identity";
import type { OrgExplorerPerson } from "./org-explorer-types";

/** A person's name, followed by their pronouns when they share them. */
export function personDisplayName(
	person: Pick<OrgExplorerPerson, "name" | "pronouns">,
) {
	const pronouns = normalizePronouns(person.pronouns);
	return pronouns ? `${person.name} (${pronouns})` : person.name;
}
