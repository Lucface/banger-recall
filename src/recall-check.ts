import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { loadSongBrief } from "./brief";
import { isWithdrawal, recordSpokenConsent } from "./consent";
import { estimateSessionCost } from "./cost";
import { logOutcomeEvent } from "./events";
import { captureSpokenAnswer, type CaptureMode } from "./listen";
import { SCORING_MODEL, scoreRecallAgainstBrief, type ScoredAnswer, type TokenUsage } from "./score-recall";
import { RecallSessionSchema, type AnswerRecord, type RecallSession } from "./session";
import { speakToParticipant } from "./speak";
import { transcribeSpokenAnswer } from "./transcribe";

export const DEFAULT_BRIEF = "fixtures/brief.cobalt-expense-policy.json";

interface CliArgs {
  participant: string;
  briefPath: string;
  mode: CaptureMode;
  replay: string | null;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { participant: "", briefPath: DEFAULT_BRIEF, mode: "mic", replay: null };
  for (let i = 0; i < argv.length; i += 1) {
    const flag = argv[i];
    const value = argv[i + 1];
    if (flag === "--participant" && value) {
      args.participant = value;
      i += 1;
    } else if (flag === "--brief" && value) {
      args.briefPath = value;
      i += 1;
    } else if (flag === "--typed") {
      args.mode = "typed";
    } else if (flag === "--replay" && value) {
      args.replay = value;
      i += 1;
    }
  }
  if (!args.participant && !args.replay) {
    console.error("usage: bun run recall --participant <name> [--typed] [--brief <path>]\n       bun run recall --replay <fixture-id>");
    process.exit(2);
  }
  return args;
}

function newSessionId(participant: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  return `${participant.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${stamp}`;
}

/**
 * Runs one complete Banger Recall check-in from spoken input to structured output (MR-4).
 *
 * consent → question 1 → question 2 → score → (one spoken follow-up if vague → re-score)
 * → save the session record → append measurement events → print the cost of the run.
 */
