import { Link } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { AccountPanel } from "@/components/AccountPanel";
import { Logo } from "@/components/Logo";

const NAV = [
	{ to: "/", label: "nav.home", icon: "⌂", exact: true },
	{ to: "/workouts", label: "nav.history", icon: "☰", exact: false },
	{ to: "/templates", label: "nav.templates", icon: "◫", exact: false },
	{ to: "/exercises", label: "nav.exercises", icon: "◎", exact: false },
] as const;

function NavLinks() {
	const { t } = useTranslation();
	return NAV.map((item) => (
		<Link
			key={item.to}
			to={item.to}
			activeOptions={{ exact: item.exact }}
			activeProps={{ className: "on", "aria-current": "page" }}
		>
			<span aria-hidden="true">{item.icon}</span>
			{t(item.label)}
		</Link>
	));
}

/** Bottom navigation on phones and tablets. */
export function TabBar() {
	const { t } = useTranslation();
	return (
		<nav className="tabbar" aria-label={t("nav.main")}>
			<NavLinks />
		</nav>
	);
}

/** Left navigation on wide screens; hidden by CSS below the desktop breakpoint. */
export function Sidebar() {
	const { t } = useTranslation();
	return (
		<aside className="sidebar">
			<Link to="/" className="sidebar-brand" aria-label={t("nav.brandHome")}>
				<Logo width={56} />
				<span className="display">RepSheet</span>
			</Link>
			<nav className="sidebar-nav" aria-label={t("nav.side")}>
				<NavLinks />
			</nav>
			<AccountPanel />
		</aside>
	);
}
