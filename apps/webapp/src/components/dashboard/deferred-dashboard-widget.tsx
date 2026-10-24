"use client";

import { useTranslate } from "@tolgee/react";
import {
	Component,
	type ComponentType,
	type LazyExoticComponent,
	lazy,
	type ReactNode,
	Suspense,
	useEffect,
	useRef,
	useState,
	useSyncExternalStore,
} from "react";
import { Button } from "@/components/ui/button";
import { DashboardWidget } from "./dashboard-widget";
import { DashboardWidgetRefreshOwnerContext } from "./dashboard-widget-refresh-context";
import { WidgetReadError } from "./widget-read-error";
import { type DeferredWidgetId, WIDGET_CONFIGS } from "./widget-registry";

const subscribeToObserverSupport = () => () => {};
const observerUnavailable = () => typeof IntersectionObserver === "undefined";
const serverObserverUnavailable = () => false;

const loadWidgets: Record<
	DeferredWidgetId,
	() => Promise<{ default: ComponentType }>
> = {
	"birthday-reminders": () =>
		import("./birthday-reminders-widget").then((module) => ({
			default: module.BirthdayRemindersWidget,
		})),
	hydration: () =>
		import("./hydration-widget").then((module) => ({
			default: module.HydrationWidget,
		})),
};

type DeferredBoundaryProps = {
	id: DeferredWidgetId;
	title: string;
	message: string;
	loading: ReactNode;
	beforeRetry: () => void;
};
type DeferredBoundaryState = {
	failed: boolean;
	widget: LazyExoticComponent<ComponentType>;
};

/** A new lazy identity on an explicit retry also discards React.lazy's rejected-promise cache. */
class DeferredWidgetBoundary extends Component<
	DeferredBoundaryProps,
	DeferredBoundaryState
> {
	constructor(props: DeferredBoundaryProps) {
		super(props);
		this.state = { failed: false, widget: lazy(loadWidgets[props.id]) };
	}
	static getDerivedStateFromError() {
		return { failed: true };
	}
	retry = () => {
		this.props.beforeRetry();
		this.setState({ failed: false, widget: lazy(loadWidgets[this.props.id]) });
	};
	render() {
		if (this.state.failed)
			return (
				<DashboardWidget id={this.props.id}>
					<div className="flex min-h-52 flex-col gap-4 rounded-xl border bg-card p-6">
						<h2 className="font-semibold">{this.props.title}</h2>
						<WidgetReadError
							title={this.props.title}
							message={this.props.message}
							retry={this.retry}
							refreshing={false}
						/>
					</div>
				</DashboardWidget>
			);
		const Widget = this.state.widget;
		return (
			<Suspense fallback={this.props.loading}>
				<Widget />
			</Suspense>
		);
	}
}

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
						: t(
								"dashboard.widgets.deferred",
								"Loads when in view. You can also load it now.",
							)}
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
	const placeholder = (
		<Placeholder id={id} title={title} activate={activate} loading={active} />
	);
	const unavailable =
		id === "hydration"
			? t("dashboard.hydration.error", "Failed to load hydration stats")
			: t("dashboard.birthday.error", "Failed to load upcoming birthdays");
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
					<DeferredWidgetBoundary
						key={id}
						id={id}
						title={title}
						message={unavailable}
						loading={placeholder}
						beforeRetry={() => region.current?.focus({ preventScroll: true })}
					/>
				</DashboardWidgetRefreshOwnerContext>
			) : (
				placeholder
			)}
		</section>
	);
}
