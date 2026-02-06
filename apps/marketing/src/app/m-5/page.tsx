import Image from "next/image";
import Link from "next/link";

export default function DesignM5() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Reckless Neue', 'Libre Baskerville', 'Freight Text', Georgia, serif",
				backgroundColor: "#f6f4f0",
				color: "#1a1816",
			}}
		>
			{/* Header */}
			<header
				className="relative z-20 flex items-center justify-between px-8 py-5 lg:px-14"
				style={{ fontFamily: "'Mona Sans', 'General Sans', sans-serif" }}
			>
				<div className="flex items-center gap-8">
					<span className="text-[20px] font-bold tracking-[-0.02em]">Z8</span>
					<nav className="hidden items-center gap-6 text-[14px] text-[#8a8580] md:flex">
						<a href="#features" className="transition-colors hover:text-[#1a1816]">Produkt</a>
						<a href="#product" className="transition-colors hover:text-[#1a1816]">Warum Z8</a>
						<a href="#contact" className="transition-colors hover:text-[#1a1816]">Preise</a>
					</nav>
				</div>
				<a
					href="#contact"
					className="rounded-lg px-5 py-2.5 text-[13px] font-semibold text-white transition-all hover:bg-[#2a2520]"
					style={{ backgroundColor: "#1a1816" }}
				>
					Demo anfragen
				</a>
			</header>

			<div className="relative z-10 mx-8 h-px lg:mx-14" style={{ backgroundColor: "#1a181608" }} />

			{/* Hero — split with stats */}
			<section className="relative z-10 px-8 pb-20 pt-20 lg:px-14">
				<div className="grid gap-16 lg:grid-cols-2">
					{/* Left */}
					<div>
						<p
							className="animate-fade-up mb-6 text-[12px] font-semibold uppercase tracking-[0.15em]"
							style={{ color: "#b8a898", fontFamily: "'Mona Sans', 'General Sans', sans-serif", animationDelay: "0.1s" }}
						>
							Zeiterfassung f&uuml;r Teams, die z&auml;hlen
						</p>
						<h1
							className="animate-fade-up"
							style={{
								fontSize: "clamp(3rem, 6vw, 4.5rem)",
								fontWeight: 500,
								lineHeight: 1.1,
								letterSpacing: "-0.025em",
								animationDelay: "0.2s",
							}}
						>
							Jede Minute
							<br />
							hat einen{" "}
							<em style={{ fontStyle: "italic", color: "#a09080" }}>Wert</em>.
						</h1>
						<p
							className="animate-fade-up mt-8 max-w-md text-[16px] leading-[1.9] text-[#8a8580]"
							style={{ fontFamily: "'Mona Sans', 'General Sans', sans-serif", animationDelay: "0.4s" }}
						>
							Z8 macht Arbeitszeit sichtbar, messbar und verwertbar.
							GoBD-konform, automatisch exportiert, in Echtzeit analysiert.
						</p>
						<div
							className="animate-fade-up mt-10 flex items-center gap-4"
							style={{ animationDelay: "0.5s", fontFamily: "'Mona Sans', 'General Sans', sans-serif" }}
						>
							<a
								href="#contact"
								className="rounded-lg px-7 py-3.5 text-[14px] font-semibold text-white transition-all hover:bg-[#2a2520]"
								style={{ backgroundColor: "#1a1816" }}
							>
								Kostenlos starten
							</a>
							<a href="#features" className="text-[14px] text-[#b8a898] transition-colors hover:text-[#1a1816]">
								Mehr erfahren &darr;
							</a>
						</div>

						{/* Stats row */}
						<div
							className="animate-fade-up mt-16 grid grid-cols-3 gap-8"
							style={{ animationDelay: "0.6s" }}
						>
							{[
								{ number: "10k+", label: "Nutzer" },
								{ number: "99,9%", label: "Uptime" },
								{ number: "<1s", label: "Sync-Zeit" },
							].map((stat, i) => (
								<div key={i}>
									<div className="text-[clamp(2rem,3vw,2.8rem)] font-medium tracking-[-0.02em]">{stat.number}</div>
									<div
										className="mt-1 text-[12px] text-[#b8a898]"
										style={{ fontFamily: "'Mona Sans', 'General Sans', sans-serif" }}
									>
										{stat.label}
									</div>
								</div>
							))}
						</div>
					</div>

					{/* Right — app screenshot with overlay */}
					<div className="animate-scale-in relative" style={{ animationDelay: "0.3s" }}>
						<div
							className="relative overflow-hidden rounded-2xl"
							style={{
								boxShadow: "0 30px 80px rgba(26,24,22,0.1), 0 8px 32px rgba(26,24,22,0.06)",
								border: "1px solid #e8e4de",
							}}
						>
							{/* App mockup */}
							<div className="bg-white">
								{/* Header bar */}
								<div className="flex items-center justify-between border-b border-[#f0ece6] px-5 py-3" style={{ fontFamily: "'Mona Sans', 'General Sans', sans-serif" }}>
									<div className="flex items-center gap-3">
										<div className="h-7 w-7 rounded-lg bg-[#1a1816] text-center text-[9px] font-bold leading-7 text-white">Z8</div>
										<span className="text-[13px] font-semibold">Zeiterfassung</span>
									</div>
									<div className="flex gap-2">
										<div className="rounded-md bg-[#f6f4f0] px-3 py-1.5 text-[11px] text-[#8a8580]">Export</div>
										<div className="rounded-md bg-[#1a1816] px-3 py-1.5 text-[11px] font-medium text-white">+ Eintrag</div>
									</div>
								</div>
								{/* Content */}
								<div className="p-5" style={{ fontFamily: "'Mona Sans', 'General Sans', sans-serif" }}>
									{/* Week view */}
									<div className="mb-4 grid grid-cols-7 gap-1.5 text-center text-[10px] text-[#b8a898]">
										{["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d, i) => (
											<div key={i}>{d}</div>
										))}
									</div>
									<div className="mb-6 grid grid-cols-7 gap-1.5">
										{[8.5, 7.75, 8.0, 8.25, 8.5, 0, 0].map((h, i) => (
											<div
												key={i}
												className="flex h-16 flex-col items-center justify-end rounded-lg p-1.5"
												style={{
													backgroundColor: h > 0 ? "#f6f4f0" : "#fafaf8",
												}}
											>
												{h > 0 && (
													<>
														<div
															className="w-full rounded-md"
															style={{
																height: `${(h / 9) * 100}%`,
																backgroundColor: h >= 8.5 ? "#1a1816" : "#d0c8be",
																minHeight: "8px",
															}}
														/>
														<span className="mt-1 text-[9px] font-medium text-[#8a8580]">{h}h</span>
													</>
												)}
											</div>
										))}
									</div>
									{/* Summary */}
									<div className="grid grid-cols-3 gap-3">
										<div className="rounded-xl bg-[#f6f4f0] p-4">
											<div className="text-[10px] text-[#b8a898]">Diese Woche</div>
											<div className="mt-1 text-[20px] font-medium tracking-tight" style={{ fontFamily: "'Reckless Neue', Georgia, serif" }}>41h</div>
										</div>
										<div className="rounded-xl bg-[#f6f4f0] p-4">
											<div className="text-[10px] text-[#b8a898]">&Uuml;berstunden</div>
											<div className="mt-1 text-[20px] font-medium tracking-tight text-[#b8a898]" style={{ fontFamily: "'Reckless Neue', Georgia, serif" }}>+1h</div>
										</div>
										<div className="rounded-xl bg-[#f6f4f0] p-4">
											<div className="text-[10px] text-[#b8a898]">Urlaubstage</div>
											<div className="mt-1 text-[20px] font-medium tracking-tight" style={{ fontFamily: "'Reckless Neue', Georgia, serif" }}>18</div>
										</div>
									</div>
								</div>
							</div>
						</div>
						{/* Decorative overlap */}
						<div
							className="absolute -bottom-4 -right-4 -z-10 h-full w-full rounded-2xl"
							style={{ backgroundColor: "#ebe7e0" }}
						/>
					</div>
				</div>
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-8 py-24 lg:px-14">
				<div className="mx-auto max-w-5xl">
					<div className="mb-14">
						<h2 className="text-[clamp(2rem,4vw,3rem)] tracking-[-0.02em]" style={{ fontWeight: 500 }}>
							Alles, was z&auml;hlt.
						</h2>
					</div>
					<div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
						{[
							{ title: "Stempeluhr", desc: "Web, Desktop, Mobile. Echtzeit-Synchronisation über alle Geräte." },
							{ title: "GoBD-konform", desc: "Revisionssichere Einträge. Lückenlos dokumentiert." },
							{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Automatisch und nahtlos." },
							{ title: "Multi-Tenant", desc: "Mandantenfähig. Isoliert, sicher, skalierbar." },
							{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Nahtlose Integration." },
							{ title: "Dashboards", desc: "Überstunden, Trends, Auswertungen. Sofort live." },
						].map((f, i) => (
							<div key={i} className="group">
								<div className="mb-3 flex items-center gap-3">
									<span className="text-[26px] font-light text-[#d0c8be]">{String(i + 1).padStart(2, "0")}</span>
									<div className="h-px flex-1 transition-colors group-hover:bg-[#d0c8be]" style={{ backgroundColor: "#e8e4de" }} />
								</div>
								<h3 className="mb-2 text-[17px] tracking-tight" style={{ fontWeight: 500, fontFamily: "'Mona Sans', 'General Sans', sans-serif" }}>
									{f.title}
								</h3>
								<p className="text-[13px] leading-[1.8] text-[#a09888]" style={{ fontFamily: "'Mona Sans', 'General Sans', sans-serif" }}>
									{f.desc}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Image section */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-14">
				<div className="grid gap-5 md:grid-cols-2">
					<div className="relative h-64 overflow-hidden rounded-2xl">
						<Image src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=800&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.4) contrast(1.05)" }} />
					</div>
					<div className="relative h-64 overflow-hidden rounded-2xl">
						<Image src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.4) contrast(1.05)" }} />
					</div>
				</div>
			</section>

			{/* Quote */}
			<section className="relative z-10 px-8 py-24 lg:px-14">
				<div className="mx-auto max-w-2xl text-center">
					<blockquote className="text-[clamp(1.5rem,3.5vw,2.5rem)] leading-[1.4] tracking-[-0.02em]" style={{ fontWeight: 500 }}>
						Was man messen kann,
						<br />
						kann man <em style={{ color: "#a09080" }}>verbessern</em>.
					</blockquote>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-14">
				<div
					className="mx-auto max-w-3xl rounded-2xl p-14 text-center"
					style={{ backgroundColor: "#1a1816", color: "#f6f4f0" }}
				>
					<h2 className="mb-4 text-[clamp(2rem,4vw,3rem)] tracking-[-0.02em]" style={{ fontWeight: 500 }}>
						Bereit, jede Minute zu nutzen?
					</h2>
					<p className="mb-8 text-[14px] text-[#8a8580]" style={{ fontFamily: "'Mona Sans', 'General Sans', sans-serif" }}>
						Starten Sie kostenlos &mdash; oder lassen Sie sich pers&ouml;nlich beraten.
					</p>
					<div className="flex items-center justify-center gap-3" style={{ fontFamily: "'Mona Sans', 'General Sans', sans-serif" }}>
						<a
							href="mailto:hello@z8.app"
							className="rounded-lg bg-[#f6f4f0] px-8 py-3.5 text-[14px] font-semibold text-[#1a1816] transition-all hover:bg-white"
						>
							Kostenlos starten
						</a>
						<a href="mailto:hello@z8.app" className="rounded-lg px-8 py-3.5 text-[14px] text-[#8a8580] transition-colors hover:text-[#f6f4f0]" style={{ border: "1px solid #3a3530" }}>
							hello@z8.app
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-14" style={{ borderTop: "1px solid #e8e4de" }}>
				<div className="flex items-center justify-between text-[13px] text-[#c0b8b0]" style={{ fontFamily: "'Mona Sans', 'General Sans', sans-serif" }}>
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#1a1816]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
