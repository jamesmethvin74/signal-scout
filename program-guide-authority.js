(() => {
  const PROFILES = [
    [/UNITED STATES AGENCY FOR GLOBAL MEDIA|\bUSAGM\b/i, (l)=>`U.S. international broadcasting${l ? ` — ${l}` : ''}`, 'U.S. international-service programming with news, current affairs, interviews, public-affairs features and regional service content. The exact network or show can vary by feed.'],
    [/VOICE OF AMERICA|\bVOA\b/i, (l)=>`Voice of America${l ? ` — ${l} service` : ''}`, 'World and regional news, current affairs, interviews, U.S. features, music and audience-focused international-service programming.'],
    [/RADIO (?:TELEVISION )?MART[IÍ]|MART[IÍ] NOTICIAS/i, ()=> 'Radio Martí — Cuba-focused Spanish service', 'Spanish-language news, current affairs, interviews, commentary and information aimed primarily at audiences in Cuba.'],
    [/RADIO FREE ASIA|\bRFA\b/i, (l)=>`Radio Free Asia${l ? ` — ${l} service` : ''}`, 'Regional news, current affairs, human-rights reporting, interviews and information programming aimed at audiences in Asia.'],
    [/BBC WORLD SERVICE|BRITISH BROADCASTING CORPORATION/i, (l)=>`BBC World Service${l ? ` — ${l}` : ''}`, 'Global news, breaking events, analysis, interviews, documentaries, science, culture and feature programming from the BBC World Service.'],
    [/CHINA RADIO INTERNATIONAL|\bCRI\b/i, (l)=>`China Radio International${l ? ` — ${l} service` : ''}`, 'International and Chinese news, current affairs, Chinese culture, business, interviews, features, music and language-service programming.'],
    [/CHINA NATIONAL RADIO|\bCNR\b/i, (l)=>`China National Radio${l ? ` — ${l}` : ''}`, 'Chinese domestic public-service programming that can include national and regional news, talk, information, culture and music.'],
    [/RADIO ROMANIA INTERNATIONAL/i, (l)=>`Radio Romania International${l ? ` — ${l}` : ''}`, 'Romanian international-service programming with news, current affairs, culture, history, travel, music, sports and listener features.'],
    [/RADIO EXTERIOR DE ESPA(?:ÑA|NA)|\bREE\b/i, (l)=>`Radio Exterior de España${l ? ` — ${l}` : ''}`, 'Spain’s international public-radio service with news, current affairs, Spanish culture, sports, interviews, music and features.'],
    [/RNZ PACIFIC|RADIO NEW ZEALAND INTERNATIONAL|\bRNZI\b/i, ()=> 'RNZ Pacific', 'Pacific regional news, current affairs, weather and cyclone information, interviews, music, culture and public-service programming from New Zealand.'],
    [/SOLOMON ISLANDS BROADCASTING|\bSIBC\b/i, ()=> 'Solomon Islands Broadcasting / SIBC', 'Solomon Islands domestic public-service programming with local and national news, community information, government updates, talk, music and culture.'],
    [/WEWN|EWTN|ETERNAL WORD/i, (l)=>`EWTN / WEWN${l ? ` — ${l}` : ''}`, 'Catholic programming including religious teaching, prayer, devotional programs, church news, interviews, call-in shows and faith-focused features.'],
    [/\bWWCR\b|WNQM/i, ()=> 'WWCR — brokered shortwave programming', 'Primarily Christian teaching and ministry programs, with talk, commentary and specialty independently produced shows depending on the hour and transmitter.'],
    [/\bWBCQ\b|ALLAN H\. WEINER/i, ()=> 'WBCQ — independent / brokered programming', 'Independent shortwave programming that can include talk, religion, political commentary, music, hobby-radio shows and other brokered or independently produced programs.'],
    [/\bWRMI\b|RADIO MIAMI INTERNATIONAL/i, ()=> 'WRMI — relay / independent programming', 'A wide mix of international relays and independent shows including news and culture, religion, music, DX and radio-hobby programs, talk and specialty programming.'],
    [/NHK|RADIO JAPAN|NIPPON HOSO/i, (l)=>`NHK World Radio Japan${l ? ` — ${l}` : ''}`, 'Japanese international-service programming with news, current affairs, Japanese culture, society, language and music features.'],
    [/KBS WORLD RADIO|KOREAN BROADCASTING SYSTEM/i, (l)=>`KBS World Radio${l ? ` — ${l}` : ''}`, 'South Korean international programming with news, current affairs, Korean culture, entertainment, music and listener features.'],
    [/RADIO TAIWAN INTERNATIONAL|\bRTI\b/i, (l)=>`Radio Taiwan International${l ? ` — ${l}` : ''}`, 'Taiwan-focused international news, current affairs, culture, society, technology, music and listener programming.'],
    [/VOICE OF TURKEY|VOICE OF TÜRKIYE|TRT/i, (l)=>`Voice of Türkiye${l ? ` — ${l}` : ''}`, 'Türkiye’s international radio service with news, current affairs, Turkish culture, history, tourism, music and features.'],
    [/VOICE OF KOREA/i, (l)=>`Voice of Korea${l ? ` — ${l}` : ''}`, 'North Korean state international broadcasting with official news, political commentary, cultural features, music and DPRK-focused programming.'],
    [/ALL INDIA RADIO|AKASHVANI/i, (l)=>`Akashvani / All India Radio${l ? ` — ${l}` : ''}`, 'Indian public-service programming with national and regional news, current affairs, culture, music, features and international-service content.'],
    [/RADIO FRANCE INTERNATIONALE|\bRFI\b/i, (l)=>`Radio France Internationale${l ? ` — ${l}` : ''}`, 'International news, analysis, interviews, culture, sports and regional current-affairs programming from France.'],
    [/DEUTSCHE WELLE|\bDW\b/i, (l)=>`Deutsche Welle${l ? ` — ${l}` : ''}`, 'German international public-media programming focused on world news, analysis, politics, business, culture and regional affairs.'],
    [/VATICAN RADIO/i, (l)=>`Vatican Radio${l ? ` — ${l}` : ''}`, 'Catholic news, papal and Vatican coverage, prayer, liturgy, religious teaching, interviews and international church affairs.'],
    [/ADVENTIST WORLD RADIO|\bAWR\b/i, (l)=>`Adventist World Radio${l ? ` — ${l}` : ''}`, 'Christian religious programming including Bible teaching, health and family features, music, testimonies and regional-language ministry programs.'],
    [/TRANS WORLD RADIO|\bTWR\b/i, (l)=>`Trans World Radio${l ? ` — ${l}` : ''}`, 'Christian teaching, Bible programs, devotional content, family and community features, music and regional-language ministry programming.'],
    [/FAR EAST BROADCASTING|\bFEBC\b/i, (l)=>`Far East Broadcasting Company${l ? ` — ${l}` : ''}`, 'Christian and community-oriented programming including teaching, music, family features and regional-language broadcasts.'],
    [/RADIO HABANA CUBA|RADIO HAVANA CUBA|\bRHC\b/i, (l)=>`Radio Havana Cuba${l ? ` — ${l}` : ''}`, 'Cuban international broadcasting with official news, politics and commentary, Cuban culture, music, history and international features.'],
    [/RADIO NACIONAL DA AMAZ[ÔO]NIA|RADIOBRAS|EBC/i, (l)=>`Brazilian public radio${l ? ` — ${l}` : ''}`, 'Brazilian public-service programming with news, regional information, culture, music, interviews and national features.'],
    [/VOICE OF THE ISLAMIC REPUBLIC|IRIB|RADIO IRAN/i, (l)=>`Iran international service${l ? ` — ${l}` : ''}`, 'Iranian state international programming with official news and commentary, regional affairs, culture, religion and features.'],
    [/RADIO SAUDI|SAUDI BROADCASTING|QURAN/i, (l)=>`Saudi international / religious service${l ? ` — ${l}` : ''}`, 'Saudi broadcasting that can include Qur’an recitation, Islamic religious programming, official news, culture and international-service content.'],
    [/VOICE OF VIETNAM|\bVOV\b/i, (l)=>`Voice of Vietnam${l ? ` — ${l}` : ''}`, 'Vietnamese international programming with news, current affairs, culture, tourism, music and listener-oriented features.'],
    [/RADIO THAILAND/i, (l)=>`Radio Thailand${l ? ` — ${l}` : ''}`, 'Thai international-service programming with news, current affairs, tourism, culture, business and national features.'],
    [/KVOH|VOICE OF HOPE/i, ()=> 'Voice of Hope / KVOH', 'Christian shortwave programming with Bible teaching, ministry shows, music, talk and religious features.'],
    [/\bWINB\b/i, ()=> 'WINB — brokered shortwave programming', 'Brokered shortwave programming that commonly includes religious teaching, ministries, talk and specialty independent programs.'],
    [/\bWMLK\b|ASSEMBLIES OF YAHWEH/i, ()=> 'WMLK / Assemblies of Yahweh', 'Religious programming from the Assemblies of Yahweh, including scripture teaching, sermons and ministry broadcasts.']
  ];

  const LANGUAGE_RE = /English|Spanish|French|German|Portuguese|Arabic|Chinese|Japanese|Korean|Russian|Romanian|Italian|Dutch|Polish|Hindi|Urdu|Persian|Turkish|Swahili|Hausa|Afrikaans|Amharic|Tigrinya|Thai|Vietnamese|Indonesian|Malay|Tagalog|Ukrainian|Bulgarian|Serbian|Croatian|Greek|Hebrew|Danish|Norwegian|Swedish|Finnish/i;
  let scanQueued = false;

  function esc(value) { return String(value ?? '').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;'); }
  function stationFrom(card) { return card.querySelector('.station-name')?.textContent?.trim() || card.querySelector('h3')?.textContent?.trim() || ''; }
  function tagsFrom(card) { return [...card.querySelectorAll('.tags .tag, .lookup-tags .lookup-tag')].map((tag)=>tag.textContent.trim()).filter(Boolean); }
  function languageFrom(card) { return tagsFrom(card).find((tag)=>LANGUAGE_RE.test(tag)) || ''; }
  function transmitterFrom(card) {
    const detail = [...card.querySelectorAll('.details .detail')].find((item)=>String(item.childNodes?.[0]?.textContent || '').trim() === 'Transmitter');
    return detail?.querySelector('b')?.textContent?.trim() || '';
  }
  function formatFrom(card) { return tagsFrom(card).find((tag)=>/broadcast|religious|international|digital|DRM/i.test(tag)) || 'shortwave broadcast'; }
  function profileFor(card) {
    const station = stationFrom(card);
    const language = languageFrom(card);
    const found = PROFILES.find(([re])=>re.test(station));
    if (found) return { title:found[1](language), note:found[2] };
    const transmitter = transmitterFrom(card);
    const format = formatFrom(card);
    const lang = language && !/unknown/i.test(language) ? language : '';
    return {
      title:`${station || 'Broadcast service'}${lang ? ` — ${lang}` : ''}`,
      note:`Scheduled ${lang ? `${lang.toLowerCase()} ` : ''}${format.toLowerCase()}${transmitter ? ` from ${transmitter}` : ''}. FREQBEACON identifies this carrier as active now, but an exact show title is not available from a current integrated broadcaster guide.`
    };
  }
  function preserve(slot) {
    if (slot.classList.contains('is-verified') || slot.classList.contains('is-broadcast')) return true;
    const text = slot.textContent || '';
    return /PUBLISHED LISTINGS CONFLICT|official listings overlap|will not guess/i.test(text);
  }
  function renderProfile(card, slot) {
    if (!slot || preserve(slot)) return;
    if (slot.classList.contains('is-loading')) {
      if (!slot.dataset.authorityWait) {
        slot.dataset.authorityWait = '1';
        setTimeout(()=>renderProfile(card, slot),3000);
      }
      return;
    }
    const profile = profileFor(card);
    const signature = `${profile.title}|${profile.note}`;
    if (slot.dataset.authoritySignature === signature && slot.classList.contains('is-profile')) return;
    slot.classList.remove('is-warning','is-service','is-loading');
    slot.classList.add('is-service','is-profile');
    slot.dataset.authoritySignature = signature;
    slot.innerHTML = `\n      <div class="program-guide-kicker"><span class="program-profile-dot"></span>ON NOW · PROGRAMMING PROFILE</div>\n      <div class="program-guide-title">${esc(profile.title)}</div>\n      <div class="program-guide-note">${esc(profile.note)}</div>`;
  }
  function scan() {
    scanQueued = false;
    document.querySelectorAll('.signal-card, .lookup-result').forEach((card)=>{
      const slot = card.querySelector('[data-program-guide]');
      if (slot) renderProfile(card, slot);
    });
  }
  function queueScan() {
    if (scanQueued) return;
    scanQueued = true;
    requestAnimationFrame(scan);
  }

  const style = document.createElement('style');
  style.textContent = `\n    .program-guide-card.is-profile{border-color:rgba(78,187,206,.34);background:linear-gradient(135deg,rgba(37,212,230,.055),rgba(4,11,14,.84));}\n    .program-guide-card.is-profile .program-guide-kicker{color:#8ccbd5;}\n    .program-profile-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;background:#6f9fa8;box-shadow:0 0 8px rgba(111,159,168,.35);}\n  `;
  document.head.appendChild(style);

  new MutationObserver(queueScan).observe(document.body,{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['class']});
  queueScan();
  setTimeout(queueScan,500);
  setTimeout(queueScan,1500);
  setTimeout(queueScan,3500);
})();
