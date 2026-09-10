import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { loadSongBrief } from "./brief";
import { CONSENT_PURPOSE, CONSENT_SCRIPT_VERSION, CONSENT_WITHDRAWAL, RETENTION_DAYS } from "./consent";
import { estimateSessionCost } from "./cost";
import { DEFAULT_BRIEF } from "./recall-check";
import { SCORING_MODEL, scoreRecallAgainstBrief } from "./score-recall";
import { RecallSessionSchema, type AnswerRecord, type RecallSession } from "./session";
import { transcribeSpokenAnswer } from "./transcribe";

const SyntheticEmployeeSchema = z.object({
  id: z.string(),
  participant: z.string(),
  voice: z.string(),
  answers: z.array(z.string()).min(1),
});

/**
 * Pre-bakes the demo: runs twelve synthetic employees through the real pipeline and
 * saves their session records to fixtures/sessions, so the recall report and the
 * offline replay (OR-13) work with no microphone, no network, and no API key.
 *
 * Each synthetic employee's answer is spoken by a macOS system voice (no real person's
 * voice is ever used), transcribed by local Whisper, and scored by the same
 * scoreRecallAgainstBrief call a live check-in uses. If speech synthesis or
 * transcription is unavailable on this machine the typed text is scored instead and
 * the record says so in `input_kind`.
 */
async function bakeFixtures(): Promise<void> {
  const brief = loadSongBrief(DEFAULT_BRIEF);
  const employees = z.array(SyntheticEmployeeSchema).parse(JSON.parse(readFileSync("fixtures/synthetic-employees.json", "utf8")));
  mkdirSync("fixtures/sessions", { recursive: true });
  mkdirSync("fixtures/audio", { recursive: true });

  for (const employee of employees) {
    const target = `fixtures/sessions/${employee.id}.json`;
    if (existsSync(target) && !process.argv.includes("--force")) {
      console.log(`skip ${employee.id} (exists; pass --force to rebuild)`);
      continue;
    }
    const startedAt = new Date().toISOString();
    const answers: AnswerRecord[] = [];
    for (const [index, text] of employee.answers.entries()) {
      const question = brief.check_in_questions[index] ?? `Follow-up ${index + 1}`;
      answers.push(await synthesizeAndTranscribe(employee.id, employee.voice, index + 1, question, text));
    }
    const scored = await scoreRecallAgainstBrief(brief, answers.map((a) => ({ question: a.question, transcript: a.transcript })));
    const cost = estimateSessionCost([scored.usage]);
    const session: RecallSession = RecallSessionSchema.parse({
      session_id: `fixture-${employee.id}`,
      mode: "fixture",
      participant: employee.participant,
      client: brief.client,
      song_title: brief.song_title,
      brief_messages: brief.required_messages,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      consent: {
        participant: employee.participant,
        consented: true,
        asked_at: startedAt,
        script_version: CONSENT_SCRIPT_VERSION,
        retention_days: RETENTION_DAYS,
        purpose: CONSENT_PURPOSE,
        withdrawal: CONSENT_WITHDRAWAL,
        answer_transcript: "yes (synthetic employee; consent simulated)",
      },
      answers,
      recall: scored.score,
      cost_usd: cost.usd,
      tokens: { input: cost.input_tokens, output: cost.output_tokens },
      scoring_model: SCORING_MODEL,
    });
    writeFileSync(target, `${JSON.stringify(session, null, 2)}\n`);
    const summary = session.recall?.per_message.map((m) => `${m.message_id}=${m.status}`).join(" ") ?? "";
    console.log(`baked ${employee.id.padEnd(8)} score ${String(session.recall?.overall_score ?? 0).padStart(3)}  ${summary}  $${cost.usd}`);
  }
}

async function synthesizeAndTranscribe(id: string, voice: string, n: number, question: string, text: string): Promise<AnswerRecord> {
  const aiff = `fixtures/audio/${id}-q${n}.aiff`;
  const wav = `fixtures/audio/${id}-q${n}.wav`;
  const spoken = spawnSync("say", ["-v", voice, "-o", aiff, text], { stdio: "ignore" });
  const converted = spoken.status === 0 ? spawnSync("sox", [aiff, "-r", "16000", "-c", "1", "-b", "16", wav], { stdio: "ignore" }) : null;
  if (converted && converted.status === 0) {
    try {
      const transcript = await transcribeSpokenAnswer(wav);
      return { question, transcript, input_kind: "synthetic_voice", audio_path: wav, is_follow_up: false };
    } catch (error) {
      console.warn(`transcription failed for ${id} q${n}, scoring the typed text instead: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { question, transcript: text, input_kind: "typed", audio_path: null, is_follow_up: false };
}

await bakeFixtures();
