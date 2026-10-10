"use client";

import { IconLoader2, IconWifiOff } from "@tabler/icons-react";
import { useTranslate } from "@tolgee/react";
import { useEffect, useEffectEvent, useState } from "react";
import { Button } from "@/components/ui/button";
import {
	forgetKioskToken,
	type KioskSession,
	loadKioskSession,
} from "@/lib/time-tracking/kiosk/device";
import type { KioskDeviceInfo } from "@/lib/time-tracking/kiosk/protocol";
import { KioskPairedScreen } from "./kiosk-paired-screen";
import { KioskPairingForm } from "./kiosk-pairing-form";
import { KioskRevokedScreen } from "./kiosk-revoked-screen";

type KioskScreen =
	| { state: "loading" }
	| { state: "pairing"; initialCode: string }
	| { state: "paired"; token: string; kiosk: KioskDeviceInfo }
	| { state: "revoked" }
	| { state: "unreachable" };

/** Reads `?code=` from a QR link once and drops it from the address bar. */
function takePairingCodeFromUrl(): string {
	const url = new URL(window.location.href);
	const code = url.searchParams.get("code") ?? "";
	if (url.searchParams.has("code")) {
		url.searchParams.delete("code");
		window.history.replaceState(
			window.history.state,
			"",
			`${url.pathname}${url.search}${url.hash}`,
		);
	}
	return code;
}

function screenFor(session: KioskSession, initialCode: string): KioskScreen {
	switch (session.state) {
		case "paired":
			return { state: "paired", token: session.token, kiosk: session.kiosk };
		case "unpaired":
			return { state: "pairing", initialCode };
		case "revoked":
			return { state: "revoked" };
		case "unreachable":
			return { state: "unreachable" };
	}
}

/**
 * The kiosk page (#859). It has no user session: the device either pairs with
 * a pairing code or opens on the kiosk its device token belongs to. #862 builds
 * the kiosk home screen into `KioskPairedScreen`.
 */
export function KioskApp() {
	const [screen, setScreen] = useState<KioskScreen>({ state: "loading" });

	const start = useEffectEvent(async () => {
		const initialCode = takePairingCodeFromUrl();
		setScreen(screenFor(await loadKioskSession(), initialCode));
	});

	useEffect(() => {
		void start();
	}, []);

	async function retry() {
		setScreen({ state: "loading" });
		setScreen(screenFor(await loadKioskSession(), ""));
	}

	return (
		<main className="flex min-h-svh flex-col bg-background p-4 text-foreground sm:p-8">
			{screen.state === "loading" ? <KioskLoading /> : null}
			{screen.state === "pairing" ? (
				<KioskPairingForm
					initialCode={screen.initialCode}
					onPaired={(token, kiosk) => setScreen({ state: "paired", token, kiosk })}
				/>
			) : null}
			{screen.state === "paired" ? (
				<KioskPairedScreen
					token={screen.token}
					kiosk={screen.kiosk}
					onRevoked={() => setScreen({ state: "revoked" })}
					onUnpaired={() => {
						forgetKioskToken();
						setScreen({ state: "pairing", initialCode: "" });
					}}
				/>
			) : null}
			{screen.state === "revoked" ? (
				<KioskRevokedScreen
					onPairAgain={() => {
						forgetKioskToken();
						setScreen({ state: "pairing", initialCode: "" });
					}}
				/>
			) : null}
			{screen.state === "unreachable" ? <KioskUnreachable onRetry={() => void retry()} /> : null}
		</main>
	);
}

function KioskLoading() {
	const { t } = useTranslate();
	const label = t("timeTracking.kiosk.loading", "Starting kiosk…");
	return (
		<output
			aria-busy="true"
			aria-label={label}
			className="m-auto flex flex-col items-center gap-4 text-muted-foreground"
		>
			<IconLoader2 className="size-10 animate-spin motion-reduce:animate-none" aria-hidden="true" />
			<span>{label}</span>
		</output>
	);
}

function KioskUnreachable({ onRetry }: { onRetry: () => void }) {
	const { t } = useTranslate();
	return (
		<div className="m-auto flex max-w-md flex-col items-center gap-6 text-center" role="alert">
			<IconWifiOff className="size-14 text-muted-foreground" aria-hidden="true" />
			<div className="space-y-2">
				<h1 className="text-2xl font-semibold">
					{t("timeTracking.kiosk.unreachableTitle", "Kiosk offline")}
				</h1>
				<p className="text-muted-foreground">
					{t(
						"timeTracking.kiosk.unreachableDescription",
						"The kiosk cannot reach the server. Check the network connection; clocking works only while online.",
					)}
				</p>
			</div>
			<Button size="lg" className="h-14 min-w-48 text-lg" onClick={onRetry}>
				{t("timeTracking.kiosk.retry", "Try again")}
			</Button>
		</div>
	);
}
