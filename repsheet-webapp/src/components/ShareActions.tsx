import { useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorText } from "@/components/ui";

/**
 * "Share…" through the phone's share sheet, falling back to the clipboard
 * where the Web Share API is missing, and "Copy".
 */
export function ShareActions({ text }: { text: string }) {
	const { t } = useTranslation();
	const [copied, setCopied] = useState(false);
	const [failed, setFailed] = useState(false);

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
		<>
			<div className="row share-actions">
				<button
					type="button"
					className="btn btn-primary grow"
					onClick={() => void share()}
				>
					{t("sending.share")}
				</button>
				<button type="button" className="btn grow" onClick={() => void copy()}>
					{copied ? t("sending.copied") : t("sending.copy")}
				</button>
			</div>
			{failed ? <ErrorText>{t("sending.failed")}</ErrorText> : null}
			<p className="muted small">{t("sending.hint")}</p>
		</>
	);
}
