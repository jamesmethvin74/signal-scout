import assert from 'node:assert/strict';
import { ddmmssToDecimal, osGridToWgs84, parseXlsxSheets } from '../scripts/lib/terrestrial-catalog-lib.mjs';
import { normalizeISED, normalizeOfcom, normalizeACMARows, normalizeBrazilMCom, normalizeLowFrequencyFallback } from '../scripts/generate-global-terrestrial-catalog.mjs';

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

const xlsxFixture=Buffer.from('UEsDBBQAAAAIAFtoMF1UIkUvqAAAANYAAAAPAAAAeGwvd29ya2Jvb2sueG1sNY7LCsIwEEX3fkWYvaZ1IVKaFkEEF+70A2I6taHNTMnE198bQVdzH1zm1O0rTOqBUTyTgXJVgEJy3Hm6GbicD8stKEmWOjsxoYE3CrTNon5yHK/Mo8p7kioaGFKaK63FDRisrHhGyl3PMdiUbbxp7nvvcM/uHpCSXhfFRkecbMq/ZfCzQFPLgJjkd1WsfGcgHrsyU3yTY7ZZkw2ZZXcC3dT6P9F/puYDUEsDBBQAAAAIAFtoMF2D4CN9eQAAAKAAAAAaAAAAeGwvX3JlbHMvd29ya2Jvb2sueG1sLnJlbHNVjTEOwjAQBHtecdqeGHcUsdMhpUXmARY+JRbGjnwWkN8TUZFqtRrtbD98noleXCWWbKC7E4jzvYSYJ4ObuxzPIGk+B59KZoOVBYM99FdOvm0bmeMidlfJ+TpxM3iX+pCZuYn6he62M5BbF/6DoDEY1DFoKNurvfgLUEsDBBQAAAAIAFtoMF08JOKv2AAAAM4BAAAUAAAAeGwvc2hhcmVkU3RyaW5ncy54bWxt0cFLwzAUx/F/5ZHTdtiatm72kGXocE7YRJziOWsfNdC8YJOM1b/eiqCQeP18f4cXItYX08EZe6ctrVg+5wyQattoalfs9WU7q9haCuc81DaQHydLBoH0R8DNL4wDLYWXG9V1TrckMi9F9m0/vu1x3FM9TA67z2lcb3pUcMT+jE2cjtojPCqDSfDKBxfrXnntQ5Os95baf8NBXbQJBu6en2DyllxW3N/GxOfVdZlcMzSEQ6w7a/AU3HvsD86F9KmzsoQFh6KIQ77IoYSrZewV5/zPsvGL5BdQSwMEFAAAAAgAW2gwXYaJt/bGAAAAbAIAABgAAAB4bC93b3Jrc2hlZXRzL3NoZWV0MS54bWxt0t0OgiAAhuFbYZwXQlm2Ia7y7wLqApqxcpVs6LTLT8SZAkcO/R4P3kGj7+cNWi7rUlQhxGsPAl4V4l5WjxBeL+kqgBGjnZCv+sl5w+jwiG/NjVEpOiB7BBktQBPCGqrjUZ1b5lHUMooK9a1/e8IQ1Gqrh2qBZ4tJn7UmSx3beuPSidbbpU5t7bt0pvVuqXNb76cF6htMIYgRggzjwAhBrN8dnCG0xkbH2ObYGTIZvVEydXhnymz0Rsvc4X0jB5rdEfS/Oj9QSwECFAMUAAAACABbaDBdVCJFL6gAAADWAAAADwAAAAAAAAAAAAAAgAEAAAAAeGwvd29ya2Jvb2sueG1sUEsBAhQDFAAAAAgAW2gwXYPgI315AAAAoAAAABoAAAAAAAAAAAAAAIAB1QAAAHhsL19yZWxzL3dvcmtib29rLnhtbC5yZWxzUEsBAhQDFAAAAAgAW2gwXTwk4q/YAAAAzgEAABQAAAAAAAAAAAAAAIABhgEAAHhsL3NoYXJlZFN0cmluZ3MueG1sUEsBAhQDFAAAAAgAW2gwXYaJt/bGAAAAbAIAABgAAAAAAAAAAAAAAIABkAIAAHhsL3dvcmtzaGVldHMvc2hlZXQxLnhtbFBLBQYAAAAABAAEAA0BAACMAwAAAAA=','base64');
const parsedSheets=parseXlsxSheets(xlsxFixture); assert.equal(parsedSheets.length,1); assert.equal(parsedSheets[0].name,'AM'); assert.equal(parsedSheets[0].rows[0][0],'Callsign'); assert.equal(parsedSheets[0].rows[0][1],'Frequency(MHz)');
const auCurrent=normalizeACMARows(parsedSheets[0].rows); assert.equal(auCurrent.length,1); assert.equal(auCurrent[0].callsign,'2GB'); assert.equal(auCurrent[0].frequencyKHz,873); assert.equal(auCurrent[0].powerW,8000); assert.equal(auCurrent[0].status,'Issued');

