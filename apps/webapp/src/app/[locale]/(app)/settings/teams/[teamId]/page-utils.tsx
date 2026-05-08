export {
	AddMemberDialog,
	DeleteTeamDialog,
	RemoveMemberDialog,
	TeamInfoCard,
	TeamMembersCard,
	TeamPageHeader,
} from "./page-sections";
export { invalidateTeamQueries, useTeamPageUiState } from "./page-state";

export type TeamFormValues = {
	name?: string;
	description?: string | null;
	primaryManagerId?: string | null;
};

export function extractTeamMemberIds(team: any): string[] {
	return team.employees?.map((employee: any) => employee.id) ?? [];
}
