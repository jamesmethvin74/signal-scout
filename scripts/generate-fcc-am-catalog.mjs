// FCC first-party AM station identity catalog. Never use third-party mirrors.
import { writeFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const API = 'https://publicfiles.fcc.gov/api/service/facility/search';
const STATES = 'AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC PR VI'.split(' ');
const CENTER = {
  AL:[32.81,-86.79], AK:[64.2,-152.5], AZ:[34.05,-111.09], AR:[34.8,-92.3], CA:[36.8,-119.4],
  CO:[39,-105.55], CT:[41.6,-72.7], DE:[39,-75.5], FL:[27.7,-81.6], GA:[32.1,-83.5],
  HI:[20.9,-157.5], ID:[44.1,-114.7], IL:[40,-89.2], IN:[39.9,-86.3], IA:[42.1,-93.5],
  KS:[38.5,-98], KY:[37.5,-85.3], LA:[31.2,-91.9], ME:[45.3,-69], MD:[39,-76.7],
  MA:[42.3,-71.8], MI:[44.3,-85.5], MN:[46.3,-94.4], MS:[32.7,-89.7], MO:[38.5,-92.5],
  MT:[46.9,-110.4], NE:[41.5,-99.9], NV:[39.3,-116.6], NH:[43.7,-71.6], NJ:[40.1,-74.5],
  NM:[34.5,-106], NY:[42.9,-75.5], NC:[35.5,-79.8], ND:[47.55,-100.5], OH:[40.4,-82.7],
  OK:[35.6,-97.3], OR:[43.9,-120.5], PA:[41.2,-77.2], RI:[41.7,-71.5], SC:[33.9,-80.9],
  SD:[44.4,-100.2], TN:[35.8,-86.4], TX:[31.5,-99.2], UT:[39.4,-111.6], VT:[44.1,-72.7],
  VA:[37.5,-78.8], WA:[47.4,-120.7], WV:[38.6,-80.6], WI:[44.6,-89.5], WY:[43,-107.5],
  DC:[38.9,-77.04], PR:[18.2,-66.5], VI:[18.34,-64.9]
};

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
async function getState(state) {
  const url = API + '/' + encodeURIComponent(state) + '.json';
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const response = await fetch(url, {
        redirect:'follow', headers: {accept:'application/json', 'user-agent':'FREQBEACON/1.0 (freqbeacon.methvindigitalworks.com)'},
        signal: AbortSignal.timeout(13000)
      });
      if (!response.ok) throw new Error('HTTP '+response.status);
      const body = await response.json();
      const results = body?.results?.globalSearchResults;
      if (!results || !Array.isArray(results.amFacilityList)) throw new Error('Missing FCC amFacilityList field');
      const rows = results.amFacilityList.filter(row => String(row.communityState||'').toUpperCase()===state);
      // If the endpoint reports more matches than it returns, fail rather than
      // quietly publish an incomplete state.
      const reported = Number(results.amResultsCount);
      if (Number.isFinite(reported) && reported > results.amFacilityList.length)
        throw new Error('FCC response truncated: '+results.amFacilityList.length+'/'+reported);
      return rows;
    } catch (error) {
      if (attempt === 3) throw new Error('FCC OPIF '+state+': '+String(error?.message||error));
      await pause(450*attempt);
    }
  }
}

function normalize(rows,state) {
  const [fallbackLat,fallbackLon] = CENTER[state];
  const entries=[];
  for (const row of rows) {
    const call = String(row.callSign||'').trim().toUpperCase().replace(/\s*\(AM\)$/,'');
    const frequencyKHz = Number(String(row.frequency??'').replace(/,/g,''));
    const active = String(row.activeInd??'Y').trim().toUpperCase();
    const status = String(row.status||'').toUpperCase();
    if (!/^[KW][A-Z0-9]{2,6}$/.test(call) || frequencyKHz<530 || frequencyKHz>1700
      || !Number.isFinite(frequencyKHz) || active==='N'
      || /CANCEL|EXPIRED|DELETED|TERMINATED/.test(status)) continue;
    const city = String(row.communityCity||'').trim();
    if (!city) continue;
    const lat=Number(row.latitude),lon=Number(row.longitude);
    const hasCoords=Number.isFinite(lat)&&Number.isFinite(lon)&&Math.abs(lat)<=90&&Math.abs(lon)<=180
      && row.latitude!==null && row.latitude!==undefined && row.longitude!==null && row.longitude!==undefined;
    const fid = String(row.id||'').trim();
    entries.push({
      type:'station',band:'MW',frequencyKHz,callsign:call,name:call,
      location:city+', '+state,country:'United States',
      lat:hasCoords?lat:fallbackLat,lon:hasCoords?lon:fallbackLon,
      locationApproximate:!hasCoords,mode:'AM',categories:['broadcast','MW'],
      sourceAuthority:'FCC',sourceTier:1,source:'FCC Public Inspection Files (official U.S. government API)',
      sourceId:fid,facilityId:fid,status:status||'ACTIVE',sourceRegion:'north-america',
      description:'FCC licensed AM broadcast facility in '+city+', '+state+'. Station identity is a candidate, not proof of live reception.'
    });
  }
  return entries;
}

export async function build(fetchState=getState) {
  const items=[];
  for(const state of STATES){
    items.push(...normalize(await fetchState(state),state));
    await pause(200);
  }
  const byId=new Map();
  for(const station of items){
    const key=station.facilityId ? 'fcc:'+station.facilityId : station.frequencyKHz+'|'+station.callsign;
    if (!byId.has(key)) byId.set(key,station);
  }
  const stations=[...byId.values()].sort((a,b)=>a.frequencyKHz-b.frequencyKHz||a.callsign.localeCompare(b.callsign));
  const coveredStates=new Set(stations.map(s=>s.location.split(', ').at(-1)));
  if(stations.length<2800 || coveredStates.size<49) {
    throw new Error('REFUSING INCOMPLETE FCC AM DATA: '+stations.length+' stations, '+coveredStates.size+' jurisdictions; minimum 2800/49');
  }
  const generatedAt=new Date().toISOString();
  const meta={
    version:3,generatedAt,stationCount:stations.length,jurisdictions:coveredStates.size,
    source:API,sourceAuthority:'FCC OPIF',acquisition:'First-party official FCC API, state-keyword queries',
    license:'US Government public-domain factual station records',
    locationAccuracy:'State centroids are used only when the FCC search response lacks station coordinates.'
  };
  const script=`(() => {
  'use strict';
  // Generated from official FCC Public Inspection Files API. Do not hand edit.
  const rows = ${JSON.stringify(stations)};
  window.FREQBEACON_ZERO_US_AM_FCC_CATALOG = Object.freeze(rows.map(e=>Object.freeze({...e,categories:Object.freeze(e.categories)})));
  window.FREQBEACON_ZERO_US_AM_FCC_META = Object.freeze(${JSON.stringify(meta)});
})();
`;
  await writeFile('freqbeacon-zero-us-am-fcc.js',script,'utf8');
  console.log('FCC OPIF AM catalog: '+stations.length+' stations across '+coveredStates.size+' jurisdictions; '+Buffer.byteLength(script)+' bytes');
  return {stations,meta};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)
  build().catch(error=>{console.error(error);process.exitCode=1;});
