import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

export type SttProvider = "local" | "openai";

export function sttProvider(): SttProvider {
  return process.env.STT_PROVIDER === "openai" ? "openai" : "local";
}

/**
 * Transcribes a spoken answer into text (OR-1).
 *
 * Default runs Whisper locally through mlx_whisper: free, offline, and the audio
 * never leaves the laptop, which matters because an employee's voice is biometric
 * data. OpenAI transcription is an opt-in switch for machines without Apple silicon.
 */
export async function transcribeSpokenAnswer(wavPath: string): Promise<string> {
  return sttProvider() === "openai" ? transcribeWithOpenAi(wavPath) : transcribeLocally(wavPath);
}

function transcribeLocally(wavPath: string): string {
  const outDir = mkdtempSync(join(tmpdir(), "banger-recall-"));
  const model = process.env.WHISPER_MODEL ?? "mlx-community/whisper-large-v3-turbo";
  const result = spawnSync(
    "mlx_whisper",
    [wavPath, "--model", model, "--output-dir", outDir, "--output-format", "txt", "--language", "en", "--verbose", "False"],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  if (result.status !== 0) {
    const detail = result.stderr ? result.stderr.toString().trim().split("\n").slice(-3).join(" ") : "";
    throw new Error(`local transcription failed (mlx_whisper exit ${result.status}) ${detail}`);
  }
  const transcriptPath = join(outDir, `${basename(wavPath).replace(/\.[^.]+$/, "")}.txt`);
  return readFileSync(transcriptPath, "utf8").trim();
}

async function transcribeWithOpenAi(wavPath: string): Promise<string> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error("OPENAI_API_KEY is required when STT_PROVIDER=openai");
  const form = new FormData();
  form.append("file", new Blob([readFileSync(wavPath)], { type: "audio/wav" }), basename(wavPath));
  form.append("model", "gpt-4o-mini-transcribe");
  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
  });
  if (!response.ok) throw new Error(`OpenAI transcription failed with HTTP ${response.status}`);
  const data = (await response.json()) as { text?: string };
  return (data.text ?? "").trim();
}
