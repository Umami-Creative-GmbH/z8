import Image from "next/image";
import Link from "next/link";

export default function DesignP5() {
	return (
		<div
			className="min-h-screen"
			style={{
				fontFamily: "'Newsreader', 'Lora', 'Source Serif 4', Georgia, serif",
				backgroundColor: "#fcfbf9",
				color: "#1a1816",
			}}
		>
			{/* Prismatic top line */}
			<div
				className="h-[2px]"
				style={{
					background: "linear-gradient(90deg, #6478ff 0%, #c850c0 20%, #ff5088 40%, #ffb347 60%, #3cdcb4 80%, #6478ff 100%)",
					opacity: 0.4,
				}}
			/>

			{/* Header */}
			<header
				className="relative z-20 flex items-center justify-between px-8 py-5 lg:px-14"
				style={{ fontFamily: "'Satoshi', 'General Sans', sans-serif" }}
			>
				<div className="flex items-center gap-8">
					<span
						className="text-[20px] font-bold tracking-[-0.02em]"
						style={{
							background: "linear-gradient(135deg, #6478ff, #c850c0)",
							WebkitBackgroundClip: "text",
							WebkitTextFillColor: "transparent",
						}}
					>
						Z8
					</span>
					<nav className="hidden items-center gap-6 text-[14px] text-[#8a8580] md:flex">
						<a href="#features" className="transition-colors hover:text-[#1a1816]">Produkt</a>
						<a href="#features" className="transition-colors hover:text-[#1a1816]">Warum Z8</a>
						<a href="#contact" className="transition-colors hover:text-[#1a1816]">Preise</a>
					</nav>
				</div>
				<a
					href="#contact"
					className="rounded-lg px-5 py-2.5 text-[13px] font-semibold text-white transition-all hover:opacity-90"
					style={{ background: "linear-gradient(135deg, #6478ff, #c850c0)" }}
				>
					Demo anfragen
				</a>
			</header>

			<div className="relative z-10 mx-8 h-px lg:mx-14" style={{ backgroundColor: "#1a181608" }} />

			{/* Hero — editorial split with stats + prismatic accents */}
			<section className="relative z-10 px-8 pb-20 pt-20 lg:px-14">
				<div className="grid gap-16 lg:grid-cols-2">
					{/* Left */}
					<div>
						<p
							className="animate-fade-up mb-6 text-[10px] font-semibold uppercase tracking-[0.5em]"
							style={{
								background: "linear-gradient(90deg, #6478ff, #c850c0, #ff5088)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
								fontFamily: "'Satoshi', 'General Sans', sans-serif",
								animationDelay: "0.1s",
							}}
						>
							Zeiterfassung f&uuml;r Teams
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
							<em
								style={{
									fontStyle: "italic",
									background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088)",
									WebkitBackgroundClip: "text",
									WebkitTextFillColor: "transparent",
								}}
							>
								Wert
							</em>
							.
						</h1>
						<p
							className="animate-fade-up mt-8 max-w-md text-[16px] leading-[1.9] text-[#8a8580]"
							style={{ fontFamily: "'Satoshi', 'General Sans', sans-serif", animationDelay: "0.4s" }}
						>
							Z8 macht Arbeitszeit sichtbar, messbar und verwertbar.
							GoBD-konform, automatisch exportiert, prismatisch analysiert.
						</p>
						<div
							className="animate-fade-up mt-10 flex items-center gap-4"
							style={{ animationDelay: "0.5s", fontFamily: "'Satoshi', 'General Sans', sans-serif" }}
						>
							<a
								href="#contact"
								className="group relative overflow-hidden rounded-lg px-7 py-3.5 text-[14px] font-semibold text-white"
								style={{ background: "linear-gradient(135deg, #6478ff, #c850c0)" }}
							>
								<span className="relative z-10">Kostenlos starten</span>
								<div
									className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
									style={{ background: "linear-gradient(135deg, #c850c0, #ff5088)" }}
								/>
							</a>
							<a href="#features" className="text-[14px] text-[#b8a898] transition-colors hover:text-[#1a1816]">
								Mehr erfahren &darr;
							</a>
						</div>

						{/* Stats with spectral colors */}
						<div
							className="animate-fade-up mt-16 grid grid-cols-3 gap-8"
							style={{ animationDelay: "0.6s" }}
						>
							{[
								{ number: "10k+", label: "Nutzer", color: "#6478ff" },
								{ number: "99,9%", label: "Uptime", color: "#c850c0" },
								{ number: "<1s", label: "Sync-Zeit", color: "#3cdcb4" },
							].map((stat, i) => (
								<div key={i}>
									<div className="text-[clamp(2rem,3vw,2.8rem)] font-medium tracking-[-0.02em]">{stat.number}</div>
									<div
										className="mt-1 text-[12px] font-semibold"
										style={{
											fontFamily: "'Satoshi', 'General Sans', sans-serif",
											color: stat.color,
										}}
									>
										{stat.label}
									</div>
								</div>
							))}
						</div>
					</div>

					{/* Right — app mockup with prismatic touches */}
					<div className="animate-scale-in relative" style={{ animationDelay: "0.3s" }}>
						<div
							className="relative overflow-hidden rounded-2xl bg-white"
							style={{
								boxShadow: "0 30px 80px rgba(100,120,255,0.06), 0 8px 32px rgba(200,80,192,0.04)",
								border: "1px solid rgba(100,120,255,0.1)",
							}}
						>
							{/* Header bar */}
							<div className="flex items-center justify-between border-b px-5 py-3" style={{ borderColor: "#f0ece6", fontFamily: "'Satoshi', 'General Sans', sans-serif" }}>
								<div className="flex items-center gap-3">
									<div
										className="flex h-7 w-7 items-center justify-center rounded-lg text-[9px] font-bold text-white"
										style={{ background: "linear-gradient(135deg, #6478ff, #c850c0)" }}
									>
										Z8
									</div>
									<span className="text-[13px] font-semibold">Zeiterfassung</span>
								</div>
								<div className="flex gap-2">
									<div className="rounded-md bg-[#f6f4f0] px-3 py-1.5 text-[11px] text-[#8a8580]">Export</div>
									<div
										className="rounded-md px-3 py-1.5 text-[11px] font-medium text-white"
										style={{ background: "linear-gradient(135deg, #6478ff, #c850c0)" }}
									>
										+ Eintrag
									</div>
								</div>
							</div>
							{/* Content */}
							<div className="p-5" style={{ fontFamily: "'Satoshi', 'General Sans', sans-serif" }}>
								{/* Week bars */}
								<div className="mb-4 grid grid-cols-7 gap-1.5 text-center text-[10px] text-[#b8a898]">
									{["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((d, i) => (
										<div key={i}>{d}</div>
									))}
								</div>
								<div className="mb-6 grid grid-cols-7 gap-1.5">
									{[8.5, 7.75, 8.0, 8.25, 8.5, 0, 0].map((h, i) => {
										const colors = ["#6478ff", "#8860e0", "#c850c0", "#ff5088", "#ffb347"];
										return (
											<div
												key={i}
												className="flex h-16 flex-col items-center justify-end rounded-lg p-1.5"
												style={{ backgroundColor: h > 0 ? "#f8f6f3" : "#fafaf8" }}
											>
												{h > 0 && (
													<>
														<div
															className="w-full rounded-md"
															style={{
																height: `${(h / 9) * 100}%`,
																backgroundColor: h >= 8.5 ? colors[i] : "#d0c8be",
																minHeight: "8px",
															}}
														/>
														<span className="mt-1 text-[9px] font-medium text-[#8a8580]">{h}h</span>
													</>
												)}
											</div>
										);
									})}
								</div>
								{/* Summary */}
								<div className="grid grid-cols-3 gap-3">
									{[
										{ label: "Diese Woche", value: "41h", color: "#6478ff" },
										{ label: "\u00dcberstunden", value: "+1h", color: "#c850c0" },
										{ label: "Urlaubstage", value: "18", color: "#3cdcb4" },
									].map((s, i) => (
										<div key={i} className="rounded-xl p-4" style={{ backgroundColor: `${s.color}06`, border: `1px solid ${s.color}10` }}>
											<div className="text-[10px] text-[#b8a898]">{s.label}</div>
											<div className="mt-1 text-[20px] font-medium tracking-tight">{s.value}</div>
										</div>
									))}
								</div>
							</div>
						</div>
						{/* Decorative prismatic shadow */}
						<div
							className="absolute -bottom-3 -right-3 -z-10 h-full w-full rounded-2xl"
							style={{
								background: "linear-gradient(135deg, rgba(100,120,255,0.06), rgba(200,80,192,0.04), rgba(60,220,180,0.06))",
							}}
						/>
					</div>
				</div>
			</section>

			{/* Features */}
			<section id="features" className="relative z-10 px-8 py-24 lg:px-14">
				<div className="mx-auto max-w-5xl">
					<div className="mb-14">
						<h2 className="text-[clamp(2rem,4vw,3rem)] tracking-[-0.02em]" style={{ fontWeight: 500 }}>
							Alles, was{" "}
							<span
								style={{
									background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088)",
									WebkitBackgroundClip: "text",
									WebkitTextFillColor: "transparent",
								}}
							>
								z&auml;hlt
							</span>
							.
						</h2>
					</div>
					<div className="grid gap-8 md:grid-cols-2 lg:grid-cols-3">
						{[
							{ title: "Stempeluhr", desc: "Web, Desktop, Mobile. Echtzeit-Synchronisation \u00fcber alle Ger\u00e4te.", color: "#6478ff" },
							{ title: "GoBD-konform", desc: "Revisionssichere Eintr\u00e4ge. L\u00fcckenlos dokumentiert.", color: "#8860e0" },
							{ title: "Lohnexport", desc: "DATEV, Lexware, Personio, SAP. Automatisch und nahtlos.", color: "#c850c0" },
							{ title: "Multi-Tenant", desc: "Mandantenf\u00e4hig. Isoliert, sicher, skalierbar.", color: "#ff5088" },
							{ title: "Enterprise-SSO", desc: "SAML, OIDC, SCIM. Nahtlose Integration.", color: "#ffb347" },
							{ title: "Dashboards", desc: "\u00dcberstunden, Trends, Auswertungen. Sofort live.", color: "#3cdcb4" },
						].map((f, i) => (
							<div key={i} className="group">
								<div className="mb-3 flex items-center gap-3">
									<span className="text-[26px] font-light" style={{ color: `${f.color}50` }}>{String(i + 1).padStart(2, "0")}</span>
									<div className="h-px flex-1 transition-colors" style={{ backgroundColor: `${f.color}20` }} />
								</div>
								<h3 className="mb-2 text-[17px] tracking-tight" style={{ fontWeight: 500, fontFamily: "'Satoshi', 'General Sans', sans-serif" }}>
									{f.title}
								</h3>
								<p className="text-[13px] leading-[1.8] text-[#a09888]" style={{ fontFamily: "'Satoshi', 'General Sans', sans-serif" }}>
									{f.desc}
								</p>
							</div>
						))}
					</div>
				</div>
			</section>

			{/* Images */}
			<section className="relative z-10 mx-8 mb-24 lg:mx-14">
				<div className="grid gap-5 md:grid-cols-2">
					<div className="relative h-64 overflow-hidden rounded-2xl" style={{ border: "1px solid rgba(100,120,255,0.08)" }}>
						<Image src="https://images.unsplash.com/photo-1600880292203-757bb62b4baf?w=800&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.5) contrast(1.05)" }} />
					</div>
					<div className="relative h-64 overflow-hidden rounded-2xl" style={{ border: "1px solid rgba(60,220,180,0.08)" }}>
						<Image src="https://images.unsplash.com/photo-1522071820081-009f0129c71c?w=800&q=80&auto=format&fit=crop" alt="" fill className="object-cover" style={{ filter: "saturate(0.5) contrast(1.05)" }} />
					</div>
				</div>
			</section>

			{/* Quote */}
			<section className="relative z-10 px-8 py-24 lg:px-14">
				<div className="mx-auto max-w-2xl text-center">
					<div className="mb-6 flex justify-center">
						<div
							className="h-px w-40"
							style={{ background: "linear-gradient(90deg, transparent, #6478ff20, #c850c020, #ff508820, transparent)" }}
						/>
					</div>
					<blockquote className="text-[clamp(1.5rem,3.5vw,2.5rem)] leading-[1.4] tracking-[-0.02em]" style={{ fontWeight: 500 }}>
						Was man{" "}
						<span
							style={{
								background: "linear-gradient(135deg, #6478ff, #c850c0, #ff5088)",
								WebkitBackgroundClip: "text",
								WebkitTextFillColor: "transparent",
							}}
						>
							messen
						</span>{" "}
						kann, kann man verbessern.
					</blockquote>
				</div>
			</section>

			{/* Contact */}
			<section id="contact" className="relative z-10 px-8 py-24 lg:px-14">
				<div
					className="mx-auto max-w-3xl overflow-hidden rounded-2xl p-14 text-center text-white"
					style={{ background: "linear-gradient(135deg, #6478ff, #8860e0, #c850c0, #ff5088)" }}
				>
					<h2 className="mb-4 text-[clamp(2rem,4vw,3rem)] tracking-[-0.02em]" style={{ fontWeight: 500 }}>
						Bereit, jede Minute zu nutzen?
					</h2>
					<p className="mb-8 text-[14px] text-white/70" style={{ fontFamily: "'Satoshi', 'General Sans', sans-serif" }}>
						Starten Sie kostenlos &mdash; oder lassen Sie sich pers&ouml;nlich beraten.
					</p>
					<div className="flex items-center justify-center gap-3" style={{ fontFamily: "'Satoshi', 'General Sans', sans-serif" }}>
						<a
							href="mailto:hello@z8.app"
							className="rounded-lg bg-white px-8 py-3.5 text-[14px] font-semibold text-[#6478ff] transition-all hover:bg-white/90"
						>
							Kostenlos starten
						</a>
						<a href="mailto:hello@z8.app" className="rounded-lg px-8 py-3.5 text-[14px] text-white/70 transition-colors hover:text-white" style={{ border: "1px solid rgba(255,255,255,0.25)" }}>
							hello@z8.app
						</a>
					</div>
				</div>
			</section>

			{/* Footer */}
			<footer className="relative z-10 px-8 py-8 lg:px-14" style={{ borderTop: "1px solid #e8e4de" }}>
				<div className="flex items-center justify-between text-[13px] text-[#c0b8b0]" style={{ fontFamily: "'Satoshi', 'General Sans', sans-serif" }}>
					<span>&copy; 2025 Z8</span>
					<Link href="/" className="transition-colors hover:text-[#1a1816]">&larr; Alle Designs</Link>
				</div>
			</footer>
		</div>
	);
}
