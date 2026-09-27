import assert from 'node:assert/strict';
import {
  SOURCE_DEFINITIONS,
  normalizeStationKey,
  resolveProgramStationKey,
  parseWbcqRows,
  parseWrmiScheduleCsv,
  parseReeSchedule,
  parseKarnNow,
  parseAbcRadioNationalNow,
  parseKbsWorldEnglishNow,
  parseChannelAfricaNow,
  parseRadioNacionalAmazoniaNow,
  parseVaticanEnglishNow,
  selectProgramFromRecords,
  validateCandidateRecords
} from '../program-catalog-worker.js';

assert.equal(normalizeStationKey('Radio Exterior de España'), 'REE');
assert.equal(normalizeStationKey('Radio Miami International'), 'WRMI');
assert.equal(normalizeStationKey('2RN'), 'ABC_RN');
assert.equal(resolveProgramStationKey('KBS World Radio', 'English'), 'KBS_WORLD_ENGLISH');
assert.equal(resolveProgramStationKey('KBS World Radio', 'Spanish'), 'KBS_WORLD');
assert.equal(resolveProgramStationKey('Vatican Radio', 'English'), 'VATICAN_RADIO_ENGLISH');
assert.equal(resolveProgramStationKey('Vatican Radio', 'Italian'), 'VATICAN_RADIO');
assert.ok(SOURCE_DEFINITIONS.length >= 10);
assert.equal(SOURCE_DEFINITIONS.find((source) => source.id === 'rri-official-english')?.coverageLevel, 'service-only');

const wbcq = parseWbcqRows(
  '<table><tr><td>7490</td><td>Mon</td><td>2300</td><td>0100</td><td>Night Test</td></tr></table>'
);
assert.equal(wbcq.length, 1);
let selected = selectProgramFromRecords(
  [{...wbcq[0], sourcePriority:100, activeExpiresAt:Date.parse('2026-09-23T00:00:00Z')}],
  new Date('2026-09-22T00:30:00Z'),
  7490,
  new Date('2026-09-21T22:00:00Z')
);
assert.equal(selected.status, 'verified');
assert.equal(selected.best.record.title, 'Night Test');

const wrmiCsv = [
  '"WRMI A26 Schedule effective July 13, 2026",,,',
  'UTC,,7730 kHz,9955 kHz',
  '0000,,J,B',
  ',,Supreme,',
  ',,Master,',
  ',,TV,',
  '0100,,L,B',
  ',,Hal Turner,',
  ',,weekdays,',
  ',,others Sat-Sun,',
  '0200,,D,B',
  ',,World Radio,',
  ',,Network,',
  ',,,'
].join('\n');
const wrmi = parseWrmiScheduleCsv(wrmiCsv);
assert.equal(wrmi.season, 'A26');
assert.equal(wrmi.effectiveFrom, '2026-07-13');
assert.ok(wrmi.records.some((row) => row.title === 'Supreme Master TV' && row.frequencyKHz === 7730 && row.days === '0123456'));
assert.ok(wrmi.records.some((row) => row.title === 'Hal Turner' && row.frequencyKHz === 7730 && row.days === '12345'));

const reeHtml = [
  '<img alt="24 horas con Lara Hermoso">',
  '<div>24 horas Lara Hermoso De 20:00 a 22:00 horas</div>',
  '<img alt="Emisión en sefardí con Rajel Barnatán">',
  '<div>Rajel Barnatán Emisión en sefardí De 22:00 a 22:30 horas</div>',
  '<img alt="España es música con Marcos Mostaza">',
  '<div>Marcos Mostaza España es música De 00:00 a 00:30 horas</div>'
].join('');
const ree = parseReeSchedule(reeHtml, new Date('2026-09-21T18:30:00Z'));
assert.equal(ree.length, 3);
selected = selectProgramFromRecords(
  ree.map((row) => ({...row, sourcePriority:100, activeExpiresAt:Date.parse('2026-09-22T06:00:00Z')})),
  new Date('2026-09-21T18:45:00Z'),
  15350,
  new Date('2026-09-21T19:00:00Z')
);
assert.equal(selected.status, 'verified');
assert.equal(selected.best.record.title, '24 horas');

const karn = parseKarnNow(
  '<div>On Air Now</div><h2>The Rich Eisen Show</h2><div>11:00 AM - 2:00 PM</div>',
  new Date('2026-09-21T17:00:00Z')
);
assert.equal(karn.length, 1);
assert.equal(karn[0].frequencyKHz, 920);
selected = selectProgramFromRecords(
  karn.map((row) => ({...row, sourcePriority:100, activeExpiresAt:Date.parse('2026-09-21T20:00:00Z')})),
  new Date('2026-09-21T17:30:00Z'),
  920,
  new Date('2026-09-21T17:30:00Z')
);
assert.equal(selected.status, 'verified');
assert.equal(selected.best.record.title, 'The Rich Eisen Show');


const abcRn = parseAbcRadioNationalNow(
  '<main><h1>Radio National live player</h1><div>ABC Radio National</div><button>Play Live</button><h2>Saturday Extra</h2><span>on</span><a>Radio National</a><h2>Up Next</h2></main>',
  new Date('2026-09-26T08:00:00Z')
);
assert.equal(abcRn.length, 1);
assert.equal(abcRn[0].stationKey, 'ABC_RN');
assert.equal(abcRn[0].title, 'Saturday Extra');

