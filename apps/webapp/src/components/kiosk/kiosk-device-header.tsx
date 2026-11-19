"use client";

import { IconDeviceTablet, IconMapPin } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import type { ReactNode } from "react";
import type { KioskDeviceInfo } from "@/lib/time-tracking/kiosk/protocol";

/** Device scope stays visible while an employee proves and records their own work. */
export function KioskDeviceHeader({
	kiosk,
	children,
}: {
	kiosk: KioskDeviceInfo;
	children?: ReactNode;
}) {
	const { t } = useTranslate();
	return (
		<header className="flex flex-wrap items-center justify-between gap-4 border-b pb-5">
			<div className="flex min-w-0 items-start gap-3">
				<IconDeviceTablet
					className="mt-1 size-7 shrink-0 text-primary"
					aria-hidden="true"
				/>
				<div className="min-w-0 space-y-1">
					<p className="text-lg font-semibold break-words">{kiosk.name}</p>
					<p className="flex items-start gap-1.5 text-base text-muted-foreground">
						<IconMapPin className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
						<span className="break-words">{kiosk.locationName}</span>
					</p>
					{kiosk.organizationName ? (
						<p className="text-sm text-muted-foreground break-words">
							{kiosk.organizationName}
						</p>
					) : null}
				</div>
			</div>
			<div className="flex flex-wrap items-center gap-3">
				<p className="text-sm text-muted-foreground">
					{t("timeTracking.kiosk.scope.zone", "Kiosk time: {zone}", {
						zone: kiosk.timezone,
					})}
				</p>
				{children}
			</div>
		</header>
	);
}
