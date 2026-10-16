"use client";

import { useForm } from "@tanstack/react-form";

import { useQuery } from "@tanstack/react-query";

import { useTolgee, useTranslate } from "@tolgee/react";

import { useMemo, useState } from "react";

import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
	AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
	TFormControl,
	TFormItem,
	TFormLabel,
} from "@/components/ui/tanstack-form";
import { useSession } from "@/lib/auth-client";
import { parseInstant } from "@/lib/datetime/temporal-core";

import type { DrivingLicenceRetentionData } from "@/lib/organization/driving-licence/retention";

import {
	cleanupDrivingLicenceEvidenceAction,
	getDrivingLicenceRetentionAction,
	placeDrivingLicenceHoldAction,
	releaseDrivingLicenceHoldAction,
} from "@/lib/organization/driving-licence/retention-actions";

export function DrivingLicenceRetentionSettings() {
	const { t } = useTranslate();

	const formatTime = useRetentionTime();

	const { data: session } = useSession();

	const query = useQuery({
		queryKey: [
			"driving-licence-retention",

			session?.session.activeOrganizationId,

			session?.user.id,
		],

		queryFn: async () => {
			const result = await getDrivingLicenceRetentionAction();

			if (!result.success) throw new Error(result.error);

			return result.data;
		},

		enabled: !!session?.session.activeOrganizationId,
	});

	const [error, setError] = useState(false);

	const [busy, setBusy] = useState(false);

	const refresh = async () => {
		await query.refetch();
	};

	async function cleanup() {
		setBusy(true);

		setError(false);

		try {
			const result = await cleanupDrivingLicenceEvidenceAction();

			if (!result.success) setError(true);
			else await refresh();
		} catch {
			setError(true);
		}

		setBusy(false);
	}

	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t(
						"drivingLicence.retention.title",

						"Evidence retention and legal-case holds",
					)}
				</CardTitle>
				<CardDescription>
					{t(
						"drivingLicence.retention.help",

						"Retention starts when a check no longer supports any active class. A hold requires a specific legal case, also protects related report evidence from the same employment period, and must be released when preservation is no longer required. These controls do not grant inspection access. Do not enter medical or personal background details.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				{query.isPending && (
					<p role="status">
						{t(
							"drivingLicence.retention.loading",

							"Loading retention records…",
						)}
					</p>
				)}
				{(query.isError || error) && (
					<p role="alert">
						{t(
							"drivingLicence.retention.error",

							"Retention administration could not be completed. Refresh and check your access and case details.",
						)}
					</p>
				)}
				{query.data && (
					<>
						<RetentionRecords data={query.data} onSaved={refresh} />
						<ImpedimentRetentionRecords data={query.data} />
						<PlaceHoldForm data={query.data} onSaved={refresh} />
						<CleanupButton busy={busy} onConfirm={() => void cleanup()} />
						<h3 className="font-medium">
							{t("drivingLicence.retention.runs", "Recent cleanup results")}
						</h3>
						<ul className="space-y-1 text-sm">
							{query.data.runs.map((run) => (
								<li key={run.id}>
									{t(
										"drivingLicence.retention.run",

										"{time}: {deleted} deleted, {held} held, {protected} protected. Actor: {actor}",

										{
											time: formatTime(run.completedAt),

											deleted: run.deletedCount,

											held: run.heldCount,

											protected: run.protectedCount,

											actor:
												run.actorUserId ??
												t(
													"drivingLicence.retention.scheduled",

													"Scheduled processing",
												),
										},
									)}
								</li>
							))}
						</ul>
					</>
				)}
			</CardContent>
		</Card>
	);
}

