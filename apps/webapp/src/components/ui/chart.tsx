"use client";

import * as React from "react";
import type * as RechartsPrimitive from "recharts";
import type { NameType, Payload, ValueType } from "recharts/types/component/DefaultTooltipContent";

import { cn } from "@/lib/utils";

const ResponsiveContainer = React.lazy(() =>
	import("recharts").then((mod) => ({ default: mod.ResponsiveContainer })),
) as React.ComponentType<React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>>;

const ChartTooltip = React.lazy(() =>
	import("recharts").then((mod) => ({ default: mod.Tooltip })),
) as React.ComponentType<React.ComponentProps<typeof RechartsPrimitive.Tooltip>>;

const ChartLegend = React.lazy(() =>
	import("recharts").then((mod) => ({ default: mod.Legend })),
) as React.ComponentType<React.ComponentProps<typeof RechartsPrimitive.Legend>>;

// Format: { THEME_NAME: CSS_SELECTOR }
const THEMES = { light: "", dark: ".dark" } as const;
const SAFE_CSS_IDENTIFIER_REPLACEMENT = "-";
const SAFE_CSS_IDENTIFIER_PATTERN = /^[a-zA-Z0-9_-]+$/;
const SAFE_CSS_COLOR_PATTERN =
	/^(#[0-9a-fA-F]{3,8}|(?:rgb|rgba|hsl|hsla)\((?:[0-9%.,\s/+-]+|var\(--[a-zA-Z0-9_-]+\)(?:\s*[/,]\s*[0-9.]+%?)?)\)|(?:var\(--[a-zA-Z0-9_-]+\))|[a-zA-Z]+)$/;

function toSafeCssIdentifier(value: string, fallbackSuffix: number): string {
	if (SAFE_CSS_IDENTIFIER_PATTERN.test(value)) {
		return value;
	}

	const sanitized = value
		.trim()
		.replace(/[^a-zA-Z0-9_-]/g, SAFE_CSS_IDENTIFIER_REPLACEMENT)
		.replace(/-+/g, SAFE_CSS_IDENTIFIER_REPLACEMENT)
		.replace(/^-+|-+$/g, "");

	return `${sanitized || "item"}-${fallbackSuffix}`;
}

function toSafeCssColor(value: string): string | null {
	const trimmed = value.trim();
	return SAFE_CSS_COLOR_PATTERN.test(trimmed) ? trimmed : null;
}

export type ChartConfig = {
	[k in string]: {
		label?: React.ReactNode;
		icon?: React.ComponentType;
	} & (
		| { color?: string; theme?: never }
		| { color?: never; theme: Record<keyof typeof THEMES, string> }
	);
};

type ChartContextProps = {
	config: ChartConfig;
};

const ChartContext = React.createContext<ChartContextProps | null>(null);

function useChart() {
	const context = React.use(ChartContext);

	if (!context) {
		throw new Error("useChart must be used within a <ChartContainer />");
	}

	return context;
}

function ChartContainer({
	id,
	className,
	children,
	config,
	...props
}: React.ComponentProps<"div"> & {
	config: ChartConfig;
	children: React.ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>["children"];
}) {
	const uniqueId = React.useId();
	const chartId = `chart-${toSafeCssIdentifier(id || uniqueId.replace(/:/g, ""), 0)}`;

	return (
		<ChartContext.Provider value={{ config }}>
			<div
				className={cn(
					"flex aspect-video justify-center text-xs [&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50 [&_.recharts-curve.recharts-tooltip-cursor]:stroke-border [&_.recharts-dot[stroke='#fff']]:stroke-transparent [&_.recharts-layer]:outline-hidden [&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border [&_.recharts-radial-bar-background-sector]:fill-muted [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted [&_.recharts-reference-line_[stroke='#ccc']]:stroke-border [&_.recharts-sector[stroke='#fff']]:stroke-transparent [&_.recharts-sector]:outline-hidden [&_.recharts-surface]:outline-hidden",
					className,
				)}
				data-chart={chartId}
				data-slot="chart"
				{...props}
			>
				<ChartStyle config={config} id={chartId} />
				<React.Suspense fallback={null}>
					<ResponsiveContainer>{children}</ResponsiveContainer>
				</React.Suspense>
			</div>
		</ChartContext.Provider>
	);
}

const ChartStyle = ({ id, config }: { id: string; config: ChartConfig }) => {
	const colorConfig = Object.entries(config).filter(([, config]) => config.theme || config.color);

	if (!colorConfig.length) {
		return null;
	}

	const cssText = Object.entries(THEMES)
		.map(
			([theme, prefix]) => `
${prefix} [data-chart=${id}] {
${colorConfig
	.map(([key, itemConfig], index) => {
		const color = itemConfig.theme?.[theme as keyof typeof itemConfig.theme] || itemConfig.color;
		const safeColor = color ? toSafeCssColor(color) : null;
		return safeColor ? `  --color-${toSafeCssIdentifier(key, index)}: ${safeColor};` : null;
	})
	.join("\n")}
}
`,
		)
		.join("\n");

	return <style>{cssText}</style>;
};

function ChartTooltipContent({
	active,
	payload,
	className,
	indicator = "dot",
	hideLabel = false,
	hideIndicator = false,
	label,
	labelFormatter,
	labelClassName,
	formatter,
	color,
	nameKey,
	labelKey,
}: React.ComponentProps<typeof RechartsPrimitive.Tooltip> &
	React.ComponentProps<"div"> & {
		hideLabel?: boolean;
		hideIndicator?: boolean;
		indicator?: "line" | "dot" | "dashed";
		nameKey?: string;
		labelKey?: string;
		// These props are injected by the parent Tooltip component
		active?: boolean;
		payload?: Payload<ValueType, NameType>[];
		label?: string | number;
	}) {
	const { config } = useChart();

	const tooltipLabel = (() => {
		if (hideLabel || !payload?.length) {
			return null;
		}

		const [item] = payload;
		const key = `${labelKey || item?.dataKey || item?.name || "value"}`;
		const itemConfig = getPayloadConfigFromPayload(config, item, key);
		const value =
			!labelKey && typeof label === "string"
				? config[label as keyof typeof config]?.label || label
				: itemConfig?.label;

		if (labelFormatter) {
			return (
				<div className={cn("font-medium", labelClassName)}>{labelFormatter(value, payload)}</div>
			);
		}

		if (!value) {
			return null;
		}

		return <div className={cn("font-medium", labelClassName)}>{value}</div>;
	})();

	if (!(active && payload?.length)) {
		return null;
	}

	const nestLabel = payload.length === 1 && indicator !== "dot";

	return (
		<div
			className={cn(
				"grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl",
				className,
			)}
		>
			{nestLabel ? null : tooltipLabel}
			<div className="grid gap-1.5">
				{payload.map((item, index) => {
					const key = `${nameKey || item.name || item.dataKey || "value"}`;
					const itemConfig = getPayloadConfigFromPayload(config, item, key);
					const indicatorColor = color || item.payload.fill || item.color;

					return (
						<div
							className={cn(
								"flex w-full flex-wrap items-stretch gap-2 [&>svg]:size-2.5 [&>svg]:text-muted-foreground",
								indicator === "dot" && "items-center",
							)}
							key={typeof item.dataKey === "function" ? index : item.dataKey}
						>
							{formatter && item?.value !== undefined && item.name ? (
								formatter(item.value, item.name, item, index, item.payload)
							) : (
								<>
									{itemConfig?.icon ? (
										<itemConfig.icon />
									) : (
										!hideIndicator && (
											<div
												className={cn(
													"shrink-0 rounded-[2px] border-(--color-border) bg-(--color-bg)",
													{
														"size-2.5": indicator === "dot",
														"w-1": indicator === "line",
														"w-0 border-[1.5px] border-dashed bg-transparent":
															indicator === "dashed",
														"my-0.5": nestLabel && indicator === "dashed",
													},
												)}
												style={
													{
														"--color-bg": indicatorColor,
														"--color-border": indicatorColor,
													} as React.CSSProperties
												}
											/>
										)
									)}
									<div
										className={cn(
											"flex flex-1 justify-between leading-none",
											nestLabel ? "items-end" : "items-center",
										)}
									>
										<div className="grid gap-1.5">
											{nestLabel ? tooltipLabel : null}
											<span className="text-muted-foreground">
												{itemConfig?.label || item.name}
											</span>
										</div>
										{item.value && (
											<span className="font-medium font-mono text-foreground tabular-nums">
												{item.value.toLocaleString()}
											</span>
										)}
									</div>
								</>
							)}
						</div>
					);
				})}
			</div>
		</div>
	);
}

function ChartLegendContent({
	className,
	hideIcon = false,
	payload,
	verticalAlign = "bottom",
	nameKey,
}: React.ComponentProps<"div"> & {
	hideIcon?: boolean;
	nameKey?: string;
	// These props are injected by the parent Legend component
	payload?: Array<{
		value?: string;
		type?: string;
		color?: string;
		dataKey?: string | number;
	}>;
	verticalAlign?: "top" | "bottom" | "middle";
}) {
	const { config } = useChart();

	if (!payload?.length) {
		return null;
	}

	return (
		<div
			className={cn(
				"flex items-center justify-center gap-4",
				verticalAlign === "top" ? "pb-3" : "pt-3",
				className,
			)}
		>
			{payload.map((item) => {
				const key = `${nameKey || item.dataKey || "value"}`;
				const itemConfig = getPayloadConfigFromPayload(config, item, key);

				return (
					<div
						className={cn("flex items-center gap-1.5 [&>svg]:size-3 [&>svg]:text-muted-foreground")}
						key={item.value}
					>
						{itemConfig?.icon && !hideIcon ? (
							<itemConfig.icon />
						) : (
							<div
								className="size-2 shrink-0 rounded-[2px]"
								style={{
									backgroundColor: item.color,
								}}
							/>
						)}
						{itemConfig?.label}
					</div>
				);
			})}
		</div>
	);
}

// Helper to extract item config from a payload.
function getPayloadConfigFromPayload(config: ChartConfig, payload: unknown, key: string) {
	if (typeof payload !== "object" || payload === null) {
		return;
	}

	const payloadPayload =
		"payload" in payload && typeof payload.payload === "object" && payload.payload !== null
			? payload.payload
			: undefined;

	let configLabelKey: string = key;

	if (key in payload && typeof payload[key as keyof typeof payload] === "string") {
		configLabelKey = payload[key as keyof typeof payload] as string;
	} else if (
		payloadPayload &&
		key in payloadPayload &&
		typeof payloadPayload[key as keyof typeof payloadPayload] === "string"
	) {
		configLabelKey = payloadPayload[key as keyof typeof payloadPayload] as string;
	}

	return configLabelKey in config ? config[configLabelKey] : config[key as keyof typeof config];
}

export {
	ChartContainer,
	ChartLegend,
	ChartLegendContent,
	ChartStyle,
	ChartTooltip,
	ChartTooltipContent,
};
