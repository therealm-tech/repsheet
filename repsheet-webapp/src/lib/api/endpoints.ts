import type { z } from "zod";
import { request, requestVoid } from "@/lib/api/client";
import {
	type AthleteInput,
	AthleteSchema,
	type BlockInput,
	BlockSchema,
	CommentSchema,
	type CreateExerciseInput,
	type CreatePlannedSessionInput,
	type CreateWorkoutInput,
	type Equipment,
	ExerciseSchema,
	type GripFilter,
	LinkedAccountSchema,
	type Locale,
	type Mode,
	PerformanceSchema,
	type PlannedBlockInput,
	PlannedSessionSchema,
	PlannedSessionSummarySchema,
	pageOf,
	type Role,
	TemplateBlockSchema,
	type TemplateInput,
	TemplateSchema,
	TemplateSummarySchema,
	TokenSchema,
	type UpdateExerciseInput,
	type UpdatePlannedSessionInput,
	type UpdateWorkoutInput,
	UserSchema,
	type WeightUnit,
	WorkoutSchema,
	WorkoutShareSchema,
	WorkoutSummarySchema,
} from "@/lib/api/schemas";
import { type Choices, gripFilter } from "@/lib/choices";

export const UserPageSchema = pageOf(UserSchema);
export const ExercisePageSchema = pageOf(ExerciseSchema);
export const PerformancePageSchema = pageOf(PerformanceSchema);
export const WorkoutPageSchema = pageOf(WorkoutSummarySchema);
export const TemplatePageSchema = pageOf(TemplateSummarySchema);
export const LinkedAccountPageSchema = pageOf(LinkedAccountSchema);
export const AthletePageSchema = pageOf(AthleteSchema);
export const PlannedSessionPageSchema = pageOf(PlannedSessionSummarySchema);
export const WorkoutDetailPageSchema = pageOf(WorkoutSchema);
export const WorkoutSharePageSchema = pageOf(WorkoutShareSchema);

export interface PageParams {
	page?: number;
	perPage?: number;
}

