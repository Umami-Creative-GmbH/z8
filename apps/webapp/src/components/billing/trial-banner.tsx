"use client";

import { IconCreditCard, IconX } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useState } from "react";
import { Link } from "@/navigation";

interface TrialBannerProps {
	daysRemaining: number;
	billingHref: string;
	showUpgradeButton: boolean;
}

export function TrialBanner({ daysRemaining, billingHref, showUpgradeButton }: TrialBannerProps) {
	const { t } = useTranslate();
	const [isDismissing, setIsDismissing] = useState(false);
	const [isDismissed, setIsDismissed] = useState(false);
	const isUrgent = daysRemaining < 5;
	const bannerAccentClassName = isUrgent
		? "border-red-200 bg-red-50/80 text-red-950 dark:border-red-900 dark:bg-red-950/40 dark:text-red-50"
		: "border-blue-200 bg-blue-50/80 text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-50";
	const iconAccentClassName = isUrgent
		? "bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-200"
		: "bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-200";
	const descriptionAccentClassName = isUrgent
		? "text-red-800 dark:text-red-100"
		: "text-blue-800 dark:text-blue-100";
	const upgradeAccentClassName = isUrgent
		? "bg-red-600 hover:bg-red-700 focus-visible:ring-red-500 dark:bg-red-500 dark:hover:bg-red-400"
		: "bg-blue-600 hover:bg-blue-700 focus-visible:ring-blue-500 dark:bg-blue-500 dark:hover:bg-blue-400";
	const dismissAccentClassName = isUrgent
		? "text-red-700 hover:bg-red-100 hover:text-red-900 focus-visible:ring-red-500 dark:text-red-100 dark:hover:bg-red-900"
		: "text-blue-700 hover:bg-blue-100 hover:text-blue-900 focus-visible:ring-blue-500 dark:text-blue-100 dark:hover:bg-blue-900";

	if (isDismissed) {
		return null;
	}

	return (
		<aside
			className={`overflow-hidden border-b px-4 transition-[max-height,transform,opacity,padding,border-color] duration-200 ease-out motion-reduce:transition-none ${bannerAccentClassName} ${
				isDismissing
					? "max-h-0 -translate-y-1 border-transparent py-0 opacity-0"
					: "max-h-40 py-3 opacity-100"
			}`}
			onTransitionEnd={(event) => {
				if (event.target !== event.currentTarget || !isDismissing) {
					return;
				}

				setIsDismissed(true);
			}}
		>
			<div className="mx-auto flex max-w-7xl gap-3">
				<div className="flex items-start gap-3">
					<div className={`mt-0.5 rounded-full p-2 ${iconAccentClassName}`}>
						<IconCreditCard className="size-4" aria-hidden="true" />
					</div>
					<div className="space-y-1">
						<p className="font-medium">{t("billing.trialBanner.title", "14-day trial active")}</p>
						<p className={`text-sm ${descriptionAccentClassName}`}>
							{t(
								"billing.trialBanner.description",
								"{days} days remaining. Add payment details now; your paid subscription starts after the trial.",
								{ days: daysRemaining },
							)}
						</p>
					</div>
				</div>
				<div className="ml-auto flex shrink-0 items-start gap-2 sm:items-center">
					{showUpgradeButton ? (
						<Link
							href={billingHref}
							className={`inline-flex h-9 shrink-0 items-center justify-center rounded-md px-4 text-sm font-medium text-white shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 ${upgradeAccentClassName}`}
						>
							{t("billing.trialBanner.upgrade", "Upgrade")}
						</Link>
					) : null}
					<button
						type="button"
						className={`inline-flex size-9 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 dark:hover:text-white ${dismissAccentClassName}`}
						onClick={() => setIsDismissing(true)}
						disabled={isDismissing}
						aria-label={t("billing.trialBanner.dismiss", "Dismiss trial banner")}
					>
						<IconX className="size-4" aria-hidden="true" />
					</button>
				</div>
			</div>
		</aside>
	);
}
