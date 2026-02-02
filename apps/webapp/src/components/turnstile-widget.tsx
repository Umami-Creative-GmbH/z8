"use client";

import { Turnstile } from "@marsidev/react-turnstile";
import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { forwardRef, useImperativeHandle, useRef } from "react";

export interface TurnstileWidgetProps {
	siteKey: string;
	onVerify: (token: string) => void;
	onError?: (errorCode?: string) => void;
	onExpire?: () => void;
	onTimeout?: () => void;
	onWidgetLoad?: (widgetId: string) => void;
	theme?: "light" | "dark" | "auto";
	size?: "normal" | "compact" | "flexible" | "invisible";
	className?: string;
}

export interface TurnstileRef {
	reset: () => void;
	getResponse: () => string | undefined;
	getResponsePromise: () => Promise<string>;
	isExpired: () => boolean;
}

/**
 * Cloudflare Turnstile widget using @marsidev/react-turnstile.
 * Supports invisible mode (interaction-only) by default.
 *
 * @example
 * ```tsx
 * const turnstileRef = useRef<TurnstileRef>(null);
 *
 * <TurnstileWidget
 *   ref={turnstileRef}
 *   siteKey="your-site-key"
 *   onVerify={(token) => setToken(token)}
 *   onError={() => setError("Verification failed")}
 *   onExpire={() => setToken(null)}
 * />
 *
 * // Reset after failed submission
 * turnstileRef.current?.reset();
 * ```
 */
export const TurnstileWidget = forwardRef<TurnstileRef, TurnstileWidgetProps>(
	function TurnstileWidget(
		{
			siteKey,
			onVerify,
			onError,
			onExpire,
			onTimeout,
			onWidgetLoad,
			theme = "auto",
			size,
			className,
		},
		ref,
	) {
		const turnstileRef = useRef<TurnstileInstance>(null);

		// Expose ref methods to parent component
		useImperativeHandle(
			ref,
			() => ({
				reset: () => {
					turnstileRef.current?.reset();
				},
				getResponse: () => {
					return turnstileRef.current?.getResponse();
				},
				getResponsePromise: () => {
					return turnstileRef.current?.getResponsePromise() ?? Promise.reject(new Error("Widget not ready"));
				},
				isExpired: () => {
					return turnstileRef.current?.isExpired() ?? false;
				},
			}),
			[],
		);

		return (
			<Turnstile
				ref={turnstileRef}
				siteKey={siteKey}
				onSuccess={onVerify}
				onError={onError}
				onExpire={onExpire}
				onTimeout={onTimeout}
				onWidgetLoad={onWidgetLoad}
				className={className}
				options={{
					theme,
					size: size ?? "normal",
					appearance: "interaction-only", // Invisible mode - only shows if interaction required
				}}
			/>
		);
	},
);

/**
 * @deprecated Use ref methods instead: `turnstileRef.current?.reset()`
 */
export function resetTurnstile(_widgetId: string): void {
	console.warn(
		"resetTurnstile is deprecated. Use ref methods instead: turnstileRef.current?.reset()",
	);
}
