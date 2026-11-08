import type {
	AbsencesPlan,
	DeactivationApplied,
	DeactivationPlan,
	NamedEmployee,
	ShiftsPlan,
	TeamLinksPlan,
} from "./deactivation/types";

/**
 * The re-grant checklist shown after Reactivate (#1441, Organization ADR
 * 0006). Reactivation restores nothing; the checklist lists what the
 * deactivation ended, read from its ledger row (`applied`, named from the
 * stored `plan`), and links each item to the page where it is granted again.
 * The roster areas' items are built here; each Employment ending participant
 * supplies its own (`reactivationItems`). Client-safe: no server imports.
 */

export type ChecklistGrantKind =
	| "expense_officer"
	| "payroll_access"
	| "personnel_file_officer"
	| "driving_licence_verifier"
	| "equipment_officer";

export type ReactivationChecklistGroup =
	| "managers"
	| "grants"
	| "access"
	| "teams"
	| "shifts"
	| "absences"
	| "documentRequests"
	| "shareLinks";

/** One thing the deactivation ended. Names are null when the plan was not stored. */
export type ReactivationChecklistItem =
	/** A report moved to a replacement manager. */
	| {
			group: "managers";
			kind: "report_moved";
			employeeId: string;
			name: string | null;
			newManagerName: string | null;
			href: string;
	  }
	/** A report who kept another manager and lost this one. */
	| {
			group: "managers";
			kind: "report_link_ended";
			employeeId: string;
			name: string | null;
			href: string;
	  }
	/** One of the person's own managers. */
	| {
			group: "managers";
			kind: "own_manager";
			employeeId: string;
			name: string | null;
			href: string;
	  }
	| {
			group: "grants";
			kind: "grant";
			grant: ChecklistGrantKind | null;
			href: string;
	  }
	| { group: "access"; kind: "kiosk_badges"; count: number; href: string }
	| {
			group: "access";
			kind: "driving_authorizations";
			count: number;
			href: string;
	  }
	| {
			group: "teams";
			kind: "team" | "project_assignment" | "project_manager";
			id: string;
			name: string | null;
			href: string;
	  }
	| {
			group: "shifts";
			kind: "shift";
			id: string;
			date: string | null;
			startTime: string | null;
			endTime: string | null;
			href: string;
	  }
	| {
			group: "absences";
			kind: "absence";
			id: string;
			categoryName: string | null;
			startDate: string | null;
			endDate: string | null;
			href: string;
	  }
	| {
			group: "documentRequests";
			kind: "document_requests";
			count: number;
			href: string;
	  }
	| { group: "shareLinks"; kind: "share_links"; count: number; href: string };

/** The checklist of the employee's latest reactivated deactivation, until dismissed. */
export type ReactivationChecklist = {
	deactivationId: string;
	employeeId: string;
	/**
	 * ISO instants; shown in `timeZone`, the organization's. `deactivatedAt` is
	 * null when it was not recorded (a backfilled deactivation without evidence).
	 */
	deactivatedAt: string | null;
	reactivatedAt: string;
	timeZone: string;
	items: ReactivationChecklistItem[];
};

const GRANT_PAGES: Record<ChecklistGrantKind, string> = {
	equipment_officer: "/settings/equipment",
	expense_officer: "/settings/travel-expenses?tab=access",
	payroll_access: "/settings/payroll-access",
	personnel_file_officer: "/settings/personnel-files?tab=access",
	driving_licence_verifier: "/settings/driving-licence?tab=verifiers",
};

const employeePage = (employeeId: string) => `/settings/employees/${employeeId}`;

/** A held grant that ended, linked to where it is granted again. */
export function grantChecklistItem(grant: ChecklistGrantKind | null): ReactivationChecklistItem {
	return { group: "grants", kind: "grant", grant, href: grant ? GRANT_PAGES[grant] : "/settings" };
}

/** An item that stands for a number of ended things of one kind. */
type CountedChecklistItem = Extract<ReactivationChecklistItem, { count: number }>;

/** The item for `count` ended things of a kind; none when nothing ended. */
export function countedChecklistItems(item: CountedChecklistItem): ReactivationChecklistItem[] {
	return item.count > 0 ? [item] : [];
}

/**
 * The plan as stored on the ledger row: everything the checklist names, but
 * of the replacement options only the chosen replacements (the options list
 * the whole current roster of admins and managers).
 */
export function checklistPlanSnapshot(plan: DeactivationPlan): DeactivationPlan {
	const chosen = new Set(
		plan.managerLinks.reportsNeedingReplacement.flatMap((report) =>
			report.replacementEmployeeId ? [report.replacementEmployeeId] : [],
		),
	);
	return {
		...plan,
		managerLinks: {
			...plan.managerLinks,
			replacementOptions: plan.managerLinks.replacementOptions.filter((option) =>
				chosen.has(option.employeeId),
			),
		},
	};
}

/** The parts of a stored plan the checklist names items from. */
export type ChecklistPlan = {
	managerLinks: {
		replacementOptions: readonly NamedEmployee[];
		reportsNeedingReplacement: readonly NamedEmployee[];
		reportsKeepingAnotherManager: readonly NamedEmployee[];
		ownManagerLinks: readonly NamedEmployee[];
		formerReports: readonly NamedEmployee[];
	};
	teamLinks: TeamLinksPlan;
	shifts: Pick<ShiftsPlan, "shiftsToOpen">;
	absences: Pick<AbsencesPlan, "absencesToCancel">;
};

/** The roster areas a deactivation's ledger row records, in every version of it. */
export type ChecklistApplied = Pick<
	DeactivationApplied,
	"managerLinks" | "teamLinks" | "shifts" | "absences"
