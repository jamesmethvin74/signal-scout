export const SDR_DIRECTORY_SEED_VERSION = '2026-08-29';

// Deployment-bundled public KiwiSDR safety catalog. Dynamic ReceiverBook
// discovery remains primary; this is used when the live directory cannot be
// trusted for the current request.
export const SDR_DIRECTORY_SEED = [
  { id:'22661.proxy.kiwisdr.com:8073', name:'N0DSS | St. Louis, Missouri', location:'St. Louis, Missouri', url:'http://22661.proxy.kiwisdr.com:8073', lat:38.6270, lon:-90.1994, minKHz:10, maxKHz:30000 },
  { id:'km4rt.ddns.net:8073', name:'KM4RT 0-30 MHz SDR', location:'Tipton County, Tennessee', url:'http://km4rt.ddns.net:8073', lat:35.5600, lon:-89.6500, minKHz:10, maxKHz:30000 },
  { id:'21118.proxy.kiwisdr.com:8073', name:'Shortwave Central', location:'Mandeville, Louisiana', url:'http://21118.proxy.kiwisdr.com:8073', lat:30.3583, lon:-90.0656, minKHz:10, maxKHz:30000 },
  { id:'21305.proxy.kiwisdr.com:8073', name:'KJ5CHW 0-30 MHz SDR', location:'San Antonio, Texas', url:'http://21305.proxy.kiwisdr.com:8073', lat:29.4241, lon:-98.4936, minKHz:10, maxKHz:30000 },
  { id:'22204.proxy.kiwisdr.com:8073', name:'K4MIE 0-30 MHz SDR', location:'Huntsville, Alabama', url:'http://22204.proxy.kiwisdr.com:8073', lat:34.7304, lon:-86.5861, minKHz:10, maxKHz:30000 },
  { id:'22581.proxy.kiwisdr.com:8073', name:'KiwiSDR V2 Hartwell GA', location:'Hartwell, Georgia', url:'http://22581.proxy.kiwisdr.com:8073', lat:34.3529, lon:-82.9321, minKHz:10, maxKHz:30000 },
  { id:'p3hosting.dscloud.biz:8073', name:'0-30 MHz SDR | Boone NC', location:'Boone, North Carolina', url:'http://p3hosting.dscloud.biz:8073', lat:36.2168, lon:-81.6746, minKHz:10, maxKHz:30000 },
  { id:'22551.proxy.kiwisdr.com:8073', name:'KZ4MR 0-30 MHz SDR', location:'Leesburg, Virginia', url:'http://22551.proxy.kiwisdr.com:8073', lat:39.1157, lon:-77.5636, minKHz:10, maxKHz:30000 },
  { id:'22338.proxy.kiwisdr.com:8073', name:"WF7I's SDR", location:'Natural Bridge, Virginia', url:'http://22338.proxy.kiwisdr.com:8073', lat:37.6285, lon:-79.5439, minKHz:10, maxKHz:30000 },
  { id:'21690.proxy.kiwisdr.com:8073', name:'0-30 MHz SDR | Hilliard Ohio', location:'Hilliard, Ohio', url:'http://21690.proxy.kiwisdr.com:8073', lat:40.0334, lon:-83.1582, minKHz:10, maxKHz:30000 },
  { id:'rgv.twrmon.net:8075', name:'0-30 MHz SDR | Brownsville Texas', location:'Brownsville, Texas', url:'http://rgv.twrmon.net:8075', lat:25.9017, lon:-97.4975, minKHz:10, maxKHz:30000 },
  { id:'kiwisdr1.sdrutah.org:8073', name:'Northern Utah KiwiSDR #1', location:'Northern Utah', url:'http://kiwisdr1.sdrutah.org:8073', lat:40.7608, lon:-111.8910, minKHz:10, maxKHz:30000 },
  { id:'kiwisdr2.sdrutah.org:8074', name:'Northern Utah KiwiSDR #2', location:'Northern Utah', url:'http://kiwisdr2.sdrutah.org:8074', lat:40.7608, lon:-111.8910, minKHz:10, maxKHz:30000 },
  { id:'km6cq.hopto.org:8073', name:'KM6CQ Ponderosa SDR', location:'Washoe Valley, Nevada', url:'http://km6cq.hopto.org:8073', lat:39.2830, lon:-119.8280, minKHz:100, maxKHz:30000 },
  { id:'22148.proxy.kiwisdr.com:8073', name:'0-30 MHz SDR | Bend Oregon', location:'Bend, Oregon', url:'http://22148.proxy.kiwisdr.com:8073', lat:44.0582, lon:-121.3153, minKHz:10, maxKHz:30000 },
  { id:'mtkiwi.proxy.kiwisdr.com:8073', name:'0-30 MHz SDR | Stevensville MT', location:'Stevensville, Montana', url:'http://mtkiwi.proxy.kiwisdr.com:8073', lat:46.5099, lon:-114.0932, minKHz:10, maxKHz:30000 },
  { id:'k7len.proxy.kiwisdr.com:8073', name:'K7LEN 0-30 MHz SDR', location:'Worley, Idaho', url:'http://k7len.proxy.kiwisdr.com:8073', lat:47.4007, lon:-116.9207, minKHz:10, maxKHz:30000 },
  { id:'n7drd.proxy.kiwisdr.com:8073', name:'0-30 MHz SDR | Ocean Park WA', location:'Ocean Park, Washington', url:'http://n7drd.proxy.kiwisdr.com:8073', lat:46.4918, lon:-124.0526, minKHz:10, maxKHz:30000 },
  { id:'palomar-1.proxy.kiwisdr.com:8073', name:'K6VZK KiwiSDR #1', location:'Palomar Mountain, California', url:'http://palomar-1.proxy.kiwisdr.com:8073', lat:33.3220, lon:-116.8640, minKHz:10, maxKHz:30000 }
];

