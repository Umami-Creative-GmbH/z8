"use client";

import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { PersonButton } from "./org-explorer-person";
import type { GroupedTeams, TeamCard } from "./org-explorer-teams";
import type { OrgExplorerPerson } from "./org-explorer-types";

export type TeamsViewProps = {
	grouped: GroupedTeams;
	/** Whether every person is loaded, so nothing needs loading on request. */
	complete: boolean;
	noTeamCount: number;
	loadingTeamIds: ReadonlySet<string>;
	isNoTeamLoaded: boolean;
	isNoTeamLoading: boolean;
	showNoTeam: boolean;
	onSelect: (employeeId: string) => void;
	onLoadTeam: (teamId: string) => void;
	onLoadNoTeam: () => void;
};

/** A responsive grid of team cards, one column on phones, with a No team card last. */
export function TeamsView(props: TeamsViewProps) {
	const { t } = useTranslate();
	const { cards, noTeam } = props.grouped;
	const canLoadNoTeam =
		!props.complete &&
		!props.isNoTeamLoaded &&
		noTeam.length < props.noTeamCount;

	return (
		<div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
			{cards.map((card) => (
				<TeamCardView
					card={card}
					canLoad={!props.complete && !card.allMembersLoaded}
					isLoading={props.loadingTeamIds.has(card.team.teamId)}
					key={card.team.teamId}
					onLoad={() => props.onLoadTeam(card.team.teamId)}
					onSelect={props.onSelect}
				/>
			))}
			{props.showNoTeam ? (
				<TeamShell
					count={
						props.complete
							? noTeam.length
							: Math.max(props.noTeamCount, noTeam.length)
					}
					description={t(
						"organization.explorer.noTeamDescription",
						"People without a team membership.",
					)}
					name={t("organization.explorer.noTeam", "No team")}
					teamKey="none"
				>
					<MemberList
						canLoad={canLoadNoTeam}
						isLoading={props.isNoTeamLoading}
						members={noTeam.map((person) => ({ person, isPrimaryTeam: false }))}
						onLoad={props.onLoadNoTeam}
						onSelect={props.onSelect}
					/>
				</TeamShell>
			) : null}
		</div>
	);
}

function TeamCardView({
	card,
	canLoad,
	isLoading,
	onLoad,
	onSelect,
}: {
	card: TeamCard;
	canLoad: boolean;
	isLoading: boolean;
	onLoad: () => void;
	onSelect: (employeeId: string) => void;
}) {
	const { t } = useTranslate();

	return (
		<TeamShell
			count={card.team.memberCount}
			description={card.team.description}
			header={
				<div
					className="mt-3 rounded-md bg-muted/50 p-2"
					data-testid="team-lead"
				>
					<p className="px-2 text-xs font-medium text-muted-foreground">
						{t("organization.explorer.teamLead", "Team lead")}
					</p>
					{card.lead ? (
						<PersonButton onSelect={onSelect} person={card.lead} />
					) : (
						<p className="px-2 py-1.5 text-sm text-muted-foreground">
							{t("organization.explorer.noTeamLead", "No team lead")}
						</p>
					)}
				</div>
			}
			name={card.team.name}
			teamKey={card.team.teamId}
		>
			<MemberList
				canLoad={canLoad}
				isLoading={isLoading}
				members={card.members}
				onLoad={onLoad}
				onSelect={onSelect}
			/>
		</TeamShell>
	);
}

function TeamShell({
	teamKey,
	name,
	description,
	count,
	header,
	children,
}: {
	teamKey: string;
	name: string;
	description: string | null;
	count: number;
	header?: React.ReactNode;
	children: React.ReactNode;
}) {
	const { t } = useTranslate();
	const headingId = useId();

	return (
		<section
			aria-labelledby={headingId}
			className="flex min-w-0 flex-col rounded-lg border bg-card p-4 text-card-foreground shadow-sm"
			data-team={teamKey}
			data-testid={`team-card-${teamKey}`}
		>
			<div className="flex items-start justify-between gap-3">
				<div className="min-w-0">
					<h3 className="truncate text-base font-semibold" id={headingId}>
						{name}
					</h3>
					{description ? (
						<p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
							{description}
						</p>
					) : null}
				</div>
				<span className="shrink-0 text-xs text-muted-foreground">
					{t(
						"organization.explorer.memberCount",
						"{count, plural, one {# member} other {# members}}",
						{
							count,
						},
					)}
				</span>
			</div>
			{header}
			<div className="mt-3 flex-1">{children}</div>
		</section>
	);
}

function MemberList({
	members,
	canLoad,
	isLoading,
	onLoad,
	onSelect,
}: {
	members: Array<{ person: OrgExplorerPerson; isPrimaryTeam: boolean }>;
	canLoad: boolean;
	isLoading: boolean;
	onLoad: () => void;
	onSelect: (employeeId: string) => void;
}) {
	const { t } = useTranslate();

	return (
		<>
			{members.length > 0 ? (
				<ul className="space-y-0.5">
					{members.map(({ person, isPrimaryTeam }) => (
						<li key={person.employeeId}>
							<PersonButton onSelect={onSelect} person={person}>
								{isPrimaryTeam ? (
									<Badge className="shrink-0" variant="secondary">
										{t("organization.explorer.primaryTeam", "Primary team")}
									</Badge>
								) : null}
							</PersonButton>
						</li>
					))}
				</ul>
			) : canLoad ? null : (
				<p className="text-sm text-muted-foreground">
					{t("organization.explorer.noMembers", "No members yet")}
				</p>
			)}
			{canLoad ? (
				<Button
					className="mt-2"
					disabled={isLoading}
					onClick={onLoad}
					size="sm"
					type="button"
					variant="outline"
				>
					{t("organization.explorer.showAllMembers", "Show all members")}
				</Button>
			) : null}
		</>
	);
}