export const api = {
	register: (body: {
		name: string;
		email: string;
		password: string;
		weightUnit: WeightUnit;
		locale: Locale;
	}) => request("POST", "/users", UserSchema, { body, auth: false }),
	login: (body: { email: string; password: string }) =>
		request("POST", "/tokens", TokenSchema, { body, auth: false }),
	logout: () => requestVoid("DELETE", "/tokens/current"),
	me: () => request("GET", "/users/me", UserSchema),
	users: (params: { q?: string } & PageParams) =>
		request("GET", "/users", UserPageSchema, { query: { ...params } }),
	updateUserRole: (id: string, role: Role) =>
		request("PUT", `/users/${id}/role`, UserSchema, { body: { role } }),
	deleteUser: (id: string) => requestVoid("DELETE", `/users/${id}`),
	updatePreferences: (body: { locale: Locale; weightUnit: WeightUnit }) =>
		request("PUT", "/users/me/preferences", UserSchema, { body }),

	exercises: (
		params: { q?: string; sort?: "name" | "-lastUsedOn" } & PageParams,
	) =>
		request("GET", "/exercises", ExercisePageSchema, { query: { ...params } }),
	exercise: (id: string) => request("GET", `/exercises/${id}`, ExerciseSchema),
	createExercise: (body: CreateExerciseInput) =>
		request("POST", "/exercises", ExerciseSchema, { body }),
	updateExercise: (id: string, body: UpdateExerciseInput) =>
		request("PUT", `/exercises/${id}`, ExerciseSchema, { body }),
	deleteExercise: (id: string) => requestVoid("DELETE", `/exercises/${id}`),
	performances: (
		id: string,
		params: PageParams & {
			/** A profile the caller manages, whose history to read instead of theirs. */
			athleteId?: string;
			beforeWorkoutId?: string;
			mode?: Mode;
			equipment?: Equipment;
			grip?: GripFilter;
		} = {},
	) =>
		request("GET", `/exercises/${id}/performances`, PerformancePageSchema, {
			query: { ...params },
		}),
	/** The times an athlete of the caller performed it, in the workouts the caller reads. */
	athletePerformances: (
		id: string,
		params: PageParams & {
			athleteId: string;
			mode?: Mode;
			equipment?: Equipment;
			grip?: GripFilter;
		},
	) =>
		request("GET", `/exercises/${id}/performances`, PerformancePageSchema, {
			query: { ...params },
		}),

	workouts: (params: { athleteId?: string } & PageParams = {}) =>
		request("GET", "/workouts", WorkoutPageSchema, { query: { ...params } }),
	workout: (id: string) => request("GET", `/workouts/${id}`, WorkoutSchema),
	createWorkout: (body: CreateWorkoutInput) =>
		request("POST", "/workouts", WorkoutSchema, { body }),
	updateWorkout: (id: string, body: UpdateWorkoutInput) =>
		request("PUT", `/workouts/${id}`, WorkoutSchema, { body }),
	deleteWorkout: (id: string) => requestVoid("DELETE", `/workouts/${id}`),
	createBlock: (workoutId: string, body: BlockInput) =>
		request("POST", `/workouts/${workoutId}/blocks`, BlockSchema, { body }),
	updateBlock: (workoutId: string, blockId: string, body: BlockInput) =>
		request("PUT", `/workouts/${workoutId}/blocks/${blockId}`, BlockSchema, {
			body,
		}),
	deleteBlock: (workoutId: string, blockId: string) =>
		requestVoid("DELETE", `/workouts/${workoutId}/blocks/${blockId}`),

	templates: (params: PageParams = {}) =>
		request("GET", "/templates", TemplatePageSchema, { query: { ...params } }),
	template: (id: string) => request("GET", `/templates/${id}`, TemplateSchema),
	createTemplate: (body: TemplateInput) =>
		request("POST", "/templates", TemplateSchema, { body }),
	updateTemplate: (id: string, body: TemplateInput) =>
		request("PUT", `/templates/${id}`, TemplateSchema, { body }),
	deleteTemplate: (id: string) => requestVoid("DELETE", `/templates/${id}`),

	coaches: (params: PageParams = {}) =>
		request("GET", "/users/me/coaches", LinkedAccountPageSchema, {
			query: { ...params },
		}),
	addCoach: (email: string) =>
		request("POST", "/users/me/coaches", LinkedAccountSchema, {
			body: { email },
		}),
	removeCoach: (id: string) => requestVoid("DELETE", `/users/me/coaches/${id}`),
	athletes: (params: PageParams = {}) =>
		request("GET", "/users/me/athletes", AthletePageSchema, {
			query: { ...params },
		}),
	athlete: (id: string) =>
		request("GET", `/users/me/athletes/${id}`, AthleteSchema),
	createAthlete: (body: AthleteInput) =>
		request("POST", "/users/me/athletes", AthleteSchema, { body }),
	updateAthlete: (id: string, body: AthleteInput) =>
		request("PUT", `/users/me/athletes/${id}`, AthleteSchema, { body }),
	deleteAthlete: (id: string) =>
		requestVoid("DELETE", `/users/me/athletes/${id}`),

	plannedSessions: (params: { athleteId?: string } & PageParams = {}) =>
		request("GET", "/planned-sessions", PlannedSessionPageSchema, {
			query: { ...params },
		}),
	plannedSession: (id: string) =>
		request("GET", `/planned-sessions/${id}`, PlannedSessionSchema),
	createPlannedSession: (body: CreatePlannedSessionInput) =>
		request("POST", "/planned-sessions", PlannedSessionSchema, { body }),
	updatePlannedSession: (id: string, body: UpdatePlannedSessionInput) =>
		request("PUT", `/planned-sessions/${id}`, PlannedSessionSchema, { body }),
	deletePlannedSession: (id: string) =>
		requestVoid("DELETE", `/planned-sessions/${id}`),
	sendPlannedSession: (id: string) =>
		request("PUT", `/planned-sessions/${id}/status`, PlannedSessionSchema, {
			body: { status: "sent" },
		}),
	createPlannedBlock: (sessionId: string, body: PlannedBlockInput) =>
		request(
			"POST",
			`/planned-sessions/${sessionId}/blocks`,
			TemplateBlockSchema,
			{ body },
		),
	updatePlannedBlock: (
		sessionId: string,
		blockId: string,
		body: PlannedBlockInput,
	) =>
		request(
			"PUT",
			`/planned-sessions/${sessionId}/blocks/${blockId}`,
			TemplateBlockSchema,
			{ body },
		),
	deletePlannedBlock: (sessionId: string, blockId: string) =>
		requestVoid("DELETE", `/planned-sessions/${sessionId}/blocks/${blockId}`),
	plannedSessionWorkouts: (id: string) =>
		request(
			"GET",
			`/planned-sessions/${id}/workouts`,
			WorkoutDetailPageSchema,
			{ query: { perPage: 10 } },
		),

	workoutShares: (workoutId: string) =>
		request("GET", `/workouts/${workoutId}/shares`, WorkoutSharePageSchema, {
			query: { perPage: 100 },
		}),
	shareWorkout: (workoutId: string, coachId: string) =>
		requestVoid("PUT", `/workouts/${workoutId}/shares/${coachId}`),
	unshareWorkout: (workoutId: string, coachId: string) =>
		requestVoid("DELETE", `/workouts/${workoutId}/shares/${coachId}`),

	createComment: (body: { blockExerciseId: string; text: string }) =>
		request("POST", "/comments", CommentSchema, { body }),
	updateComment: (id: string, text: string) =>
		request("PUT", `/comments/${id}`, CommentSchema, { body: { text } }),
	deleteComment: (id: string) => requestVoid("DELETE", `/comments/${id}`),
};

