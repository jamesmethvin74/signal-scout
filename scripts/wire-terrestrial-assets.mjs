import { readFile, writeFile } from 'node:fs/promises';

const files = ['freqbeacon-zero.html', 'lookup.html'];
const dataTags = [
  '  <script src="/freqbeacon-zero-global-mw-lw.js?v=1"></script>',
  '  <script src="/freqbeacon-zero-global-mw-lw-fallback.js?v=1"></script>'
].join('\n');
const wrapperTag = '  <script src="/freqbeacon-terrestrial-identification.js?v=1"></script>';

for (const file of files) {
  let html = await readFile(file, 'utf8');
  if (!html.includes('/freqbeacon-zero-global-mw-lw.js')) {
    const anchor = '  <script src="/freqbeacon-zero-identification-data.js';
    const i = html.indexOf(anchor);
    if (i < 0) throw new Error(`${file}: identification-data script anchor missing`);
    html = `${html.slice(0, i)}${dataTags}\n${html.slice(i)}`;
  }
  if (!html.includes('/freqbeacon-terrestrial-identification.js')) {
    const engineEnd = html.match(/  <script src="\/freqbeacon-identification-engine\.js[^\n]*<\/script>/)?.[0];
    if (!engineEnd) throw new Error(`${file}: identification-engine script anchor missing`);
    html = html.replace(engineEnd, `${engineEnd}\n${wrapperTag}`);
  }
  await writeFile(file, html, 'utf8');
}

console.log(`Wired terrestrial catalog assets into ${files.join(' and ')}.`);
