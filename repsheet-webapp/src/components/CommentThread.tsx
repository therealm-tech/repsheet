import { useMutation, useQueryClient } from "@tanstack/react-query";
import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { ErrorText } from "@/components/ui";
import { api, keys } from "@/lib/api/endpoints";
import { errorMessage } from "@/lib/api/errors";
import type { Author, Comment } from "@/lib/api/schemas";
import { formatShortInstant } from "@/lib/dates";
import { useMe } from "@/lib/hooks";

export const COMMENT_MAX_LENGTH = 2000;

/** The exercise a thread is about, named in a block of several exercises. */
export interface ThreadSubject {
	name: string;
	/** The exercise's letter in its block; the heading is shown only with it. */
	letter?: string;
}

/** Text being written, held by a parent that posts what is left unsent. */
export interface CommentDraft {
	value: string;
	onChange: (value: string) => void;
}

/** Where comments can be written: the workout to refresh and the exercise to post on. */
export interface ThreadTarget {
	workoutId: string;
	blockExerciseId: string;
	/** "open" shows the composer, "collapsed" a button that opens it. */
	composer: "open" | "collapsed";
	/** The composer's text; it keeps its own when omitted. */
	draft?: CommentDraft;
}

/** Refreshes everything that shows the workout's threads. */
function useRefreshThreads(workoutId: string) {
	const queryClient = useQueryClient();
	return () => {
		void queryClient.invalidateQueries({ queryKey: keys.workout(workoutId) });
		void queryClient.invalidateQueries({ queryKey: ["performances"] });
		void queryClient.invalidateQueries({
			queryKey: ["plannedSessionWorkouts"],
		});
	};
}

function CommentItem({
	comment,
	ownerId,
	workoutId,
}: {
	comment: Comment;
	ownerId: string;
	/** Set where the viewer may edit or delete. */
	workoutId?: string;
}) {
	const { t } = useTranslation();
	const meId = useMe().data?.id;
	const [editing, setEditing] = useState<string | null>(null);
	const [confirming, setConfirming] = useState(false);
	const refresh = useRefreshThreads(workoutId ?? "");
	const update = useMutation({
		mutationFn: (text: string) => api.updateComment(comment.id, text),
		onSuccess: () => {
			setEditing(null);
			refresh();
		},
	});
	const remove = useMutation({
		mutationFn: () => api.deleteComment(comment.id),
		onSuccess: refresh,
	});

	const author = comment.author;
	const mine = author !== null && author.id === meId;
	const name = author === null ? null : mine ? t("comments.me") : author.name;
	const byOwner = author?.id === ownerId;
	const canEdit = workoutId !== undefined && mine;
	const canDelete = workoutId !== undefined && (mine || meId === ownerId);
	const who = [
		name === null ? null : <b key="name">{name}</b>,
		author !== null && !byOwner ? t("comments.coach") : null,
		formatShortInstant(comment.createdAt),
		comment.updatedAt === comment.createdAt ? null : t("comments.edited"),
	].filter((part) => part !== null);

	function save(event: FormEvent) {
		event.preventDefault();
		const text = editing?.trim();
		if (text) {
			update.mutate(text);
		}
	}

	return (
		<span className="comment">
			<span
				className={
					author === null
						? "avatar"
						: byOwner
							? "avatar avatar-owner"
							: "avatar avatar-coach"
				}
				aria-hidden="true"
			>
				{name?.charAt(0).toUpperCase()}
			</span>
			<span className="comment-body">
				<span className="comment-who">
					{who.flatMap((part, i) => (i === 0 ? [part] : [" · ", part]))}
					{canEdit && editing === null ? (
						<>
							{" · "}
							<button
								type="button"
								className="comment-action"
								onClick={() => setEditing(comment.text)}
							>
								{t("comments.edit")}
							</button>
						</>
					) : null}
					{canDelete && editing === null ? (
						<>
							{" · "}
							<button
								type="button"
								className={
									confirming ? "comment-action danger" : "comment-action"
								}
								disabled={remove.isPending}
								onClick={() =>
									confirming ? remove.mutate() : setConfirming(true)
								}
							>
								{confirming
									? t("comments.confirmDelete")
									: t("comments.delete")}
							</button>
						</>
					) : null}
				</span>
				{editing === null ? (
					<span className="comment-text">{comment.text}</span>
				) : (
					<form className="compose" onSubmit={save}>
						<textarea
							className="input compose-input"
							rows={2}
							maxLength={COMMENT_MAX_LENGTH}
							aria-label={t("comments.editOf")}
							value={editing}
							onChange={(e) => setEditing(e.target.value)}
						/>
						<span className="compose-actions">
							<button
								type="button"
								className="link-button muted"
								onClick={() => setEditing(null)}
							>
								{t("common.cancel")}
							</button>
							<button
								type="submit"
								className="link-button"
								disabled={!editing.trim() || update.isPending}
							>
								{t("common.save")}
							</button>
						</span>
					</form>
				)}
				{update.isError || remove.isError ? (
					<ErrorText>
						{errorMessage(update.error ?? remove.error, {
							fallback: "commentFailed",
						})}
					</ErrorText>
				) : null}
			</span>
		</span>
	);
}