export const keys = {
	me: ["me"] as const,
	users: ["users"] as const,
	exercises: (q: string) => ["exercises", q] as const,
	exercise: (id: string) => ["exercise", id] as const,
	performances: (
		id: string,
		perPage: number,
		beforeWorkoutId?: string,
		mode?: Mode,
		equipment?: Equipment,
		grip?: GripFilter,
	) =>
		[
			"performances",
			id,
			perPage,
			beforeWorkoutId ?? null,
			mode ?? null,
			equipment ?? null,
			grip ?? null,
		] as const,
	athletePerformances: (
		athleteId: string,
		id: string,
		mode: Mode,
		equipment: Equipment,
		grip: GripFilter,
	) =>
		["performances", "athlete", athleteId, id, mode, equipment, grip] as const,
	workouts: ["workouts"] as const,
	workout: (id: string) => ["workout", id] as const,
	templates: ["templates"] as const,
	template: (id: string) => ["template", id] as const,
	coaches: ["coaches"] as const,
	athletes: ["athletes"] as const,
	athlete: (id: string) => ["athletes", id] as const,
	plannedSessions: ["plannedSessions"] as const,
	plannedSession: (id: string) => ["plannedSession", id] as const,
	plannedSessionWorkouts: (id: string) =>
		["plannedSessionWorkouts", id] as const,
	workoutShares: (workoutId: string) => ["workoutShares", workoutId] as const,
	sharedWorkouts: (athleteId: string) =>
		["workouts", "shared", athleteId] as const,
};

/**
 * The latest performance of an exercise done the way `chosen` says, logged
 * before the given workout, by the caller or by the profile `athleteId` they
 * manage. A block with no grip recorded compares with the history that has
 * none either.
 */
export function previousPerformanceQuery(
	exerciseId: string,
	beforeWorkoutId: string,
	chosen: Choices,
	athleteId?: string,
) {
	const { mode, equipment } = chosen;
	const grip = gripFilter(chosen.grip);
	return {
		queryKey: [
			...keys.performances(
				exerciseId,
				1,
				beforeWorkoutId,
				mode,
				equipment,
				grip,
			),
			athleteId ?? null,
		],
		queryFn: () =>
			api.performances(exerciseId, {
				perPage: 1,
				beforeWorkoutId,
				mode,
				equipment,
				grip,
				...(athleteId ? { athleteId } : {}),
			}),
		staleTime: 60_000,
	};
}

/** What a block sheet asks for "last time": a query for the latest performance done the way `chosen` says. */
export interface LastTimeQuery {
	queryKey: readonly unknown[];
	queryFn: () => Promise<z.output<typeof PerformancePageSchema>>;
	staleTime: number;
}

/**
 * The latest performance of an exercise by one of the caller's athletes,
 * among the workouts the caller reads as their coach.
 */
export function athletePerformanceQuery(
	athleteId: string,
	exerciseId: string,
	chosen: Choices,
): LastTimeQuery {
	const { mode, equipment } = chosen;
	const grip = gripFilter(chosen.grip);
	return {
		queryKey: keys.athletePerformances(
			athleteId,
			exerciseId,
			mode,
			equipment,
			grip,
		),
		queryFn: () =>
			api.athletePerformances(exerciseId, {
				athleteId,
				perPage: 1,
				mode,
				equipment,
				grip,
			}),
		staleTime: 60_000,
	};
}
