"use client";

import { useTranslate } from "@tolgee/react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { LoadingTranslation } from "@/components/ui/loading-region";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shared loading state for single-card settings pages. It is the page's root
 * and carries the page frame, unless `framed` is false because the caller
 * already renders inside one. Pass `measure` for configuration pages whose
 * content sits in `page-measure`, so the fallback has the same width.
 */
export function SettingsPageSkeleton({
	variant = "form",
	label,
	framed = true,
	measure = false,
}: {
	variant?: "form" | "list";
	label: string | LoadingTranslation;
	framed?: boolean;
	measure?: boolean;
}) {
	const layout =
		variant === "form"
			? "flex flex-1 flex-col gap-6"
			: "flex flex-1 flex-col gap-4";
	if (measure) {
		const skeleton = (
			<SettingsPageSkeletonBody
				variant={variant}
				label={label}
				className={`page-measure ${layout}`}
			/>
		);
		return framed ? <div className="page-frame">{skeleton}</div> : skeleton;
	}
	return (
		<SettingsPageSkeletonBody
			variant={variant}
			label={label}
			className={framed ? `page-frame ${layout}` : layout}
		/>
	);
}

function SettingsPageSkeletonBody({
	variant,
	label,
	className,
}: {
	variant: "form" | "list";
	label: string | LoadingTranslation;
	className: string;
}) {
	const { t } = useTranslate();
	const isForm = variant === "form";
	const hidden = true;
	return (
		<div
			className={className}
			role="status"
			aria-label={
				typeof label === "string"
					? label
					: t(label.labelKey, label.labelDefault)
			}
		>
			<div className="space-y-2">
				<Skeleton
					aria-hidden={hidden}
					className={
						isForm
							? "h-8 w-48 max-w-full sm:h-9"
							: "h-8 w-64 max-w-full sm:h-9"
					}
				/>
				<Skeleton aria-hidden={hidden} className="h-4 w-96 max-w-full" />
			</div>
			<Card>
				<CardHeader>
					<Skeleton aria-hidden={hidden} className="h-6 w-48 max-w-full" />
					<Skeleton
						aria-hidden={hidden}
						className={isForm ? "h-4 w-72 max-w-full" : "h-4 w-96 max-w-full"}
					/>
				</CardHeader>
				<CardContent>
					<div className="space-y-4">
						<Skeleton
							aria-hidden={hidden}
							className={isForm ? "h-32 w-full" : "h-24 w-full"}
						/>
						<Skeleton
							aria-hidden={hidden}
							className={isForm ? "h-10 w-32" : "h-24 w-full"}
						/>
					</div>
				</CardContent>
			</Card>
		</div>
	);
}

