import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { SongBrief } from "./brief";

export const SCORING_MODEL = "claude-opus-5";

export const MessageRecallSchema = z.object({
  message_id: z.string(),
  status: z.enum(["landed", "partial", "missed", "misrecalled"]),
  evidence_quote: z.string().describe("The participant's own words that decided the status, or an empty string"),
  note: z.string().describe("One sentence on why this status"),
});

export const RecallScoreSchema = z.object({
  per_message: z.array(MessageRecallSchema),
  overall_score: z.number().min(0).max(100),
  answer_is_vague: z.boolean(),
  follow_up_question: z
    .string()
    .nullable()
    .describe("One short spoken follow-up when the answer is vague, otherwise null"),
  what_they_would_actually_do: z
    .string()
    .describe("One sentence: the behavior this employee would actually perform tomorrow, based on what they said"),
});

export type RecallScore = z.infer<typeof RecallScoreSchema>;
export type MessageRecall = z.infer<typeof MessageRecallSchema>;

export interface ScoredAnswer {
  question: string;
  transcript: string;
}

export interface TokenUsage {
  input_tokens: number;
  output_tokens: number;
}

const SYSTEM_PROMPT = `You score whether a business song's message landed with one employee, from what that employee said in a spoken check-in.

Score the message, not the words. A paraphrase in the employee's own language counts as landed. Judge each required message separately:
- landed: the employee states the message or the behavior it asks for, with the specific detail right (the number, the tool, the threshold).
- partial: the right direction but a key detail is missing or fuzzy ("file them fast" when the message is "within 30 days").
- missed: nothing in the answer touches this message.
- misrecalled: the employee confidently states the wrong version, typically the old policy or the listed common misrecall. This is the most valuable state of all, because it tells the songwriter what the next song has to un-teach. Never soften a misrecall into partial.

Transcripts come from speech recognition, so ignore filler, disfluency, and small transcription errors. Quote the employee's actual words as evidence.

Set answer_is_vague to true only when a real follow-up would change a status (the employee gestured at a message without the detail). Then write follow_up_question as one short, friendly spoken question, under 20 words, that asks for that specific detail. Otherwise set it to null.

overall_score: 100 means every message landed; misrecalled scores below missed.`;

/**
 * Scores what an employee said against the brief's required messages (MR-3): it turns a
 * messy spoken answer into a structured recall record that downstream steps consume,
 * the aggregate recall report today and the next song brief tomorrow.
 *
 * The hard problem is that recall is not recitation. Employees paraphrase, and the ones
 * who confidently remember the OLD policy are the ones a songwriter most needs to hear
 * about, so misrecall is scored as its own state instead of being folded into "missed".
 * When an answer is vague the score carries one follow-up question, which the agent
 * asks out loud before scoring again (OR-3).
 */
export async function scoreRecallAgainstBrief(
  brief: SongBrief,
  answers: ScoredAnswer[],
): Promise<{ score: RecallScore; usage: TokenUsage }> {
  const client = new Anthropic();
  const response = await client.messages.parse({
    model: SCORING_MODEL,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    output_config: { format: zodOutputFormat(RecallScoreSchema), effort: "low" },
    messages: [{ role: "user", content: buildScoringPrompt(brief, answers) }],
  });
  if (!response.parsed_output) throw new Error("the scoring model returned no structured recall score");
  return {
    score: oneRowPerRequiredMessage(brief, response.parsed_output),
    usage: { input_tokens: response.usage.input_tokens, output_tokens: response.usage.output_tokens },
  };
}

/**
 * Keeps the recall record deterministic for downstream steps: exactly one row per
 * required message, in brief order. A duplicated id keeps its first row; a message
 * the model skipped is recorded as missed rather than silently absent.
 */
function oneRowPerRequiredMessage(brief: SongBrief, score: RecallScore): RecallScore {
  const perMessage: MessageRecall[] = brief.required_messages.map((required) => {
    const row = score.per_message.find((m) => m.message_id === required.id);
    return row ?? { message_id: required.id, status: "missed", evidence_quote: "", note: "not addressed by the scorer" };
  });
  return { ...score, per_message: perMessage };
}

function buildScoringPrompt(brief: SongBrief, answers: ScoredAnswer[]): string {
  const messages = brief.required_messages
    .map(
      (m) =>
        `- ${m.id}: "${m.message}"\n  behavior asked for: ${m.behavior}\n  common misrecall: ${m.common_misrecall}`,
    )
    .join("\n");
  const exchange = answers
    .map((a, i) => `Q${i + 1}: ${a.question}\nA${i + 1}: ${a.transcript || "(no answer)"}`)
    .join("\n\n");
  return `Song: "${brief.song_title}" for ${brief.client}. Audience: ${brief.audience}. Objective: ${brief.objective}.

Required messages:
${messages}

Check-in transcript:
${exchange}

Score every required message by id.`;
}