const brCsv=[
  'SiglaServico;sitarwebStatus;licenca_srd_planobasico_NomeMunicipio;licenca_srd_planobasico_SiglaUF;licenca_estacao_NomeIndicativo;licenca_entidade_NomeEntidade;licenca_frequency;licenca_loctx_coordinates_1;licenca_loctx_coordinates_0;srd_planobasico_MedPotenciaDiurna;srd_planobasico_MedPotenciaNoturna;id_estacao;SiglaSituacao;data_extracao',
  'OM;L;Brasília;DF;ZYA980;Empresa Brasil de Comunicação;0,980;-15,824097;-47,963069;50;50;BR980;ATIVA;2026-09-01',
  'FM;L;Brasília;DF;FMTEST;Empresa FM;0,980;-15,8;-47,9;10;10;BRFM;ATIVA;2026-09-01',
  'OM;L;Teste;SP;ZERO;Zero Rádio;1,000;-23,5;-46,6;0;0;BRZERO;ATIVA;2026-09-01',
  'OM;L;Teste;SP;OFF;Off Rádio;1,100;-23,5;-46,6;10;10;BROFF;INATIVA;2026-09-01'
].join('\n');
const br=normalizeBrazilMCom(brCsv,'2026-09-16'); assert.equal(br.length,1); assert.equal(br[0].frequencyKHz,980); assert.equal(br[0].dayPowerW,50000); assert.equal(br[0].nightPowerW,50000); assert.equal(br[0].sourceTier,1); assert.equal(br[0].sourceAuthority,'MCom/Anatel SCR'); assert.equal(br[0].country,'Brazil'); assert.match(br[0].name,/Empresa Brasil/i); assert.ok(br[0].lat<0&&br[0].lon<0);
const brNightZero=normalizeBrazilMCom(brCsv.replace(';50;50;BR980;',';50;0;BR980;'),'2026-09-16'); assert.equal(brNightZero[0].nightPowerW,0); assert.equal(brNightZero[0].dayPowerW,50000);
assert.throws(()=>normalizeBrazilMCom('SiglaServico;sitarwebStatus\nOM;L\n'),/missing required header/i);

const schedule='Frequency,M,Station,On,Off,Language,Site,TX Country,Days,Target,Power,Azimuth,Origin,Source\n252000,AM,Radio Test,0000,2400,E,Tipaza,Algeria,1234567,,750,,Algeria,EiBi\n350000,AM,NDB TEST,0000,2400,-,Airport,Canada,1234567,,,,Canada,EiBi\n1000000,AM,MW One,0100,0200,E,Site,United Kingdom,1234567,,10,,United Kingdom,EiBi\n';
const countries='name,latitude,longitude\nAlgeria,28,2\nUnited Kingdom,54,-2\nCanada,56,-106\n';
const fb=normalizeLowFrequencyFallback(schedule,countries); assert.equal(fb.length,2); assert.ok(fb.every(e=>e.sourceTier==='reference/fallback')); assert.ok(!fb.some(e=>/NDB/.test(e.name)));
console.log('terrestrial catalog parser tests: ok');
