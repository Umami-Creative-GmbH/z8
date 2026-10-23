"use client";

import { useForm } from "@tanstack/react-form";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { toast } from "sonner";
import { EmployeeSingleSelect } from "@/components/employee-select";
import {
	GrantList,
	GrantScopeFields,
	RevokeGrantDialog,
	toSelectableEmployee,
} from "@/components/settings/access-grants/grant-editor";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { useAppLocale } from "@/components/providers/app-locale-provider";
import { DatePicker } from "@/components/ui/date-picker";
import { formatDateOnly } from "@/components/ui/date-picker-utils";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth-client";
import {
	parseInstant,
	plainDateAt,
	systemClock,
} from "@/lib/datetime/temporal-core";
import {
	type DrivingLicenceVerifierAdminData,
	getDrivingLicenceVerifierAdminDataAction,
	getDrivingLicenceVerifierResponsibilityAction,
	revokeDrivingLicenceVerifierGrantAction,
	saveDrivingLicenceVerifierGrantAction,
} from "@/lib/organization/driving-licence/verifier-actions";
import type {
	DrivingLicenceVerifierGrantView,
	SaveDrivingLicenceVerifierGrantInput,
} from "@/lib/organization/driving-licence/verifiers";
import { queryKeys } from "@/lib/query";

