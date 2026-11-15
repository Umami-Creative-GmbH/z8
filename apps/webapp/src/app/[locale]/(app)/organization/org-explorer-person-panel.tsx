"use client";

import { IconMail, IconPencil, IconUsersGroup } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useId } from "react";
import {
	ActionPanelBody,
	ActionPanelHeader,
} from "@/components/ui/action-panel";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import {
	Sheet,
	SheetContent,
	SheetDescription,
	SheetHeader,
	SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { Link } from "@/navigation";
import { OrgExplorerLoadError } from "./org-explorer-load-error";
import { PersonAvatar, PersonButton } from "./org-explorer-person";
import { personDisplayName } from "./org-explorer-person-name";
import type { OrgExplorerPerson } from "./org-explorer-types";

export type PersonPanelProps = {
	employeeId: string | null;
	peopleById: ReadonlyMap<string, OrgExplorerPerson>;
	teamNamesById: ReadonlyMap<string, string>;
	canManage: boolean;
	side: "right" | "bottom";
	onSelect: (employeeId: string) => void;
	onClose: () => void;
	loadError?: { retry: () => Promise<void>; pending: boolean };
};

/**
 * A person's details: managers (primary first), direct reports, team
 * memberships with the primary team marked, and email. Admins also get links
 * to the existing settings screens: the employee, and each of their teams.
 * Read-only.
 */
export function PersonPanel(props: PersonPanelProps) {
	const { t } = useTranslate();
	const person = props.employeeId
		? props.peopleById.get(props.employeeId)
		: undefined;

	return (
		<Sheet
			onOpenChange={(open) => {
				if (!open) props.onClose();
			}}
			open={props.employeeId !== null}
		>
			<SheetContent
				className={cn(
					"overflow-y-auto",
					props.side === "bottom"
						? "max-h-[85dvh] rounded-t-xl"
						: "w-full sm:max-w-md",
				)}
				side={props.side}
			>
				{person ? (
					<PersonDetails {...props} person={person} />
				) : (
					<SheetHeader>
						<SheetTitle>
							{props.loadError
								? t(
										"organization.explorer.panel.description",
										"Reporting lines and teams",
									)
								: t("organization.explorer.panel.loading", "Loading person…")}
						</SheetTitle>
						<SheetDescription className="sr-only">
							{t(
								"organization.explorer.panel.description",
								"Reporting lines and teams",
							)}
						</SheetDescription>
						{props.loadError ? (
							<OrgExplorerLoadError {...props.loadError} />
						) : (
							<Skeleton className="h-24 w-full" />
						)}
					</SheetHeader>
				)}
			</SheetContent>
		</Sheet>
	);
}

function PersonDetails({
	person,
	peopleById,
	teamNamesById,
	canManage,
	onSelect,
}: PersonPanelProps & { person: OrgExplorerPerson }) {
	const { t } = useTranslate();

	return (
		<>
			<ActionPanelHeader>
				<div className="flex items-center gap-3">
					<PersonAvatar person={person} size="md" />
					<div className="min-w-0">
						<SheetTitle className="break-words text-lg">
							{personDisplayName(person)}
						</SheetTitle>
						<SheetDescription>
							{person.position ??
								t(
									"organization.explorer.panel.description",
									"Reporting lines and teams",
								)}
						</SheetDescription>
					</div>
				</div>
			</ActionPanelHeader>
			<ActionPanelBody className="flex flex-col gap-5">
				<PanelSection
					title={t("organization.explorer.panel.managers", "Managers")}
				>
					<PeopleList
						empty={t("organization.explorer.panel.noManager", "No manager")}
						ids={person.managerIds}
						onSelect={onSelect}
						peopleById={peopleById}
						renderMark={(managerId) =>
							managerId === person.primaryManagerId ? (
								<Badge className="shrink-0" variant="secondary">
									{t(
										"organization.explorer.panel.primaryManager",
										"Primary manager",
									)}
								</Badge>
							) : null
						}
					/>
				</PanelSection>
				<PanelSection
					title={t(
						"organization.explorer.panel.directReports",
						"Direct reports",
					)}
				>
					<PeopleList
						empty={t(
							"organization.explorer.panel.noDirectReports",
							"No direct reports",
						)}
						ids={person.reportIds}
						onSelect={onSelect}
						peopleById={peopleById}
					/>
				</PanelSection>
				<PanelSection
					title={t(
						"organization.explorer.panel.teamMemberships",
						"Team memberships",
					)}
				>
					{person.teamIds.length > 0 ? (
						<ul className="flex flex-col gap-1">
							{person.teamIds.map((teamId) => {
								const name = teamNamesById.get(teamId) ?? teamId;
								return (
									<li
										className="flex items-center gap-2 px-2 py-1 text-sm"
										key={teamId}
									>
										<IconUsersGroup
											aria-hidden="true"
											className="size-4 text-muted-foreground"
										/>
										{canManage ? (
											<Link
												className="truncate text-primary underline-offset-4 hover:underline"
												href={`/settings/teams/${teamId}`}
											>
												{name}
											</Link>
										) : (
											<span className="truncate">{name}</span>
										)}
										{teamId === person.primaryTeamId ? (
											<Badge className="shrink-0" variant="secondary">
												{t("organization.explorer.primaryTeam", "Primary team")}
											</Badge>
										) : null}
									</li>
								);
							})}
						</ul>
					) : (
						<p className="px-2 text-sm text-muted-foreground">
							{t(
								"organization.explorer.panel.noTeamMemberships",
								"No team memberships",
							)}
						</p>
					)}
				</PanelSection>
				<PanelSection title={t("organization.explorer.panel.email", "Email")}>
					<a
						className="inline-flex min-w-0 items-center gap-2 break-all px-2 text-sm text-primary underline-offset-4 hover:underline"
						href={`mailto:${person.email}`}
					>
						<IconMail aria-hidden="true" className="size-4" />
						{person.email}
					</a>
				</PanelSection>
				{canManage ? (
					<div className="flex flex-wrap gap-2 border-t pt-4">
						<Link
							className={buttonVariants({ variant: "outline", size: "sm" })}
							href={`/settings/employees/${person.employeeId}`}
						>
							<IconPencil aria-hidden="true" />
							{t("organization.explorer.panel.editEmployee", "Edit employee")}
						</Link>
						{/* Each team membership above links to its team. */}
						{person.teamIds.length === 0 ? (
							<Link
								className={buttonVariants({ variant: "outline", size: "sm" })}
								href="/settings/teams"
							>
								<IconUsersGroup aria-hidden="true" />
								{t("organization.explorer.panel.manageTeams", "Manage teams")}
							</Link>
						) : null}
					</div>
				) : null}
			</ActionPanelBody>
		</>
	);
}

function PanelSection({
	title,
	children,
}: {
	title: string;
	children: React.ReactNode;
}) {
	const headingId = useId();

	return (
		<section aria-labelledby={headingId} className="flex flex-col gap-1">
			<h3
				className="px-2 text-xs font-medium tracking-wide text-muted-foreground uppercase"
				id={headingId}
			>
				{title}
			</h3>
			{children}
		</section>
	);
}

function PeopleList({
	ids,
	peopleById,
	empty,
	onSelect,
	renderMark,
}: {
	ids: string[];
	peopleById: ReadonlyMap<string, OrgExplorerPerson>;
	empty: string;
	onSelect: (employeeId: string) => void;
	renderMark?: (employeeId: string) => React.ReactNode;
}) {
	if (ids.length === 0)
		return <p className="px-2 text-sm text-muted-foreground">{empty}</p>;

	return (
		<ul className="flex flex-col gap-0.5">
			{ids.map((id) => {
				const person = peopleById.get(id);
				return (
					<li key={id}>
						{person ? (
							<PersonButton onSelect={onSelect} person={person}>
								{renderMark?.(id)}
							</PersonButton>
						) : (
							<Skeleton className="my-1 h-9 w-full" />
						)}
					</li>
				);
			})}
		</ul>
	);
}
