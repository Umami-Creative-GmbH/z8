"use client";

import { IconAlertTriangle, IconLoader2 } from "@tabler/icons-react";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useId, useState } from "react";
import {
	getReportProjectChoicesAction,
	type ProjectChoicesView,
	type SaveProjectOutcome,
	saveItemProjectAction,
	saveTripProjectAction,
} from "@/app/[locale]/(app)/travel-expenses/report-project-actions";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { queryKeys } from "@/lib/query/keys";
import type { DraftSaver, ExclusiveWriteOutcome } from "@/lib/travel-expenses/draft-saver";
import type { ItemProjectChoice } from "@/lib/travel-expenses/project-attribution";
import type { ProjectChoiceRefusal } from "@/lib/travel-expenses/project-attribution-store";

type Translate = ReturnType<typeof useTranslate>["t"];
type VersionedSaver = Pick<DraftSaver<unknown, unknown>, "runExclusive">;

/**
 * Project attribution of a draft expense or trip (#605). The choices are the
 * projects the server proves for the date(s): captured assignment history or
 * an authorized exception. The save is validated with the same rule and runs
 * through the editor's draft saver, so it never races the other edits.
 */

function useProjectChoices(input: {
	reportId: string;
	from: string | null;
	to: string | null;
	selectedProjectId: string | null;
}) {
	const { reportId, from, to, selectedProjectId } = input;
	return useQuery({
		queryKey: queryKeys.travelExpenses.projectChoices(
			reportId,
			from ?? "",
			to ?? "",
			selectedProjectId,
		),
		queryFn: async (): Promise<ProjectChoicesView> => {
			const result = await getReportProjectChoicesAction({
				reportId,
				from: from ?? "",
				to: to ?? "",
				selectedProjectId,
			});
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: Boolean(from && to && to >= from),
		placeholderData: keepPreviousData,
		refetchOnWindowFocus: false,
	});
}

function refusalMessage(t: Translate, reason: ProjectChoiceRefusal | string) {
	switch (reason) {
		case "ineligible":
			return t(
				"travelExpenses.report.project.refused.ineligible",
				"You were not assigned to this project on that date. Ask an expense administrator for an attribution exception if you worked on it.",
			);
		case "date_required":
			return t(
				"travelExpenses.report.project.refused.dateRequired",
				"Enter the date first: projects are offered for the date of the expense.",
			);
		case "project_not_found":
			return t("travelExpenses.report.project.refused.notFound", "This project is not available.");
		case "conflict":
			return t(
				"travelExpenses.report.project.refused.conflict",
				"This expense changed elsewhere. Resolve the save conflict above, then choose the project again.",
			);
		default:
			return t(
				"travelExpenses.report.project.refused.failed",
				"The project could not be saved. Please retry.",
			);
	}
}

function toExclusiveOutcome(
	result: Awaited<ReturnType<typeof saveItemProjectAction>>,
): ExclusiveWriteOutcome {
	if (!result.success) return { status: "failed", error: "failed" };
	const outcome: SaveProjectOutcome = result.data;
	switch (outcome.status) {
		case "saved":
			return { status: "saved", version: outcome.version };
		case "conflict":
			return { status: "conflict", version: outcome.version };
		case "refused":
			return { status: "failed", error: outcome.reason };
	}
}

function basisSuffix(t: Translate, basis: string) {
	return basis === "exception"
		? ` · ${t("travelExpenses.report.project.viaException", "authorized exception")}`
		: "";
}

function ChoicesStatus({
	query,
	needsDate,
}: {
	query: ReturnType<typeof useProjectChoices>;
	needsDate: string;
}) {
	const { t } = useTranslate();
	if (!query.isEnabled) return <p className="text-sm text-muted-foreground">{needsDate}</p>;
	if (query.isError) {
		return (
			<div className="flex flex-wrap items-center gap-2 text-sm text-destructive" role="alert">
				<span>
					{t("travelExpenses.report.project.loadFailed", "The projects could not be loaded.")}
				</span>
				<Button type="button" variant="outline" size="sm" onClick={() => void query.refetch()}>
					{t("common.retry", "Retry")}
				</Button>
			</div>
		);
	}
	if (query.data && query.data.choices.length === 0) {
		return (
			<p className="text-sm text-muted-foreground">
				{t(
					"travelExpenses.report.project.noneEligible",
					"You had no project assignment on this date. If you worked on a project then, an expense administrator can authorize an attribution exception.",
				)}
			</p>
		);
	}
	return null;
}

function SaveProblem({ message }: { message: string | null }) {
	if (!message) return null;
	return (
		<p className="flex items-start gap-1 text-sm text-destructive" role="alert">
			<IconAlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
			{message}
		</p>
	);
}

/** The saving indicator while a project choice is being saved. */
function SavingProject() {
	const { t } = useTranslate();
	return (
		<p className="flex items-center gap-1 text-sm text-muted-foreground" role="status">
			<IconLoader2 aria-hidden="true" className="size-4 animate-spin" />
			{t("travelExpenses.report.project.saving", "Saving project…")}
		</p>
	);
}

type ProjectSelectOption = { value: string; label: string; disabled?: boolean };

/**
 * Called, not rendered as a component: the select resolves its trigger label
 * only from `SelectItem` elements placed directly in its content.
 */
function projectSelectItems(options: ProjectSelectOption[]) {
	return options.map((option) => (
		<SelectItem key={option.value} value={option.value} disabled={option.disabled}>
			{option.label}
		</SelectItem>
	));
}

/** The projects the server offers for the date(s), as select options. */
function offeredProjectOptions(
	t: Translate,
	options: ProjectChoicesView["choices"],
): ProjectSelectOption[] {
	return options.map((option) => ({
		value: `project:${option.id}`,
		label: `${option.name}${option.customerName ? ` · ${option.customerName}` : ""}${basisSuffix(t, option.basis)}`,
	}));
}

const encode = (choice: ItemProjectChoice) =>
	choice.mode === "project" ? `project:${choice.projectId}` : choice.mode;

function decode(value: string): ItemProjectChoice | null {
	if (value === "inherit" || value === "none") return { mode: value };
	if (value.startsWith("project:")) return { mode: "project", projectId: value.slice(8) };
	return null;
}

/** The project an expense is attributed to under its choice, or null. */
function itemEffectiveProjectId(
	choice: ItemProjectChoice,
	isTrip: boolean,
	tripProjectId: string | null,
) {
	if (choice.mode === "project") return choice.projectId;
	return choice.mode === "inherit" && isTrip ? tripProjectId : null;
}

/** An expense's options: the trip's project, none, the offered ones, an unavailable own one. */
function itemProjectOptions(
	t: Translate,
	{
		choice,
		isTrip,
		tripProjectId,
		options,
		selectedName,
	}: {
		choice: ItemProjectChoice;
		isTrip: boolean;
		tripProjectId: string | null;
		options: ProjectChoicesView["choices"];
		selectedName: string | null;
	},
): ProjectSelectOption[] {
	const inheritedName = isTrip && tripProjectId && choice.mode === "inherit" ? selectedName : null;
	const result: ProjectSelectOption[] = [];
	if (isTrip) {
		result.push({
			value: "inherit",
			label: tripProjectId
				? t("travelExpenses.report.project.inheritNamed", "Same as the trip ({name})", {
						name: inheritedName ?? "…",
					})
				: t("travelExpenses.report.project.inheritNone", "Same as the trip (no project)"),
		});
	}
	result.push({ value: "none", label: t("travelExpenses.report.project.none", "No project") });
	result.push(...offeredProjectOptions(t, options));
	if (choice.mode === "project" && !options.some((option) => option.id === choice.projectId)) {
		result.push({
			value: `project:${choice.projectId}`,
			label: t(
				"travelExpenses.report.project.unavailableOption",
				"{name} (not available on this date)",
				{
					name: selectedName ?? "…",
				},
			),
			disabled: true,
		});
	}
	return result;
}

/** Warns that the attributed project was not assigned on the expense date. */
function IneligibleProjectProblem({
	effectiveProjectId,
	selected,
}: {
	effectiveProjectId: string | null;
	selected: ProjectChoicesView["selected"];
}) {
	const { t } = useTranslate();
	if (!effectiveProjectId || !selected || selected.eligible) return null;
	return (
		<SaveProblem
			message={t(
				"travelExpenses.report.project.notEligible",
				"{name} cannot be used on this date: you were not assigned to it then. Choose another project, or ask an expense administrator for an attribution exception.",
				{ name: selected.name },
			)}
		/>
	);
}

/** The expense's project choice and its save through the editor's draft saver. */
function useItemProjectChoice({
	reportId,
	itemId,
	initialChoice,
	saver,
	onSaved,
}: {
	reportId: string;
	itemId: string;
	initialChoice: ItemProjectChoice;
	saver: VersionedSaver;
	onSaved?: () => void;
}) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [choice, setChoice] = useState(initialChoice);
	const [saving, setSaving] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);

	async function change(value: string | null) {
		const next = value ? decode(value) : null;
		if (!next || encode(next) === encode(choice)) return;
		const previous = choice;
		setChoice(next);
		setProblem(null);
		setSaving(true);
		// Promise#finally rather than try/finally: the React Compiler cannot
		// compile try statements without a catch clause.
		await saveChoice(next, previous).finally(() => setSaving(false));
	}

	async function saveChoice(next: ItemProjectChoice, previous: ItemProjectChoice) {
		const outcome = await saver.runExclusive(async (version) =>
			toExclusiveOutcome(
				await saveItemProjectAction({ reportId, itemId, expectedVersion: version, choice: next }),
			),
		);
		if (outcome.status === "saved") {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.travelExpenses.report(reportId),
			});
			onSaved?.();
			return;
		}
		setChoice(previous);
		setProblem(refusalMessage(t, outcome.status === "conflict" ? "conflict" : outcome.error));
	}

	return { choice, saving, problem, change };
}

