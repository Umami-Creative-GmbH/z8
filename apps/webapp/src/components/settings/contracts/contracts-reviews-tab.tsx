"use client";

import {
	IconAlertTriangle,
	IconCheck,
	IconExternalLink,
	IconInfoCircle,
	IconLoader2,
	IconSparkles,
} from "@tabler/icons-react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslate } from "@tolgee/react";
import { useRef, useState } from "react";
import { toast } from "sonner";
import {
	listContractsReviewQueueAction,
	resolveContractMigrationConflictAction,
} from "@/app/[locale]/(app)/settings/contracts/actions";
import {
	previewBulkContractActionAction,
	submitBulkContractActionAction,
} from "@/app/[locale]/(app)/settings/contracts/bulk-actions";
import { resolveDepartureReviewAction } from "@/app/[locale]/(app)/settings/employees/employee-offboarding.actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { PreviewBulkContractActionResult } from "@/lib/contracts/bulk-operations";
import { Link } from "@/navigation";
import { OnCallReviewsSection } from "./on-call-reviews-section";
import { todayIsoDateInTimezone } from "./contract-formatters";

type ReviewFilterKind =
	| "all"
	| "contract_migration_conflict"
	| "work_after_cutoff"
	| "payroll_reconciliation";

export interface ContractsReviewsTabProps {
	organizationId: string;
	organizationTimezone: string;
}