const EMPTY: SaveDrivingLicenceVerifierGrantInput = {
	verifierEmployeeId: "",
	scope: "specific",
	teamIds: [],
	employeeIds: [],
	until: null,
};
const UNTIL_FIELD_ID = "driving-verifier-until";
const grantTimeFormatter = new Intl.DateTimeFormat(undefined, {
	year: "numeric",
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
	timeZone: "UTC",
	timeZoneName: "short",
});
function grantTime(value: string): string {
	return grantTimeFormatter.format(parseInstant(value).epochMilliseconds);
}
function VerifierGrantSummary({
	grant,
	data,
}: {
	grant: DrivingLicenceVerifierGrantView;
	data: DrivingLicenceVerifierAdminData;
}) {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const nameOf = (id: string) =>
		data.employees.find((person) => person.id === id)?.name ?? id;
	return (
		<div className="space-y-1">
			<p>
				{grant.scope === "all"
					? t(
							"settings.drivingLicence.verifiers.all",
							"All employees in this organization",
						)
					: t(
							"settings.drivingLicence.verifiers.selected",
							"{teams} teams, {employees} named employees",
							{
								teams: grant.teamIds.length,
								employees: grant.employeeIds.length,
							},
						)}
			</p>
			{grant.scope === "specific" && (
				<p>
					{[
						...grant.teamIds.map(
							(id) => data.teams.find((team) => team.id === id)?.name ?? id,
						),
						...grant.employeeIds.map(nameOf),
					].join(", ")}
				</p>
			)}
			<p className="text-xs">
				{t(
					"settings.drivingLicence.verifiers.attribution",
					"Granted by {actor} at {time}",
					{ actor: grant.grantedBy, time: grantTime(grant.grantedAt) },
				)}
			</p>
			{grant.until && (
				<p>
					{grant.expired
						? t(
								"settings.drivingLicence.verifiers.untilEnded",
								"Ended after {date} ({timezone}). Edit it to extend or revoke it.",
								{
									date: formatDateOnly(grant.until, locale),
									timezone: data.timezone,
								},
							)
						: t(
								"settings.drivingLicence.verifiers.until",
								"Until {date} (end of day, {timezone})",
								{
									date: formatDateOnly(grant.until, locale),
									timezone: data.timezone,
								},
							)}
				</p>
			)}
		</div>
	);
}
function VerifierEditor({
	data,
	onSaved,
}: {
	data: DrivingLicenceVerifierAdminData;
	onSaved: () => Promise<unknown>;
}) {
	const { t } = useTranslate();
	const [open, setOpen] = useState(false);
	const [editing, setEditing] =
		useState<DrivingLicenceVerifierGrantView | null>(null);
	const [revoking, setRevoking] =
		useState<DrivingLicenceVerifierGrantView | null>(null);
	const [pending, setPending] = useState(false);
	const form = useForm({
		defaultValues: EMPTY,
		onSubmit: async ({ value }) => {
			const result = await saveDrivingLicenceVerifierGrantAction({
				...value,
				until: value.until || null,
			});
			if (!result.success) {
				toast.error(
					result.error === "until_in_past"
						? t(
								"settings.drivingLicence.verifiers.untilInPast",
								"The until date can't be in the past.",
							)
						: result.error === "former_employee"
							? t(
									"settings.drivingLicence.verifiers.formerEmployee",
									"Former employees can't be added. Choose employees on the current roster.",
								)
							: result.error,
				);
				return;
			}
			await onSaved();
			setOpen(false);
			toast.success(
				t(
					"settings.drivingLicence.verifiers.saved",
					"Verifier responsibility saved",
				),
			);
		},
	});
	const values = useStore(form.store, (s) => s.values);
	const submitting = useStore(form.store, (s) => s.isSubmitting);
	// Only the current roster can verify; a former employee a grant still names
	// stays selectable in its scope, marked, so editing the grant keeps them (#1438).
	const currentPeople = data.employees.filter((person) => !person.isFormer);
	const options = currentPeople.map((person) =>
		toSelectableEmployee(person, { isActive: true }),
	);
	const scopeOptions = data.employees.map((person) =>
		toSelectableEmployee(
			person,
			person.isFormer ? { isActive: false, formerSince: person.formerSince } : { isActive: true },
		),
	);
	const nameOf = (id: string) =>
		data.employees.find((p) => p.id === id)?.name ?? id;
	const current = data.grants.filter(
		(g) =>
			!g.revokedAt &&
			currentPeople.some((person) => person.id === g.verifierEmployeeId),
	);
	// Until dates are calendar days in the fixed driving licence timezone, never the viewer's.
	const today = plainDateAt(systemClock.nowInstant(), data.timezone).toString();
	const edit = (grant: DrivingLicenceVerifierGrantView | null) => {
		setEditing(grant);
		const next = grant ?? EMPTY;
		form.setFieldValue("verifierEmployeeId", next.verifierEmployeeId);
		form.setFieldValue("scope", next.scope);
		form.setFieldValue("teamIds", next.teamIds);
		form.setFieldValue("employeeIds", next.employeeIds);
		// An ended grant's old date would be refused; start from no end instead.
		form.setFieldValue("until", grant && !grant.expired ? grant.until : null);
		setOpen(true);
	};
	const revoke = async () => {
		if (!revoking) return;
		setPending(true);
		await (async () => {
			const result = await revokeDrivingLicenceVerifierGrantAction({
				grantId: revoking.id,
			});
			if (!result.success) {
				toast.error(result.error);
				return;
			}
			await onSaved();
			setRevoking(null);
			if (editing?.id === revoking.id) setOpen(false);
			toast.success(
				t(
					"settings.drivingLicence.verifiers.revoked",
					"Verifier responsibility revoked",
				),
			);
		})()
			.catch(() =>
				toast.error(
					t(
						"settings.drivingLicence.verifiers.revokeFailed",
						"Could not revoke responsibility. Try again.",
					),
				),
			)
			.finally(() => setPending(false));
	};
	return (
		<div className="space-y-6">
			<GrantList
				rows={current.map((grant) => ({
					id: grant.id,
					title: nameOf(grant.verifierEmployeeId),
					details: <VerifierGrantSummary grant={grant} data={data} />,
				}))}
				canAdd={currentPeople.length > 0}
				onAdd={() => edit(null)}
				onEdit={(id) => edit(current.find((g) => g.id === id) ?? null)}
				onRevoke={(id) => setRevoking(current.find((g) => g.id === id) ?? null)}
				copy={{
					add: t(
						"settings.drivingLicence.verifiers.add",
						"Grant verifier responsibility",
					),
					empty: t(
						"settings.drivingLicence.verifiers.empty",
						"No verifier responsibilities assigned",
					),
					edit: t("common.edit", "Edit"),
					revoke: t("common.revoke", "Revoke"),
				}}
			/>
			<RevokeGrantDialog
				open={!!revoking}
				pending={pending}
				onConfirm={() => void revoke()}
				onClose={() => setRevoking(null)}
				copy={{
					title: t(
						"settings.drivingLicence.verifiers.revokeTitle",
						"Revoke verifier responsibility?",
					),
					description: t(
						"settings.drivingLicence.verifiers.revokeDescription",
						"The verifier immediately loses access to checks in this scope. A new grant is required to restore responsibility.",
					),
					cancel: t("common.cancel", "Cancel"),
					confirm: t("common.revoke", "Revoke"),
				}}
			/>
			{open && (
				<form
					className="space-y-5 rounded-lg border p-4"
					onSubmit={(event) => {
						event.preventDefault();
						void form.handleSubmit();
					}}
				>
					<h3 className="font-medium">
						{t("settings.drivingLicence.verifiers.editor", "Verifier scope")}
					</h3>
					<form.Field name="verifierEmployeeId">
						{(field) => (
							<EmployeeSingleSelect
								label={t(
									"settings.drivingLicence.verifiers.person",
									"Verifier",
								)}
								placeholder={t(
									"settings.drivingLicence.verifiers.select",
									"Select an employee",
								)}
								value={field.state.value || null}
								onChange={(value) => field.handleChange(value ?? "")}
								employees={options}
								disabled={submitting || !!editing}
							/>
						)}
					</form.Field>
					<GrantScopeFields
						scope={values.scope}
						onScopeChange={(scope) => {
							form.setFieldValue("scope", scope);
							if (scope === "all") {
								form.setFieldValue("teamIds", []);
								form.setFieldValue("employeeIds", []);
							}
						}}
						teamIds={values.teamIds}
						onTeamIdsChange={(ids) => form.setFieldValue("teamIds", ids)}
						employeeIds={values.employeeIds}
						onEmployeeIdsChange={(ids) =>
							form.setFieldValue("employeeIds", ids)
						}
						teams={data.teams}
						employeeOptions={scopeOptions}
						disabled={submitting}
						testIdPrefix="driving-verifier-team"
						copy={{
							scope: t(
								"settings.drivingLicence.verifiers.scope",
								"Responsibility",
							),
							allScope: t(
								"settings.drivingLicence.verifiers.all",
								"All employees in this organization",
							),
							specificScope: t(
								"settings.drivingLicence.verifiers.specific",
								"Selected teams and employees",
							),
							allScopeDescription: t(
								"settings.drivingLicence.verifiers.allDescription",
								"Responsibility follows current organization membership. Verifiers can never verify themselves.",
							),
							specificScopeDescription: t(
								"settings.drivingLicence.verifiers.specificDescription",
								"Includes named employees and current members of selected teams. Team changes take effect immediately.",
							),
							teams: t("common.teams", "Teams"),
							noTeams: t(
								"settings.drivingLicence.verifiers.noTeams",
								"No teams available",
							),
							employees: t("common.employees", "Employees"),
							selectEmployees: t(
								"settings.drivingLicence.verifiers.selectEmployees",
								"Select employees",
							),
							departedNotice: null,
						}}
					/>
					<form.Field name="until">
						{(field) => (
							<VerifierUntilField
								value={field.state.value ?? null}
								onChange={(value) => field.handleChange(value || null)}
								onBlur={field.handleBlur}
								min={today}
								disabled={submitting}
								timezone={data.timezone}
							/>
						)}
					</form.Field>
					<div className="flex gap-2">
						<Button
							type="submit"
							disabled={
								submitting ||
								!values.verifierEmployeeId ||
								(values.scope === "specific" &&
									!values.teamIds.length &&
									!values.employeeIds.length)
							}
						>
							{submitting
								? t("common.saving", "Saving…")
								: t("common.save", "Save")}
						</Button>
						<Button
							type="button"
							variant="outline"
							disabled={submitting}
							onClick={() => setOpen(false)}
						>
							{t("common.cancel", "Cancel")}
						</Button>
					</div>
				</form>
			)}
			<RevokedGrantHistory grants={data.grants.filter((g) => g.revokedAt)} nameOf={nameOf} />
		</div>
	);
}

