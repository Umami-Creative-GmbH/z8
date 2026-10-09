"use client";

import { IconLoader2, IconMapPin } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { useState } from "react";
import { toast } from "sonner";
import {
	agreeToPositionNoticeAction,
	type OwnPositionCaptureData,
	type OwnPositionStampAccessEntry,
	withdrawPositionConsentAction,
} from "@/app/[locale]/(app)/settings/position-stamps/actions";
import { positionCaptureErrorMessage } from "@/components/position-capture/error-message";
import { formatRecordedPositionInstant } from "@/components/position-capture/format";
import { PositionNoticeText } from "@/components/position-capture/position-notice-text";
import {
	AlertDialog,
	AlertDialogAction,
	AlertDialogCancel,
	AlertDialogContent,
	AlertDialogDescription,
	AlertDialogFooter,
	AlertDialogHeader,
	AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

interface OwnPositionStampsPanelProps {
	data: OwnPositionCaptureData;
	/** Who was shown the employee's positions (#831); null when it could not be loaded. */
	accessLog?: OwnPositionStampAccessEntry[] | null;
}

/**
 * The employee's own "Position stamps" settings: status, current notice, agree
 * and withdraw, and the log of who was shown their positions.
 */
export function OwnPositionStampsPanel({ data, accessLog = null }: OwnPositionStampsPanelProps) {
	const { t } = useTranslate();
	const locale = useLocale();
	const router = useRouter();
	const [pending, setPending] = useState<"agree" | "withdraw" | null>(null);
	const [confirmingWithdrawal, setConfirmingWithdrawal] = useState(false);
	const { notice, consent } = data;
	const date = (iso: string) => formatRecordedPositionInstant(locale, iso);

	const agree = async () => {
		if (!notice) return;
		setPending("agree");
		try {
			const result = await agreeToPositionNoticeAction({ noticeId: notice.id });
			if (result.success) {
				toast.success(t("settings.positionStamps.agreed", "Thank you. Your consent is recorded."));
				router.refresh();
			} else {
				toast.error(
					positionCaptureErrorMessage(t, result.code) ??
						t("settings.positionStamps.agreeFailed", "Your consent could not be saved"),
				);
			}
		} finally {
			setPending(null);
		}
	};

	const withdraw = async () => {
		setPending("withdraw");
		try {
			const result = await withdrawPositionConsentAction();
			if (result.success) {
				toast.success(
					t(
						"settings.positionStamps.withdrawn",
						"Consent withdrawn. Your recorded positions have been deleted.",
					),
				);
				setConfirmingWithdrawal(false);
				router.refresh();
			} else {
				toast.error(
					positionCaptureErrorMessage(t, result.code) ??
						t("settings.positionStamps.withdrawFailed", "Your consent could not be withdrawn"),
				);
			}
		} finally {
			setPending(null);
		}
	};

	return (
		<div className="space-y-6">
			<Card>
				<CardHeader>
					<CardTitle className="flex items-center gap-2">
						<IconMapPin className="size-5" aria-hidden="true" />
						{t("settings.positionStamps.statusTitle", "Your status")}
					</CardTitle>
				</CardHeader>
				<CardContent className="space-y-3">
					<div className="flex flex-wrap items-center gap-2">
						<Badge variant={data.captureOn ? "default" : "secondary"}>
							{data.captureOn
								? t("settings.positionStamps.captureOnBadge", "Capture on")
								: t("settings.positionStamps.captureOffBadge", "Capture off")}
						</Badge>
						<p className="text-sm">
							{data.captureOn
								? t("settings.positionStamps.captureOn", "Position capture is switched on for you.")
								: t(
										"settings.positionStamps.captureOff",
										"Position capture is not switched on for you.",
									)}
						</p>
					</div>
					<p className="text-sm text-muted-foreground">
						{consent.kind === "active"
							? t(
									"settings.positionStamps.consentActive",
									"You agreed to version {version} on {date}.",
									{ version: consent.noticeVersion, date: date(consent.grantedAt) },
								)
							: consent.kind === "lapsed"
								? t(
										"settings.positionStamps.consentLapsed",
										"You agreed to version {previous}. The notice has changed, so no positions are recorded until you agree to version {current}.",
										{ previous: consent.noticeVersion, current: notice?.version ?? "" },
									)
								: consent.kind === "declined"
									? t(
											"settings.positionStamps.consentDeclined",
											"You chose “Not now” for version {version} on {date}.",
											{ version: consent.noticeVersion, date: date(consent.declinedAt) },
										)
									: consent.kind === "withdrawn"
										? t(
												"settings.positionStamps.consentWithdrawn",
												"You withdrew your consent on {date}.",
												{ date: date(consent.withdrawnAt) },
											)
										: t("settings.positionStamps.consentUndecided", "You have not decided yet.")}
					</p>
					<div className="flex flex-wrap gap-2">
						{notice && consent.kind !== "active" ? (
							<Button type="button" onClick={() => void agree()} disabled={pending !== null}>
								{pending === "agree" ? (
									<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
								) : null}
								{t("settings.positionStamps.agree", "Agree")}
							</Button>
						) : null}
						{data.canWithdraw ? (
							<Button
								type="button"
								variant="outline"
								onClick={() => setConfirmingWithdrawal(true)}
								disabled={pending !== null}
							>
								{t("settings.positionStamps.withdraw", "Withdraw consent")}
							</Button>
						) : null}
					</div>
				</CardContent>
			</Card>

			<Card>
				<CardHeader>
					<CardTitle>{t("settings.positionStamps.noticeTitle", "Position notice")}</CardTitle>
					<CardDescription>
						{t(
							"settings.positionStamps.noticeDescription",
							"This is what you agree to. A new version is published when the purpose changes or positions are kept longer.",
						)}
					</CardDescription>
				</CardHeader>
				<CardContent>
					{notice ? (
						<PositionNoticeText
							version={notice.version}
							purposeStatement={notice.purposeStatement}
							retentionDays={Math.min(data.retentionDays, notice.retentionDays)}
						/>
					) : (
						<p className="text-sm text-muted-foreground">
							{t(
								"settings.positionStamps.noNotice",
								"Your organization has not published a position notice.",
							)}
						</p>
					)}
				</CardContent>
			</Card>

			{accessLog ? (
				<Card>
					<CardHeader>
						<CardTitle>
							{t("settings.positionStamps.accessLogTitle", "Who saw your positions")}
						</CardTitle>
						<CardDescription>
							{t(
								"settings.positionStamps.accessLogDescription",
								"Every time someone else is shown your recorded positions, it is listed here.",
							)}
						</CardDescription>
					</CardHeader>
					<CardContent>
						{accessLog.length === 0 ? (
							<p className="text-sm text-muted-foreground">
								{t(
									"settings.positionStamps.accessLogEmpty",
									"Nobody else has been shown your positions.",
								)}
							</p>
						) : (
							<ul className="divide-y">
								{accessLog.map((entry) => (
									<li
										key={entry.id}
										className="flex flex-col gap-0.5 py-2 text-sm sm:flex-row sm:items-baseline sm:justify-between sm:gap-4"
									>
										<div className="min-w-0">
											<p className="font-medium">
												{entry.viewerName ??
													t("settings.positionStamps.accessLogDeletedViewer", "A deleted user")}
											</p>
											<p className="text-muted-foreground">
												{entry.kind === "data_export"
													? t("settings.positionStamps.accessLogExport", "Data export")
													: entry.workPeriods.map((period) => (
															<span key={period.id} className="block">
																{period.date
																	? t(
																			"settings.positionStamps.accessLogWorkPeriod",
																			"Work period on {date}",
																			{ date: period.date },
																		)
																	: t(
																			"settings.positionStamps.accessLogRemovedWorkPeriod",
																			"A work period that no longer exists",
																		)}
															</span>
														))}
											</p>
										</div>
										<p className="shrink-0 text-muted-foreground tabular-nums">
											{date(entry.accessedAt)}
										</p>
									</li>
								))}
							</ul>
						)}
					</CardContent>
				</Card>
			) : null}

			<AlertDialog
				open={confirmingWithdrawal}
				onOpenChange={(next) => {
					if (!next && pending === null) setConfirmingWithdrawal(false);
				}}
			>
				<AlertDialogContent>
					<AlertDialogHeader>
						<AlertDialogTitle>
							{t("settings.positionStamps.withdrawTitle", "Withdraw your consent?")}
						</AlertDialogTitle>
						<AlertDialogDescription>
							{t(
								"settings.positionStamps.withdrawDescription",
								"No more positions are recorded, and this immediately deletes all positions recorded with your clock events. Your clock events stay unchanged. This cannot be undone.",
							)}
						</AlertDialogDescription>
					</AlertDialogHeader>
					<AlertDialogFooter>
						<AlertDialogCancel disabled={pending !== null}>
							{t("common.cancel", "Cancel")}
						</AlertDialogCancel>
						<AlertDialogAction
							onClick={(event) => {
								event.preventDefault();
								void withdraw();
							}}
							disabled={pending !== null}
						>
							{pending === "withdraw" ? (
								<IconLoader2 className="size-4 animate-spin" aria-hidden="true" />
							) : null}
							{t("settings.positionStamps.withdrawConfirm", "Withdraw and delete positions")}
						</AlertDialogAction>
					</AlertDialogFooter>
				</AlertDialogContent>
			</AlertDialog>
		</div>
	);
}
