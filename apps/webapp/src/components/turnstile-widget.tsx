"use client";

import type { TurnstileInstance } from "@marsidev/react-turnstile";
import { Turnstile } from "@marsidev/react-turnstile";
import { type Ref, useImperativeHandle, useRef } from "react";

export interface TurnstileWidgetProps {
	ref?: Ref<TurnstileRef>;
	siteKey: string;
	onVerify: (token: string) => void;
	onError?: (errorCode?: string) => void;
	onExpire?: () => void;
	onTimeout?: () => void;
	/** Fires when Cloudflare needs the person to interact and is about to show the widget. */
	onBeforeInteractive?: () => void;
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
export function TurnstileWidget({
	ref,
	siteKey,
	onVerify,
	onError,
	onExpire,
	onTimeout,
	onBeforeInteractive,
	onWidgetLoad,
	theme = "auto",
	size,
	className,
}: TurnstileWidgetProps) {
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
				return (
					turnstileRef.current?.getResponsePromise() ??
					Promise.reject(new Error("Widget not ready"))
				);
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
			onBeforeInteractive={onBeforeInteractive}
			onWidgetLoad={onWidgetLoad}
			className={className}
			options={{
				theme,
				size: size ?? "normal",
				appearance: "interaction-only", // Invisible mode - only shows if interaction required
			}}
		/>
	);
}
