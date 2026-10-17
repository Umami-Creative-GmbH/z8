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
import { Skeleton } from "@/components/ui/skeleton";
import { useSession } from "@/lib/auth-client";
import { parseInstant } from "@/lib/datetime/temporal-core";
import {
	type DrivingLicenceVerifierAdminData,
	getDrivingLicenceVerifierAdminDataAction,
	getDrivingLicenceVerifierResponsibilityAction,
	revokeDrivingLicenceVerifierGrantAction,
	saveDrivingLicenceVerifierGrantAction,
} from "@/lib/organization/driving-licence/verifier-actions";
import type {
	DrivingLicenceVerifierGrantRecord,
	SaveDrivingLicenceVerifierGrantInput,
} from "@/lib/organization/driving-licence/verifiers";

const EMPTY: SaveDrivingLicenceVerifierGrantInput = {
	verifierEmployeeId: "",
	scope: "specific",
	teamIds: [],
	employeeIds: [],
};
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
	grant: DrivingLicenceVerifierGrantRecord;
	data: DrivingLicenceVerifierAdminData;
}) {
	const { t } = useTranslate();
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
			{grant.expiresAt && (
				<p>
					{t("settings.drivingLicence.verifiers.expiry", "Expires at {time}", {
						time: grantTime(grant.expiresAt),
					})}
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
		useState<DrivingLicenceVerifierGrantRecord | null>(null);
	const [revoking, setRevoking] =
		useState<DrivingLicenceVerifierGrantRecord | null>(null);
	const [pending, setPending] = useState(false);
	const form = useForm({
		defaultValues: EMPTY,
		onSubmit: async ({ value }) => {
			const result = await saveDrivingLicenceVerifierGrantAction(value);
			if (!result.success) {
				toast.error(result.error);
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
	const options = data.employees.map((person) =>
		toSelectableEmployee(person, { isActive: true }),
	);
	const nameOf = (id: string) =>
		data.employees.find((p) => p.id === id)?.name ?? id;
	const current = data.grants.filter(
		(g) =>
			!g.revokedAt &&
			data.employees.some((person) => person.id === g.verifierEmployeeId),
	);
	const edit = (grant: DrivingLicenceVerifierGrantRecord | null) => {
		setEditing(grant);
		const next = grant ?? EMPTY;
		form.setFieldValue("verifierEmployeeId", next.verifierEmployeeId);
		form.setFieldValue("scope", next.scope);
		form.setFieldValue("teamIds", next.teamIds);
		form.setFieldValue("employeeIds", next.employeeIds);
		form.setFieldValue("expiresAt", next.expiresAt);
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
				canAdd={data.employees.length > 0}
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
						employeeOptions={options}
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
			{data.grants.some((g) => g.revokedAt) && (
				<details className="text-sm">
					<summary className="cursor-pointer font-medium">
						{t(
							"settings.drivingLicence.verifiers.history",
							"Responsibility history",
						)}
					</summary>
					<ul className="mt-3 space-y-3">
						{data.grants
							.filter((g) => g.revokedAt)
							.map((g) => (
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
			)}
		</div>
	);
}

export function VerifierSettings() {
	const { t } = useTranslate();
	const { data: session } = useSession();
	const client = useQueryClient();
	const queryKey = [
		"drivingLicence",
		"verifiers",
		session?.session.activeOrganizationId,
		session?.user.id,
	];
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
						"settings.drivingLicence.verifiers.description",
						"Grant responsibility separately from driver enrollment, line management and personnel file access. Managing these grants does not permit reading inspection records. Self-verification is always prohibited.",
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
							client.invalidateQueries({ queryKey: ["drivingLicence"] })
						}
					/>
				)}
			</CardContent>
		</Card>
	);
}

export function VerifierResponsibility() {
	const { t } = useTranslate();
	const { data: session } = useSession();
	const query = useQuery({
		queryKey: [
			"drivingLicence",
			"myResponsibility",
			session?.session.activeOrganizationId,
			session?.user.id,
		],
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
			</CardContent>
		</Card>
	);
}
