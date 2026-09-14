(() => {
  'use strict';
  const base = window.FREQBEACON_LOOKUP_CATEGORIES;
  const engine = window.FREQBEACON_IDENTIFICATION_ENGINE;
  const stage = document.getElementById('lookupResults');
  const count = document.getElementById('lookupResultCount');
  const status = document.getElementById('lookupStatus');
  const title = document.getElementById('lookupResultsTitle');
  if (!base || !engine || !stage || !count) return;

  const BROADCAST = new Set(['news','sports','religious','propaganda','international']);
  const NEWS = /\bbbc\b|bbc world service|british broadcasting corporation|voice of america|usagm|united states agency for global media|radio free asia|radio free europe|radio liberty|radio exterior de españa|radio romania international|deutsche welle|radio france internationale|nhk world|kbs world|china radio international|rnz pacific|world service|\bnews\b/i;
  const INTERNATIONAL = /\bbbc\b|bbc world service|british broadcasting corporation|voice of america|usagm|radio free asia|radio free europe|radio liberty|radio exterior de españa|radio romania international|deutsche welle|radio france internationale|nhk world|kbs world|china radio international|rnz pacific|voice of turkey/i;
  const STATE = /china radio international|voice of korea|radio pyongyang|radio havana|voice of america|radio romania international|radio exterior de españa|\bbbc\b|bbc world service|rnz pacific|radio france internationale|deutsche welle|voice of turkey|kbs world|nhk world|usagm|radio free/i;
  const RELIGIOUS = /relig|gospel|bible|catholic|christian|adventist|ministry|ministries|evangel|vatican|overcomer/i;
  const TARGETS = [
    ['europe', /\b(eur|europe|weu|eeu|ceu|gbr|britain|united kingdom|uk)\b/i],
    ['north-america', /\b(nam|north america|usa|united states|canada|can|mexico|mex)\b/i],
    ['south-america', /\b(sam|south america|latin america|latam|brazil|bra|argentina|arg)\b/i],
    ['africa', /\b(afr|africa|naf|waf|eaf|saf)\b/i],
    ['asia', /\b(asia|east asia|south asia|southeast asia|eas|sas|sea|korea|japan|china|india|pakistan|iran)\b/i],
    ['oceania', /\b(oceania|oce|australia|aus|pacific|pac|new zealand|nzl)\b/i]
  ];
  const AVIATION = [
    [2872,'North Atlantic MWARA','Gander · Iceland · Shanwick',['europe','north-america']],
    [5598,'North Atlantic MWARA','New York · Gander · Santa Maria · Shanwick',['europe','north-america']],
    [5649,'North Atlantic MWARA','Gander · Iceland · Shanwick',['europe','north-america']],
    [8879,'North Atlantic MWARA','Gander · Iceland · Shanwick',['europe','north-america']],
    [8906,'North Atlantic MWARA','New York · Gander · Santa Maria · Shanwick',['europe','north-america']],
    [13306,'North Atlantic MWARA','New York · Gander · Santa Maria · Shanwick',['europe','north-america']],
    [3413,'Shannon VOLMET','North Atlantic / Western Europe aviation weather',['europe','north-america']],
    [5505,'Shannon VOLMET','North Atlantic / Western Europe aviation weather',['europe','north-america']],
    [8957,'Shannon VOLMET','North Atlantic / Western Europe aviation weather',['europe','north-america']],
    [13264,'Shannon VOLMET','North Atlantic / Western Europe aviation weather',['europe','north-america']],
    [5652,'Pacific MWARA','San Francisco · Guam · Tokyo',['north-america','asia','oceania']],
    [6532,'Pacific MWARA','San Francisco · Guam · Tokyo',['north-america','asia','oceania']],
    [8870,'Pacific MWARA','San Francisco · Guam · Tokyo',['north-america','asia','oceania']],
    [2881,'South America MWARA','Ezeiza',['south-america']],
    [5601,'South America MWARA','Ezeiza',['south-america']]
  ].map(([frequencyKHz,name,serviceArea,regions]) => ({frequencyKHz,name,serviceArea,regions,mode:'USB'}));

  let fullEntries = null;
  let fullLoad = null;
  const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#039;'}[c]));
  const text = (e) => [e?.name,e?.format,e?.description,e?.country,e?.language,e?.target,e?.transmitter].filter(Boolean).join(' ').toLowerCase();
  const freq = (e) => Number(e?.frequencyKHz ?? e?.frequency);
  const normalized = (v) => String(v || '').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();

  function region(receiver) {
    const lat=Number(receiver?.lat), lon=Number(receiver?.lon);
    if (!Number.isFinite(lat)||!Number.isFinite(lon)) return '';
    if (lat>=34&&lat<=72&&lon>=-25&&lon<=45) return 'europe';
    if (lat>=15&&lat<=75&&lon>=-170&&lon<=-50) return 'north-america';
    if (lat>=-58&&lat<15&&lon>=-85&&lon<=-30) return 'south-america';
    if (lat>=-38&&lat<=38&&lon>=-20&&lon<=55) return 'africa';
    if (lat>=5&&lat<=80&&lon>45&&lon<=180) return 'asia';
    if (lat>=-50&&lat<10&&lon>=105&&lon<=180) return 'oceania';
    return '';
  }
  function targetRegion(value) { return TARGETS.find(([,re]) => re.test(String(value||'')))?.[0] || ''; }
  function miles(entry,receiver) {
    if (entry?.locationApproximate === true) return Infinity;
    const a=[Number(entry?.lat),Number(entry?.lon),Number(receiver?.lat),Number(receiver?.lon)];
    if (!a.every(Number.isFinite)) return Infinity;
    try { return engine.milesBetween?.({lat:a[2],lon:a[3]},{lat:a[0],lon:a[1]}) ?? Infinity; } catch { return Infinity; }
  }
  function path(entry,distance,receiver,now) {
    if (!Number.isFinite(distance)) return {score:-160,tier:'unknown',ok:true};
    const kHz=freq(entry), hour=(now.getUTCHours()+now.getUTCMinutes()/60+Number(receiver.lon)/15+24)%24, night=hour<6||hour>=18;
    let soft=1800, hard=3000;
    if (kHz<5000) [soft,hard]=night?[1800,3000]:[900,1900];
    else if (kHz<8000) [soft,hard]=night?[2400,3600]:[1500,2700];
    else if (kHz<12000) [soft,hard]=night?[2800,4200]:[2200,3600];
    else if (kHz<18000) [soft,hard]=night?[1800,3000]:[2500,4000];
    else if (kHz<22000) [soft,hard]=night?[1400,2500]:[2200,3600];
    else [soft,hard]=night?[900,1800]:[1800,3000];
    if (distance<=500) return {score:440,tier:'regional',ok:true};
    if (distance<=1000) return {score:360,tier:'regional',ok:true};
    if (distance<=soft) return {score:220,tier:'good',ok:true};
    if (distance<=hard) return {score:20,tier:'dx',ok:true};
    return {score:-900,tier:'long',ok:false};
  }
  function matches(entry,key) {
    const t=text(entry);
    if (key==='news') return NEWS.test(t)||/current affairs/.test(t);
    if (key==='sports') return /\bsports?\b/.test(t);
    if (key==='religious') return RELIGIOUS.test(t);
    if (key==='propaganda') return STATE.test(t);
    if (key==='international') return INTERNATIONAL.test(t)||/international|world service/.test(t);
    return false;
  }
  function asEntry(s) {
    const rawName=String(s.name||'Shortwave broadcaster');
    const name=normalized(rawName)==='bbc'?'BBC World Service':rawName;
    return {frequencyKHz:Number(s.frequency),name,country:String(s.country||''),transmitter:String(s.transmitter||''),lat:Number(s.lat),lon:Number(s.lon),locationApproximate:s.locationApproximate===true,mode:/DRM/i.test(String(s.format||''))?'DRM':'AM',language:String(s.language||'Unknown'),description:String(s.note||s.format||''),format:String(s.format||''),start:s.start,end:s.end,days:s.days,target:String(s.target||'')};
  }
  async function loadFull() {
    if (fullEntries) return fullEntries;
    if (fullLoad) return fullLoad;
    fullLoad=(async()=>{
      if (!window.SIGNAL_SCOUT_DATA_READY) await new Promise((resolve,reject)=>{
        const script=document.createElement('script');
        script.src='/full-data.js?v=2'; script.async=true; script.dataset.freqbeaconFullData='1';
        script.onload=resolve; script.onerror=()=>reject(new Error('full schedule loader failed')); document.head.appendChild(script);
      });
      if (window.SIGNAL_SCOUT_DATA_READY?.then) await Promise.race([window.SIGNAL_SCOUT_DATA_READY,new Promise((_,reject)=>setTimeout(()=>reject(new Error('full schedule timeout')),9000))]);
      fullEntries=(window.SIGNAL_SCOUT_FULL_SW||[]).map(asEntry).filter((e)=>Number.isFinite(e.frequencyKHz));
      return fullEntries;
    })().catch((e)=>{ fullLoad=null; throw e; });
    return fullLoad;
  }
  function href(entry) {
    const raw=String(entry.mode||'AM').toLowerCase();
    const mode=raw.includes('usb')?'usb':raw.includes('lsb')?'lsb':'am';
    return `/zero?frequency=${encodeURIComponent(freq(entry).toFixed(3))}&mode=${mode}&from=lookup-category`;
  }
  function label(item) { return item.path.tier==='regional'?'BEST BET':item.path.tier==='good'?'GOOD PATH':item.path.tier==='dx'?'DX TRY':'POSSIBLE'; }
  function broadcastCard(item) {
    const e=item.entry;
    const detail=[item.schedule?.active===true?'Scheduled now':'',e.language,e.mode,e.transmitter||e.country,Number.isFinite(item.distance)?`${Math.round(item.distance).toLocaleString()} mi from receiver`:''].filter(Boolean).join(' · ');
    return `<article class="lookup-category-result"><div class="lookup-category-copy"><div class="lookup-category-result-top"><strong>${esc(e.name)}</strong><span class="lookup-status-pill is-now"><i aria-hidden="true"></i>${label(item)}</span></div><span class="lookup-category-frequency">${esc(engine.formatFrequency(e.frequencyKHz))}</span><small>${esc(detail)}</small></div><a class="lookup-tune" href="${esc(href(e))}">TUNE ON RADIO</a></article>`;
  }
  async function browseBroadcast(receiver,key) {
    if (title) title.textContent=`${key.toUpperCase()} ON THIS RECEIVER`;
    stage.innerHTML='<div class="lookup-loading">LOADING THE FULL A26 SCHEDULE…</div>';
    if(status){status.className='lookup-status is-working';status.textContent=`Loading current HFCC/EiBi schedule data for ${receiver.location}…`;}
    let entries; try { entries=await loadFull(); } catch(e){console.warn('FREQBEACON full schedule category load failed',e);return base.browse(receiver);}
    const now=new Date(), area=region(receiver);
    let ranked=entries.filter((e)=>matches(e,key)).map((e)=>{
      const schedule=engine.scheduleState?.(e,now)||null, distance=miles(e,receiver), p=path(e,distance,receiver,now), aimed=targetRegion(e.target), nearby=distance<=600, t=text(e);
      let score=140+p.score+(schedule?.active===true?520:schedule?.active===false?-1600:0);
      if(aimed&&aimed===area)score+=180; else if(aimed&&area&&aimed!==area&&!nearby)score-=360;
      if(INTERNATIONAL.test(t))score+=65; if(key==='news'&&NEWS.test(t))score+=140;
      return {entry:e,schedule,distance,path:p,score};
    }).filter((x)=>x.schedule?.active!==false&&x.path.ok&&x.score>-500).sort((a,b)=>b.score-a.score||a.distance-b.distance);
    const seen=new Set(), unique=[], repeat=[];
    for(const item of ranked){const k=normalized(item.entry.name);if(seen.has(k))repeat.push(item);else{seen.add(k);unique.push(item);}}
    ranked=[...unique,...repeat];
    count.textContent=`${ranked.length.toLocaleString()} ${key} candidate${ranked.length===1?'':'s'}`;
    stage.innerHTML=ranked.length?ranked.slice(0,12).map(broadcastCard).join(''):`<div class="lookup-empty"><strong>No strong ${esc(key)} candidates right now.</strong><p>The full A26 schedule does not currently show a plausible active path for this receiver.</p></div>`;
    if(status){status.className='lookup-status';status.textContent=`${key} · full current A26 HFCC/EiBi schedule + receiver-path ranking · not live signal proof`;}
    return true;
  }
  function airScore(e,receiver) {
    const r=region(receiver); if(!e.regions.includes(r))return -1;
    if(r==='north-america'){const west=Number(receiver.lon)<-105;if(e.name==='Pacific MWARA')return west?900:350;if(e.name!=='Pacific MWARA')return west?350:900;}
    return 900;
  }
  function airCard(e,global=false) {
    const name=e.name||'USAF HFGCS', detail=global?`${e.mode||'USB'} · Global military/utility alternate`:`USB · ${e.serviceArea}`;
    return `<article class="lookup-category-result"><div class="lookup-category-copy"><div class="lookup-category-result-top"><strong>${esc(name)}</strong><span class="lookup-status-pill ${global?'':'is-now'}"><i aria-hidden="true"></i>${global?'GLOBAL AIR':'REGIONAL AIR'}</span></div><span class="lookup-category-frequency">${esc(engine.formatFrequency(freq(e)))}</span><small>${esc(detail)}</small></div><a class="lookup-tune" href="${esc(href(e))}">TUNE ON RADIO</a></article>`;
  }
  async function browseAviation(receiver) {
    if(title)title.textContent='AVIATION ON THIS RECEIVER';
    const regional=AVIATION.map((e)=>({e,score:airScore(e,receiver)})).filter((x)=>x.score>0).sort((a,b)=>b.score-a.score||a.e.frequencyKHz-b.e.frequencyKHz).map((x)=>x.e);
    const global=(window.FREQBEACON_IDENTIFICATION_CATALOG?.entries||[]).filter((e)=>(e.categories||[]).some((c)=>String(c).toLowerCase()==='aviation')&&/hfgcs|military/i.test(text(e))).slice(0,3);
    const total=regional.length+global.length; count.textContent=`${total} Aviation candidate${total===1?'':'s'}`;
    stage.innerHTML=regional.length||global.length?[...regional.map((e)=>airCard(e)),...global.map((e)=>airCard(e,true))].join(''):'<div class="lookup-empty"><strong>No regional aviation set is mapped yet.</strong><p>FREQBEACON will not substitute unrelated U.S. channels just to fill the list.</p></div>';
    if(status){status.className='lookup-status';status.textContent=regional.length?`Aviation · ${region(receiver)} civil HF routes first · global HFGCS only as alternates`:'Aviation · no region-specific civil set mapped yet · global alternates shown separately';}
    return true;
  }
  async function browse(receiver,context={}) {
    const key=base.selected?.()||window.FREQBEACON_LOOKUP_SELECTED_CATEGORY||'';
    if(!receiver||!key)return base.browse(receiver,context);
    if(BROADCAST.has(key))return browseBroadcast(receiver,key);
    if(key==='aviation')return browseAviation(receiver);
    return base.browse(receiver,context);
  }
  window.FREQBEACON_LOOKUP_CATEGORIES=Object.freeze({...base,browse});
})();