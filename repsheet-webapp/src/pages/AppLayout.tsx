import { Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { Sidebar, TabBar } from "@/components/TabBar";
import i18n, { rememberLocale } from "@/i18n";
import { useToken } from "@/lib/auth";
import { useMe } from "@/lib/hooks";
import { APP_SCROLLER_ID } from "@/lib/scroll";

/** Once signed in, the account's language wins over whatever the device suggested. */
function useAccountLocale() {
	const locale = useMe().data?.locale;
	useEffect(() => {
		if (locale && locale !== i18n.language) {
			rememberLocale(locale);
			void i18n.changeLanguage(locale);
		}
	}, [locale]);
}

export function AppLayout() {
	const token = useToken();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	useAccountLocale();
	if (!token) {
		return <Navigate to="/login" />;
	}
	const immersive = /^\/workouts\/[^/]+$/.test(pathname);
	return (
		<div className="app">
			<Sidebar />
			<div className="app-main" data-scroll-restoration-id={APP_SCROLLER_ID}>
				<Outlet />
			</div>
			{immersive ? null : <TabBar />}
		</div>
	);
}
