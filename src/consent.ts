import { captureSpokenAnswer, type CaptureMode } from "./listen";
import { speakToParticipant } from "./speak";
import { transcribeSpokenAnswer } from "./transcribe";

export const CONSENT_SCRIPT_VERSION = "2026-09-09.1";
export const RETENTION_DAYS = 30;

export interface ConsentRecord {
  participant: string;
  consented: boolean;
  asked_at: string;
  script_version: string;
  retention_days: number;
  purpose: string;
  withdrawal: string;
  answer_transcript: string;
}

export const CONSENT_PURPOSE =
  "to check whether the song's message landed; the recording is scored, summarized for the company, and never used to clone a voice";

export const CONSENT_WITHDRAWAL =
  "say 'stop' at any point, or tell the company to delete the recording; the check-in ends and nothing is kept";

/** The exact words every employee hears before anything is recorded. */
export function consentScript(songTitle: string): string {
  return (
    `Hi, this is the quick check-in about "${songTitle}". ` +
    `I'll ask two short questions and record your answers, about a minute total. ` +
    `The recording is used only to see whether the song's message landed. ` +
    `It is kept for ${RETENTION_DAYS} days, then deleted, and it is never used to clone your voice. ` +
    `You can stop at any time by saying stop, and nothing is kept. ` +
    `Is it okay to record? Please say yes or no.`
  );
}

/**
 * Records explicit consent before any voice is captured or reused (OR-7).
 *
 * The participant hears what is recorded, what it is for, how long it is kept, and
 * how to withdraw, then answers out loud. The answer is transcribed and the decision
 * is stored with the script version and the retention window, so the company can
 * show exactly what each person was told. A "no" ends the check-in with nothing kept.
 */
export async function recordSpokenConsent(options: {
  participant: string;
  songTitle: string;
  mode: CaptureMode;
  wavPath: string;
}): Promise<ConsentRecord> {
  const askedAt = new Date().toISOString();
  await speakToParticipant(consentScript(options.songTitle));
  const captured = await captureSpokenAnswer({ mode: options.mode, wavPath: options.wavPath, maxSeconds: 8 });
  const transcript = captured.kind === "typed" ? captured.text : await transcribeSpokenAnswer(captured.wavPath);
  return {
    participant: options.participant,
    consented: interpretConsentAnswer(transcript),
    asked_at: askedAt,
    script_version: CONSENT_SCRIPT_VERSION,
    retention_days: RETENTION_DAYS,
    purpose: CONSENT_PURPOSE,
    withdrawal: CONSENT_WITHDRAWAL,
    answer_transcript: transcript,
  };
}

/** A spoken yes counts only when no refusal appears anywhere in the answer. */
export function interpretConsentAnswer(transcript: string): boolean {
  const text = transcript.toLowerCase();
  const refused = /\b(no|nope|don't|do not|stop|not okay|not ok)\b/.test(text);
  const agreed = /\b(yes|yeah|yep|yup|sure|okay|ok|fine|go ahead|of course)\b/.test(text);
  return agreed && !refused;
}

/** The participant can withdraw mid-check-in by saying stop (OR-7). */
export function isWithdrawal(transcript: string): boolean {
  return /\b(stop|delete (this|that|it)|i withdraw)\b/.test(transcript.toLowerCase());
}