function VerifierUntilField({
	value,
	onChange,
	onBlur,
	min,
	disabled,
	timezone,
}: {
	value: string | null;
	onChange: (value: string | null) => void;
	onBlur: () => void;
	min: string;
	disabled: boolean;
	timezone: string;
}) {
	const { t } = useTranslate();
	return (
		<div className="space-y-2">
			<Label htmlFor={UNTIL_FIELD_ID}>
				{t("settings.drivingLicence.verifiers.untilLabel", "Until (optional)")}
			</Label>
			<DatePicker
				id={UNTIL_FIELD_ID}
				aria-describedby={`${UNTIL_FIELD_ID}-help`}
				value={value}
				onChange={onChange}
				onBlur={onBlur}
				min={min}
				disabled={disabled}
				placeholder={t("settings.drivingLicence.verifiers.untilPlaceholder", "No end date")}
			/>
			<p id={`${UNTIL_FIELD_ID}-help`} className="text-muted-foreground text-sm">
				{t(
					"settings.drivingLicence.verifiers.untilHelp",
					"For temporary cover. Responsibility ends after this whole day in {timezone}. Leave empty for no end.",
					{ timezone },
				)}
			</p>
		</div>
	);
}

function RevokedGrantHistory({
	grants,
	nameOf,
}: {
	grants: readonly DrivingLicenceVerifierGrantView[];
	nameOf: (employeeId: string) => string;
}) {
	const { t } = useTranslate();
	if (!grants.length) return null;
	return (
		<details className="text-sm">
			<summary className="cursor-pointer font-medium">
				{t("settings.drivingLicence.verifiers.history", "Responsibility history")}
			</summary>
			<ul className="mt-3 space-y-3">
				{grants.map((g) => (
					<li key={g.id}>
						{nameOf(g.verifierEmployeeId)} —{" "}
						{t(
							"settings.drivingLicence.verifiers.historyEntry",
							"Granted by {grantor} at {granted}; revoked by {revoker} at {revoked}",
							{
								grantor: g.grantedBy,
								granted: grantTime(g.grantedAt),
								revoker: g.revokedBy ?? "",
								revoked: g.revokedAt ? grantTime(g.revokedAt) : "",
							},
						)}
					</li>
				))}
			</ul>
		</details>
	);
}

