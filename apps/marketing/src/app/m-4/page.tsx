import Image from "next/image";
import Link from "next/link";

export default function DesignM4() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Aeonik', 'Graphik', 'Mona Sans', 'Cabinet Grotesk', sans-serif",
				backgroundColor: "#09090b",
				color: "#fafafa",
			}}
		>
			{/* Header */}
			<header className="relative z-20 flex items-center justify-between px-8 py-5 lg:px-14">
				<div className="flex items-center gap-8">
					<span className="text-[20px] font-bold">Z8</span>
					<nav className="hidden items-center gap-6 text-[13px] font-medium text-[#71717a] md:flex">
						<a href="#features" className="transition-colors hover:text-white">Funktionen</a>
						<a href="#product" className="transition-colors hover:text-white">Produkt</a>
						<a href="#contact" className="transition-colors hover:text-white">Preise</a>
					</nav>
				</div>
				<div className="flex items-center gap-3">
					<a href="#contact" className="text-[13px] text-[#71717a] transition-colors hover:text-white">Anmelden</a>
					<a
						href="#contact"
						className="rounded-lg px-5 py-2.5 text-[13px] font-semibold text-[#09090b] transition-all hover:bg-[#e4e4e7]"
						style={{ backgroundColor: "#fafafa" }}
					>
						Demo anfragen
					</a>
				</div>
			</header>

			{/* Hero — product cards floating */}
			<section className="relative z-10 overflow-hidden px-8 pb-32 pt-24 lg:px-14">
				<div className="mx-auto max-w-6xl">
					<div className="text-center">
						<div
							className="animate-fade-up mx-auto mb-8 inline-flex items-center gap-2 rounded-full px-4 py-2 text-[12px] font-medium"
							style={{
								backgroundColor: "rgba(16,185,129,0.1)",
								border: "1px solid rgba(16,185,129,0.2)",
								color: "#10b981",
								animationDelay: "0.05s",
							}}
						>
							<span className="h-1.5 w-1.5 rounded-full bg-[#10b981]" />
							Alle Systeme online
						</div>

						<h1
							className="animate-fade-up"
							style={{
								fontSize: "clamp(3rem, 7vw, 5.5rem)",
								fontWeight: 700,
								lineHeight: 1.05,
								letterSpacing: "-0.04em",
								animationDelay: "0.15s",
							}}
						>
							Die Zentrale
							<br />
							<span className="text-[#71717a]">f&uuml;r Arbeitszeit.</span>
						</h1>

						<p
							className="animate-fade-up mx-auto mt-6 max-w-lg text-[16px] leading-[1.8] text-[#71717a]"
							style={{ animationDelay: "0.3s" }}
						>
							Stempeluhr, GoBD-Export, Echtzeit-Analyse &mdash; eine Plattform,
							die Ihr gesamtes Workforce-Management vereint.
						</p>

						<div
							className="animate-fade-up mt-10 flex items-center justify-center gap-3"
							style={{ animationDelay: "0.45s" }}
						>
							<a
								href="#contact"
								className="rounded-lg px-8 py-3.5 text-[14px] font-semibold text-[#09090b] transition-all hover:bg-[#e4e4e7]"
								style={{ backgroundColor: "#fafafa" }}
							>
								Kostenlos testen
							</a>
							<a
								href="#contact"
								className="rounded-lg px-8 py-3.5 text-[14px] text-[#71717a] transition-colors hover:text-white"
								style={{ border: "1px solid #27272a" }}
							>
								Demo ansehen
							</a>
						</div>
					</div>

					{/* Floating product cards */}
					<div className="animate-scale-in relative mt-20 flex items-center justify-center gap-6" style={{ animationDelay: "0.6s", perspective: "1200px" }}>
						{/* Left card */}
						<div
							className="hidden w-72 rounded-2xl p-6 md:block"
							style={{
								backgroundColor: "#18181b",
								border: "1px solid #27272a",
								transform: "rotateY(8deg) translateZ(-40px)",
								boxShadow: "0 25px 60px rgba(0,0,0,0.4)",
							}}
						>
							<div className="mb-4 flex items-center gap-2">
								<div className="h-2 w-2 rounded-full bg-[#10b981]" />
								<span className="text-[11px] font-medium text-[#71717a]">Live Stempeluhr</span>
							</div>
							<div className="space-y-2.5">
								{["Max Müller", "Anna Schmidt", "Lukas Weber"].map((name, i) => (
									<div key={i} className="flex items-center justify-between rounded-lg bg-[#09090b] px-3 py-2.5">
										<div className="flex items-center gap-2">
											<div className="flex h-6 w-6 items-center justify-center rounded-full bg-[#27272a] text-[8px] font-bold text-[#71717a]">
												{name.split(" ").map(n => n[0]).join("")}
											</div>
											<span className="text-[12px]">{name}</span>
										</div>
										<span className="text-[11px] text-[#10b981]">{["7:42", "5:18", "8:01"][i]}</span>
									</div>
								))}
							</div>
						</div>

						{/* Center card — main */}
						<div
							className="w-80 rounded-2xl p-6"
							style={{
								backgroundColor: "#18181b",
								border: "1px solid #27272a",
								boxShadow: "0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.03)",
							}}
						>
							<div className="mb-4 flex items-center justify-between">
								<span className="text-[13px] font-semibold">Dashboard</span>
								<div className="flex gap-1.5">
									<div className="rounded-md bg-[#27272a] px-2.5 py-1 text-[10px] text-[#71717a]">Woche</div>
									<div className="rounded-md bg-[#fafafa] px-2.5 py-1 text-[10px] font-medium text-[#09090b]">Monat</div>
								</div>
							</div>
							<div className="mb-4 grid grid-cols-2 gap-3">
								<div className="rounded-xl bg-[#09090b] p-4">
									<div className="text-[10px] text-[#71717a]">Stunden (Monat)</div>
									<div className="mt-1 text-[24px] font-bold tracking-tight">1.284</div>
								</div>
								<div className="rounded-xl bg-[#09090b] p-4">
									<div className="text-[10px] text-[#71717a]">&Uuml;berstunden</div>
									<div className="mt-1 text-[24px] font-bold tracking-tight text-[#f59e0b]">48</div>
								</div>
							</div>
							<div className="flex h-28 items-end gap-1 rounded-xl bg-[#09090b] p-3">
								{[35, 55, 45, 70, 60, 80, 50, 65, 75, 42, 68, 82, 58, 72, 88, 55, 78, 62, 90, 70].map((h, i) => (
									<div
										key={i}
										className="flex-1 rounded-t-sm"
										style={{
											height: `${h}%`,
											backgroundColor: i >= 18 ? "#10b981" : "#27272a",
										}}
									/>
								))}
							</div>
						</div>

						{/* Right card */}
						<div
							className="hidden w-72 rounded-2xl p-6 md:block"
							style={{
								backgroundColor: "#18181b",
								border: "1px solid #27272a",
								transform: "rotateY(-8deg) translateZ(-40px)",
								boxShadow: "0 25px 60px rgba(0,0,0,0.4)",
							}}
						>
							<div className="mb-4 flex items-center gap-2">
								<span className="text-[11px] font-medium text-[#71717a]">Lohnexport</span>
							</div>
							<div className="space-y-2">
								{[
									{ name: "DATEV", status: "Exportiert", color: "#10b981" },
									{ name: "Lexware", status: "Bereit", color: "#f59e0b" },
									{ name: "Personio", status: "Exportiert", color: "#10b981" },
								].map((item, i) => (
									<div key={i} className="flex items-center justify-between rounded-lg bg-[#09090b] px-3 py-2.5">
										<span className="text-[12px]">{item.name}</span>
										<span className="rounded-full px-2 py-0.5 text-[10px] font-medium" style={{ backgroundColor: `${item.color}15`, color: item.color }}>
											{item.status}
										</span>
									</div>
								))}
							</div>
							<div className="mt-4 rounded-lg bg-[#10b981] px-3 py-2.5 text-center text-[11px] font-semibold text-[#09090b]">
								Alle exportieren
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-8 py-24 lg:px-14" style={{ borderTop: "1px solid #18181b" }}>
				<div className="mx-auto max-w-5xl">
					<div className="mb-14 text-center">
						<h2 className="text-[clamp(2rem,4vw,3rem)] font-bold tracking-[-0.03em]">
							Sechs Bausteine. Ein System.
						</h2>
					</div>
					<div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
						{[
							{ title: "Stempeluhr", desc: "Ein Klick. Alle Geräte. Sofort synchronisiert." },
							{ title: "GoBD-konform", desc: "Revisionssicher. Unantastbar. Lückenlos." },
							{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Automatisch." },
							{ title: "Multi-Tenant", desc: "Mandantenfähig. Isoliert und skalierbar." },
							{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Nahtlos integriert." },
							{ title: "Dashboards", desc: "Überstunden, Trends. Live und sofort." },
						].map((f, i) => (
							<div
								key={i}
								className="group rounded-2xl p-6 transition-all hover:-translate-y-1"
								style={{
									backgroundColor: "#18181b",
									border: "1px solid #27272a",
								}}
							>
								<h3 className="mb-2 text-[15px] font-semibold transition-colors group-hover:text-white">{f.title}</h3>
								<p className="text-[13px] leading-[1.7] text-[#71717a]">{f.desc}</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Image */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-14">
				<div className="relative h-[35vh] overflow-hidden rounded-2xl">
					<Image
						src="https://images.unsplash.com/photo-1557804506-669a67965ba0?w=1400&q=80&auto=format&fit=crop"
						alt=""
						fill
						className="object-cover"
						style={{ filter: "saturate(0.2) brightness(0.35) contrast(1.2)" }}
					/>
					<div className="absolute inset-0" style={{ background: "linear-gradient(135deg, rgba(9,9,11,0.5), rgba(9,9,11,0))" }} />
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-14">
				<div className="mx-auto max-w-2xl text-center">
					<h2 className="mb-4 text-3xl font-bold tracking-[-0.02em]">
						Bereit f&uuml;r die Zentrale?
					</h2>
					<p className="mb-8 text-[14px] text-[#71717a]">
						Kostenlos starten. Ohne Kreditkarte.
					</p>
					<div className="flex items-center justify-center gap-3">
						<a
							href="mailto:hello@z8.app"
							className="rounded-lg px-8 py-3.5 text-[14px] font-semibold text-[#09090b] transition-all hover:bg-[#e4e4e7]"
							style={{ backgroundColor: "#fafafa" }}
						>
							Kostenlos testen
						</a>
						<a href="mailto:hello@z8.app" className="rounded-lg px-8 py-3.5 text-[14px] text-[#71717a] transition-colors hover:text-white" style={{ border: "1px solid #27272a" }}>
							hello@z8.app
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-14" style={{ borderTop: "1px solid #18181b" }}>
				<div className="flex items-center justify-between text-[13px] text-[#3f3f46]">
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-white">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
