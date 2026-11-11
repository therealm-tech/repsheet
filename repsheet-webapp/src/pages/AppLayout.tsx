import { useQuery } from "@tanstack/react-query";
import { Navigate, Outlet, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { Sidebar, TabBar } from "@/components/TabBar";
import i18n, { rememberLocale } from "@/i18n";
import { api, keys } from "@/lib/api/endpoints";
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

/** The profile whose workout the caller is logging, when the page is one. */
function useLoggingFor(pathname: string) {
	const athleteId =
		/^\/athletes\/([^/]+)\/workouts\/[^/]+$/.exec(pathname)?.[1] ?? null;
	const athlete = useQuery({
		queryKey: keys.athlete(athleteId ?? ""),
		queryFn: () => api.athlete(athleteId ?? ""),
		enabled: athleteId !== null,
	});
	return athleteId && athlete.data?.managed ? athlete.data : null;
}

export function AppLayout() {
	const token = useToken();
	const pathname = useRouterState({ select: (s) => s.location.pathname });
	const loggingFor = useLoggingFor(pathname);
	useAccountLocale();
	if (!token) {
		return <Navigate to="/login" />;
	}
	const immersive = /^\/workouts\/[^/]+$/.test(pathname) || loggingFor !== null;
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
