// Builds hands-A/B.json.gz from logs/<session>/log.jsonl (gitignored) + the hand labels (per stroke of the original
// replay, keyed by index into /tmp/haunt-rec/pts<k>.json, which carries each stroke's time span). Run: node tests/fixtures/make.mjs
// shortcut: label source lives in /tmp; the labels are baked into the .gz, so only rerun with new logs + new labels.
import { readFileSync, writeFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const R = a => a && Array.from(a, v => Math.round(v * 1e4) / 1e4);
const labels = JSON.parse(readFileSync('/tmp/haunt-rec/labels.json', 'utf-8'));
const S = { A: '2026-10-31T05-38-54', B: '2026-10-31T05-42-17' };
// session B windows, log time = screen time + 10.5 s
const B = { fist: [[21.6, 22.2], [37.4, 37.9], [52.0, 52.9]], flick: [[27.7, 30.2], [41.5, 45.5], [69.5, 72.0]], drop: [[36.4, 37.1], [77.7, 78.0]] };
for (const k of ['A', 'B']) {
  const L = readFileSync(`logs/${S[k]}/log.jsonl`, 'utf-8').trim().split('\n').map(l => JSON.parse(l));
  const pts = JSON.parse(readFileSync(`/tmp/haunt-rec/pts${k}.json`, 'utf-8'));
  const trace = [];
  for (const e of L) {
    if (e.k === 'mode') trace.push(['m', e.at, e.mode]);
    else if (e.k === 'p') trace.push(['p', e.at, e.t, e.vw, e.vh, R(e.lm)]);
    else if (e.k === 'h') trace.push(['h', e.at, e.t, e.vw, e.vh, R(e.lm), R(e.world)]);
  }
  const f = {
    session: S[k], screen: L.find(e => e.k === 'start').screen.slice(0, 2), trace,
    logged: L.filter(e => e.k === 'stroke').map(e => [e.at, e.wanted]),
    labels: labels[k].map((l, i) => [l, pts[i].ts[0], pts[i].ts.at(-1)]),
    ...(k === 'B' ? B : { fist: [], flick: [], drop: [] }),
  };
  const gz = gzipSync(JSON.stringify(f), { level: 9 });
  writeFileSync(`tests/fixtures/hands-${k}.json.gz`, gz);
  console.log(k, (gz.length / 1e6).toFixed(2), 'MB');
}
