// Puts what hand tracking needs into public/vision/, so the game serves it itself (no CDN at play time):
// MediaPipe's wasm (copied from node_modules) and the two models (downloaded once): the body (for where you are, your
// arms and the cut-out mask) and the hand (for the pointing finger).
// Run after `npm install`: node tools/fetch_vision.mjs
import { copyFileSync, existsSync, mkdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'public', 'vision');
mkdirSync(join(out, 'wasm'), { recursive: true });

const wasm = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
// the ES-module build for the worker, the classic one for running on the page when there's no worker
for (const f of ['vision_wasm_module_internal.js', 'vision_wasm_module_internal.wasm', 'vision_wasm_internal.js', 'vision_wasm_internal.wasm']) {
  copyFileSync(join(wasm, f), join(out, 'wasm', f));
  console.log('copied', f);
}

const MODELS = {
  'hand_landmarker.task': 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
  'pose_landmarker_lite.task': 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
};
for (const [name, url] of Object.entries(MODELS)) {
  const path = join(out, name);
  if (existsSync(path) && statSync(path).size > 0) { console.log('have', name); continue; }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${name}: ${res.status} ${res.statusText}`);
  writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  console.log('fetched', name, statSync(path).size, 'bytes');
}
// models this game no longer uses
for (const old of ['selfie_segmenter_landscape.tflite', 'blaze_face_short_range.tflite']) if (existsSync(join(out, old))) unlinkSync(join(out, old));