function finite(v){if(v==null||String(v).trim()==='')return null;const n=Number(v);return Number.isFinite(n)?n:null;}
function clamp(v,min,max){return Math.max(min,Math.min(max,v));}
function milesBetween(lat1,lon1,lat2,lon2){if(![lat1,lon1,lat2,lon2].every(Number.isFinite))return null;const r=Math.PI/180;const a=Math.sin((lat2-lat1)*r/2)**2+Math.cos(lat1*r)*Math.cos(lat2*r)*Math.sin((lon2-lon1)*r/2)**2;return 2*3958.8*Math.asin(Math.sqrt(a));}
function solarHour(lon,date=new Date()){return Number.isFinite(lon)?(date.getUTCHours()+date.getUTCMinutes()/60+lon/15+24)%24:null;}
function proximityScore(d){if(!Number.isFinite(d))return 28;if(d<=50)return 100;if(d<=150)return 96-(d-50)*.08;if(d<=400)return 88-(d-150)*.12;if(d<=900)return 58-(d-400)*.07;return Math.max(4,23-(d-900)*.012);}
function solarSimilarity(userLon,receiverLon,frequencyKHz){const u=solarHour(userLon),r=solarHour(receiverLon);if(!Number.isFinite(u)||!Number.isFinite(r))return 50;const un=u>=19||u<6,rn=r>=19||r<6;let s=un===rn?92:48;const mhz=frequencyKHz/1000;if(mhz<8&&un&&rn)s+=8;if(mhz>16&&!un&&!rn)s+=6;return clamp(s,0,100);}

export function rankSeedReceivers({frequencyKHz,userLat,userLon,txLat,txLon}){
  const f=finite(frequencyKHz),uLat=finite(userLat),uLon=finite(userLon),tLat=finite(txLat),tLon=finite(txLon);if(!Number.isFinite(f))return[];
  const hasUser=Number.isFinite(uLat)&&Number.isFinite(uLon),hasTx=Number.isFinite(tLat)&&Number.isFinite(tLon),local=f<2000,direct=hasUser&&hasTx?milesBetween(uLat,uLon,tLat,tLon):null;
  const eligible=SDR_DIRECTORY_SEED.filter(r=>f>=r.minKHz&&f<=r.maxKHz).map(r=>{const ud=hasUser?milesBetween(uLat,uLon,r.lat,r.lon):null,td=hasTx?milesBetween(tLat,tLon,r.lat,r.lon):null,p=proximityScore(ud);let path=50;if(Number.isFinite(direct)&&Number.isFinite(ud)&&Number.isFinite(td)){path=clamp(100-Math.abs(td-direct)/Math.max(12,direct*.012),0,100);const detour=Math.max(0,ud+td-direct);path=clamp(path-detour/Math.max(20,direct*.025),0,100);}const solar=solarSimilarity(uLon,r.lon,f);let score;if(local)score=hasUser?p*.92+8:45;else if(hasUser&&hasTx)score=p*.50+path*.38+solar*.12;else if(hasUser)score=p*.82+solar*.18;else if(hasTx&&Number.isFinite(td))score=clamp(100-td/30,5,95);else score=50;return{...r,userDistance:ud,txDistance:td,pathSimilarity:path,solar,score};}).sort((a,b)=>b.score-a.score||(a.userDistance??Infinity)-(b.userDistance??Infinity));
  if(!eligible.length)return[];const picks=[],picked=new Set();const add=(r,role,reason)=>{if(!r||picked.has(r.id))return;picked.add(r.id);picks.push({...r,role,reason});};const best=eligible[0];
  if(local){const d=Number.isFinite(best.userDistance)?`${Math.round(best.userDistance)} mi from you`:'best available receiver';add(best,'NEAR YOU',`Closest useful built-in receiver for this local/regional frequency · ${d}.`);}else{const near=Number.isFinite(best.userDistance)&&best.userDistance<=250;add(best,near?'NEAR YOU':'BEST MATCH',near?'Closest strong built-in match to your listening location while keeping a useful HF path.':'Best built-in balance of your location, transmitter path, frequency, and current day/night conditions.');}
  if(hasUser)add([...eligible].sort((a,b)=>(a.userDistance??Infinity)-(b.userDistance??Infinity))[0],'NEAR YOU','Useful comparison point because its RF environment is geographically closest to yours.');
  if(!local&&hasTx)add([...eligible].sort((a,b)=>(a.txDistance??Infinity)-(b.txDistance??Infinity))[0],'STATION CHECK','Closer to the transmitter; useful for checking whether the broadcast appears to be reaching the airwaves.');
  if(!local&&hasUser&&hasTx)add([...eligible].filter(r=>r.id!==best.id).sort((a,b)=>(b.pathSimilarity*.72+b.solar*.28)-(a.pathSimilarity*.72+a.solar*.28))[0],'PROPAGATION ALT','Alternate built-in receiver with a similar transmitter path and useful HF propagation geometry.');
  for(const r of eligible){if(picks.length>=7)break;add(r,'ALTERNATE','Another built-in public KiwiSDR that covers this frequency.');}
  return picks.map((r,i)=>({id:r.id,name:r.name,location:r.location,lat:r.lat,lon:r.lon,minKHz:r.minKHz,maxKHz:r.maxKHz,coverageKnown:true,version:'',distanceMiles:Number.isFinite(r.userDistance)?Math.round(r.userDistance):null,transmitterDistanceMiles:Number.isFinite(r.txDistance)?Math.round(r.txDistance):null,role:r.role,reason:r.reason,recommended:i===0}));
}
