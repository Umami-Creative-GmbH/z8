"use client";

import { BProgress } from "@bprogress/core";
import { useIsFetching } from "@tanstack/react-query";
import { useEffect } from "react";
import "./bprogress.css";

type PushStateInput = [data: unknown, unused: string, url?: string | URL | null | undefined];

export function BProgressBar() {
	BProgress.configure({ showSpinner: false, speed: 400, trickleSpeed: 300 });

	const isFetchingGlobal = useIsFetching();
	useEffect(() => {
		if (isFetchingGlobal) {
			BProgress.start();
		} else {
			BProgress.done();
		}
	}, [isFetchingGlobal]);

	useEffect(() => {
		const abortController = new AbortController();
		const originalPushState = window.history.pushState;

		const handleDocumentClick = (event: MouseEvent) => {
			if (!(event.target instanceof Element)) {
				return;
			}

			const anchor = event.target.closest<HTMLAnchorElement>("a[href]");
			if (!anchor) {
				return;
			}

			const targetUrl = anchor.href;
			const currentUrl = window.location.href;
			if (targetUrl !== currentUrl) {
				BProgress.start();
			}
		};

		document.addEventListener("click", handleDocumentClick, { signal: abortController.signal });

		window.history.pushState = new Proxy(window.history.pushState, {
			apply: (target, thisArg, argArray: PushStateInput) => {
				BProgress.done();
				return target.apply(thisArg, argArray);
			},
		});

		return () => {
			document.removeEventListener("click", handleDocumentClick);
			abortController.abort();
			window.history.pushState = originalPushState;
		};
	}, []);

	return null;
}
