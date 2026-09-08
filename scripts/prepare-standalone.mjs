import { cp, mkdir } from 'node:fs/promises';

const standaloneRoot = new URL('../.next/standalone/', import.meta.url);
await mkdir(standaloneRoot, { recursive: true });
await cp(new URL('../public/', import.meta.url), new URL('public/', standaloneRoot), {
  recursive: true,
  force: true,
});
await cp(
  new URL('../.next/static/', import.meta.url),
  new URL('.next/static/', standaloneRoot),
  { recursive: true, force: true },
);
