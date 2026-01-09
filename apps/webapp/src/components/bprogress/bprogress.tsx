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
		const handleAnchorClick = (event: MouseEvent) => {
			const targetUrl = (event.currentTarget as HTMLAnchorElement).href;
			const currentUrl = window.location.href;
			if (targetUrl !== currentUrl) {
				BProgress.start();
			}
		};

		const handleMutation: MutationCallback = () => {
			const anchorElements: NodeListOf<HTMLAnchorElement> = document.querySelectorAll("a[href]");

			for (const anchor of anchorElements) {
				anchor.addEventListener("click", handleAnchorClick);
			}
		};

		const mutationObserver = new MutationObserver(handleMutation);

		mutationObserver.observe(document, { childList: true, subtree: true });

		window.history.pushState = new Proxy(window.history.pushState, {
			apply: (target, thisArg, argArray: PushStateInput) => {
				BProgress.done();
				return target.apply(thisArg, argArray);
			},
		});
	}, []);

	return null;
}