function RetentionRecords({
	data,

	onSaved,
}: {
	data: DrivingLicenceRetentionData;

	onSaved: () => Promise<void>;
}) {
	const { t } = useTranslate();

	const formatTime = useRetentionTime();

	return (
		<ul className="space-y-4">
			{data.records.map((record) => (
				<li
					key={record.checkId}
					className="space-y-2 break-words rounded-md border p-3"
					style={{ contentVisibility: "auto" }}
				>
					<p className="font-medium">
						{t("drivingLicence.retention.record", "{employee} · Check {date}", {
							employee: record.employeeName,

							date: formatTime(record.controlledAt),
						})}
					</p>
					<p className="text-sm">
						{record.protected
							? t(
									"drivingLicence.retention.protected",

									"Protected by an active class authorization",
								)
							: t(
									"drivingLicence.retention.deadline",

									"Retention began {start}. Eligible for deletion from {end}.",

									{
										start: record.retentionStartedAt ?? "—",

										end: record.deleteAfter ?? "—",
									},
								)}
					</p>
					{record.holds.map((hold) => (
						<div key={hold.id} className="space-y-2 border-l-2 pl-3 text-sm">
							<p>
								{t(
									"drivingLicence.retention.holdDetails",

									"Case {case}: {reason}. Placed by {actor} at {time}.",

									{
										case: hold.caseReference,

										reason: hold.preservationReason,

										actor: hold.placedBy,

										time: formatTime(hold.placedAt),
									},
								)}
							</p>
							{hold.releasedAt ? (
								<p>
									{t(
										"drivingLicence.retention.released",

										"Released by {actor} at {time}: {reason}",

										{
											actor: hold.releasedBy ?? "—",

											time: formatTime(hold.releasedAt),

											reason: hold.releaseReason ?? "—",
										},
									)}
								</p>
							) : (
								<ReleaseHoldForm holdId={hold.id} onSaved={onSaved} />
							)}
						</div>
					))}
				</li>
			))}
		</ul>
	);
}

function ImpedimentRetentionRecords({
	data,
}: {
	data: DrivingLicenceRetentionData;
}) {
	const { t } = useTranslate();
	const formatTime = useRetentionTime();
	if (!data.reports.length) return null;
	return (
		<section className="space-y-3">
			<h3 className="font-medium">
				{t(
					"drivingLicence.retention.reportsTitle",
					"Impediment report retention",
				)}
			</h3>
			<ul className="space-y-3">
				{data.reports.map((report) => (
					<li
						key={report.reportId}
						className="space-y-2 break-words rounded-md border p-3 text-sm"
						style={{ contentVisibility: "auto" }}
					>
						<p className="font-medium">
							{t(
								"drivingLicence.retention.report",
								"{employee} · Report {date}",
								{
									employee: report.employeeName,
									date: formatTime(report.reportedAt),
								},
							)}
						</p>
						<p>
							{report.protected
								? t(
										"drivingLicence.retention.reportProtected",
										"Protected while the current report remains unresolved or its resolution check supports active authorization.",
									)
								: t(
										"drivingLicence.retention.deadline",
										"Retention began {start}. Eligible for deletion from {end}.",
										{
											start: formatTime(report.retentionStartedAt),
											end: formatTime(report.deleteAfter),
										},
									)}
						</p>
						{report.holds.map((hold) => (
							<p key={hold.id}>
								{t(
									"drivingLicence.retention.reportHeld",
									"Protected by case {case} on related check evidence from this employment period. Release the hold on that check when preservation is no longer required.",
									{ case: hold.caseReference },
								)}
							</p>
						))}
					</li>
				))}
			</ul>
		</section>
	);
}

function PlaceHoldForm({
	data,

	onSaved,
}: {
	data: DrivingLicenceRetentionData;

	onSaved: () => Promise<void>;
}) {
	const { t } = useTranslate();
	const formatTime = useRetentionTime();

	const [error, setError] = useState(false);

	const form = useForm({
		defaultValues: { checkId: "", caseReference: "", preservationReason: "" },

		onSubmit: async ({ value }) => {
			setError(false);

			const result = await placeDrivingLicenceHoldAction(value);

			if (!result.success) {
				setError(true);

				return;
			}

			form.reset();

			await onSaved();
		},
	});

	if (!data.records.length)
		return (
			<p>{t("drivingLicence.retention.empty", "No retained check records.")}</p>
		);

	return (
		<form
			className="space-y-3 rounded-md border p-3"
			onSubmit={(event) => {
				event.preventDefault();

				void form.handleSubmit();
			}}
		>
			<h3 className="font-medium">
				{t("drivingLicence.retention.place", "Place a specific-case hold")}
			</h3>
			<form.Field name="checkId">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("drivingLicence.retention.check", "Check record")}
						</TFormLabel>
						<TFormControl>
							<select
								aria-label={t("drivingLicence.retention.check", "Check record")}
								required
								className="h-10 w-full rounded-md border bg-background px-3 text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-ring"
								name={field.name}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(e) => field.handleChange(e.target.value)}
							>
								<option value="">
									{t(
										"drivingLicence.retention.choose",

										"Choose a retained record",
									)}
								</option>
								{data.records.map((record) => (
									<option key={record.checkId} value={record.checkId}>
										{record.employeeName} · {formatTime(record.controlledAt)}
									</option>
								))}
							</select>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="caseReference">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t(
								"drivingLicence.retention.case",

								"Specific legal-case reference",
							)}
						</TFormLabel>
						<TFormControl>
							<Input
								required
								minLength={3}
								maxLength={100}
								spellCheck={false}
								autoComplete="off"
								name={field.name}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(e) => field.handleChange(e.target.value)}
							/>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="preservationReason">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t(
								"drivingLicence.retention.reason",

								"Why this case requires preservation",
							)}
						</TFormLabel>
						<TFormControl>
							<Input
								required
								minLength={10}
								maxLength={400}
								autoComplete="off"
								name={field.name}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(e) => field.handleChange(e.target.value)}
							/>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>
			{error && (
				<p role="alert">
					{t(
						"drivingLicence.retention.saveError",

						"The hold could not be saved. Check the case details and your access.",
					)}
				</p>
			)}
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(busy) => (
					<Button type="submit" disabled={busy}>
						{t("drivingLicence.retention.place", "Place a specific-case hold")}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}

