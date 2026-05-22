"use client";

import { IconCreditCard } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { Link } from "@/navigation";

interface TrialBannerProps {
	daysRemaining: number;
	billingHref: string;
	showUpgradeButton: boolean;
}

export function TrialBanner({ daysRemaining, billingHref, showUpgradeButton }: TrialBannerProps) {
	const { t } = useTranslate();

	return (
		<aside className="border-b border-blue-200 bg-blue-50/80 px-4 py-3 text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-50">
			<div className="mx-auto flex max-w-7xl flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex items-start gap-3">
					<div className="mt-0.5 rounded-full bg-blue-100 p-2 text-blue-700 dark:bg-blue-900 dark:text-blue-200">
						<IconCreditCard className="size-4" aria-hidden="true" />
					</div>
					<div className="space-y-1">
						<p className="font-medium">{t("billing.trialBanner.title", "14-day trial active")}</p>
						<p className="text-sm text-blue-800 dark:text-blue-100">
							{t(
								"billing.trialBanner.description",
								"{days} days remaining. Add payment details now; your paid subscription starts after the trial.",
								{ days: daysRemaining },
							)}
						</p>
					</div>
				</div>
				{showUpgradeButton ? (
					<Link
						href={billingHref}
						className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white shadow-xs transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:bg-blue-500 dark:hover:bg-blue-400"
					>
						{t("billing.trialBanner.upgrade", "Upgrade")}
					</Link>
				) : null}
			</div>
		</aside>
	);
}
