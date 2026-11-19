"use client";

import { useTranslate } from "@tolgee/react";
import { useSearchParams } from "next/navigation";
import { useId } from "react";
import { DataTableToolbar } from "@/components/data-table-server/data-table-toolbar";
import { Label } from "@/components/ui/label";
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@/components/ui/select";
import { getPlatformAnalyticsBucketOptions } from "@/lib/platform-analytics/range";
import type {
	PlatformAnalyticsBucket,
	PlatformAnalyticsRange,
} from "@/lib/platform-analytics/types";
import { useRouter } from "@/navigation";

const RANGE_LABELS: Record<PlatformAnalyticsRange, string> = {
	"7d": "Last 7 days",
	"30d": "Last 30 days",
	"90d": "Last 90 days",
	"12m": "Last 12 months",
};

const BUCKET_LABELS: Record<PlatformAnalyticsBucket, string> = {
	day: "Daily",
	week: "Weekly",
	month: "Monthly",
};

const RANGE_OPTIONS = Object.keys(RANGE_LABELS) as PlatformAnalyticsRange[];

export function PlatformAnalyticsControls({
	range,
	bucket,
}: {
	range: PlatformAnalyticsRange;
	bucket: PlatformAnalyticsBucket;
}) {
	const { t } = useTranslate();
	const { push } = useRouter();
	const searchParams = useSearchParams();
	const rangeId = useId();
	const bucketId = useId();
	const bucketOptions = getPlatformAnalyticsBucketOptions(range);

	function pushParams(nextRange: PlatformAnalyticsRange, nextBucket: PlatformAnalyticsBucket) {
		const params = new URLSearchParams(searchParams.toString());
		params.set("range", nextRange);
		params.set("bucket", nextBucket);
		push(`/platform-admin/analytics?${params.toString()}`);
	}

	function handleRangeChange(value: string) {
		const nextRange = value as PlatformAnalyticsRange;
		const nextBucketOptions = getPlatformAnalyticsBucketOptions(nextRange);
		const nextBucket = nextBucketOptions.includes(bucket) ? bucket : nextBucketOptions[0];

		pushParams(nextRange, nextBucket);
	}

	function handleBucketChange(value: string) {
		pushParams(range, value as PlatformAnalyticsBucket);
	}

	return (
		<fieldset className="min-w-0 space-y-4 rounded-lg border bg-muted/20 p-4">
			<legend className="px-1 text-sm font-medium">
				{t("admin:admin.analytics.scope", "Platform-wide reporting")}
			</legend>
			<DataTableToolbar
				filterControls={
					<div className="grid w-full min-w-0 gap-4 sm:grid-cols-2 sm:max-w-xl">
						<div className="grid min-w-0 gap-1.5">
							<Label
								htmlFor={rangeId}
								className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
							>
								{t("admin:admin.analytics.controls.range.label", "Range")}
							</Label>
							<Select value={range} onValueChange={handleRangeChange}>
								<SelectTrigger
									id={rangeId}
									className="h-auto min-h-10 w-full whitespace-normal text-left [&_[data-slot=select-value]]:line-clamp-none"
									aria-label={t(
										"admin:admin.analytics.controls.range.ariaLabel",
										"Analytics range",
									)}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{RANGE_OPTIONS.map((option) => (
										<SelectItem key={option} value={option}>
											{t(`admin:admin.analytics.controls.range.${option}`, RANGE_LABELS[option])}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>

						<div className="grid min-w-0 gap-1.5">
							<Label
								htmlFor={bucketId}
								className="text-xs font-medium uppercase tracking-wider text-muted-foreground"
							>
								{t("admin:admin.analytics.controls.bucket.label", "Bucket")}
							</Label>
							<Select value={bucket} onValueChange={handleBucketChange}>
								<SelectTrigger
									id={bucketId}
									className="h-auto min-h-10 w-full whitespace-normal text-left [&_[data-slot=select-value]]:line-clamp-none"
									aria-label={t(
										"admin:admin.analytics.controls.bucket.ariaLabel",
										"Analytics bucket",
									)}
								>
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{bucketOptions.map((option) => (
										<SelectItem key={option} value={option}>
											{t(`admin:admin.analytics.controls.bucket.${option}`, BUCKET_LABELS[option])}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
					</div>
				}
			/>
		</fieldset>
	);
}
