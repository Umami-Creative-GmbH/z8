"use client";

import { useForm } from "@tanstack/react-form";
import { useQuery } from "@tanstack/react-query";
import { useTolgee, useTranslate } from "@tolgee/react";
import { useMemo, useState } from "react";
import { toast } from "sonner";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
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
import { TFormControl, TFormItem, TFormLabel } from "@/components/ui/tanstack-form";
import { useSession } from "@/lib/auth-client";
import { parseInstant } from "@/lib/datetime/temporal-core";
import type { DrivingLicenceRetentionData } from "@/lib/organization/driving-licence/retention";
import {
	cleanupDrivingLicenceEvidenceAction,
	getDrivingLicenceRetentionAction,
	placeDrivingLicenceHoldAction,
	releaseDrivingLicenceHoldAction,
} from "@/lib/organization/driving-licence/retention-actions";
import { queryKeys } from "@/lib/query";

type Translate = ReturnType<typeof useTranslate>["t"];
type RetentionRecord = DrivingLicenceRetentionData["records"][number];

/** The Retention & holds tab (#1427): retained records, legal-case holds and cleanup. */
export function DrivingLicenceRetentionSettings() {
	const { t } = useTranslate();
	const { data: session } = useSession();
	const query = useQuery({
		queryKey: queryKeys.drivingLicence.retention(
			session?.session.activeOrganizationId,
			session?.user.id,
		),
		queryFn: async () => {
			const result = await getDrivingLicenceRetentionAction();
			if (!result.success) throw new Error(result.error);
			return result.data;
		},
		enabled: !!session?.session.activeOrganizationId,
	});
	const refresh = async () => {
		await query.refetch();
	};

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle>
						{t("drivingLicence.retention.title", "Evidence retention and legal-case holds")}
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
						<p role="status" className="text-sm text-muted-foreground">
							{t("drivingLicence.retention.loading", "Loading retention records…")}
						</p>
					)}
					{query.isError && (
						<p role="alert" className="text-sm text-destructive">
							{t(
								"drivingLicence.retention.error",
								"Retention administration could not be completed. Refresh and check your access and case details.",
							)}
						</p>
					)}
					{query.data && <RetentionRecords data={query.data} />}
				</CardContent>
			</Card>
			{query.data && (
				<>
					<HoldsCard data={query.data} onSaved={refresh} />
					<ImpedimentRetentionRecords data={query.data} />
					<CleanupCard data={query.data} onCleaned={refresh} />
				</>
			)}
		</div>
	);
}

function retentionStatus(
	t: Translate,
	formatTime: (value: string | null) => string,
	row: { protected: boolean; retentionStartedAt: string | null; deleteAfter: string | null },
	protectedText: string,
) {
	return row.protected
		? protectedText
		: t(
				"drivingLicence.retention.deadline",
				"Retention began {start}. Eligible for deletion from {end}.",
				{ start: formatTime(row.retentionStartedAt), end: formatTime(row.deleteAfter) },
			);
}