export async function runRecallCheckIn(args: CliArgs): Promise<RecallSession> {
  const brief = loadSongBrief(args.briefPath);
  const sessionId = newSessionId(args.participant);
  const audioDir = `out/audio/${sessionId}`;
  mkdirSync(audioDir, { recursive: true });
  mkdirSync("out/sessions", { recursive: true });
  const startedAt = new Date().toISOString();
  const base = { session_id: sessionId, participant: args.participant, song_title: brief.song_title };
  logOutcomeEvent({ type: "session_started", ...base, data: { mode: args.mode } });

  const consent = await recordSpokenConsent({
    participant: args.participant,
    songTitle: brief.song_title,
    mode: args.mode,
    wavPath: `${audioDir}/consent.wav`,
  });
  logOutcomeEvent({ type: consent.consented ? "consent_given" : "consent_declined", ...base });

  const answers: AnswerRecord[] = [];
  const usages: TokenUsage[] = [];
  let recall: RecallSession["recall"] = null;

  if (!consent.consented) {
    await speakToParticipant("No problem, nothing was kept. Thanks for your time.");
  } else {
    for (const [index, question] of brief.check_in_questions.entries()) {
      const answer = await askAndCapture(question, `${audioDir}/q${index + 1}.wav`, args.mode, base, false);
      answers.push(answer);
      if (isWithdrawal(answer.transcript)) {
        await speakToParticipant("Understood, stopping now. Nothing from this check-in is kept.");
        logOutcomeEvent({ type: "consent_declined", ...base, data: { withdrawn_mid_session: true } });
        consent.consented = false;
        break;
      }
    }

    if (consent.consented) {
      const scored = await scoreRecallAgainstBrief(brief, answers.map(toScoredAnswer));
      usages.push(scored.usage);
      recall = scored.score;
      logOutcomeEvent({ type: "recall_scored", ...base, data: { overall_score: recall.overall_score, vague: recall.answer_is_vague } });

      // One spoken follow-up when the answer was vague, then score again with everything said (OR-3).
      if (recall.answer_is_vague && recall.follow_up_question) {
        logOutcomeEvent({ type: "follow_up_asked", ...base, data: { question: recall.follow_up_question } });
        const followUp = await askAndCapture(recall.follow_up_question, `${audioDir}/follow-up.wav`, args.mode, base, true);
        answers.push(followUp);
        const rescored = await scoreRecallAgainstBrief(brief, answers.map(toScoredAnswer));
        usages.push(rescored.usage);
        recall = rescored.score;
        logOutcomeEvent({ type: "recall_scored", ...base, data: { overall_score: recall.overall_score, after_follow_up: true } });
      }
      await speakToParticipant("That's everything. Thanks, and enjoy the song.");
    }
  }

  const cost = estimateSessionCost(usages);
  const session: RecallSession = RecallSessionSchema.parse({
    session_id: sessionId,
    mode: "live",
    participant: args.participant,
    client: brief.client,
    song_title: brief.song_title,
    brief_messages: brief.required_messages,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    consent,
    answers,
    recall,
    cost_usd: cost.usd,
    tokens: { input: cost.input_tokens, output: cost.output_tokens },
    scoring_model: SCORING_MODEL,
  });
  const path = `out/sessions/${sessionId}.json`;
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`);
  logOutcomeEvent({ type: "session_completed", ...base, data: { cost_usd: cost.usd, consented: consent.consented } });
  printSessionSummary(session, path);
  return session;
}

async function askAndCapture(
  question: string,
  wavPath: string,
  mode: CaptureMode,
  base: { session_id: string; participant: string; song_title: string },
  isFollowUp: boolean,
): Promise<AnswerRecord> {
  await speakToParticipant(question);
  logOutcomeEvent({ type: "question_asked", ...base, data: { question, follow_up: isFollowUp } });
  const captured = await captureSpokenAnswer({ mode, wavPath });
  logOutcomeEvent({ type: "answer_captured", ...base, data: { kind: captured.kind } });
  if (captured.kind === "typed") {
    return { question, transcript: captured.text, input_kind: "typed", audio_path: null, is_follow_up: isFollowUp };
  }
  const transcript = await transcribeSpokenAnswer(captured.wavPath);
  console.log(`📝 heard: "${transcript}"`);
  logOutcomeEvent({ type: "answer_transcribed", ...base, data: { chars: transcript.length } });
  return { question, transcript, input_kind: "spoken", audio_path: captured.wavPath, is_follow_up: isFollowUp };
}

function toScoredAnswer(answer: AnswerRecord): ScoredAnswer {
  return { question: answer.question, transcript: answer.transcript };
}

function printSessionSummary(session: RecallSession, path: string): void {
  console.log("\n══════════ recall check-in result ══════════");
  console.log(`${session.participant} · "${session.song_title}" · consent: ${session.consent.consented ? "yes" : "no"}`);
  if (session.recall) {
    for (const m of session.recall.per_message) {
      const label = session.brief_messages.find((b) => b.id === m.message_id)?.message ?? m.message_id;
      console.log(`  ${statusIcon(m.status)} ${m.message_id} ${m.status.padEnd(11)} ${label}`);
      if (m.evidence_quote) console.log(`       "${m.evidence_quote}"`);
    }
    console.log(`  overall recall score: ${session.recall.overall_score}/100`);
    console.log(`  what they'd actually do: ${session.recall.what_they_would_actually_do}`);
  }
  console.log(`  cost of this check-in: $${session.cost_usd} (${session.tokens.input} in / ${session.tokens.output} out tokens)`);
  console.log(`  saved: ${path}`);
}

function statusIcon(status: string): string {
  if (status === "landed") return "✅";
  if (status === "partial") return "🟡";
  if (status === "misrecalled") return "🔁";
  return "❌";
}

/**
 * Offline demonstration mode (OR-13): replays a pre-baked session from fixtures/sessions,
 * speaking the questions and printing the saved transcript and score, with no API call.
 */
async function replayFixture(fixtureId: string): Promise<void> {
  const path = `fixtures/sessions/${fixtureId}.json`;
  if (!existsSync(path)) {
    console.error(`no fixture at ${path}`);
    process.exit(1);
  }
  const session = RecallSessionSchema.parse(JSON.parse(readFileSync(path, "utf8")));
  console.log(`▶ replaying pre-baked check-in for ${session.participant} (no API calls)`);
  for (const answer of session.answers) {
    await speakToParticipant(answer.question);
    console.log(`📝 ${session.participant} said: "${answer.transcript}"`);
  }
  printSessionSummary(session, path);
}

if (import.meta.main) {
  const args = parseArgs(process.argv.slice(2));
  if (args.replay) {
    await replayFixture(args.replay);
  } else {
    await runRecallCheckIn(args);
  }
}
