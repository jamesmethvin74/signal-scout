import { readFile, writeFile } from 'node:fs/promises';

const files = ['freqbeacon-zero.html', 'lookup.html'];
const dataTags = [
  '  <script src="/freqbeacon-zero-philippines-am.js?v=1"></script>',
  '  <script src="/freqbeacon-zero-global-mw-lw.js?v=1"></script>',
  '  <script src="/freqbeacon-zero-global-mw-lw-fallback.js?v=1"></script>'
];
const wrapperTag = '  <script src="/freqbeacon-terrestrial-identification.js?v=2"></script>';

for (const file of files) {
  let html = await readFile(file, 'utf8');
  const missingDataTags = dataTags.filter((tag) => {
    const src = tag.match(/src="([^"]+)"/)?.[1]?.split('?')[0];
    return src && !html.includes(src);
  });
  if (missingDataTags.length) {
    const anchor = '  <script src="/freqbeacon-zero-identification-data.js';
    const i = html.indexOf(anchor);
    if (i < 0) throw new Error(`${file}: identification-data script anchor missing`);
    html = `${html.slice(0, i)}${missingDataTags.join('\n')}\n${html.slice(i)}`;
  }

  const existingWrapper = html.match(/  <script src="\/freqbeacon-terrestrial-identification\.js[^\n]*<\/script>/)?.[0];
  if (existingWrapper) {
    html = html.replace(existingWrapper, wrapperTag);
  } else {
    const engineEnd = html.match(/  <script src="\/freqbeacon-identification-engine\.js[^\n]*<\/script>/)?.[0];
    if (!engineEnd) throw new Error(`${file}: identification-engine script anchor missing`);
    html = html.replace(engineEnd, `${engineEnd}\n${wrapperTag}`);
  }
  await writeFile(file, html, 'utf8');
}

console.log(`Wired terrestrial catalog assets into ${files.join(' and ')}.`);