function RetentionRecords({ data }: { data: DrivingLicenceRetentionData }) {
	const { t } = useTranslate();
	const formatTime = useRetentionTime();
	if (!data.records.length)
		return (
			<p className="text-sm text-muted-foreground">
				{t("drivingLicence.retention.empty", "No retained check records.")}
			</p>
		);
	return (
		<Table mobileLayout="stacked">
			<TableHeader>
				<TableRow>
					<TableHead>{t("drivingLicence.retention.check", "Check record")}</TableHead>
					<TableHead>{t("drivingLicence.settingsTabs.retentionColumn", "Retention")}</TableHead>
					<TableHead>{t("drivingLicence.settingsTabs.holdsColumn", "Open holds")}</TableHead>
				</TableRow>
			</TableHeader>
			<TableBody>
				{data.records.map((record) => (
					<TableRow key={record.checkId}>
						<TableCell className="font-medium whitespace-normal break-words">
							{t("drivingLicence.retention.record", "{employee} · Check {date}", {
								employee: record.employeeName,
								date: formatTime(record.controlledAt),
							})}
						</TableCell>
						<TableCell className="whitespace-normal">
							{retentionStatus(
								t,
								formatTime,
								record,
								t(
									"drivingLicence.retention.protected",
									"Protected by an active class authorization",
								),
							)}
						</TableCell>
						<TableCell className="whitespace-normal">
							{record.holds
								.filter((hold) => !hold.releasedAt)
								.map((hold) => hold.caseReference)
								.join(", ") || "—"}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

function HoldsCard({
	data,
	onSaved,
}: {
	data: DrivingLicenceRetentionData;
	onSaved: () => Promise<void>;
}) {
	const { t } = useTranslate();
	const formatTime = useRetentionTime();
	const holds = data.records.flatMap((record) => record.holds.map((hold) => ({ record, hold })));
	if (!data.records.length && !holds.length) return null;
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("drivingLicence.settingsTabs.holdsTitle", "Legal-case holds")}</CardTitle>
			</CardHeader>
			<CardContent className="space-y-6">
				{holds.length ? (
					<ul className="divide-y rounded-md border">
						{holds.map(({ record, hold }) => (
							<li key={hold.id} className="space-y-2 break-words p-3 text-sm">
								<p className="font-medium">
									{t("drivingLicence.retention.record", "{employee} · Check {date}", {
										employee: record.employeeName,
										date: formatTime(record.controlledAt),
									})}
								</p>
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
									<p className="text-muted-foreground">
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
							</li>
						))}
					</ul>
				) : null}
				<PlaceHoldForm records={data.records} onSaved={onSaved} />
			</CardContent>
		</Card>
	);
}

function ImpedimentRetentionRecords({ data }: { data: DrivingLicenceRetentionData }) {
	const { t } = useTranslate();
	const formatTime = useRetentionTime();
	if (!data.reports.length) return null;
	return (
		<Card>
			<CardHeader>
				<CardTitle>
					{t("drivingLicence.retention.reportsTitle", "Impediment report retention")}
				</CardTitle>
			</CardHeader>
			<CardContent>
				<Table mobileLayout="stacked">
					<TableHeader>
						<TableRow>
							<TableHead>{t("drivingLicence.settingsTabs.reportColumn", "Report")}</TableHead>
							<TableHead>{t("drivingLicence.settingsTabs.retentionColumn", "Retention")}</TableHead>
						</TableRow>
					</TableHeader>
					<TableBody>
						{data.reports.map((report) => (
							<TableRow key={report.reportId}>
								<TableCell className="font-medium whitespace-normal break-words">
									{t("drivingLicence.retention.report", "{employee} · Report {date}", {
										employee: report.employeeName,
										date: formatTime(report.reportedAt),
									})}
								</TableCell>
								<TableCell className="space-y-1 whitespace-normal">
									<p>
										{retentionStatus(
											t,
											formatTime,
											report,
											t(
												"drivingLicence.retention.reportProtected",
												"Protected while the current report remains unresolved or its resolution check supports active authorization.",
											),
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
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</CardContent>
		</Card>
	);
}

function PlaceHoldForm({
	records,
	onSaved,
}: {
	records: RetentionRecord[];
	onSaved: () => Promise<void>;
}) {
	const { t } = useTranslate();
	const formatTime = useRetentionTime();
	const form = useForm({
		defaultValues: { checkId: "", caseReference: "", preservationReason: "" },
		onSubmit: async ({ value }) => {
			const result = await placeDrivingLicenceHoldAction(value).catch(() => null);
			if (!result?.success) {
				toast.error(
					t(
						"drivingLicence.retention.saveError",
						"The hold could not be saved. Check the case details and your access.",
					),
				);
				return;
			}
			form.reset();
			toast.success(t("drivingLicence.settingsTabs.holdPlaced", "Legal-case hold placed"));
			await onSaved();
		},
	});
	if (!records.length) return null;
	const items = records.map((record) => ({
		value: record.checkId,
		label: `${record.employeeName} · ${formatTime(record.controlledAt)}`,
	}));

	return (
		<form
			className="space-y-4"
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
						<TFormLabel>{t("drivingLicence.retention.check", "Check record")}</TFormLabel>
						<Select
							value={field.state.value || null}
							items={items}
							required
							onValueChange={(value: string | null) => field.handleChange(value ?? "")}
						>
							<TFormControl>
								<SelectTrigger className="w-full" onBlur={field.handleBlur}>
									<SelectValue
										placeholder={t("drivingLicence.retention.choose", "Choose a retained record")}
									/>
								</SelectTrigger>
							</TFormControl>
							<SelectContent>
								{items.map((item) => (
									<SelectItem key={item.value} value={item.value}>
										{item.label}
									</SelectItem>
								))}
							</SelectContent>
						</Select>
					</TFormItem>
				)}
			</form.Field>
			<form.Field name="caseReference">
				{(field) => (
					<TFormItem>
						<TFormLabel>
							{t("drivingLicence.retention.case", "Specific legal-case reference")}
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
							{t("drivingLicence.retention.reason", "Why this case requires preservation")}
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
			<form.Subscribe selector={(state) => [state.isSubmitting, !state.values.checkId] as const}>
				{([busy, noRecord]) => (
					<Button type="submit" disabled={busy || noRecord}>
						{t("drivingLicence.retention.place", "Place a specific-case hold")}
					</Button>
				)}
			</form.Subscribe>
		</form>
	);
}

function ReleaseHoldForm({ holdId, onSaved }: { holdId: string; onSaved: () => Promise<void> }) {
	const { t } = useTranslate();
	const form = useForm({
		defaultValues: { releaseReason: "" },
		onSubmit: async ({ value }) => {
			const result = await releaseDrivingLicenceHoldAction({ holdId, ...value }).catch(() => null);
			if (!result?.success) {
				toast.error(
					t(
						"drivingLicence.retention.releaseError",
						"The hold could not be released. Check your access and release reason.",
					),
				);
				return;
			}
			toast.success(t("drivingLicence.settingsTabs.holdReleased", "Legal-case hold released"));
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

function CleanupCard({
	data,
	onCleaned,
}: {
	data: DrivingLicenceRetentionData;
	onCleaned: () => Promise<void>;
}) {
	const { t } = useTranslate();
	const formatTime = useRetentionTime();
	const [busy, setBusy] = useState(false);
	function failed() {
		toast.error(
			t(
				"drivingLicence.retention.error",
				"Retention administration could not be completed. Refresh and check your access and case details.",
			),
		);
	}
	async function cleanup() {
		setBusy(true);
		try {
			const result = await cleanupDrivingLicenceEvidenceAction();
			if (result.success) {
				toast.success(
					t("drivingLicence.settingsTabs.cleanupFinished", "Due evidence cleanup finished"),
				);
				await onCleaned();
			} else {
				failed();
			}
		} catch {
			failed();
		}
		setBusy(false);
	}
	return (
		<Card>
			<CardHeader>
				<CardTitle>{t("drivingLicence.settingsTabs.cleanupTitle", "Evidence cleanup")}</CardTitle>
				<CardDescription>
					{t(
						"drivingLicence.settingsTabs.cleanupDescription",
						"Due evidence is deleted automatically. Run cleanup now to delete it at once.",
					)}
				</CardDescription>
			</CardHeader>
			<CardContent className="space-y-4">
				<CleanupButton busy={busy} onConfirm={() => void cleanup()} />
				{data.runs.length ? (
					<>
						<h3 className="font-medium">
							{t("drivingLicence.retention.runs", "Recent cleanup results")}
						</h3>
						<ul className="space-y-1 text-sm">
							{data.runs.map((run) => (
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
												t("drivingLicence.retention.scheduled", "Scheduled processing"),
										},
									)}
								</li>
							))}
						</ul>
					</>
				) : null}
			</CardContent>
		</Card>
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

function CleanupButton({ busy, onConfirm }: { busy: boolean; onConfirm: () => void }) {
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
