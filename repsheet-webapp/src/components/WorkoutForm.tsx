import { type FormEvent, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import { ErrorText } from "@/components/ui";
import { validationMessage } from "@/lib/api/errors";

const WorkoutFormSchema = z.object({
	name: z.string().trim().min(1, "workoutNameRequired").max(100, "nameTooLong"),
	performedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "dateRequired"),
	durationMinutes: z
		.string()
		.trim()
		.transform((text, ctx) => {
			if (text === "") {
				return null;
			}
			const value = Number(text);
			if (!Number.isInteger(value) || value < 1 || value > 1440) {
				ctx.addIssue({
					code: "custom",
					message: "durationRange",
				});
				return z.NEVER;
			}
			return value;
		}),
	note: z
		.string()
		.trim()
		.transform((text) => text || null),
});
export type WorkoutFormValues = z.output<typeof WorkoutFormSchema>;

export interface WorkoutFormInitial {
	name: string;
	performedOn: string;
	durationMinutes: number | null;
	note: string | null;
}

/** A workout's details; a planned session's, `withDuration` off, since it has not happened yet. */
export function WorkoutForm({
	title,
	initial,
	withNote,
	withDuration = true,
	submitLabel,
	pending,
	error,
	onSubmit,
	onCancel,
}: {
	title: string;
	initial: WorkoutFormInitial;
	withNote: boolean;
	withDuration?: boolean;
	submitLabel: string;
	pending: boolean;
	error: string | null;
	onSubmit: (values: WorkoutFormValues) => void;
	onCancel: () => void;
}) {
	const { t } = useTranslation();
	const id = useId();
	const [name, setName] = useState(initial.name);
	const [performedOn, setPerformedOn] = useState(initial.performedOn);
	const [duration, setDuration] = useState(
		initial.durationMinutes === null ? "" : String(initial.durationMinutes),
	);
	const [note, setNote] = useState(initial.note ?? "");
	const [invalid, setInvalid] = useState<string | null>(null);

	function submit(event: FormEvent) {
		event.preventDefault();
		const parsed = WorkoutFormSchema.safeParse({
			name,
			performedOn,
			durationMinutes: duration,
			note,
		});
		if (!parsed.success) {
			setInvalid(validationMessage(parsed.error));
			return;
		}
		setInvalid(null);
		onSubmit(parsed.data);
	}

	const message = invalid ?? error;
	return (
		<form className="stack" onSubmit={submit} aria-label={title} noValidate>
			<div>
				<label className="label" htmlFor={`${id}-name`}>
					{t("workoutForm.name")}
				</label>
				<input
					id={`${id}-name`}
					className="input"
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
			</div>
			<div className="row form-pair">
				<div className="grow">
					<label className="label" htmlFor={`${id}-date`}>
						{t("workoutForm.date")}
					</label>
					<input
						id={`${id}-date`}
						className="input"
						type="date"
						value={performedOn}
						onChange={(e) => setPerformedOn(e.target.value)}
					/>
				</div>
				{withDuration ? (
					<div className="grow">
						<label className="label" htmlFor={`${id}-duration`}>
							{t("workoutForm.duration")}
						</label>
						<input
							id={`${id}-duration`}
							className="input"
							inputMode="numeric"
							placeholder="55"
							value={duration}
							onChange={(e) => setDuration(e.target.value)}
						/>
					</div>
				) : null}
			</div>
			{withNote ? (
				<div>
					<label className="label" htmlFor={`${id}-note`}>
						{t("workoutForm.note")}
					</label>
					<textarea
						id={`${id}-note`}
						className="input textarea"
						placeholder={t("workoutForm.notePlaceholder")}
						value={note}
						onChange={(e) => setNote(e.target.value)}
					/>
				</div>
			) : null}
			{message ? <ErrorText>{message}</ErrorText> : null}
			<div className="row">
				<button type="button" className="btn" onClick={onCancel}>
					{t("common.cancel")}
				</button>
				<button
					type="submit"
					className="btn btn-primary grow"
					disabled={pending}
				>
					{submitLabel}
				</button>
			</div>
		</form>
	);
}