>;

/**
 * The checklist items for exactly what `applied` lists, with `holdings`, the
 * items of what Employment ending ended, after the manager links.
 */
export function buildReactivationChecklistItems(input: {
	employeeId: string;
	applied: ChecklistApplied;
	plan: ChecklistPlan | null;
	holdings: readonly ReactivationChecklistItem[];
}): ReactivationChecklistItem[] {
	const { employeeId: person, applied, plan } = input;
	const items: ReactivationChecklistItem[] = [];

	const names = new Map<string, string>();
	if (plan) {
		const links = plan.managerLinks;
		for (const named of [
			...links.replacementOptions,
			...links.reportsNeedingReplacement,
			...links.reportsKeepingAnotherManager,
			...links.formerReports,
			...links.ownManagerLinks,
		]) {
			names.set(named.employeeId, named.name);
		}
	}
	const nameOf = (employeeId: string) => names.get(employeeId) ?? null;

	const moved = new Set(applied.managerLinks.addedLinks.map((link) => link.employeeId));
	for (const link of applied.managerLinks.addedLinks) {
		items.push({
			group: "managers",
			kind: "report_moved",
			employeeId: link.employeeId,
			name: nameOf(link.employeeId),
			newManagerName: nameOf(link.managerId),
			href: employeePage(link.employeeId),
		});
	}
	for (const link of applied.managerLinks.removedLinks) {
		if (link.managerId === person && !moved.has(link.employeeId)) {
			items.push({
				group: "managers",
				kind: "report_link_ended",
				employeeId: link.employeeId,
				name: nameOf(link.employeeId),
				href: employeePage(link.employeeId),
			});
		}
	}
	for (const link of applied.managerLinks.removedLinks) {
		if (link.employeeId === person) {
			items.push({
				group: "managers",
				kind: "own_manager",
				employeeId: link.managerId,
				name: nameOf(link.managerId),
				href: employeePage(person),
			});
		}
	}

	items.push(...input.holdings);

	const teamNames = new Map(plan?.teamLinks.teams.map((team) => [team.teamId, team.name]));
	for (const teamId of applied.teamLinks.teamIds) {
		items.push({
			group: "teams",
			kind: "team",
			id: teamId,
			name: teamNames.get(teamId) ?? null,
			href: `/settings/teams/${teamId}`,
		});
	}
	const projectNames = new Map(
		[
			...(plan?.teamLinks.projectAssignments ?? []),
			...(plan?.teamLinks.projectManagerLinks ?? []),
		].map((project) => [project.projectId, project.name]),
	);
	for (const projectId of applied.teamLinks.projectAssignmentProjectIds) {
		items.push({
			group: "teams",
			kind: "project_assignment",
			id: projectId,
			name: projectNames.get(projectId) ?? null,
			href: "/settings/projects",
		});
	}
	for (const projectId of applied.teamLinks.projectManagerProjectIds) {
		items.push({
			group: "teams",
			kind: "project_manager",
			id: projectId,
			name: projectNames.get(projectId) ?? null,
			href: "/settings/projects",
		});
	}

	const shifts = new Map(plan?.shifts.shiftsToOpen.map((shift) => [shift.shiftId, shift]));
	for (const shiftId of applied.shifts.openedShiftIds) {
		const shift = shifts.get(shiftId);
		items.push({
			group: "shifts",
			kind: "shift",
			id: shiftId,
			date: shift?.date ?? null,
			startTime: shift?.startTime ?? null,
			endTime: shift?.endTime ?? null,
			href: "/scheduling",
		});
	}

	const absences = new Map(
		plan?.absences.absencesToCancel.map((absence) => [absence.absenceId, absence]),
	);
	for (const absenceId of applied.absences.cancelledAbsenceIds) {
		const absence = absences.get(absenceId);
		items.push({
			group: "absences",
			kind: "absence",
			id: absenceId,
			categoryName: absence?.categoryName ?? null,
			startDate: absence?.startDate ?? null,
			endDate: absence?.endDate ?? null,
			href: "/team/absences",
		});
	}

	return items;
}

/** What a ledger row written before Employment ending (#1624) recorded as ended. */
export type LegacyAccessEndsApplied = {
	grantIds: string[];
	drivingAuthorizationIds: string[];
	kioskBadgeIds: string[];
	kioskFobIds: string[];
	shareLinkIds: string[];
};

/**
 * The checklist items of such a row, named from the grant kinds its stored
 * plan listed. An ended kiosk fob has no item (#1509).
 */
export function legacyAccessEndsItems(input: {
	employeeId: string;
	accessEnds: LegacyAccessEndsApplied;
	plannedGrants: ReadonlyArray<{ kind: ChecklistGrantKind; grantId: string }> | null;
}): ReactivationChecklistItem[] {
	const { employeeId, accessEnds } = input;
	const grantKinds = new Map(input.plannedGrants?.map((grant) => [grant.grantId, grant.kind]));
	return [
		...accessEnds.grantIds.map((grantId) => grantChecklistItem(grantKinds.get(grantId) ?? null)),
		...countedChecklistItems({
			group: "access",
			kind: "kiosk_badges",
			count: accessEnds.kioskBadgeIds.length,
			href: employeePage(employeeId),
		}),
		...countedChecklistItems({
			group: "access",
			kind: "driving_authorizations",
			count: accessEnds.drivingAuthorizationIds.length,
			href: `/driving-licence/checks/${employeeId}`,
		}),
		...countedChecklistItems({
			group: "shareLinks",
			kind: "share_links",
			count: accessEnds.shareLinkIds.length,
			href: "/settings/report-share-links",
		}),
	];
}
