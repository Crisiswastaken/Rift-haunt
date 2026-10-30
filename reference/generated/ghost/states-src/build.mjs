// Bundles states.ts (with the game code it imports) into one self-contained ../states.html that opens from disk.
import { build } from 'esbuild';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = p => fileURLToPath(new URL(p, import.meta.url));
const out = await build({ entryPoints: [here('states.ts')], bundle: true, format: 'iife', target: 'es2022', write: false, legalComments: 'none' });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\/script');
const html = readFileSync(here('states.template.html'), 'utf8').replace('/*BUNDLE*/', () => js);
writeFileSync(here('../states.html'), html);
console.log('wrote states.html', (html.length / 1024).toFixed(1), 'KB');
