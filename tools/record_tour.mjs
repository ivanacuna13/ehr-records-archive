import puppeteer from 'puppeteer-core';
import { spawn, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
// Renders the guided tour to site/tour/tour.mp4-ready footage. Needs: the site served on :8731,
// `npm i puppeteer-core`, Google Chrome, ffmpeg. Usage: node tools/record_tour.mjs [outdir]
const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../site');
const OUTDIR = process.argv[2] || path.resolve(SITE, '../recording');
const LIMIT = +(process.argv[3] || 1e9);        // max seconds (for test runs)
const FPS = 30, W = 1920, H = 1080;
fs.mkdirSync(OUTDIR, { recursive: true });
const browser = await puppeteer.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: 'new', args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', `--window-size=${W},${H}`] });
const page = await browser.newPage();
await page.setViewport({ width: W, height: H, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('[pageerror]', e.message));
await page.goto('http://localhost:8731/?record', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => !!window.__app, { timeout: 60000 });
// boot under the virtual clock
for (let i = 0; i < 2000; i++) {
  const lv = await page.evaluate(() => { __app.recordFrame(1 / 30); return __app.level; });
  if (lv === 'hospital') break;
  await new Promise((r) => setTimeout(r, 20));
}
for (let i = 0; i < 150; i++) await page.evaluate(() => __app.recordFrame(1 / 30));   // intro flight settles
const ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', `${OUTDIR}/video.mp4`], { stdio: ['pipe', 'inherit', 'inherit'] });
const t0 = await page.evaluate(() => __app.clock.t);
await page.evaluate(() => { __app.tour.start(); });
let n = 0, tail = 0;
const started = Date.now();
while (true) {
  const st = await page.evaluate((dt) => { __app.recordFrame(dt); return { running: __app.tour.running, t: __app.clock.t }; }, 1 / FPS);
  const buf = await page.screenshot({ type: 'jpeg', quality: 92 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once('drain', r));
  n++;
  if (!st.running && n > 30) tail++;
  if (tail > FPS * 2) break;
  if (n / FPS > LIMIT) break;
  if (n % 300 === 0) console.log(`frame ${n} (${(n / FPS).toFixed(0)}s video) ${((Date.now() - started) / 1000).toFixed(0)}s wall`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
const log = await page.evaluate(() => window.__recordLog || []);
await browser.close();
fs.writeFileSync(`${OUTDIR}/log.json`, JSON.stringify({ t0, frames: n, log }, null, 1));
// lay each narration clip at the virtual time its stop began
const inputs = [], filters = [];
log.forEach((e, i) => {
  inputs.push('-i', `${SITE}/tour/${e.id}.mp3`);
  const ms = Math.max(0, Math.round((e.t - t0) * 1000));
  filters.push(`[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`);
});
const dur = (n / FPS).toFixed(3);
if (log.length) {
  execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-i', `${OUTDIR}/video.mp4`, ...inputs, '-filter_complex',
    filters.join(';') + ';' + log.map((_, i) => `[a${i}]`).join('') + `amix=inputs=${log.length}:normalize=0,apad[aout]`,
    '-map', '0:v', '-map', '[aout]', '-t', dur, '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', `${OUTDIR}/tour.mp4`]);
}
console.log('frames', n, 'video', dur + 's', 'clips', log.length, 'wall', ((Date.now() - started) / 1000).toFixed(0) + 's');
