import assert from 'node:assert/strict';
import { ddmmssToDecimal, osGridToWgs84 } from '../scripts/lib/terrestrial-catalog-lib.mjs';
import { normalizeISED, normalizeOfcom, normalizeACMARows, normalizeLowFrequencyFallback } from '../scripts/generate-global-terrestrial-catalog.mjs';

function makeDbf(fields, rows){
  const headerLen=32+fields.length*32+1, recordLen=1+fields.reduce((a,f)=>a+f.len,0), b=Buffer.alloc(headerLen+recordLen*rows.length+1,0x20);
  b[0]=0x03; b.writeUInt32LE(rows.length,4); b.writeUInt16LE(headerLen,8); b.writeUInt16LE(recordLen,10);
  fields.forEach((f,i)=>{const o=32+i*32; b.write(f.name,o,Math.min(11,f.name.length),'ascii'); b[o+11]=f.type.charCodeAt(0); b[o+16]=f.len; b[o+17]=f.dec||0;}); b[headerLen-1]=0x0d;
  rows.forEach((r,ri)=>{let p=headerLen+ri*recordLen;b[p++]=0x20;for(const f of fields){const s=String(r[f.name]??'');const v=f.type==='N'?s.padStart(f.len):s.padEnd(f.len);b.write(v.slice(0,f.len),p,f.len,'latin1');p+=f.len;}}); b[b.length-1]=0x1a; return b;
}

assert.ok(Math.abs(ddmmssToDecimal('451530')-45.258333)<1e-6);
assert.ok(Math.abs(ddmmssToDecimal('0754530',true)+75.758333)<1e-6);
const os=osGridToWgs84('TG5140913177'); assert.ok(Math.abs(os.lat-52.6576)<0.01); assert.ok(Math.abs(os.lon-1.7179)<0.01);

const fields=[['PROVINCE','C',2],['CITY','C',20],['CALL_SIGN','C',12],['FREQUENCY','N',7],['CLASS','C',3],['LATITUDE','N',7],['LONGITUDE','N',8],['BANNER','C',2],['STATUS1','C',2],['STATUS2','C',2],['LATITUDE2','N',7],['LONGITUDE2','N',8],['POWERDAY','N',7],['POWERNIGHT','N',7],['POWERCRIT','N',7]].map(([name,type,len])=>({name,type,len}));
const dbf=makeDbf(fields,[{PROVINCE:'ON',CITY:'Toronto',CALL_SIGN:'CFZM',FREQUENCY:'740',CLASS:'A',LATITUDE:'434000',LONGITUDE:'0792000',BANNER:'O',STATUS1:'OP',STATUS2:'OP',LATITUDE2:'434100',LONGITUDE2:'0792100',POWERDAY:'50000',POWERNIGHT:'50000',POWERCRIT:'10000'}]);
const ca=normalizeISED(dbf); assert.equal(ca.length,1); assert.equal(ca[0].callsign,'CFZM'); assert.equal(ca[0].dayPowerW,50000); assert.equal(ca[0].nightPowerW,50000); assert.equal(ca[0].criticalPowerW,10000); assert.notEqual(ca[0].dayLat,ca[0].nightLat); assert.ok(ca[0].lon<0&&ca[0].dayLon<0);

const ukCsv='Station,Area,Site,Frequency (kHz),OS National Grid Reference,In-use EMRP (kW),Licensed EMRP (kW),Date\nRadio Caroline,Suffolk,Orfordness,648,TM450494,4,4,2026-01-01\n';
const uk=normalizeOfcom(ukCsv); assert.equal(uk.length,1); assert.equal(uk[0].powerW,4000); assert.equal(uk[0].frequencyKHz,648); assert.ok(uk[0].lat>49&&uk[0].lat<61);
const ukCurrentCsv='Station,Area,Site,Frequency,OS National Grid Reference,In-use EMRP,Licensed EMRP,Date\nRadio Caroline,Suffolk,Orfordness,648,TM 450 494,4 kW,4 kW,2026-08-05\n';
const ukCurrent=normalizeOfcom(ukCurrentCsv); assert.equal(ukCurrent.length,1); assert.equal(ukCurrent[0].powerW,4000); assert.equal(ukCurrent[0].frequencyKHz,648); assert.ok(ukCurrent[0].lat>49&&ukCurrent[0].lat<61);

const auRows=[['Broadcast AM transmitter data'],['Callsign','Frequency (kHz)','Purpose','Service Area','Transmitter Site','Latitude','Longitude','Maximum ERP (W)','Licence Number'],['2GB','873','Commercial','Sydney','Homebush','-33 50 22','151 3 46','8000','1385019']];
const au=normalizeACMARows(auRows); assert.equal(au.length,1); assert.equal(au[0].callsign,'2GB'); assert.equal(au[0].powerW,8000); assert.ok(au[0].lat<0&&au[0].lon>0);

const schedule='Frequency,M,Station,On,Off,Language,Site,TX Country,Days,Target,Power,Azimuth,Origin,Source\n252000,AM,Radio Test,0000,2400,E,Tipaza,Algeria,1234567,,750,,Algeria,EiBi\n350000,AM,NDB TEST,0000,2400,-,Airport,Canada,1234567,,,,Canada,EiBi\n1000000,AM,MW One,0100,0200,E,Site,United Kingdom,1234567,,10,,United Kingdom,EiBi\n';
const countries='name,latitude,longitude\nAlgeria,28,2\nUnited Kingdom,54,-2\nCanada,56,-106\n';
const fb=normalizeLowFrequencyFallback(schedule,countries); assert.equal(fb.length,2); assert.ok(fb.every(e=>e.sourceTier==='reference/fallback')); assert.ok(!fb.some(e=>/NDB/.test(e.name)));
console.log('terrestrial catalog parser tests: ok');
