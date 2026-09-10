import { appendFileSync, mkdirSync } from "node:fs";

export type RecallEventType =
  | "session_started"
  | "consent_given"
  | "consent_declined"
  | "question_asked"
  | "answer_captured"
  | "answer_transcribed"
  | "follow_up_asked"
  | "recall_scored"
  | "session_completed"
  | "session_failed";

export interface RecallEvent {
  at: string;
  type: RecallEventType;
  session_id: string;
  participant: string;
  song_title: string;
  data?: Record<string, string | number | boolean | null>;
}

export const EVENTS_PATH = "out/events.jsonl";

/**
 * Appends one measurement event per step of the check-in to an append-only log (OR-11).
 *
 * This is the instrumentation behind the business outcome. Recall rate per banger,
 * check-in completion rate, consent decline rate, and cost per session are all
 * computed from these rows. Six months of them is the evidence for a premium price
 * and for the recall report as a paid line item, instead of an assertion that the
 * song worked.
 */
export function logOutcomeEvent(event: Omit<RecallEvent, "at">): void {
  mkdirSync("out", { recursive: true });
  const row: RecallEvent = { at: new Date().toISOString(), ...event };
  appendFileSync(EVENTS_PATH, `${JSON.stringify(row)}\n`);
}
