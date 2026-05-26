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
	const [isDismissed, setIsDismissed] = useState(false);

	if (isDismissed) {
		return null;
	}

	return (
		<aside className="border-b border-blue-200 bg-blue-50/80 px-4 py-3 text-blue-950 dark:border-blue-900 dark:bg-blue-950/40 dark:text-blue-50">
			<div className="mx-auto flex max-w-7xl gap-3">
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
				<div className="ml-auto flex shrink-0 items-start gap-2 sm:items-center">
					{showUpgradeButton ? (
						<Link
							href={billingHref}
							className="inline-flex h-9 shrink-0 items-center justify-center rounded-md bg-blue-600 px-4 text-sm font-medium text-white shadow-xs transition-colors hover:bg-blue-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:bg-blue-500 dark:hover:bg-blue-400"
						>
							{t("billing.trialBanner.upgrade", "Upgrade")}
						</Link>
					) : null}
					<button
						type="button"
						className="inline-flex size-9 items-center justify-center rounded-md text-blue-700 transition-colors hover:bg-blue-100 hover:text-blue-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 dark:text-blue-100 dark:hover:bg-blue-900 dark:hover:text-white"
						onClick={() => setIsDismissed(true)}
						aria-label={t("billing.trialBanner.dismiss", "Dismiss trial banner")}
					>
						<IconX className="size-4" aria-hidden="true" />
					</button>
				</div>
			</div>
		</aside>
	);
}
