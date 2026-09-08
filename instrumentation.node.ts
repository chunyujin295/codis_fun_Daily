import { processNextTtsJob } from './lib/tts';

const workerState = globalThis as typeof globalThis & {
  dailyKnowledgeTtsRunner?: { running: boolean; started: boolean };
};

if (
  process.env.RUN_TTS_WORKER !== 'false' &&
  !workerState.dailyKnowledgeTtsRunner?.started
) {
  const state = { running: false, started: true };
  workerState.dailyKnowledgeTtsRunner = state;

  const tick = async () => {
    if (state.running) return;
    state.running = true;
    try {
      await processNextTtsJob(`embedded-${process.pid}`);
    } catch {
      // Job details are recorded in SQLite; never log credentials or signed URLs.
    } finally {
      state.running = false;
    }
  };
  const timer = setInterval(() => void tick(), 2_000);
  timer.unref();
  void tick();
}
