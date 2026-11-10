import { z } from "zod";

export const WeightUnitSchema = z.enum(["kg", "lb"]);
export type WeightUnit = z.infer<typeof WeightUnitSchema>;

/** How a set is counted: reps, a duration or a distance. */
export const ModeSchema = z.enum(["reps", "time", "distance"]);
export type Mode = z.infer<typeof ModeSchema>;

/** Whether a set carries no weight, an optional extra load or a required one. */
export const LoadSchema = z.enum(["none", "optional", "required"]);
export type Load = z.infer<typeof LoadSchema>;

export const EquipmentSchema = z.enum([
	"barbell",
	"dumbbell",
	"kettlebell",
	"machine",
	"cable",
	"bodyweight",
	"other",
]);
export type Equipment = z.infer<typeof EquipmentSchema>;

/** How the hands hold the bar or the handles. */
export const GripSchema = z.enum([
	"pronation",
	"supination",
	"neutral",
	"mixed",
]);
export type Grip = z.infer<typeof GripSchema>;

/** A grip to filter performances by; `none` for those with no grip recorded. */
export type GripFilter = Grip | "none";

export const BlockKindSchema = z.enum(["simple", "superset", "circuit"]);
export type BlockKind = z.infer<typeof BlockKindSchema>;

export const ProblemSchema = z.object({
	type: z.string().optional(),
	title: z.string(),
	status: z.number(),
	detail: z.string().nullish(),
	errors: z
		.array(z.object({ field: z.string(), message: z.string() }))
		.nullish(),
});
export type Problem = z.infer<typeof ProblemSchema>;

export function pageOf<T extends z.ZodType>(item: T) {
	return z.object({
		items: z.array(item),
		page: z.number(),
		perPage: z.number(),
		total: z.number(),
	});
}

export const RoleSchema = z.enum(["user", "superAdmin"]);
export type Role = z.infer<typeof RoleSchema>;

export const LocaleSchema = z.enum(["fr", "en"]);
export type Locale = z.infer<typeof LocaleSchema>;

export const UserSchema = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string(),
	weightUnit: WeightUnitSchema,
	locale: LocaleSchema,
	role: RoleSchema,
	createdAt: z.string(),
});
export type User = z.infer<typeof UserSchema>;

export const TokenSchema = z.object({
	token: z.string().min(1),
	expiresAt: z.string(),
});
export type Token = z.infer<typeof TokenSchema>;

export const ExerciseSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	modes: z.array(ModeSchema).min(1),
	defaultMode: ModeSchema,
	load: LoadSchema,
	equipment: z.array(EquipmentSchema).min(1),
	defaultEquipment: EquipmentSchema,
	grips: z.array(GripSchema),
	defaultGrip: GripSchema.nullable(),
	unilateral: z.boolean(),
});
export type ExerciseSummary = z.infer<typeof ExerciseSummarySchema>;

export const ExerciseNamesSchema = z.object({
	fr: z.string().nullable(),
	en: z.string().nullable(),
});
export type ExerciseNames = z.infer<typeof ExerciseNamesSchema>;

export const ExerciseSchema = ExerciseSummarySchema.extend({
	names: ExerciseNamesSchema,
	custom: z.boolean(),
	lastUsedOn: z.string().nullable(),
});
export type Exercise = z.infer<typeof ExerciseSchema>;

export const SetSchema = z.object({
	round: z.number().int(),
	reps: z.number().nullable(),
	weightKg: z.number().nullable(),
	durationSeconds: z.number().nullable(),
	distanceMeters: z.number().nullable(),
	warmup: z.boolean(),
});
export type WorkoutSet = z.infer<typeof SetSchema>;

/** Who wrote something; null once their account is deleted. */
export const AuthorSchema = z.object({
	id: z.string(),
	name: z.string(),
});
export type Author = z.infer<typeof AuthorSchema>;

