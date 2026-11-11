import { useState } from "react";
import { useTranslation } from "react-i18next";
import { TitledSheet } from "@/components/AthleteProfile";
import { plannedSummary } from "@/components/BlockCard";
import { ErrorText } from "@/components/ui";
import i18n from "@/i18n";
import type { PlannedSession, WeightUnit } from "@/lib/api/schemas";
import { kindLabel, letter, unusualChoices } from "@/lib/blocks";
import { formatDay } from "@/lib/dates";

/**
 * A planned session as a plain-text message, for an athlete who has no
 * account: its blocks, their sets and the coach's notes, signed by the coach.
 */
export function sessionMessage(
	session: PlannedSession,
	unit: WeightUnit,
	coachName: string,
): string {
	const lines = [`${session.name} · ${formatDay(session.plannedOn)}`];
	if (session.note) {
		lines.push("", session.note);
	}
	lines.push("");
	session.blocks.forEach((block, i) => {
		const single = block.exercises.length === 1;
		if (!single) {
			lines.push(`${i + 1}. ${kindLabel(block.kind)}`);
		}
		block.exercises.forEach((entry, j) => {
			const unusual = unusualChoices(entry.exercise, entry);
			const name = unusual
				? `${entry.exercise.name} (${unusual})`
				: entry.exercise.name;
			const summary = plannedSummary(block, j, unit);
			const head = single ? `${i + 1}. ` : `   ${letter(j)}. `;
			lines.push(`${head}${name}${summary ? ` — ${summary}` : ""}`);
			if (entry.note) {
				lines.push(`${single ? "   " : "      "}« ${entry.note} »`);
			}
		});
	});
	lines.push("", i18n.t("plannedSession.messageOutro"), `— ${coachName}`);
	return lines.join("\n");
}

/** Sends a planned session as text, through the phone's share sheet or the clipboard. */
export function SendSessionSheet({
	session,
	athleteName,
	coachName,
	unit,
	onClose,
}: {
	session: PlannedSession;
	athleteName: string;
	coachName: string;
	unit: WeightUnit;
	onClose: () => void;
}) {
	const { t } = useTranslation();
	const [copied, setCopied] = useState(false);
	const [failed, setFailed] = useState(false);
	const text = sessionMessage(session, unit, coachName);
	const title = t("plannedSession.sendTo", { name: athleteName });

	async function copy() {
		setFailed(false);
		try {
			await navigator.clipboard.writeText(text);
			setCopied(true);
		} catch {
			setFailed(true);
		}
	}

	async function share() {
		if (typeof navigator.share !== "function") {
			await copy();
			return;
		}
		try {
			await navigator.share({ text });
		} catch (error) {
			if (!(error instanceof DOMException && error.name === "AbortError")) {
				await copy();
			}
		}
	}

	return (
		<TitledSheet title={title} onClose={onClose}>
			<pre className="share-message">{text}</pre>
			<div className="row share-actions">
				<button
					type="button"
					className="btn btn-primary grow"
					onClick={() => void share()}
				>
					{t("plannedSession.share")}
				</button>
				<button type="button" className="btn grow" onClick={() => void copy()}>
					{copied ? t("plannedSession.copied") : t("plannedSession.copy")}
				</button>
			</div>
			{failed ? <ErrorText>{t("plannedSession.shareFailed")}</ErrorText> : null}
			<p className="muted small">{t("plannedSession.shareHint")}</p>
		</TitledSheet>
	);
}