export function VerifierSettings() {
	const { t } = useTranslate();
	const { data: session } = useSession();
	const client = useQueryClient();
	const queryKey = queryKeys.drivingLicence.verifiers(
		session?.session.activeOrganizationId,
		session?.user.id,
	);
	const query = useQuery({
		queryKey,
		enabled: !!session?.session.activeOrganizationId,
		queryFn: async () => {
			const result = await getDrivingLicenceVerifierAdminDataAction();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t(
						"settings.drivingLicence.verifiers.title",
						"Driving licence verifiers",
					)}
				</CardTitle>
				<CardDescription>
					{t(
						"settings.drivingLicence.verifiers.summary",
						"Verifier responsibility is separate from intended-driver assignments, line management and personnel file access. Managing these grants does not permit reading inspection records. Self-verification is always prohibited.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent>
				{query.isLoading && <Skeleton className="h-32" />}
				{query.isError && (
					<div role="alert">
						<p>
							{t(
								"settings.drivingLicence.verifiers.loadFailed",
								"Could not load verifier responsibilities",
							)}
						</p>
						<Button
							type="button"
							variant="outline"
							onClick={() => void query.refetch()}
						>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				)}
				{query.data && (
					<VerifierEditor
						key={session?.session.activeOrganizationId}
						data={query.data}
						onSaved={() =>
							client.invalidateQueries({ queryKey: queryKeys.drivingLicence.all })
						}
					/>
				)}
			</CardContent>
		</Card>
	);
}

export function VerifierResponsibility() {
	const { t } = useTranslate();
	const locale = useAppLocale();
	const { data: session } = useSession();
	const query = useQuery({
		queryKey: queryKeys.drivingLicence.myResponsibility(
			session?.session.activeOrganizationId,
			session?.user.id,
		),
		enabled: !!session?.session.activeOrganizationId,
		queryFn: async () => {
			const result = await getDrivingLicenceVerifierResponsibilityAction();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
	});
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t(
						"settings.drivingLicence.verifiers.myTitle",
						"Your verifier responsibility",
					)}
				</CardTitle>
			</CardHeader>
			<CardContent>
				{query.isLoading && <Skeleton className="h-16" />}
				{query.isError && (
					<div role="alert">
						<p>
							{t(
								"settings.drivingLicence.verifiers.loadFailed",
								"Could not load verifier responsibilities",
							)}
						</p>
						<Button
							type="button"
							variant="outline"
							onClick={() => void query.refetch()}
						>
							{t("common.retry", "Retry")}
						</Button>
					</div>
				)}
				{query.isSuccess && (
					<p>
						{!query.data
							? t(
									"settings.drivingLicence.verifiers.none",
									"You have no current driving licence verifier responsibility.",
								)
							: query.data.scope === "all"
								? t(
										"settings.drivingLicence.verifiers.myAll",
										"You are responsible for checks across this organization. You cannot verify yourself.",
									)
								: t(
										"settings.drivingLicence.verifiers.mySelected",
										"You are responsible for {teams} selected teams and {employees} named employees. Current team membership determines access. You cannot verify yourself.",
										{
											teams: query.data.teamIds.length,
											employees: query.data.employeeIds.length,
										},
									)}
					</p>
				)}
				{query.data?.scope === "specific" && (
					<ul className="mt-3 space-y-1 text-sm">
						{query.data.teams.map((team) => (
							<li key={team.id}>{team.name}</li>
						))}
						{query.data.employees.map((person) => (
							<li key={person.id}>{person.name}</li>
						))}
					</ul>
				)}
				{query.data?.until && (
					<p className="mt-3 text-sm">
						{t(
							"settings.drivingLicence.verifiers.myUntil",
							"Your responsibility ends after {date} ({timezone}).",
							{
								date: formatDateOnly(query.data.until, locale),
								timezone: query.data.timezone,
							},
						)}
					</p>
				)}
			</CardContent>
		</Card>
	);
}
