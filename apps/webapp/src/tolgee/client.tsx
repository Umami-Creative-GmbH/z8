"use client";

import { TolgeeProvider, type TolgeeStaticData } from "@tolgee/react";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { TolgeeBase } from "./shared";

type Props = {
	language: string;
	staticData: TolgeeStaticData;
	children: React.ReactNode;
};

const tolgee = TolgeeBase().init();

export const TolgeeNextProvider = ({ language, staticData, children }: Props) => {
	const router = useRouter();

	useEffect(() => {
		// this ensures server components refresh, after translation change
		const { unsubscribe } = tolgee.on("permanentChange", () => {
			router.refresh();
		});
		return () => unsubscribe();
	}, [router]);

	return (
		<TolgeeProvider ssr={{ language, staticData }} tolgee={tolgee}>
			{children}
		</TolgeeProvider>
	);
};