function CommentBox({
	subject,
	draft,
	hasComments,
	autoFocus = false,
}: {
	subject: ThreadSubject;
	draft: CommentDraft;
	hasComments: boolean;
	autoFocus?: boolean;
}) {
	const { t } = useTranslation();
	return (
		<textarea
			className="input compose-input"
			rows={1}
			maxLength={COMMENT_MAX_LENGTH}
			aria-label={t("comments.addOn", { name: subject.name })}
			placeholder={
				hasComments ? t("comments.reply") : t("comments.placeholder")
			}
			// biome-ignore lint/a11y/noAutofocus: opened on purpose by tapping "Comment"
			autoFocus={autoFocus}
			value={draft.value}
			onChange={(e) => draft.onChange(e.target.value)}
		/>
	);
}

/** A textarea with its send button, posting to `target` when sent. */
function Composer({
	subject,
	target,
	autoFocus,
	hasComments,
}: {
	subject: ThreadSubject;
	target: ThreadTarget;
	autoFocus: boolean;
	hasComments: boolean;
}) {
	const { t } = useTranslation();
	const [own, setOwn] = useState("");
	const draft = target.draft ?? { value: own, onChange: setOwn };
	const refresh = useRefreshThreads(target.workoutId);
	const create = useMutation({
		mutationFn: (value: string) =>
			api.createComment({
				blockExerciseId: target.blockExerciseId,
				text: value,
			}),
		onSuccess: () => {
			draft.onChange("");
			refresh();
		},
	});

	function send(event: FormEvent) {
		event.preventDefault();
		const value = draft.value.trim();
		if (value) {
			create.mutate(value);
		}
	}

	return (
		<form className="compose" onSubmit={send}>
			<span className="compose-row">
				<CommentBox
					subject={subject}
					draft={draft}
					hasComments={hasComments}
					autoFocus={autoFocus}
				/>
				<button
					type="submit"
					className="send-button"
					aria-label={t("comments.send")}
					disabled={!draft.value.trim() || create.isPending}
				>
					<svg
						width="18"
						height="18"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						strokeWidth="2.2"
						strokeLinecap="round"
						strokeLinejoin="round"
						aria-hidden="true"
					>
						<path d="M5 12h14M13 6l6 6-6 6" />
					</svg>
				</button>
			</span>
			{create.isError ? (
				<ErrorText>
					{errorMessage(create.error, { fallback: "commentFailed" })}
				</ErrorText>
			) : null}
		</form>
	);
}

function ThreadHead({ subject }: { subject: ThreadSubject }) {
	return subject.letter ? (
		<span className="thread-head">
			<span className="ex-letter">{subject.letter}</span>
			{subject.name}
		</span>
	) : null;
}

/**
 * The first comment on an exercise not saved yet: written now, posted once the
 * block it belongs to is. `coachNote` is the note the coach planned for it,
 * which starts the thread once the block is saved.
 */
export function FirstCommentDraft({
	subject,
	draft,
	coachNote,
}: {
	subject: ThreadSubject;
	draft: CommentDraft;
	coachNote?: { author: Author; text: string };
}) {
	const { t } = useTranslation();
	return (
		<span className="thread">
			<ThreadHead subject={subject} />
			{coachNote ? (
				<span className="comment">
					<span className="avatar avatar-coach" aria-hidden="true">
						{coachNote.author.name.charAt(0).toUpperCase()}
					</span>
					<span className="comment-body">
						<span className="comment-who">
							<b>{coachNote.author.name}</b> · {t("comments.coach")}
						</span>
						<span className="comment-text">{coachNote.text}</span>
					</span>
				</span>
			) : null}
			<CommentBox
				subject={subject}
				draft={draft}
				hasComments={coachNote !== undefined}
			/>
		</span>
	);
}

/**
 * The comments on one exercise of a logged block, oldest first. The workout's
 * owner is told apart from their coaches. Without `target` it is read-only and
 * renders nothing when empty.
 */
export function CommentThread({
	comments,
	ownerId,
	subject,
	target,
}: {
	comments: Comment[];
	ownerId: string;
	subject: ThreadSubject;
	target?: ThreadTarget;
}) {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	if (!target && comments.length === 0) {
		return null;
	}
	const showComposer = target?.composer === "open" || open;
	const opener = (
		<button
			type="button"
			className="link-button"
			aria-label={t("comments.addOn", { name: subject.name })}
			onClick={() => setOpen(true)}
		>
			{t("comments.add")}
		</button>
	);
	if (target && !showComposer && comments.length === 0) {
		return opener;
	}
	return (
		<span className="thread">
			<ThreadHead subject={subject} />
			{comments.map((comment) => (
				<CommentItem
					key={comment.id}
					comment={comment}
					ownerId={ownerId}
					{...(target ? { workoutId: target.workoutId } : {})}
				/>
			))}
			{target && showComposer ? (
				<Composer
					subject={subject}
					target={target}
					autoFocus={open}
					hasComments={comments.length > 0}
				/>
			) : null}
			{target && !showComposer ? opener : null}
		</span>
	);
}
