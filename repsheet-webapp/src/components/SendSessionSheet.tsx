import { useTranslation } from "react-i18next";
import { TitledSheet } from "@/components/AthleteProfile";
import { plannedSummary } from "@/components/BlockCard";
import { ShareActions } from "@/components/ShareActions";
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
	const text = sessionMessage(session, unit, coachName);
	return (
		<TitledSheet
			title={t("plannedSession.sendTo", { name: athleteName })}
			onClose={onClose}
		>
			<pre className="share-message">{text}</pre>
			<ShareActions text={text} />
		</TitledSheet>
	);
}
