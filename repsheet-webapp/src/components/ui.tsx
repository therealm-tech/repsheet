import { type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { BlockKind, ExerciseSummary, Role } from "@/lib/api/schemas";
import { equipmentLabel, gripLabel, kindLabel } from "@/lib/blocks";
import { type ChoiceChange, type Choices, hasChoice } from "@/lib/choices";

export function KindTag({ kind, auto }: { kind: BlockKind; auto?: boolean }) {
	const { t } = useTranslation();
	return (
		<span className={kind === "simple" ? "tag" : "tag tag-orange"}>
			{kindLabel(kind)}
			{auto ? ` · ${t("kinds.auto")}` : ""}
		</span>
	);
}

export function Segmented<T extends string>({
	options,
	value,
	onChange,
	label,
}: {
	options: { value: T; label: string }[];
	value: T;
	onChange: (value: T) => void;
	label: string;
}) {
	const name = useId();
	return (
		<fieldset className="segmented">
			<legend className="sr-only">{label}</legend>
			{options.map((option) => (
				<label
					key={option.value}
					className={option.value === value ? "on" : undefined}
				>
					<input
						className="sr-only"
						type="radio"
						name={name}
						value={option.value}
						checked={option.value === value}
						onChange={() => onChange(option.value)}
					/>
					{option.label}
				</label>
			))}
		</fieldset>
	);
}

/**
 * A compact "Reps | Time" switch between the values an exercise offers for
 * one choice. No value is on while the current one is unknown.
 */
export function ChoiceSwitch<T extends string>({
	options,
	value,
	label,
	optionLabel,
	onChange,
}: {
	options: readonly T[];
	value: T | null;
	label: string;
	optionLabel: (option: T) => string;
	onChange: (option: T) => void;
}) {
	return (
		<fieldset className="mini-seg">
			<legend className="sr-only">{label}</legend>
			{options.map((option) => (
				<button
					key={option}
					type="button"
					className={option === value ? "on" : undefined}
					aria-pressed={option === value}
					onClick={() => {
						if (option !== value) {
							onChange(option);
						}
					}}
				>
					{optionLabel(option)}
				</button>
			))}
		</fieldset>
	);
}

/**
 * The switches of the choices an exercise leaves open to a block or a
 * template: its mode, its equipment and its grip.
 */
export function ChoiceSwitches({
	exercise,
	chosen,
	onChange,
}: {
	exercise: ExerciseSummary;
	chosen: Choices;
	onChange: (change: ChoiceChange) => void;
}) {
	const { t } = useTranslation();
	const name = exercise.name;
	return (
		<>
			{hasChoice(exercise.modes, chosen.mode) ? (
				<ChoiceSwitch
					options={exercise.modes}
					value={chosen.mode}
					label={t("block.modeOf", { name })}
					optionLabel={(mode) => t(`modesShort.${mode}`)}
					onChange={(mode) => onChange({ mode })}
				/>
			) : null}
			{hasChoice(exercise.equipment, chosen.equipment) ? (
				<ChoiceSwitch
					options={exercise.equipment}
					value={chosen.equipment}
					label={t("block.equipmentOf", { name })}
					optionLabel={equipmentLabel}
					onChange={(equipment) => onChange({ equipment })}
				/>
			) : null}
			{hasChoice(exercise.grips, chosen.grip) ? (
				<ChoiceSwitch
					options={exercise.grips}
					value={chosen.grip}
					label={t("block.gripOf", { name })}
					optionLabel={gripLabel}
					onChange={(grip) => onChange({ grip })}
				/>
			) : null}
		</>
	);
}

export function Sheet({
	title,
	onClose,
	children,
}: {
	title: string;
	onClose: () => void;
	children: ReactNode;
}) {
	const { t } = useTranslation();
	const panel = useRef<HTMLElement>(null);
	const latestClose = useRef(onClose);
	useEffect(() => {
		latestClose.current = onClose;
	}, [onClose]);

	useEffect(() => {
		const previous = document.activeElement;
		panel.current?.focus();
		function onKeyDown(event: KeyboardEvent) {
			if (event.key === "Escape") {
				event.preventDefault();
				latestClose.current();
			}
		}
		document.addEventListener("keydown", onKeyDown);
		return () => {
			document.removeEventListener("keydown", onKeyDown);
			if (previous instanceof HTMLElement) {
				previous.focus();
			}
		};
	}, []);

	return (
		<div className="sheet-layer">
			<button
				type="button"
				className="sheet-dim"
				aria-label={t("common.close")}
				tabIndex={-1}
				onClick={onClose}
			/>
			<section
				ref={panel}
				className="sheet"
				role="dialog"
				aria-modal="true"
				aria-label={title}
				tabIndex={-1}
			>
				<div className="sheet-grab" />
				{children}
			</section>
		</div>
	);
}

export function ConfirmButton({
	label,
	confirmLabel,
	message,
	onConfirm,
	disabled,
}: {
	label: string;
	confirmLabel: string;
	message?: string;
	onConfirm: () => void;
	disabled?: boolean;
}) {
	return (
		<details className="confirm">
			<summary className="btn btn-danger-ghost">{label}</summary>
			{message ? <p className="confirm-message">{message}</p> : null}
			<button
				type="button"
				className="btn btn-danger"
				onClick={onConfirm}
				disabled={disabled}
			>
				{confirmLabel}
			</button>
		</details>
	);
}

export function RoleTag({ value }: { value: Role }) {
	const { t } = useTranslation();
	return value === "superAdmin" ? (
		<span className="tag tag-orange">{t("roles.superAdmin")}</span>
	) : (
		<span className="tag">{t("roles.user")}</span>
	);
}

export function ErrorText({ children }: { children: ReactNode }) {
	return (
		<p className="error-text" role="alert">
			{children}
		</p>
	);
}

export function Empty({ children }: { children: ReactNode }) {
	return <p className="empty">{children}</p>;
}
