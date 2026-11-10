import {
	createBrowserHistory,
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	type RouterHistory,
	redirect,
} from "@tanstack/react-router";
import { z } from "zod";
import { tokenStore } from "@/lib/auth";
import { APP_SCROLLER } from "@/lib/scroll";
import { AccountsPage } from "@/pages/AccountsPage";
import { AppLayout } from "@/pages/AppLayout";
import { AthletePage } from "@/pages/AthletePage";
import { CoachingPage } from "@/pages/CoachingPage";
import { ExerciseDetailPage } from "@/pages/ExerciseDetailPage";
import { ExercisesPage } from "@/pages/ExercisesPage";
import { HistoryPage } from "@/pages/HistoryPage";
import { HomePage } from "@/pages/HomePage";
import { LoginPage } from "@/pages/LoginPage";
import { PlannedSessionEditorPage } from "@/pages/PlannedSessionEditorPage";
import { PlannedSessionPage } from "@/pages/PlannedSessionPage";
import { SharedWorkoutPage } from "@/pages/SharedWorkoutPage";
import { TemplateEditorPage } from "@/pages/TemplateEditorPage";
import { TemplatesPage } from "@/pages/TemplatesPage";
import { WorkoutPage } from "@/pages/WorkoutPage";

const rootRoute = createRootRoute({ component: Outlet });

const loginRoute = createRoute({
	getParentRoute: () => rootRoute,
	path: "/login",
	beforeLoad: () => {
		if (tokenStore.get()) {
			throw redirect({ to: "/" });
		}
	},
	component: LoginPage,
});

const appRoute = createRoute({
	getParentRoute: () => rootRoute,
	id: "app",
	beforeLoad: () => {
		if (!tokenStore.get()) {
			throw redirect({ to: "/login" });
		}
	},
	component: AppLayout,
});

const homeRoute = createRoute({
	getParentRoute: () => appRoute,
	path: "/",
	component: HomePage,
});

const historyRoute = createRoute({
	getParentRoute: () => appRoute,
	path: "/workouts",
	component: HistoryPage,
});

const workoutRoute = createRoute({
	getParentRoute: () => appRoute,
	path: "/workouts/$workoutId",
	component: function WorkoutRouteView() {
		const { workoutId } = workoutRoute.useParams();
		return <WorkoutPage key={workoutId} workoutId={workoutId} />;
	},
});

const exercisesRoute = createRoute({
	getParentRoute: () => appRoute,
	path: "/exercises",
	component: ExercisesPage,
});

const exerciseRoute = createRoute({
	getParentRoute: () => appRoute,
	path: "/exercises/$exerciseId",
	component: function ExerciseRouteView() {
		const { exerciseId } = exerciseRoute.useParams();
		return <ExerciseDetailPage exerciseId={exerciseId} />;
	},
});

const accountsRoute = createRoute({
	getParentRoute: () => appRoute,
	path: "/admin/accounts",
	component: AccountsPage,
});

const templatesRoute = createRoute({
	getParentRoute: () => appRoute,
	path: "/templates",
	component: TemplatesPage,
});

const NewTemplateSearchSchema = z.object({
	fromWorkout: z.string().optional(),
});

const newTemplateRoute = createRoute({
	getParentRoute: () => appRoute,
	path: "/templates/new",
	validateSearch: (search) => NewTemplateSearchSchema.parse(search),
	component: function NewTemplateRouteView() {
		const { fromWorkout } = newTemplateRoute.useSearch();
		return fromWorkout ? (
			<TemplateEditorPage key={fromWorkout} fromWorkout={fromWorkout} />
		) : (
			<TemplateEditorPage key="new" />
		);
	},
});

const templateRoute = createRoute({
	getParentRoute: () => appRoute,
	path: "/templates/$templateId",
	component: function TemplateRouteView() {
		const { templateId } = templateRoute.useParams();
		return <TemplateEditorPage key={templateId} templateId={templateId} />;
	},
});

const coachingRoute = createRoute({
	getParentRoute: () => appRoute,
	path: "/coaching",
	component: CoachingPage,
});

const athleteRoute = createRoute({
	getParentRoute: () => appRoute,
	path: "/coaching/athletes/$athleteId",
	component: function AthleteRouteView() {
		const { athleteId } = athleteRoute.useParams();
		return <AthletePage key={athleteId} athleteId={athleteId} />;
	},
});

const newPlannedSessionRoute = createRoute({
	getParentRoute: () => appRoute,
	path: "/coaching/athletes/$athleteId/sessions/new",
	component: function NewPlannedSessionRouteView() {
		const { athleteId } = newPlannedSessionRoute.useParams();
		return <PlannedSessionEditorPage key={athleteId} athleteId={athleteId} />;
	},
});

const plannedSessionRoute = createRoute({
	getParentRoute: () => appRoute,
	path: "/coaching/athletes/$athleteId/sessions/$sessionId",
	component: function PlannedSessionRouteView() {
		const { athleteId, sessionId } = plannedSessionRoute.useParams();
		return (
			<PlannedSessionPage
				key={sessionId}
				athleteId={athleteId}
				sessionId={sessionId}
			/>
		);
	},
});

const editPlannedSessionRoute = createRoute({
	getParentRoute: () => appRoute,
	path: "/coaching/athletes/$athleteId/sessions/$sessionId/edit",
	component: function EditPlannedSessionRouteView() {
		const { athleteId, sessionId } = editPlannedSessionRoute.useParams();
		return (
			<PlannedSessionEditorPage
				key={sessionId}
				athleteId={athleteId}
				sessionId={sessionId}
			/>
		);
	},
});

const sharedWorkoutRoute = createRoute({
	getParentRoute: () => appRoute,
	path: "/coaching/athletes/$athleteId/workouts/$workoutId",
	component: function SharedWorkoutRouteView() {
		const { athleteId, workoutId } = sharedWorkoutRoute.useParams();
		return (
			<SharedWorkoutPage
				key={workoutId}
				athleteId={athleteId}
				workoutId={workoutId}
			/>
		);
	},
});

export const routeTree = rootRoute.addChildren([
	loginRoute,
	appRoute.addChildren([
		homeRoute,
		historyRoute,
		workoutRoute,
		exercisesRoute,
		exerciseRoute,
		templatesRoute,
		newTemplateRoute,
		templateRoute,
		accountsRoute,
		coachingRoute,
		athleteRoute,
		newPlannedSessionRoute,
		plannedSessionRoute,
		editPlannedSessionRoute,
		sharedWorkoutRoute,
	]),
]);

export function createAppRouter(
	history: RouterHistory = createBrowserHistory(),
) {
	return createRouter({
		routeTree,
		history,
		scrollRestoration: true,
		scrollToTopSelectors: [APP_SCROLLER],
	});
}

export const router = createAppRouter();

declare module "@tanstack/react-router" {
	interface Register {
		router: typeof router;
	}
}
