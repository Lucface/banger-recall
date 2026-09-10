import { spawnSync } from "node:child_process";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";

export type CaptureMode = "mic" | "typed";

export type CapturedAnswer =
  | { kind: "spoken"; wavPath: string }
  | { kind: "typed"; text: string };

/**
 * Captures the participant's answer, the human input that starts the workflow (MR-2).
 *
 * Spoken answers are recorded from the microphone as 16 kHz mono WAV (MR-1, captured
 * audio). Recording starts when the participant begins speaking and stops after two
 * seconds of silence, capped at `maxSeconds`, so a long pause or a quiet room ends the
 * turn instead of hanging it (OR-4). `typed` mode is the explicit fallback for a room
 * too loud to record in; the rest of the pipeline is identical.
 */
export async function captureSpokenAnswer(options: {
  mode: CaptureMode;
  wavPath: string;
  maxSeconds?: number;
}): Promise<CapturedAnswer> {
  if (options.mode === "typed") {
    const rl = createInterface({ input: stdin, output: stdout });
    const text = (await rl.question("⌨️  your answer: ")).trim();
    rl.close();
    return { kind: "typed", text };
  }

  const max = String(options.maxSeconds ?? 25);
  console.log(`🎙️  listening (start talking; stops after 2s of silence, max ${max}s)...`);
  const result = spawnSync(
    "sox",
    [
      "-q", "-d", "-r", "16000", "-c", "1", "-b", "16", options.wavPath,
      // start on sound, stop after 2.0s below the noise floor, then cap the length
      "silence", "1", "0.2", "1.5%", "1", "2.0", "1.5%",
      "trim", "0", max,
    ],
    { stdio: ["ignore", "ignore", "pipe"] },
  );
  if (result.status !== 0) {
    const detail = result.stderr ? result.stderr.toString().trim() : "";
    throw new Error(`microphone capture failed (sox exit ${result.status}) ${detail}. Re-run with --typed.`);
  }
  return { kind: "spoken", wavPath: options.wavPath };
}