const kbs = parseKbsWorldEnglishNow(
  '<section>KBS WORLD Radio Ch2 English More 16:00 K-POP Connection 17:00 Weekend Playlist Part1 ON AIR 19:00 Weekend Playlist Part2</section>',
  new Date('2026-09-26T08:10:00Z')
);
assert.equal(kbs.length, 1);
assert.equal(kbs[0].stationKey, 'KBS_WORLD_ENGLISH');
assert.equal(kbs[0].title, 'Weekend Playlist Part1');
selected = selectProgramFromRecords(
  kbs.map((row) => ({...row, sourcePriority:100, activeExpiresAt:Date.parse('2026-09-26T09:00:00Z')})),
  new Date('2026-09-26T08:30:00Z'),
  9770,
  new Date('2026-09-26T08:30:00Z')
);
assert.equal(selected.status, 'verified');

const channelAfrica = parseChannelAfricaNow(
  '<div>Live Radio</div><h4>Malonje (Chinyanja)</h4><div>19:00 - 20:00</div><button>Listen Live</button><h2>Programme Schedule</h2>',
  new Date('2026-09-26T17:30:00Z')
);
assert.equal(channelAfrica.length, 1);
assert.equal(channelAfrica[0].stationKey, 'CHANNEL_AFRICA');
assert.equal(channelAfrica[0].title, 'Malonje (Chinyanja)');


const amazonia = parseRadioNacionalAmazoniaNow(
  '<section>Programação das Rádios 23 h Amazônia Beco da Bossa ouvir A seguir | Madrugada Nacional Ver programação completa</section>',
  new Date('2026-09-27T02:10:00Z')
);
assert.equal(amazonia.length, 2);
assert.deepEqual(amazonia.map((row) => row.frequencyKHz).sort((a,b) => a-b), [6180,11780]);
assert.equal(amazonia[0].stationKey, 'RADIO_NACIONAL_AMAZONIA');
assert.equal(amazonia[0].title, 'Beco da Bossa');

const vatican = parseVaticanEnglishNow(
  '<main>Channel: Select Live now Schedules Events 18:30 - 19:00 ENGLISH FOR AFRICA Sun 27 Mon 28 Tue 29 Wed 30 Thu 01 Fri 02</main>',
  new Date('2026-09-27T16:40:00Z')
);
assert.equal(vatican.length, 1);
assert.equal(vatican[0].stationKey, 'VATICAN_RADIO_ENGLISH');
assert.equal(vatican[0].title, 'ENGLISH FOR AFRICA');

const frequencyRecords = [
  {stationKey:'WRMI',frequencyKHz:9955,days:'1',startMinuteUtc:600,endMinuteUtc:660,title:'9955 Show',sourcePriority:100,activeExpiresAt:Date.parse('2026-09-22T00:00:00Z')},
  {stationKey:'WRMI',frequencyKHz:9395,days:'1',startMinuteUtc:600,endMinuteUtc:660,title:'9395 Show',sourcePriority:100,activeExpiresAt:Date.parse('2026-09-22T00:00:00Z')}
];
selected = selectProgramFromRecords(frequencyRecords, new Date('2026-09-21T10:30:00Z'), 9955, new Date('2026-09-21T10:30:00Z'));
assert.equal(selected.status, 'verified');
assert.equal(selected.best.record.title, '9955 Show');

const conflicting = [
  {stationKey:'WRMI',frequencyKHz:9955,days:'1',startMinuteUtc:600,endMinuteUtc:660,title:'Show A',sourcePriority:100,activeExpiresAt:Date.parse('2026-09-22T00:00:00Z')},
  {stationKey:'WRMI',frequencyKHz:9955,days:'1',startMinuteUtc:600,endMinuteUtc:660,title:'Show B',sourcePriority:100,activeExpiresAt:Date.parse('2026-09-22T00:00:00Z')}
];
selected = selectProgramFromRecords(conflicting, new Date('2026-09-21T10:30:00Z'), 9955, new Date('2026-09-21T10:30:00Z'));
assert.equal(selected.status, 'ambiguous');

selected = selectProgramFromRecords(
  [{...frequencyRecords[0], activeExpiresAt:Date.parse('2026-09-20T00:00:00Z')}],
  new Date('2026-09-21T10:30:00Z'),
  9955,
  new Date('2026-09-21T10:30:00Z')
);
assert.equal(selected.status, 'none');

const validation = validateCandidateRecords(
  [{...frequencyRecords[0], recordKey:'valid-one'}],
  {minRecords:1,maxRecords:10},
  0
);
assert.equal(validation.ok, true);

const badValidation = validateCandidateRecords(
  [{stationKey:'BAD',frequencyKHz:99,days:'1',startMinuteUtc:60,endMinuteUtc:120,title:'Bad',recordKey:'bad'}],
  {minRecords:1,maxRecords:10},
  0
);
assert.equal(badValidation.ok, false);

console.log('program catalog regressions: ok');
