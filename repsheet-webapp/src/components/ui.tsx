import { type ReactNode, useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import type { BlockKind, Mode, Role } from "@/lib/api/schemas";
import { kindLabel } from "@/lib/blocks";

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

/** A compact "Reps | Time" switch between the modes of an exercise. */
export function ModeSwitch({
	modes,
	value,
	label,
	onChange,
}: {
	modes: Mode[];
	value: Mode;
	label: string;
	onChange: (mode: Mode) => void;
}) {
	const { t } = useTranslation();
	return (
		<fieldset className="mini-seg">
			<legend className="sr-only">{label}</legend>
			{modes.map((mode) => (
				<button
					key={mode}
					type="button"
					className={mode === value ? "on" : undefined}
					aria-pressed={mode === value}
					onClick={() => {
						if (mode !== value) {
							onChange(mode);
						}
					}}
				>
					{t(`modesShort.${mode}`)}
				</button>
			))}
		</fieldset>
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
