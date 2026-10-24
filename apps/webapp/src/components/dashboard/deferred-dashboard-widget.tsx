"use client";

import { useTranslate } from "@tolgee/react";
import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { DashboardWidget } from "./dashboard-widget";
import { DashboardWidgetRefreshOwnerContext } from "./dashboard-widget-refresh-context";
import { type DeferredWidgetId, WIDGET_CONFIGS } from "./widget-registry";

const subscribeToObserverSupport = () => () => {};
const observerUnavailable = () => typeof IntersectionObserver === "undefined";
const serverObserverUnavailable = () => false;

const BirthdayRemindersWidget = lazy(() =>
	import("./birthday-reminders-widget").then((module) => ({
		default: module.BirthdayRemindersWidget,
	})),
);
const HydrationWidget = lazy(() =>
	import("./hydration-widget").then((module) => ({ default: module.HydrationWidget })),
);

function Placeholder({
	id,
	title,
	activate,
	loading = false,
}: {
	id: DeferredWidgetId;
	title: string;
	activate: () => void;
	loading?: boolean;
}) {
	const { t } = useTranslate();
	return (
		<DashboardWidget id={id}>
			<div
				className="flex min-h-52 flex-col items-start gap-4 rounded-xl border bg-card p-6"
				aria-busy={loading}
			>
				<h2 className="font-semibold">{title}</h2>
				<p className="text-sm text-muted-foreground">
					{loading
						? t("dashboard.widgets.loading", "Loading dashboard widget…")
						: t("dashboard.widgets.deferred", "Loads when in view. You can also load it now.")}
				</p>
				{!loading && (
					<Button variant="outline" onClick={activate}>
						{t("dashboard.widgets.load", "Load {widget}", { widget: title })}
					</Button>
				)}
			</div>
		</DashboardWidget>
	);
}

/** Only the two measured secondary regions defer; operational slots remain server streamed. */
export function DeferredDashboardWidget({ id }: { id: DeferredWidgetId }) {
	const { t } = useTranslate();
	const [activated, setActive] = useState(false);
	const unsupported = useSyncExternalStore(
		subscribeToObserverSupport,
		observerUnavailable,
		serverObserverUnavailable,
	);
	const active = activated || unsupported;
	const region = useRef<HTMLElement>(null);
	const config = WIDGET_CONFIGS.find((widget) => widget.id === id);
	const title = config ? t(config.labelKey, config.label) : id;
	const activate = () => {
		if (active) return;
		setActive(true);
		// Keep keyboard focus in this region when its placeholder button is replaced.
		if (region.current?.contains(document.activeElement))
			region.current.focus({ preventScroll: true });
	};
	useEffect(() => {
		if (active || !region.current) return;
		const observer = new IntersectionObserver(
			(entries) => {
				if (entries.some((entry) => entry.isIntersecting)) setActive(true);
			},
			{ rootMargin: "0px" },
		);
		observer.observe(region.current);
		return () => observer.disconnect();
	}, [active]);
	const placeholder = <Placeholder id={id} title={title} activate={activate} loading={active} />;
	return (
		<section
			ref={region}
			tabIndex={-1}
			aria-label={title}
			className="break-inside-avoid outline-none focus-visible:ring-2 focus-visible:ring-ring"
			data-dashboard-deferred-id={id}
			data-state={active ? "active" : "deferred"}
			onFocusCapture={activate}
		>
			{active ? (
				<DashboardWidgetRefreshOwnerContext value="client">
					<Suspense fallback={placeholder}>
						{id === "hydration" ? <HydrationWidget /> : <BirthdayRemindersWidget />}
					</Suspense>
				</DashboardWidgetRefreshOwnerContext>
			) : (
				placeholder
			)}
		</section>
	);
}
