import { setTimeout as delay } from 'node:timers/promises';

import { processNextTtsJob } from '../lib/tts';

let stopping = false;
process.on('SIGINT', () => {
  stopping = true;
});
process.on('SIGTERM', () => {
  stopping = true;
});

console.log('TTS worker started.');
while (!stopping) {
  const processed = await processNextTtsJob();
  if (!processed) await delay(2_000);
}
console.log('TTS worker stopped.');
