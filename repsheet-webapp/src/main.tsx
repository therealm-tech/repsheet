import "@fontsource/barlow-condensed/600.css";
import "@fontsource/barlow-condensed/700.css";
import "@fontsource-variable/manrope";
import "./styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ApiError } from "@/lib/api/client";
import { tokenStore } from "@/lib/auth";
import { router } from "@/router";

const queryClient = new QueryClient({
	defaultOptions: {
		queries: {
			retry: (failureCount, error) =>
				!(error instanceof ApiError && error.status < 500) && failureCount < 2,
		},
	},
});

tokenStore.subscribe(() => {
	if (!tokenStore.get()) {
		queryClient.clear();
		void router.navigate({ to: "/login" });
	}
});

const root = document.getElementById("root");
if (root) {
	createRoot(root).render(
		<StrictMode>
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>
		</StrictMode>,
	);
}
