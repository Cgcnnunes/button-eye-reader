import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const target = new URL('public/vision/', root);

await mkdir(target, { recursive: true });

await cp(new URL('node_modules/@mediapipe/tasks-vision/wasm/', root), new URL('wasm/', target), {
  recursive: true,
});

const model = new URL('face_landmarker.task', target);
const source =
  'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

try {
  await readFile(model);
} catch (error) {
  if (!(error instanceof Error) || !('code' in error) || error.code !== 'ENOENT') throw error;

  const response = await fetch(source);

  if (!response.ok) throw new Error(`Model download failed: ${response.status}`, { cause: error });

  const bytes = Buffer.from(await response.arrayBuffer());

  if (bytes.length < 1_000_000)
    throw new Error('Model download is unexpectedly small', { cause: error });

  await writeFile(model, bytes);
}

const hash = createHash('sha256')
  .update(await readFile(model))
  .digest('hex');

if (hash !== '64184e229b263107bc2b804c6625db1341ff2bb731874b0bcc2fe6544e0bc9ff') {
  throw new Error('Model checksum mismatch. Remove public/vision/face_landmarker.task and retry.');
}

console.log(`Local vision assets: ${fileURLToPath(target)} (model SHA-256: ${hash})`);
