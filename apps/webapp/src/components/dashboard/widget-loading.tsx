"use client";

import { IconClock } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { DashboardWidget } from "./dashboard-widget";
import { WidgetCard } from "./widget-card";
import { WIDGET_CONFIGS, type WidgetId } from "./widget-registry";

export function WidgetLoading({ id }: { id: WidgetId }) {
	const { t } = useTranslate();
	const config = WIDGET_CONFIGS.find((widget) => widget.id === id);
	return (
		<DashboardWidget id={id}>
			<div
				role="status"
				aria-label={t("dashboard.widgets.loading", "Loading dashboard widget…")}
				aria-busy="true"
			>
				<WidgetCard
					title={config ? t(config.labelKey, config.label) : ""}
					description=""
					icon={<IconClock className="size-4" aria-hidden="true" />}
					loading
				/>
			</div>
		</DashboardWidget>
	);
}