function ReleaseHoldForm({
	holdId,

	onSaved,
}: {
	holdId: string;

	onSaved: () => Promise<void>;
}) {
	const { t } = useTranslate();

	const [error, setError] = useState(false);

	const form = useForm({
		defaultValues: { releaseReason: "" },

		onSubmit: async ({ value }) => {
			setError(false);

			const result = await releaseDrivingLicenceHoldAction({
				holdId,

				...value,
			});

			if (!result.success) {
				setError(true);

				return;
			}

			await onSaved();
		},
	});

	return (
		<form
			className="space-y-2"
			onSubmit={(event) => {
				event.preventDefault();

				void form.handleSubmit();
			}}
		>
			<form.Field name="releaseReason">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t(
								"drivingLicence.retention.releaseReason",

								"Why preservation is no longer required",
							)}
						</TFormLabel>
						<TFormControl>
							<Input
								required
								minLength={10}
								maxLength={400}
								autoComplete="off"
								name={field.name}
								value={field.state.value}
								onBlur={field.handleBlur}
								onChange={(e) => field.handleChange(e.target.value)}
							/>
						</TFormControl>
					</TFormItem>
				)}
			</form.Field>
			{error && (
				<p role="alert">
					{t(
						"drivingLicence.retention.releaseError",

						"The hold could not be released. Check your access and release reason.",
					)}
				</p>
			)}
			<form.Subscribe selector={(state) => state.isSubmitting}>
				{(busy) => (
					<Button type="submit" variant="outline" disabled={busy}>
						{t("drivingLicence.retention.release", "Release hold")}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}

function useRetentionTime() {
	const locale = useTolgee(["language"]).getLanguage() ?? "en";
	const formatter = useMemo(
		() =>
			new Intl.DateTimeFormat(locale, {
				year: "numeric",
				month: "short",
				day: "numeric",
				hour: "2-digit",
				minute: "2-digit",
				timeZone: "UTC",
				timeZoneName: "short",
			}),
		[locale],
	);
	return (value: string | null) =>
		value ? formatter.format(parseInstant(value).epochMilliseconds) : "—";
}

function CleanupButton({
	busy,
	onConfirm,
}: {
	busy: boolean;
	onConfirm: () => void;
}) {
	const { t } = useTranslate();
	return (
		<AlertDialog>
			<AlertDialogTrigger asChild>
				<Button type="button" variant="outline" disabled={busy}>
					{busy
						? t("drivingLicence.retention.cleaning", "Checking due records…")
						: t("drivingLicence.retention.cleanup", "Run due evidence cleanup")}
				</Button>
			</AlertDialogTrigger>
			<AlertDialogContent>
				<AlertDialogHeader>
					<AlertDialogTitle>
						{t("drivingLicence.retention.confirmTitle", "Delete due evidence?")}
					</AlertDialogTitle>
					<AlertDialogDescription>
						{t(
							"drivingLicence.retention.confirmDescription",
							"This permanently removes evidence whose retention period has ended. Current active authorizations and legal-case holds remain protected. Deleted originals and supplements cannot be recovered through the application.",
						)}
					</AlertDialogDescription>
				</AlertDialogHeader>
				<AlertDialogFooter>
					<AlertDialogCancel>{t("common.cancel", "Cancel")}</AlertDialogCancel>
					<AlertDialogAction onClick={onConfirm}>
						{t("drivingLicence.retention.confirmDelete", "Delete due evidence")}
					</AlertDialogAction>
				</AlertDialogFooter>
			</AlertDialogContent>
		</AlertDialog>
	);
}