export function ContractsReviewsTab({
	organizationId,
	organizationTimezone,
}: ContractsReviewsTabProps) {
	const { t } = useTranslate();
	const queryClient = useQueryClient();
	const [filterKind, setFilterKind] = useState<ReviewFilterKind>("all");
	const [includeResolved, setIncludeResolved] = useState(false);
	const [adoptDate, setAdoptDate] = useState(() => todayIsoDateInTimezone(organizationTimezone));
	const [adoptPreview, setAdoptPreview] = useState<PreviewBulkContractActionResult | null>(null);
	const [adoptRequestId, setAdoptRequestId] = useState<string | null>(null);
	const [notes, setNotes] = useState<Record<string, string>>({});
	const adoptPreviewEpochRef = useRef(0);

	const clearAdoptPreview = () => {
		adoptPreviewEpochRef.current += 1;
		setAdoptPreview(null);
		setAdoptRequestId(null);
	};

	const queueQuery = useQuery({
		queryKey: ["contracts", "review-queue", organizationId, includeResolved],
		queryFn: async () => {
			const result = await listContractsReviewQueueAction({ includeResolved });
			if (!result.success) throw new Error(result.error || "Failed to load review queue");
			return result.data;
		},
		staleTime: 15 * 1000,
	});

	const previewAdoptMutation = useMutation({
		mutationFn: async () => {
			const epoch = adoptPreviewEpochRef.current + 1;
			adoptPreviewEpochRef.current = epoch;
			const result = await previewBulkContractActionAction({
				actionKind: "adopt_default",
				effectiveFromDate: adoptDate,
				target: { onlyLegacyTerms: true },
			});
			if (!result.success) throw new Error(result.error || "Failed to preview legacy adoption");
			return { data: result.data, epoch };
		},
		onSuccess: ({ data, epoch }) => {
			if (epoch !== adoptPreviewEpochRef.current) return;
			setAdoptPreview(data);
			setAdoptRequestId(globalThis.crypto.randomUUID());
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t(
							"settings.contracts.reviews.adoptPreviewFailed",
							"Could not preview legacy terms adoption.",
						),
			);
		},
	});

	const submitAdoptMutation = useMutation({
		mutationFn: async () => {
			if (!adoptPreview?.canSubmit) {
				throw new Error(
					t(
						"settings.contracts.reviews.previewRequiredBeforeAdopt",
						"Run a preview before adopting the Org/Team default.",
					),
				);
			}
			const activeRequestId = adoptRequestId ?? globalThis.crypto.randomUUID();
			if (!adoptRequestId) setAdoptRequestId(activeRequestId);
			const result = await submitBulkContractActionAction({
				actionKind: "adopt_default",
				effectiveFromDate: adoptDate,
				target: { onlyLegacyTerms: true },
				requestId: activeRequestId,
				confirmationFingerprint: adoptPreview.confirmationFingerprint,
			});
			if (!result.success) throw new Error(result.error || "Failed to adopt Org/Team default");
			return result.data;
		},
		onSuccess: (receipt) => {
			toast.success(
				t(
					"settings.contracts.reviews.adoptSubmitted",
					"Bulk default adoption started for {count} employees.",
					{ count: receipt.batch.totalItems },
				),
			);
			clearAdoptPreview();
			void Promise.all([
				queryClient.invalidateQueries({ queryKey: ["contracts", "review-queue", organizationId] }),
				queryClient.invalidateQueries({ queryKey: ["contracts", "batches", organizationId] }),
			]);
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t(
							"settings.contracts.reviews.adoptSubmitFailed",
							"Could not start bulk default adoption.",
						),
			);
		},
	});

	const resolveConflictMutation = useMutation({
		mutationFn: async ({
			conflictId,
			status,
		}: {
			conflictId: string;
			status: "resolved" | "dismissed";
		}) => {
			const result = await resolveContractMigrationConflictAction({
				conflictId,
				status,
				resolutionNote: notes[conflictId]?.trim() || null,
			});
			if (!result.success) throw new Error(result.error || "Failed to resolve conflict");
		},
		onSuccess: () => {
			toast.success(t("settings.contracts.reviews.conflictResolved", "Conflict updated"));
			void queryClient.invalidateQueries({
				queryKey: ["contracts", "review-queue", organizationId],
			});
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.reviews.resolveFailed", "Could not resolve review item."),
			);
		},
	});

	const resolveDepartureMutation = useMutation({
		mutationFn: async ({ reviewId }: { reviewId: string }) => {
			const note = notes[reviewId]?.trim() || "";
			if (!note) {
				throw new Error(
					t("settings.contracts.reviews.noteRequired", "Enter a resolution note first."),
				);
			}
			const result = await resolveDepartureReviewAction({
				reviewId,
				resolution: note,
			});
			if (!result.success) throw new Error(result.error || "Failed to resolve departure review");
		},
		onSuccess: () => {
			toast.success(
				t("settings.contracts.reviews.departureReviewResolved", "Review marked resolved"),
			);
			void queryClient.invalidateQueries({
				queryKey: ["contracts", "review-queue", organizationId],
			});
		},
		onError: (err) => {
			toast.error(
				err instanceof Error
					? err.message
					: t("settings.contracts.reviews.resolveFailed", "Could not resolve review item."),
			);
		},
	});

	const queue = queueQuery.data;
	const conflicts =
		filterKind === "all" || filterKind === "contract_migration_conflict"
			? (queue?.migrationConflicts ?? [])
			: [];
	const departureReviews = (queue?.departureReviews ?? []).filter(
		(review) => filterKind === "all" || filterKind === review.kind,
	);
	const legacyCount = queue?.migratedLegacyTermsCount ?? 0;

	return (
		<div className="space-y-6">
			{/* Migrated Legacy Terms Banner with 1-Click Bulk Adopt */}
			{legacyCount > 0 && (
				<Alert role="status" className="border-primary/30 bg-primary/5">
					<IconSparkles className="size-4 text-primary" aria-hidden="true" />
					<AlertTitle>
						{t(
							"settings.contracts.reviews.legacyBannerTitle",
							"{count, plural, one {# employee has preserved pre-migration legacy terms} other {# employees have preserved pre-migration legacy terms}}",
							{ count: legacyCount },
						)}
					</AlertTitle>
					<AlertDescription className="mt-2 space-y-3">
						<p>
							{t(
								"settings.contracts.reviews.legacyBannerDescription",
								"Pre-migration confirmed terms stay preserved so no existing agreement is altered silently. Opt employees into live Org/Primary Team default inheritance deliberately when ready.",
							)}
						</p>
						<div className="flex flex-wrap items-end gap-3">
							<div className="space-y-1">
								<Label htmlFor="legacy-adopt-date" className="text-xs">
									{t("settings.contracts.defaults.effectiveFrom", "Effective from")}
								</Label>
								<Input
									id="legacy-adopt-date"
									type="date"
									value={adoptDate}
									onChange={(e) => {
										setAdoptDate(e.target.value);
										clearAdoptPreview();
									}}
									className="h-8 w-44"
								/>
							</div>
							<Button
								type="button"
								size="sm"
								variant="outline"
								disabled={previewAdoptMutation.isPending}
								onClick={() => previewAdoptMutation.mutate()}
							>
								{previewAdoptMutation.isPending && (
									<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
								)}
								{t("settings.contracts.reviews.previewBulkAdopt", "Preview adoption")}
							</Button>
							<Button
								type="button"
								size="sm"
								disabled={!adoptPreview?.canSubmit || submitAdoptMutation.isPending}
								onClick={() => submitAdoptMutation.mutate()}
							>
								{submitAdoptMutation.isPending && (
									<IconLoader2 className="mr-1.5 size-4 animate-spin" aria-hidden="true" />
								)}
								{t("settings.contracts.reviews.bulkAdoptDefault", "Adopt Org/Team default for all")}
							</Button>
						</div>
						{adoptPreview && (
							<p className="text-xs">
								{t(
									"settings.contracts.reviews.adoptPreviewSummary",
									"{affected} employees will adopt live inheritance ({mode} batch).",
									{ affected: adoptPreview.affectedCount, mode: adoptPreview.executionMode },
								)}
							</p>
						)}
					</AlertDescription>
				</Alert>
			)}

			{/* Queue Controls */}
			<Card>
				<CardHeader>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div>
							<CardTitle>
								{t("settings.contracts.reviews.queueTitle", "Reviews & Conflicts Queue")}
							</CardTitle>
							<CardDescription>
								{t(
									"settings.contracts.reviews.queueDescription",
									"Resolve contract migration mismatches, post-cutoff work reviews, and closed/settled payroll reconciliations.",
								)}
							</CardDescription>
						</div>
						<div className="flex flex-wrap items-center gap-3">
							<Select
								value={filterKind}
								onValueChange={(v) => setFilterKind(v as ReviewFilterKind)}
							>
								<SelectTrigger
									className="w-60"
									aria-label={t("settings.contracts.reviews.filterLabel", "Filter review type")}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="all">
										{t("settings.contracts.reviews.filterAll", "All review types")}
									</SelectItem>
									<SelectItem value="contract_migration_conflict">
										{t(
											"settings.contracts.reviews.kindMigrationConflict",
											"Contract migration conflicts",
										)}
									</SelectItem>
									<SelectItem value="work_after_cutoff">
										{t("settings.contracts.reviews.kindWorkAfterCutoff", "Work after leaving date")}
									</SelectItem>
									<SelectItem value="payroll_reconciliation">
										{t(
											"settings.contracts.reviews.kindPayrollReconciliation",
											"Payroll reconciliation",
										)}
									</SelectItem>
								</SelectContent>
							</Select>
							<div className="flex items-center gap-2">
								<Checkbox
									id="reviews-include-resolved"
									checked={includeResolved}
									onCheckedChange={(c) => setIncludeResolved(c === true)}
								/>
								<Label htmlFor="reviews-include-resolved" className="text-xs">
									{t("settings.contracts.reviews.showResolved", "Show resolved")}
								</Label>
							</div>
						</div>
					</div>
				</CardHeader>
				<CardContent className="space-y-4">
					{queueQuery.isLoading ? (
						<p className="text-muted-foreground text-sm">{t("common.loading", "Loading…")}</p>
					) : conflicts.length === 0 && departureReviews.length === 0 ? (
						<div className="flex items-center gap-2 rounded-lg border border-dashed p-6 text-muted-foreground text-sm">
							<IconInfoCircle className="size-4" aria-hidden="true" />
							{t(
								"settings.contracts.reviews.empty",
								"No open contract conflicts or retrospective departure reviews.",
							)}
						</div>
					) : (
						<ul className="space-y-3">
							{conflicts.map((conflict) => (
								<li key={conflict.id} className="space-y-3 rounded-lg border p-4 text-sm">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div className="flex flex-wrap items-center gap-2">
											<IconAlertTriangle className="size-4 text-amber-600" aria-hidden="true" />
											<Link
												href={`/settings/employees/${conflict.employeeId}#employment-history`}
												className="font-medium underline underline-offset-4"
											>
												{conflict.employeeName}
											</Link>
											<Badge variant="outline">contract_migration_conflict</Badge>
											<Badge variant={conflict.status === "open" ? "destructive" : "secondary"}>
												{conflict.status}
											</Badge>
										</div>
										<Button asChild variant="ghost" size="sm">
											<Link href={`/settings/employees/${conflict.employeeId}#employment-history`}>
												<IconExternalLink className="mr-1 size-3.5" aria-hidden="true" />
												{t("settings.contracts.reviews.openEmployee", "Open profile")}
											</Link>
										</Button>
									</div>
									<p className="text-muted-foreground text-xs">{conflict.conflictKind}</p>

									{conflict.status === "open" && (
										<div className="space-y-2">
											<Textarea
												rows={2}
												placeholder={t(
													"settings.contracts.reviews.notePlaceholder",
													"Optional resolution note…",
												)}
												value={notes[conflict.id] ?? ""}
												onChange={(e) =>
													setNotes((prev) => ({ ...prev, [conflict.id]: e.target.value }))
												}
											/>
											<div className="flex flex-wrap gap-2">
												<Button
													type="button"
													size="sm"
													disabled={resolveConflictMutation.isPending}
													onClick={() =>
														resolveConflictMutation.mutate({
															conflictId: conflict.id,
															status: "resolved",
														})
													}
												>
													<IconCheck className="mr-1 size-3.5" aria-hidden="true" />
													{t("settings.contracts.reviews.markResolved", "Mark resolved")}
												</Button>
												<Button
													type="button"
													size="sm"
													variant="outline"
													disabled={resolveConflictMutation.isPending}
													onClick={() =>
														resolveConflictMutation.mutate({
															conflictId: conflict.id,
															status: "dismissed",
														})
													}
												>
													{t("settings.contracts.reviews.dismiss", "Dismiss")}
												</Button>
											</div>
										</div>
									)}
								</li>
							))}

							{departureReviews.map((review) => (
								<li key={review.id} className="space-y-3 rounded-lg border p-4 text-sm">
									<div className="flex flex-wrap items-center justify-between gap-2">
										<div className="flex flex-wrap items-center gap-2">
											<IconAlertTriangle className="size-4 text-destructive" aria-hidden="true" />
											<Link
												href={`/settings/employees/${review.employeeId}?review=${review.id}`}
												className="font-medium underline underline-offset-4"
											>
												{review.employeeName}
											</Link>
											<Badge variant="outline">{review.kind}</Badge>
											<Badge variant={review.status === "open" ? "destructive" : "secondary"}>
												{review.status}
											</Badge>
											{review.lastWorkingDay && (
												<span className="text-muted-foreground text-xs tabular-nums">
													{t("settings.contracts.reviews.leftOn", "Left {date}", {
														date: review.lastWorkingDay,
													})}
												</span>
											)}
										</div>
										<Button asChild variant="ghost" size="sm">
											<Link href={`/settings/employees/${review.employeeId}?review=${review.id}`}>
												<IconExternalLink className="mr-1 size-3.5" aria-hidden="true" />
												{t("settings.contracts.reviews.openReview", "Open review")}
											</Link>
										</Button>
									</div>

									{review.status === "open" && (
										<div className="space-y-2">
											<Textarea
												rows={2}
												placeholder={t(
													"settings.contracts.reviews.departureNotePlaceholder",
													"Describe how the work or payroll reconciliation was handled…",
												)}
												value={notes[review.id] ?? ""}
												onChange={(e) =>
													setNotes((prev) => ({ ...prev, [review.id]: e.target.value }))
												}
											/>
											<Button
												type="button"
												size="sm"
												disabled={
													resolveDepartureMutation.isPending || !(notes[review.id] ?? "").trim()
												}
												onClick={() => resolveDepartureMutation.mutate({ reviewId: review.id })}
											>
												<IconCheck className="mr-1 size-3.5" aria-hidden="true" />
												{t("settings.contracts.reviews.markResolved", "Mark resolved")}
											</Button>
										</div>
									)}
								</li>
							))}
						</ul>
					)}
				</CardContent>
			</Card>
			<OnCallReviewsSection />
		</div>
	);
}