/** Project of one expense: inherited from the trip, its own, or none. */
export function ItemProjectField({
	reportId,
	itemId,
	isTrip,
	expenseDate,
	initialChoice,
	tripProjectId,
	saver,
	onSaved,
}: {
	reportId: string;
	itemId: string;
	isTrip: boolean;
	/** The entered (well-formed) expense date, or null. */
	expenseDate: string | null;
	initialChoice: ItemProjectChoice;
	/** The trip's project its expenses inherit; null without one. */
	tripProjectId: string | null;
	saver: VersionedSaver;
	onSaved?: () => void;
}) {
	const { t } = useTranslate();
	const id = useId();
	const { choice, saving, problem, change } = useItemProjectChoice({
		reportId,
		itemId,
		initialChoice,
		saver,
		onSaved,
	});
	const effectiveProjectId = itemEffectiveProjectId(choice, isTrip, tripProjectId);
	const query = useProjectChoices({
		reportId,
		from: expenseDate,
		to: expenseDate,
		selectedProjectId: effectiveProjectId,
	});
	const selected = query.data?.selected ?? null;

	return (
		<div className="space-y-2">
			<Label htmlFor={id}>{t("travelExpenses.report.project.label", "Project (optional)")}</Label>
			<Select
				// Without a trip, "inherit" means no project; show the option that says so (#617).
				value={!isTrip && choice.mode === "inherit" ? "none" : encode(choice)}
				onValueChange={(value) => void change(value)}
				disabled={saving}
			>
				<SelectTrigger id={id} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					{projectSelectItems(
						itemProjectOptions(t, {
							choice,
							isTrip,
							tripProjectId,
							options: query.data?.choices ?? [],
							selectedName: selected?.name ?? null,
						}),
					)}
				</SelectContent>
			</Select>
			{saving && <SavingProject />}
			<ChoicesStatus
				query={query}
				needsDate={t(
					"travelExpenses.report.project.needsDate",
					"Enter the receipt date to see the projects you can use on that day.",
				)}
			/>
			<IneligibleProjectProblem effectiveProjectId={effectiveProjectId} selected={selected} />
			<SaveProblem message={problem} />
		</div>
	);
}

