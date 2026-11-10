import { request, requestVoid } from "@/lib/api/client";
import {
	type BlockInput,
	BlockSchema,
	type CreateExerciseInput,
	type CreateWorkoutInput,
	type Equipment,
	ExerciseSchema,
	type GripFilter,
	type Locale,
	type Mode,
	PerformanceSchema,
	pageOf,
	type Role,
	type TemplateInput,
	TemplateSchema,
	TemplateSummarySchema,
	TokenSchema,
	type UpdateExerciseInput,
	type UpdateWorkoutInput,
	UserSchema,
	type WeightUnit,
	WorkoutSchema,
	WorkoutSummarySchema,
} from "@/lib/api/schemas";
import { type Choices, gripFilter } from "@/lib/choices";

export const UserPageSchema = pageOf(UserSchema);
export const ExercisePageSchema = pageOf(ExerciseSchema);
export const PerformancePageSchema = pageOf(PerformanceSchema);
export const WorkoutPageSchema = pageOf(WorkoutSummarySchema);
export const TemplatePageSchema = pageOf(TemplateSummarySchema);

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
			beforeWorkoutId?: string;
			mode?: Mode;
			equipment?: Equipment;
			grip?: GripFilter;
		} = {},
	) =>
		request("GET", `/exercises/${id}/performances`, PerformancePageSchema, {
			query: { ...params },
		}),

	workouts: (params: PageParams = {}) =>
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
	workouts: ["workouts"] as const,
	workout: (id: string) => ["workout", id] as const,
	templates: ["templates"] as const,
	template: (id: string) => ["template", id] as const,
};

/**
 * The latest performance of an exercise done the way `chosen` says, logged
 * before the given workout. A block with no grip recorded compares with the
 * history that has none either.
 */
export function previousPerformanceQuery(
	exerciseId: string,
	beforeWorkoutId: string,
	chosen: Choices,
) {
	const { mode, equipment } = chosen;
	const grip = gripFilter(chosen.grip);
	return {
		queryKey: keys.performances(
			exerciseId,
			1,
			beforeWorkoutId,
			mode,
			equipment,
			grip,
		),
		queryFn: () =>
			api.performances(exerciseId, {
				perPage: 1,
				beforeWorkoutId,
				mode,
				equipment,
				grip,
			}),
		staleTime: 60_000,
	};
}
