(() => {
  const PROFILES = [
    {
      re:/UNITED STATES AGENCY FOR GLOBAL MEDIA|\bUSAGM\b/i,
      title:(lang)=>`U.S. international broadcasting${lang ? ` — ${lang}` : ''}`,
      note:'USAGM transmission carrying U.S. international news, current affairs, interviews, public-affairs features and regional service programming. The exact network or show can vary by feed.'
    },
    {
      re:/VOICE OF AMERICA|\bVOA\b/i,
      title:(lang)=>`Voice of America${lang ? ` — ${lang} service` : ''}`,
      note:'VOA international programming typically mixes world and regional news, current affairs, interviews, U.S. features, music and audience-focused service programming.'
    },
    {
      re:/RADIO (?:TELEVISION )?MART[IÍ]|MART[IÍ] NOTICIAS/i,
      title:()=> 'Radio Martí — Cuba-focused Spanish service',
      note:'Spanish-language news, current affairs, interviews, commentary and information aimed primarily at audiences in Cuba.'
    },
    {
      re:/RADIO FREE ASIA|\bRFA\b/i,
      title:(lang)=>`Radio Free Asia${lang ? ` — ${lang} service` : ''}`,
      note:'Regional news, current affairs, human-rights reporting, interviews and information programming aimed at audiences in Asia.'
    },
    {
      re:/BBC WORLD SERVICE|BRITISH BROADCASTING CORPORATION/i,
      title:(lang)=>`BBC World Service${lang ? ` — ${lang}` : ''}`,
      note:'Global news, breaking events, analysis, interviews, documentaries, science, culture and feature programming from the BBC World Service.'
    },
    {
      re:/CHINA RADIO INTERNATIONAL|\bCRI\b/i,
      title:(lang)=>`China Radio International${lang ? ` — ${lang} service` : ''}`,
      note:'International news and current affairs alongside Chinese culture, business, interviews, features, music and language-service programming.'
    },
    {
      re:/CHINA NATIONAL RADIO|\bCNR\b/i,
      title:(lang)=>`China National Radio${lang ? ` — ${lang}` : ''}`,
      note:'Chinese domestic public-service programming that can include national and regional news, talk, information, culture and music.'
    },
    {
      re:/RADIO ROMANIA INTERNATIONAL/i,
      title:(lang)=>`Radio Romania International${lang ? ` — ${lang}` : ''}`,
      note:'Romanian international-service programming with news, current affairs, culture, history, travel, music, sports and listener features.'
    },
    {
      re:/RADIO EXTERIOR DE ESPA(?:ÑA|NA)|\bREE\b/i,
      title:(lang)=>`Radio Exterior de España${lang ? ` — ${lang}` : ''}`,
      note:'Spain’s international public-radio service with news, current affairs, Spanish culture, sports, interviews, music and features.'
    },
    {
      re:/RNZ PACIFIC|RADIO NEW ZEALAND INTERNATIONAL|\bRNZI\b/i,
      title:()=> 'RNZ Pacific',
      note:'Pacific regional news, current affairs, weather and cyclone information, interviews, music, culture and public-service programming from New Zealand.'
    },
    {
      re:/SOLOMON ISLANDS BROADCASTING|\bSIBC\b/i,
      title:()=> 'Solomon Islands Broadcasting / SIBC',
      note:'Solomon Islands domestic public-service programming with local and national news, community information, government updates, talk, music and culture.'
    },
    {
      re:/WEWN|EWTN|ETERNAL WORD/i,
      title:(lang)=>`EWTN / WEWN${lang ? ` — ${lang}` : ''}`,
      note:'Catholic programming including religious teaching, prayer, devotional programs, church news, interviews, call-in shows and faith-focused features.'
    },
    {
      re:/\bWWCR\b|WNQM/i,
      title:()=> 'WWCR — brokered shortwave programming',
      note:'Primarily Christian teaching and ministry programs, with talk, commentary and specialty independently produced shows depending on the hour and transmitter.'
    },
    {
      re:/\bWBCQ\b|ALLAN H\. WEINER/i,
      title:()=> 'WBCQ — independent / brokered programming',
      note:'Independent shortwave programming that can include talk, religion, political commentary, music, hobby-radio shows and other brokered or independently produced programs.'
    },
    {
      re:/\bWRMI\b|RADIO MIAMI INTERNATIONAL/i,
      title:()=> 'WRMI — relay / independent programming',
      note:'WRMI carries a wide mix of international relays and independent shows including news and culture, religion, music, DX and radio-hobby programs, talk and specialty programming.'
    },
    {
      re:/NHK|RADIO JAPAN|NIPPON HOSO/i,
      title:(lang)=>`NHK World Radio Japan${lang ? ` — ${lang}` : ''}`,
      note:'Japanese international-service programming with news, current affairs, Japanese culture, society, language and music features.'
    },
    {
      re:/KBS WORLD RADIO|KOREAN BROADCASTING SYSTEM/i,
      title:(lang)=>`KBS World Radio${lang ? ` — ${lang}` : ''}`,
      note:'South Korean international programming with news, current affairs, Korean culture, entertainment, music and listener features.'
    },
    {
      re:/RADIO TAIWAN INTERNATIONAL|\bRTI\b/i,
      title:(lang)=>`Radio Taiwan International${lang ? ` — ${lang}` : ''}`,
      note:'Taiwan-focused international news, current affairs, culture, society, technology, music and listener programming.'
    },
    {
      re:/VOICE OF TURKEY|TURKIYE'NIN SESI|TRT/i,
      title:(lang)=>`Voice of Türkiye${lang ? ` — ${lang}` : ''}`,
      note:'Türkiye’s international radio service with news, current affairs, Turkish culture, history, tourism, music and features.'
    },
    {
      re:/VOICE OF KOREA/i,
      title:(lang)=>`Voice of Korea${lang ? ` — ${lang}` : ''}`,
      note:'North Korean state international broadcasting with official news, political commentary, cultural features, music and DPRK-focused programming.'
    },
    {
      re:/ALL INDIA RADIO|AKASHVANI/i,
      title:(lang)=>`Akashvani / All India Radio${lang ? ` — ${lang}` : ''}`,
      note:'Indian public-service programming with national and regional news, current affairs, culture, music, features and international-service content.'
    },
    {
      re:/RADIO FRANCE INTERNATIONALE|\bRFI\b/i,
      title:(lang)=>`Radio France Internationale${lang ? ` — ${lang}` : ''}`,
      note:'International news, analysis, interviews, culture, sports and regional current-affairs programming from France.'
    },
    {
      re:/DEUTSCHE WELLE|\bDW\b/i,
      title:(lang)=>`Deutsche Welle${lang ? ` — ${lang}` : ''}`,
      note:'German international public-media programming focused on world news, analysis, politics, business, culture and regional affairs.'
    },
    {
      re:/VATICAN RADIO/i,
      title:(lang)=>`Vatican Radio${lang ? ` — ${lang}` : ''}`,
      note:'Catholic news, papal and Vatican coverage, prayer, liturgy, religious teaching, interviews and international church affairs.'
    },
    {
      re:/ADVENTIST WORLD RADIO|\bAWR\b/i,
      title:(lang)=>`Adventist World Radio${lang ? ` — ${lang}` : ''}`,
      note:'Christian religious programming including Bible teaching, health and family features, music, testimonies and regional-language ministry programs.'
    },
    {
      re:/TRANS WORLD RADIO|\bTWR\b/i,
      title:(lang)=>`Trans World Radio${lang ? ` — ${lang}` : ''}`,
      note:'Christian teaching, Bible programs, devotional content, family and community features, music and regional-language ministry programming.'
    },
    {
      re:/FAR EAST BROADCASTING|\bFEBC\b/i,
      title:(lang)=>`Far East Broadcasting Company${lang ? ` — ${lang}` : ''}`,
      note:'Christian and community-oriented programming including teaching, music, family features and regional-language broadcasts.'
    },
    {
      re:/RADIO HABANA CUBA|RADIO HAVANA CUBA|\bRHC\b/i,
      title:(lang)=>`Radio Havana Cuba${lang ? ` — ${lang}` : ''}`,
      note:'Cuban international broadcasting with official news, politics and commentary, Cuban culture, music, history and international features.'
    },
    {
      re:/RADIO NACIONAL DA AMAZ[ÔO]NIA|RADIOBRAS|EBC/i,
      title:(lang)=>`Brazilian public radio${lang ? ` — ${lang}` : ''}`,
      note:'Brazilian public-service programming with news, regional information, culture, music, interviews and national features.'
    },
    {
      re:/VOICE OF THE ISLAMIC REPUBLIC|IRIB|RADIO IRAN/i,
      title:(lang)=>`Iran international service${lang ? ` — ${lang}` : ''}`,
      note:'Iranian state international programming with official news and commentary, regional affairs, culture, religion and features.'
    },
    {
      re:/RADIO SAUDI|SAUDI BROADCASTING|QURAN/i,
      title:(lang)=>`Saudi international / religious service${lang ? ` — ${lang}` : ''}`,
      note:'Saudi broadcasting that can include Qur’an recitation, Islamic religious programming, official news, culture and international-service content.'
    },
    {
      re:/VOICE OF VIETNAM|\bVOV\b/i,
      title:(lang)=>`Voice of Vietnam${lang ? ` — ${lang}` : ''}`,
      note:'Vietnamese international programming with news, current affairs, culture, tourism, music and listener-oriented features.'
    },
    {
      re:/RADIO THAILAND/i,
      title:(lang)=>`Radio Thailand${lang ? ` — ${lang}` : ''}`,
      note:'Thai international-service programming with news, current affairs, tourism, culture, business and national features.'
    },
    {
      re:/KVOH|VOICE OF HOPE/i,
      title:()=> 'Voice of Hope / KVOH',
      note:'Christian shortwave programming with Bible teaching, ministry shows, music, talk and religious features.'
    },
    {
      re:/\bWINB\b/i,
      title:()=> 'WINB — brokered shortwave programming',
      note:'Brokered shortwave programming that commonly includes religious teaching, ministries, talk and specialty independent programs.'
    },
    {
      re:/\bWMLK\b|ASSEMBLIES OF YAHWEH/i,
      title:()=> 'WMLK / Assemblies of Yahweh',
      note:'Religious programming from the Assemblies of Yahweh, including scripture teaching, sermons and ministry broadcasts.'
    }
  ];

  const LANGUAGE_RE = /English|Spanish|French|German|Portuguese|Arabic|Chinese|Japanese|Korean|Russian|Romanian|Italian|Dutch|Polish|Hindi|Urdu|Persian|Turkish|Swahili|Hausa|Afrikaans|Amharic|Tigrinya|Thai|Vietnamese|Indonesian|Malay|Tagalog|Ukrainian|Bulgarian|Serbian|Croatian|Greek|Hebrew|Danish|Norwegian|Swedish|Finnish/i;

  function esc(value) {
    return String(value ?? '')
      .replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;')
      .replaceAll('"','&quot;').replaceAll("'",'&#039;');
  }

  function stationFrom(card) {
    return card.querySelector('.station-name')?.textContent?.trim()
      || card.querySelector('h3')?.textContent?.trim()
      || '';
  }

  function tagsFrom(card) {
    return [...card.querySelectorAll('.tags .tag, .lookup-tags .lookup-tag')]
      .map((tag)=>tag.textContent.trim()).filter(Boolean);
  }

  function languageFrom(card) {
    return tagsFrom(card).find((tag)=>LANGUAGE_RE.test(tag)) || '';
  }

  function transmitterFrom(card) {
    const detail = [...card.querySelectorAll('.details .detail')]
      .find((item)=>String(item.childNodes?.[0]?.textContent || '').trim() === 'Transmitter');
    return detail?.querySelector('b')?.textContent?.trim() || '';
  }

  function formatFrom(card) {
    const tags = tagsFrom(card);
    return tags.find((tag)=>/broadcast|religious|international|digital|DRM/i.test(tag)) || 'shortwave broadcast';
  }

  function profileFor(card) {
    const station = stationFrom(card);
    const language = languageFrom(card);
    const profile = PROFILES.find((item)=>item.re.test(station));
    if (profile) return {
      title:profile.title(language),
      note:profile.note
    };

    const transmitter = transmitterFrom(card);
    const format = formatFrom(card);
    const lang = language && !/unknown/i.test(language) ? `${language} ` : '';
    return {
      title:`${station || 'Broadcast service'} — ${lang}${format}`,
      note:`This is a scheduled ${lang.toLowerCase()}${format.toLowerCase()}${transmitter ? ` from ${transmitter}` : ''}. FREQBEACON has the active carrier and service identification, but this broadcaster does not currently expose an exact show title through an integrated program guide.`
    };
  }

  function isUsefulWarning(slot) {
    const text = slot.textContent || '';
    return /PUBLISHED LISTINGS CONFLICT|overlap|will not guess/i.test(text);
  }

  function renderProfile(card, slot) {
    if (!slot || slot.classList.contains('is-verified') || slot.classList.contains('is-broadcast')) return;
    if (slot.classList.contains('is-loading')) return;
    if (slot.classList.contains('is-warning') && isUsefulWarning(slot)) return;

    const profile = profileFor(card);
    if (!profile.title || !profile.note) return;
    slot.classList.remove('is-warning','is-service','is-loading');
    slot.classList.add('is-service','is-profile');
    slot.innerHTML = `
      <div class="program-guide-kicker"><span class="program-profile-dot"></span>ON NOW · PROGRAMMING PROFILE</div>
      <div class="program-guide-title">${esc(profile.title)}</div>
      <div class="program-guide-note">${esc(profile.note)}</div>`;
    slot.dataset.programContext = 'true';
  }

  function scan(root=document) {
    root.querySelectorAll('.signal-card, .lookup-result').forEach((card)=>{
      const slot = card.querySelector('[data-program-guide]');
      if (!slot) return;
      if (slot.classList.contains('is-verified') || slot.classList.contains('is-broadcast')) return;
      renderProfile(card, slot);
    });
  }

  const style = document.createElement('style');
  style.textContent = `
    .program-guide-card.is-profile{border-color:rgba(78,187,206,.34);background:linear-gradient(135deg,rgba(37,212,230,.055),rgba(4,11,14,.84));}
    .program-guide-card.is-profile .program-guide-kicker{color:#8ccbd5;}
    .program-profile-dot{width:7px;height:7px;border-radius:50%;flex:0 0 auto;background:#6f9fa8;box-shadow:0 0 8px rgba(111,159,168,.35);}
  `;
  document.head.appendChild(style);

  const grid = document.getElementById('signalGrid');
  const lookup = document.getElementById('lookupResults');
  if (grid) new MutationObserver(()=>setTimeout(()=>scan(grid), 250)).observe(grid,{childList:true,subtree:true});
  if (lookup) new MutationObserver(()=>setTimeout(()=>scan(lookup), 250)).observe(lookup,{childList:true,subtree:true});

  setTimeout(()=>scan(), 900);
  setTimeout(()=>scan(), 1800);
})();