/** The trip's project, which its expenses inherit unless they choose their own. */
export function TripProjectField({
	reportId,
	startDate,
	endDate,
	initialProjectId,
	saver,
	onSaved,
}: {
	reportId: string;
	startDate: string | null;
	endDate: string | null;
	initialProjectId: string | null;
	saver: VersionedSaver;
	onSaved?: (projectId: string | null) => void;
}) {
	const { t } = useTranslate();
	const id = useId();
	const queryClient = useQueryClient();
	const [projectId, setProjectId] = useState(initialProjectId);
	const [saving, setSaving] = useState(false);
	const [problem, setProblem] = useState<string | null>(null);
	const query = useProjectChoices({
		reportId,
		from: startDate,
		to: endDate,
		selectedProjectId: projectId,
	});
	const options = query.data?.choices ?? [];
	const selected = query.data?.selected ?? null;

	async function change(value: string | null) {
		const next =
			value === "none" ? null : value?.startsWith("project:") ? value.slice(8) : undefined;
		if (next === undefined || next === projectId) return;
		const previous = projectId;
		setProjectId(next);
		setProblem(null);
		setSaving(true);
		// Promise#finally rather than try/finally: the React Compiler cannot
		// compile try statements without a catch clause.
		await saveProject(next, previous).finally(() => setSaving(false));
	}

	async function saveProject(next: string | null, previous: string | null) {
		const outcome = await saver.runExclusive(async (version) =>
			toExclusiveOutcome(
				await saveTripProjectAction({ reportId, expectedVersion: version, projectId: next }),
			),
		);
		if (outcome.status === "saved") {
			await queryClient.invalidateQueries({
				queryKey: queryKeys.travelExpenses.report(reportId),
			});
			onSaved?.(next);
			return;
		}
		setProjectId(previous);
		setProblem(refusalMessage(t, outcome.status === "conflict" ? "conflict" : outcome.error));
	}

	return (
		<div className="space-y-2">
			<Label htmlFor={id}>
				{t("travelExpenses.report.project.tripLabel", "Trip project (optional)")}
			</Label>
			<Select
				value={projectId ? `project:${projectId}` : "none"}
				onValueChange={(value) => void change(value)}
				disabled={saving}
			>
				<SelectTrigger id={id} className="w-full">
					<SelectValue />
				</SelectTrigger>
				<SelectContent>
					<SelectItem value="none">
						{t("travelExpenses.report.project.none", "No project")}
					</SelectItem>
					{projectSelectItems(offeredProjectOptions(t, options))}
					{projectId && !options.some((option) => option.id === projectId) && (
						<SelectItem value={`project:${projectId}`} disabled>
							{t(
								"travelExpenses.report.project.unavailableTripOption",
								"{name} (not available on these dates)",
								{
									name: selected?.name ?? "…",
								},
							)}
						</SelectItem>
					)}
				</SelectContent>
			</Select>
			<p className="text-sm text-muted-foreground">
				{t(
					"travelExpenses.report.project.tripDescription",
					"Expenses use the trip's project unless you choose another one for them. Each expense must be covered by your project assignment on its own date.",
				)}
			</p>
			{saving && <SavingProject />}
			<ChoicesStatus
				query={query}
				needsDate={t(
					"travelExpenses.report.project.needsTripDates",
					"Enter the travel dates to see the projects you can use on this trip.",
				)}
			/>
			<SaveProblem message={problem} />
		</div>
	);
}