export const CommentSchema = z.object({
	id: z.string(),
	blockExerciseId: z.string(),
	author: AuthorSchema.nullable(),
	text: z.string(),
	createdAt: z.string(),
	updatedAt: z.string(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const PerformanceSchema = z.object({
	blockExerciseId: z.string(),
	workoutId: z.string(),
	workoutName: z.string(),
	performedOn: z.string(),
	blockKind: BlockKindSchema,
	mode: ModeSchema,
	equipment: EquipmentSchema,
	grip: GripSchema.nullable(),
	comments: z.array(CommentSchema),
	sets: z.array(SetSchema),
});
export type Performance = z.infer<typeof PerformanceSchema>;

export const BlockSchema = z.object({
	id: z.string(),
	position: z.number(),
	kind: BlockKindSchema,
	templateBlockId: z.string().nullable(),
	restSeconds: z.number().nullable(),
	exercises: z.array(
		z.object({
			id: z.string(),
			exercise: ExerciseSummarySchema,
			mode: ModeSchema,
			equipment: EquipmentSchema,
			grip: GripSchema.nullable(),
			comments: z.array(CommentSchema),
			sets: z.array(SetSchema),
		}),
	),
});
export type Block = z.infer<typeof BlockSchema>;

export const WorkoutSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	templateId: z.string().nullable(),
	performedOn: z.string(),
	durationMinutes: z.number().nullable(),
	blockCount: z.number(),
});
export type WorkoutSummary = z.infer<typeof WorkoutSummarySchema>;

export const WorkoutSchema = z.object({
	id: z.string(),
	name: z.string(),
	templateId: z.string().nullable(),
	note: z.string().nullable(),
	performedOn: z.string(),
	durationMinutes: z.number().nullable(),
	blocks: z.array(BlockSchema),
});
export type Workout = z.infer<typeof WorkoutSchema>;

export const TemplateBlockSchema = z.object({
	id: z.string(),
	position: z.number(),
	kind: BlockKindSchema,
	rounds: z.number().nullable(),
	restSeconds: z.number().nullable(),
	exercises: z.array(
		z.object({
			id: z.string(),
			exercise: ExerciseSummarySchema,
			mode: ModeSchema,
			equipment: EquipmentSchema,
			grip: GripSchema.nullable(),
			target: z.string().nullable(),
			note: z.string().nullable(),
		}),
	),
});
export type TemplateBlock = z.infer<typeof TemplateBlockSchema>;

export const TemplateSummarySchema = z.object({
	id: z.string(),
	name: z.string(),
	blockCount: z.number(),
	updatedAt: z.string(),
});
export type TemplateSummary = z.infer<typeof TemplateSummarySchema>;

export const TemplateSchema = z.object({
	id: z.string(),
	name: z.string(),
	note: z.string().nullable(),
	updatedAt: z.string(),
	blocks: z.array(TemplateBlockSchema),
});
export type Template = z.infer<typeof TemplateSchema>;

/** A coach seen by their athlete, or an athlete seen by their coach. */
export const LinkedAccountSchema = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string(),
	linkedAt: z.string(),
});
export type LinkedAccount = z.infer<typeof LinkedAccountSchema>;

export const PlannedSessionSummarySchema = z.object({
	id: z.string(),
	athleteId: z.string(),
	author: AuthorSchema.nullable(),
	plannedOn: z.string(),
	name: z.string(),
	blockCount: z.number(),
	workoutCount: z.number(),
	updatedAt: z.string(),
});
export type PlannedSessionSummary = z.infer<typeof PlannedSessionSummarySchema>;

export const PlannedSessionSchema = z.object({
	id: z.string(),
	athleteId: z.string(),
	author: AuthorSchema.nullable(),
	plannedOn: z.string(),
	name: z.string(),
	note: z.string().nullable(),
	updatedAt: z.string(),
	blocks: z.array(TemplateBlockSchema),
});
export type PlannedSession = z.infer<typeof PlannedSessionSchema>;

export const WorkoutShareSchema = z.object({
	coachId: z.string(),
	sharedAt: z.string(),
});

export interface SetInput {
	round: number;
	reps?: number | null;
	weightKg?: number | null;
	durationSeconds?: number | null;
	distanceMeters?: number | null;
	warmup: boolean;
}

export interface BlockExerciseInput {
	/** One of the block's exercises, to keep its identity and its comments. */
	id?: string;
	exerciseId: string;
	mode: Mode;
	equipment: Equipment;
	grip: Grip | null;
	sets: SetInput[];
}

export interface BlockInput {
	templateBlockId?: string;
	restSeconds?: number;
	exercises: BlockExerciseInput[];
}

export interface ExerciseNamesInput {
	fr?: string;
	en?: string;
}

export interface UpdateExerciseInput {
	names: ExerciseNamesInput;
	modes: Mode[];
	defaultMode: Mode;
	load: Load;
	equipment: Equipment[];
	defaultEquipment: Equipment;
	grips: Grip[];
	defaultGrip: Grip | null;
	unilateral: boolean;
}

export interface CreateExerciseInput extends UpdateExerciseInput {
	/** Adds the exercise to the shared catalog; super admins only. */
	builtIn?: boolean;
}

export interface CreateWorkoutInput {
	name: string;
	templateId?: string;
	performedOn: string;
	durationMinutes?: number;
}

export interface UpdateWorkoutInput {
	name: string;
	note: string | null;
	performedOn: string;
	durationMinutes: number | null;
}

export interface TemplateBlockInput {
	id?: string;
	rounds?: number;
	restSeconds?: number;
	exercises: TemplateExerciseInput[];
}

export interface TemplateExerciseInput {
	exerciseId: string;
	mode: Mode;
	equipment: Equipment;
	grip: Grip | null;
	target?: string;
	note?: string;
}

export interface TemplateInput {
	name: string;
	note?: string;
	blocks: TemplateBlockInput[];
}

export interface UpdatePlannedSessionInput extends TemplateInput {
	plannedOn: string;
}

export interface CreatePlannedSessionInput extends UpdatePlannedSessionInput {
	athleteId: string;
}
