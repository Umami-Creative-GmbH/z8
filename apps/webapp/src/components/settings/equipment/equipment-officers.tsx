"use client";

import {
	IconLoader2,
	IconPlus,
	IconUserOff,
	IconUserShield,
} from "@tabler/icons-react";
import { useForm } from "@tanstack/react-form";
import { useTranslate } from "@tolgee/react";
import { useId, useRef, useState, useTransition } from "react";
import { toast } from "sonner";
import {
	ActionPanel,
	ActionPanelBody,
	ActionPanelContent,
	ActionPanelDescription,
	ActionPanelFooter,
	ActionPanelHeader,
	ActionPanelTitle,
} from "@/components/ui/action-panel";
import {
	AlertDialog,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardAction,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { DropdownMenuItem } from "@/components/ui/dropdown-menu";
import {
	Empty,
	EmptyContent,
	EmptyDescription,
	EmptyHeader,
	EmptyMedia,
	EmptyTitle,
} from "@/components/ui/empty";
import { SearchableSelect } from "@/components/ui/searchable-select";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import {
	Table,
	TableBody,
	TableCell,
	TableHead,
	TableHeader,
	TableRow,
} from "@/components/ui/table";
import {
	TFormControl,
	TFormDescription,
	TFormItem,
	TFormLabel,
	TFormMessage,
} from "@/components/ui/tanstack-form";
import { changeEquipmentOfficerGrant } from "@/lib/organization/equipment/actions";
import type {
	EquipmentOfficerChange,
	EquipmentOfficerView,
} from "@/lib/organization/equipment/contracts";
import { useRouter } from "@/navigation";
import { EquipmentEditMenuItem, EquipmentRowMenu } from "./equipment-lists";

type Grant = EquipmentOfficerView["grants"][number];
type OfficerCommand =
	| Omit<
			Extract<EquipmentOfficerChange, { kind: "set_officer_grant" }>,
			"requestId"
	  >
	| Omit<
			Extract<EquipmentOfficerChange, { kind: "revoke_officer_grant" }>,
			"requestId"
	  >;

export function EquipmentOfficers({ data }: { data: EquipmentOfficerView }) {
	const { t } = useTranslate();
	const router = useRouter();
	const [pending, startTransition] = useTransition();
	// `null` adds a new officer; an employee id edits that officer's grant.
	const [editing, setEditing] = useState<string | null>(null);
	const [editorOpen, setEditorOpen] = useState(false);
	const [revoking, setRevoking] = useState<Grant | null>(null);
	const identity = useRef<{ payload: string; id: string } | null>(null);
	const noCandidatesId = useId();
	const activeGrants = data.grants.filter((grant) => !grant.revoked);
	const candidates = data.employees.filter(
		(employee) =>
			employee.current &&
			!activeGrants.some((grant) => grant.employeeId === employee.id),
	);

	function run(command: OfficerCommand, onSaved: () => void) {
		// A retried identical command keeps its request identity.
		const payload = JSON.stringify(command);
		if (identity.current?.payload !== payload)
			identity.current = { payload, id: crypto.randomUUID() };
		const requestId = identity.current.id;
		startTransition(async () => {
			const result = await changeEquipmentOfficerGrant({
				...command,
				requestId,
			}).catch(() => null);
			if (!result?.success || !result.data.ok) {
				toast.error(
					t(
						"settings.equipment.officers.failed",
						"Responsibility could not be saved. Reload to check current access and revisions, then try again.",
					),
				);
				return;
			}
			toast.success(
				command.kind === "revoke_officer_grant"
					? t(
							"settings.equipment.officers.revoked",
							"Equipment responsibility revoked.",
						)
					: t(
							"settings.equipment.officers.saved",
							"Equipment responsibility saved.",
						),
			);
			onSaved();
			router.refresh();
		});
	}

	function openEditor(employeeId: string | null) {
		setEditing(employeeId);
		setEditorOpen(true);
	}

	const addLabel = t(
		"settings.equipment.officers.add",
		"Add equipment officer",
	);
	return (
		<Card role="region" aria-labelledby="equipment-officers-title">
			<CardHeader>
				<CardTitle>
					<h2 id="equipment-officers-title">
						{t("settings.equipment.officers.title", "Equipment officers")}
					</h2>
				</CardTitle>
				<CardDescription>
					{t(
						"settings.equipment.officers.help",
						"Delegate equipment responsibility for the organization or selected teams and employees. Managers have no equipment access without a grant.",
					)}
				</CardDescription>
				{activeGrants.length > 0 ? (
					<CardAction>
						<Button
							variant="outline"
							size="sm"
							onClick={() => openEditor(null)}
							disabled={pending || candidates.length === 0}
						>
							<IconPlus className="size-4" aria-hidden="true" />
							{addLabel}
						</Button>
					</CardAction>
				) : null}
			</CardHeader>
			<CardContent>
				{activeGrants.length === 0 ? (
					<Empty className="border">
						<EmptyHeader>
							<EmptyMedia variant="icon">
								<IconUserShield aria-hidden="true" />
							</EmptyMedia>
							<EmptyTitle>
								{t(
									"settings.equipment.officers.emptyTitle",
									"No equipment officers yet",
								)}
							</EmptyTitle>
							<EmptyDescription>
								{t(
									"settings.equipment.officers.emptyDescription",
									"Add an officer to delegate equipment responsibility for the whole organization or selected teams and employees.",
								)}
							</EmptyDescription>
						</EmptyHeader>
						<EmptyContent>
							<Button
								onClick={() => openEditor(null)}
								disabled={pending || candidates.length === 0}
								aria-describedby={
									candidates.length === 0 ? noCandidatesId : undefined
								}
							>
								<IconPlus className="size-4" aria-hidden="true" />
								{addLabel}
							</Button>
							{candidates.length === 0 ? (
								<p id={noCandidatesId} className="text-muted-foreground">
									{t(
										"settings.equipment.officers.noCandidates",
										"No current employees are available to add.",
									)}
								</p>
							) : null}
						</EmptyContent>
					</Empty>
				) : (
					<OfficerTable
						grants={activeGrants}
						data={data}
						pending={pending}
						onEdit={(grant) => openEditor(grant.employeeId)}
						onRevoke={setRevoking}
					/>
				)}
			</CardContent>
			<OfficerGrantPanel
				open={editorOpen}
				onOpenChange={setEditorOpen}
				data={data}
				employeeId={editing}
				candidates={candidates}
				pending={pending}
				onSubmit={(command) => run(command, () => setEditorOpen(false))}
			/>
			<RevokeOfficerDialog
				grant={revoking}
				pending={pending}
				onClose={() => setRevoking(null)}
				onConfirm={(grant) =>
					run(
						{
							kind: "revoke_officer_grant",
							employeeId: grant.employeeId,
							expectedRevision: grant.revision,
						},
						() => setRevoking(null),
					)
				}
			/>
		</Card>
	);
}

function OfficerTable({
	grants,
	data,
	pending,
	onEdit,
	onRevoke,
}: {
	grants: Grant[];
	data: EquipmentOfficerView;
	pending: boolean;
	onEdit: (grant: Grant) => void;
	onRevoke: (grant: Grant) => void;
}) {
	const { t } = useTranslate();
	return (
		<div className="rounded-lg border">
			<Table mobileLayout="stacked">
				<TableHeader>
					<TableRow className="hover:bg-transparent">
						<TableHead className="px-4">
							{t("settings.equipment.officers.officer", "Equipment officer")}
						</TableHead>
						<TableHead>
							{t("settings.equipment.officers.scope", "Responsibility scope")}
						</TableHead>
						<TableHead className="w-12 px-4">
							<span className="sr-only">
								{t("settings.equipment.actions", "Actions")}
							</span>
						</TableHead>
					</TableRow>
				</TableHeader>
				<TableBody>
					{grants.map((grant) => (
						<TableRow key={grant.employeeId}>
							<TableCell className="whitespace-normal px-4">
								<div className="flex min-w-0 flex-wrap items-center gap-2">
									<span className="break-words font-medium">{grant.name}</span>
									{!grant.current ? (
										<Badge variant="secondary">
											{t(
												"settings.equipment.custody.former",
												"Former employee",
											)}
										</Badge>
									) : null}
								</div>
							</TableCell>
							<TableCell className="whitespace-normal text-muted-foreground">
								{scopeSummary(grant, data, t)}
							</TableCell>
							<TableCell className="px-4 text-right">
								<EquipmentRowMenu
									disabled={pending}
									label={t(
										"settings.equipment.officers.actionsNamed",
										"Actions for officer {name}",
										{ name: grant.name },
									)}
								>
									{grant.current ? (
										<EquipmentEditMenuItem onClick={() => onEdit(grant)} />
									) : null}
									<DropdownMenuItem
										variant="destructive"
										onClick={() => onRevoke(grant)}
									>
										<IconUserOff className="size-4" aria-hidden="true" />
										{t("settings.equipment.officers.revokeShort", "Revoke")}
									</DropdownMenuItem>
								</EquipmentRowMenu>
							</TableCell>
						</TableRow>
					))}
				</TableBody>
			</Table>
		</div>
	);
}

function scopeSummary(
	grant: Grant,
	data: EquipmentOfficerView,
	t: ReturnType<typeof useTranslate>["t"],
) {
	if (grant.scope === "all")
		return t("settings.equipment.officers.all", "Whole organization");
	const teamCount = grant.teamIds.length;
	const employeeCount = grant.employeeIds.length;
	if (teamCount === 1 && employeeCount === 0) {
		const team = data.teams.find(
			(candidate) => candidate.id === grant.teamIds[0],
		);
		if (team) return team.name;
	}
	if (teamCount > 0 && employeeCount > 0)
		return t(
			"settings.equipment.officers.scopeTeamsEmployees",
			"{teamCount, plural, one {# team} other {# teams}}, {employeeCount, plural, one {# employee} other {# employees}}",
			{ teamCount, employeeCount },
		);
	if (teamCount > 0)
		return t(
			"settings.equipment.officers.scopeTeams",
			"{count, plural, one {# team} other {# teams}}",
			{ count: teamCount },
		);
	return t(
		"settings.equipment.officers.scopeEmployees",
		"{count, plural, one {# employee} other {# employees}}",
		{ count: employeeCount },
	);
}

function OfficerGrantPanel({
	open,
	onOpenChange,
	data,
	employeeId,
	candidates,
	pending,
	onSubmit,
}: {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	data: EquipmentOfficerView;
	employeeId: string | null;
	candidates: EquipmentOfficerView["employees"];
	pending: boolean;
	onSubmit: (command: OfficerCommand) => void;
}) {
	const { t } = useTranslate();
	return (
		<ActionPanel
			open={open}
			onOpenChange={(next) => {
				if (!pending) onOpenChange(next);
			}}
		>
			<ActionPanelContent>
				<ActionPanelHeader>
					<ActionPanelTitle>
						{employeeId
							? t(
									"settings.equipment.officers.editTitle",
									"Edit equipment officer",
								)
							: t("settings.equipment.officers.add", "Add equipment officer")}
					</ActionPanelTitle>
					<ActionPanelDescription>
						{t(
							"settings.equipment.officers.editorDescription",
							"Choose who is responsible for equipment and for which teams and employees.",
						)}
					</ActionPanelDescription>
				</ActionPanelHeader>
				<OfficerGrantForm
					key={employeeId ?? "new"}
					data={data}
					employeeId={employeeId}
					candidates={candidates}
					pending={pending}
					onSubmit={onSubmit}
					onCancel={() => onOpenChange(false)}
				/>
			</ActionPanelContent>
		</ActionPanel>
	);
}

function OfficerGrantForm({
	data,
	employeeId,
	candidates,
	pending,
	onSubmit,
	onCancel,
}: {
	data: EquipmentOfficerView;
	employeeId: string | null;
	candidates: EquipmentOfficerView["employees"];
	pending: boolean;
	onSubmit: (command: OfficerCommand) => void;
	onCancel: () => void;
}) {
	const { t } = useTranslate();
	const editingGrant = employeeId
		? data.grants.find((grant) => grant.employeeId === employeeId)
		: undefined;
	const form = useForm({
		defaultValues: {
			employeeId: employeeId ?? "",
			scope: editingGrant?.scope ?? "all",
			teamIds: editingGrant?.teamIds ?? [],
			employeeIds: editingGrant?.employeeIds ?? [],
		},
		validators: {
			onSubmit: ({ value }) =>
				value.scope === "selected" &&
				!value.teamIds.length &&
				!value.employeeIds.length
					? t(
							"settings.equipment.officers.scopeRequired",
							"Select at least one team or employee.",
						)
					: undefined,
		},
		onSubmit: ({ value }) => {
			// A revoked grant keeps its revision; granting again continues from it.
			const grant = data.grants.find((g) => g.employeeId === value.employeeId);
			onSubmit({
				kind: "set_officer_grant",
				employeeId: value.employeeId,
				expectedRevision: grant?.revision ?? 0,
				scope: value.scope,
				teamIds: value.scope === "all" ? [] : value.teamIds,
				employeeIds: value.scope === "all" ? [] : value.employeeIds,
			});
		},
	});
	const scopeLabels = {
		all: t("settings.equipment.officers.all", "Whole organization"),
		selected: t(
			"settings.equipment.officers.selected",
			"Selected teams and employees",
		),
	};
	return (
		// Client-side TanStack Form submit; the settings page needs JS.
		// react-doctor-disable-next-line react-doctor/no-prevent-default
		<form
			noValidate
			className="flex min-h-0 flex-1 flex-col"
			onSubmit={(e) => {
				e.preventDefault();
				void form.handleSubmit();
			}}
		>
			<ActionPanelBody className="space-y-6">
				<form.Field
					name="employeeId"
					validators={{
						onSubmit: ({ value }) =>
							!value
								? t(
										"settings.equipment.officers.officerRequired",
										"Select an equipment officer.",
									)
								: undefined,
					}}
				>
					{(field) => (
						<TFormItem>
							<TFormLabel hasError={field.state.meta.errors.length > 0}>
								{t("settings.equipment.officers.officer", "Equipment officer")}
							</TFormLabel>
							{employeeId ? (
								<p className="break-words rounded-md border bg-muted/40 px-3 py-2 text-sm font-medium">
									{editingGrant?.name ??
										data.employees.find((e) => e.id === employeeId)?.name}
								</p>
							) : (
								<TFormControl hasError={field.state.meta.errors.length > 0}>
									<SearchableSelect
										options={candidates.map((employee) => ({
											code: employee.id,
											name: employee.name,
										}))}
										value={field.state.value}
										onValueChange={field.handleChange}
										onOpenChange={(next) => {
											if (!next) field.handleBlur();
										}}
										placeholder={t(
											"settings.equipment.officers.choose",
											"Select an officer…",
										)}
										searchPlaceholder={t(
											"settings.equipment.officers.search",
											"Search employees…",
										)}
										emptyText={t(
											"settings.equipment.officers.noMatches",
											"No current employee found.",
										)}
										disabled={pending}
									/>
								</TFormControl>
							)}
							<TFormMessage field={field} />
						</TFormItem>
					)}
				</form.Field>
				<form.Field name="scope">
					{(field) => (
						<TFormItem>
							<TFormLabel>
								{t("settings.equipment.officers.scope", "Responsibility scope")}
							</TFormLabel>
							<Select
								value={field.state.value}
								onValueChange={(value) =>
									field.handleChange(value === "all" ? "all" : "selected")
								}
								disabled={pending}
							>
								<TFormControl>
									<SelectTrigger className="w-full" onBlur={field.handleBlur}>
										<SelectValue />
									</SelectTrigger>
								</TFormControl>
								<SelectContent>
									<SelectItem value="all">{scopeLabels.all}</SelectItem>
									<SelectItem value="selected">
										{scopeLabels.selected}
									</SelectItem>
								</SelectContent>
							</Select>
							<TFormDescription>
								{field.state.value === "all"
									? t(
											"settings.equipment.officers.allHelp",
											"Covers every current and future employee in the organization.",
										)
									: t(
											"settings.equipment.officers.selectedHelp",
											"Covers members of the selected teams and the selected employees.",
										)}
							</TFormDescription>
						</TFormItem>
					)}
				</form.Field>
				<form.Subscribe selector={(state) => state.values.scope}>
					{(scope) =>
						scope === "selected" ? (
							<div className="grid gap-6 lg:grid-cols-2">
								<form.Field name="teamIds">
									{(field) => (
										<ScopeChoices
											title={t("settings.equipment.officers.teams", "Teams")}
											empty={t(
												"settings.equipment.officers.noTeams",
												"No teams available.",
											)}
											choices={data.teams}
											value={field.state.value}
											onChange={field.handleChange}
											disabled={pending}
										/>
									)}
								</form.Field>
								<form.Field name="employeeIds">
									{(field) => (
										<ScopeChoices
											title={t(
												"settings.equipment.officers.employees",
												"Employees",
											)}
											empty={t(
												"settings.equipment.officers.noEmployees",
												"No current employees available.",
											)}
											// Former employees stay listed only while the grant names them.
											choices={data.employees.filter(
												(employee) =>
													employee.current ||
													field.state.value.includes(employee.id),
											)}
											value={field.state.value}
											onChange={field.handleChange}
											disabled={pending}
										/>
									)}
								</form.Field>
							</div>
						) : null
					}
				</form.Subscribe>
				<form.Subscribe selector={(state) => state.errorMap.onSubmit}>
					{(error) =>
						typeof error === "string" ? (
							<p role="alert" className="text-sm text-destructive">
								{error}
							</p>
						) : null
					}
				</form.Subscribe>
			</ActionPanelBody>
			<ActionPanelFooter>
				<Button
					type="button"
					variant="outline"
					onClick={onCancel}
					disabled={pending}
				>
					{t("settings.equipment.cancel", "Cancel")}
				</Button>
				<Button type="submit" disabled={pending}>
					{pending ? (
						<IconLoader2
							className="size-4 motion-safe:animate-spin"
							aria-hidden="true"
						/>
					) : null}
					{t("settings.equipment.officers.save", "Save responsibility")}
				</Button>
			</ActionPanelFooter>
		</form>
	);
}

function ScopeChoices({
	title,
	empty,
	choices,
	value,
	onChange,
	disabled,
}: {
	title: string;
	empty: string;
	choices: { id: string; name: string }[];
	value: string[];
	onChange: (ids: string[]) => void;
	disabled: boolean;
}) {
	const id = useId();
	const selected = new Set(value);
	return (
		<fieldset className="min-w-0 space-y-2" disabled={disabled}>
			<legend className="mb-2 text-sm font-medium">{title}</legend>
			{choices.length === 0 ? (
				<p className="text-sm text-muted-foreground">{empty}</p>
			) : (
				<div className="max-h-64 space-y-1 overflow-auto rounded-md border p-2">
					{choices.map((choice) => (
						<div
							key={choice.id}
							className="flex items-start gap-3 rounded-sm px-2 py-1.5 hover:bg-accent/50"
						>
							<Checkbox
								id={`${id}-${choice.id}`}
								checked={selected.has(choice.id)}
								disabled={disabled}
								onCheckedChange={(checked) =>
									onChange(
										checked
											? [...value, choice.id]
											: value.filter((other) => other !== choice.id),
									)
								}
								className="mt-0.5"
							/>
							<label
								htmlFor={`${id}-${choice.id}`}
								className="min-w-0 flex-1 cursor-pointer break-words text-sm"
							>
								{choice.name}
							</label>
						</div>
					))}
				</div>
			)}
		</fieldset>
	);
}

function RevokeOfficerDialog({
	grant,
	pending,
	onClose,
	onConfirm,
}: {
	grant: Grant | null;
	pending: boolean;
	onClose: () => void;
	onConfirm: (grant: Grant) => void;
}) {
	const { t } = useTranslate();
	// Keep the last grant on screen while the dialog animates closed.
	const [shown, setShown] = useState(grant);
	if (grant && grant !== shown) setShown(grant);
	return (
		<AlertDialog
			open={grant !== null}
			onOpenChange={(open) => {
				if (!open && !pending) onClose();
			}}
		>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t(
							"settings.equipment.officers.revokeTitle",
							"Revoke equipment responsibility?",
						)}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"settings.equipment.officers.revokeDescription",
							"{name} loses this equipment responsibility immediately. You can add them as an officer again later.",
							{ name: shown?.name ?? "" },
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel disabled={pending}>
						{t("settings.equipment.cancel", "Cancel")}
					</AlertDialogCancel>
					{/* A plain button keeps the dialog open until the command settles. */}
					<Button
						variant="destructive"
						disabled={pending}
						onClick={() => {
							if (grant) onConfirm(grant);
						}}
					>
						{pending ? (
							<IconLoader2
								className="size-4 motion-safe:animate-spin"
								aria-hidden="true"
							/>
						) : null}
						{t("settings.equipment.officers.revoke", "Revoke responsibility")}
					</Button>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
