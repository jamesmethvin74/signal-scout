(() => {
  const bands = window.SIGNAL_SCOUT_HAM_BANDS || [];
  if (!bands.length) return;

  const ARRL = 'https://www.arrl.org/band-plan';
  const WSJTX = 'https://wsjt.sourceforge.io/Work_the_World_part1.pdf';
  const OMISS = 'https://omiss.net/Facelift/index.php';
  const MMSN = 'https://www.mmsn.org/about-us/about-us.html';
  const REDDIT_7200 = 'https://www.reddit.com/r/amateurradio/comments/1fd2mnw/whats_up_with_7200/';

  const context = (description, sourceLabel, sourceUrl, kind='official') => ({ description, sourceLabel, sourceUrl, kind });
  const q = (label, frequencyMHz, mode, description, sourceLabel, sourceUrl, kind='official') => ({
    label, frequencyMHz, mode, ...context(description, sourceLabel, sourceUrl, kind)
  });

  const replacements = {
    '160m': [
      q('CW QRP',1.810,'usb','ARRL-designated CW QRP activity point. Expect weak CW signals, especially after dark.','ARRL band plan',ARRL),
      q('OMISS SSB net',1.930,'lsb','OMISS uses this area for its 160m SSB net on weekend/early-week UTC sessions. Good for hearing a structured wide-coverage net when 160m is open.','OMISS published net schedule',OMISS),
      q('Beacon range',1.9975,'usb','The upper edge of 160m is identified by ARRL for beacon activity. Useful for propagation checks, though signals can be very weak.','ARRL band plan',ARRL)
    ],
    '80m': [
      q('FT8',3.573,'usb','One of the conventional FT8 dial frequencies. Expect dense, repetitive digital tones rather than voice.','WSJT-X conventional frequencies',WSJTX),
      q('OMISS SSB net',3.825,'lsb','OMISS runs a daily 80m SSB net around this frequency, with additional late sessions seasonally. Often a good place to hear organized check-ins at night.','OMISS published net schedule',OMISS),
      q('SSTV',3.845,'lsb','ARRL lists 3.845 MHz for SSTV activity. You may hear fax-like image tones that can be decoded with SSTV software.','ARRL band plan',ARRL),
      q('AM calling',3.885,'am','ARRL-designated AM calling/activity frequency. Expect full-carrier AM conversations and vintage-radio enthusiasts.','ARRL band plan',ARRL)
    ],
    '60m': [
      q('Channel 1',5.3305,'usb','One of the U.S. 60m channelized USB/CW/data frequencies. Traffic is often regional and propagation can be excellent around twilight.','ARRL band plan',ARRL),
      q('Channel 2',5.3465,'usb','U.S. 60m USB/CW/data channel. Listen for regional SSB contacts and occasional emergency/traffic-oriented operating.','ARRL band plan',ARRL),
      q('USB segment',5.3570,'usb','Inside the newer 5.3515–5.3665 MHz shared segment. Multiple low-power users may operate here rather than one station per channel.','ARRL band plan',ARRL),
      q('Channel 4',5.3715,'usb','U.S. 60m USB/CW/data channel. Often useful during dusk, overnight and early morning regional propagation.','ARRL band plan',ARRL),
      q('Channel 5',5.4035,'usb','Highest of the traditional U.S. 60m channels. Expect USB voice, CW or data within the channel rules.','ARRL band plan',ARRL)
    ],
    '40m': [
      q('RTTY / data',7.040,'usb','ARRL identifies 7.040 MHz as an RTTY/data DX activity point. Expect digital tones and occasional DX-oriented data operation.','ARRL band plan',ARRL),
      q('FT8',7.074,'usb','The conventional 40m FT8 dial frequency and one of the busiest digital watering holes in amateur radio.','WSJT-X conventional frequencies',WSJTX),
      q('SSTV',7.171,'lsb','ARRL-designated 40m SSTV activity frequency. Listen for characteristic image bursts among lower-sideband voice activity.','ARRL band plan',ARRL),
      q('OMISS SSB net',7.194,'lsb','OMISS publishes a daily 40m SSB net near 7.194 MHz (frequency can shift slightly for QRM). Expect orderly check-ins and awards-oriented contacts.','OMISS published net schedule',OMISS),
      q('7200 wild card',7.200,'lsb','A notorious community-reported 40m hangout. Listeners regularly describe heated arguments, political rants, jamming, music and chaotic ragchews here. This reputation is informal — 7.200 MHz is not officially designated for that behavior.','Amateur-radio community reports',REDDIT_7200,'community'),
      q('AM calling',7.290,'am','ARRL-designated 40m AM calling frequency. A good place to hear classic AM audio and vintage-equipment operators.','ARRL band plan',ARRL)
    ],
    '30m': [
      q('FT8',10.136,'usb','The conventional 30m FT8 dial frequency. This CW/data-only band can be surprisingly active for weak-signal DX.','WSJT-X conventional frequencies',WSJTX),
      q('RTTY / data',10.140,'usb','At the upper end of the ARRL RTTY segment; digital activity is common here. U.S. 30m does not permit phone operation.','ARRL band plan',ARRL),
      q('Packet / data',10.145,'usb','ARRL identifies 10.140–10.150 MHz for packet/data activity. Expect machine-generated signals rather than voice.','ARRL band plan',ARRL)
    ],
    '20m': [
      q('FT8',14.074,'usb','The conventional 20m FT8 dial frequency. Often packed with weak-signal contacts from multiple continents when 20m is open.','WSJT-X conventional frequencies',WSJTX),
      q('NCDXF beacons',14.100,'usb','The international beacon network frequency. Beacons transmit in sequence from sites around the world, making this an excellent propagation check.','ARRL band plan',ARRL),
      q('SSTV',14.230,'usb','ARRL-designated 20m SSTV frequency and a long-running image-exchange watering hole.','ARRL band plan',ARRL),
      q('AM calling',14.286,'am','ARRL-designated 20m AM calling frequency. Expect full-carrier AM conversations when activity is present.','ARRL band plan',ARRL),
      q('OMISS SSB net',14.290,'usb','OMISS publishes a daily 20m SSB net around 14.290 MHz, useful for hearing organized stateside and DX check-ins.','OMISS published net schedule',OMISS),
      q('Maritime net',14.300,'usb','Home of the Maritime Mobile Service Network, a long-running amateur net supporting vessels at sea and emergency/health-and-welfare traffic.','Maritime Mobile Service Network',MMSN)
    ],
    '17m': [
      q('FT8',18.100,'usb','The conventional 17m FT8 dial frequency. When the band opens, this can reveal DX before the voice portion sounds busy.','WSJT-X conventional frequencies',WSJTX),
      q('RTTY / data',18.103,'usb','Inside the ARRL 18.100–18.105 MHz RTTY segment. Expect narrow digital signals.','ARRL band plan',ARRL),
      q('OMISS SSB net',18.158,'usb','OMISS uses approximately 18.158 MHz for scheduled 17m SSB nets on selected weekend/seasonal sessions.','OMISS published net schedule',OMISS)
    ],
    '15m': [
      q('FT8',21.074,'usb','The conventional 15m FT8 dial frequency. A very useful indicator that this solar-dependent band has opened.','WSJT-X conventional frequencies',WSJTX),
      q('RTTY / data',21.080,'usb','Within the ARRL 21.070–21.110 MHz RTTY/data segment. Expect digital traffic, particularly during contests.','ARRL band plan',ARRL),
      q('SSTV',21.340,'usb','ARRL-designated 15m SSTV activity frequency. Image traffic appears mainly when propagation supports longer paths.','ARRL band plan',ARRL),
      q('OMISS SSB net',21.395,'usb','OMISS publishes a 15m SSB net near 21.395 MHz during scheduled weekend/seasonal periods.','OMISS published net schedule',OMISS)
    ],
    '12m': [
      q('FT8',24.915,'usb','The conventional 12m FT8 dial frequency. Because 12m can open suddenly, FT8 is a fast way to detect weak propagation.','WSJT-X conventional frequencies',WSJTX),
      q('RTTY / data',24.922,'usb','Inside the ARRL 24.920–24.925 MHz RTTY segment.','ARRL band plan',ARRL),
      q('OMISS SSB net',24.980,'usb','OMISS publishes a 12m SSB net around 24.980 MHz during selected weekend/seasonal sessions, shifting as needed for QRM.','OMISS published net schedule',OMISS)
    ],
    '10m': [
      q('FT8',28.074,'usb','The conventional 10m FT8 dial frequency. Often the first obvious sign that 10m propagation has come alive.','WSJT-X conventional frequencies',WSJTX),
      q('Beacon range',28.250,'usb','Inside ARRL’s 28.200–28.300 MHz beacon segment. Spin around this area to hear propagation beacons from surprising distances.','ARRL band plan',ARRL),
      q('SSB calling area',28.400,'usb','A popular general SSB calling neighborhood within the 10m phone segment. Expect CQ calls and casual voice contacts when the band is open.','ARRL band plan / common practice',ARRL),
      q('OMISS SSB net',28.525,'usb','OMISS publishes a 10m SSB net near 28.525 MHz on scheduled weekend/seasonal sessions.','OMISS published net schedule',OMISS),
      q('SSTV',28.680,'usb','ARRL-designated 10m SSTV activity frequency.','ARRL band plan',ARRL),
      q('AM activity',29.000,'am','Start of the ARRL 29.000–29.200 MHz AM segment. Expect AM voice when upper-HF propagation is strong.','ARRL band plan',ARRL)
    ]
  };

  for (const band of bands) {
    const upgraded = replacements[band.short];
    if (upgraded) band.quickTunes = upgraded;
  }

  const style = document.createElement('style');
  style.textContent = `
    .ham-frequency-context{margin-top:6px;padding:7px 8px;border-top:1px solid rgba(37,212,230,.10);color:#91a8ae;font-size:9px;line-height:1.45}
    .ham-frequency-context.community{border-top-color:rgba(239,189,92,.18);color:#c9af7e}
    .ham-frequency-context a{display:inline-block;margin-top:4px;color:var(--accent);font-family:var(--mono);font-size:8px;font-weight:800;text-decoration:none}
    .ham-frequency-context.community a{color:#efbd5c}
    .ham-quick-target.lookup-result{border:1px solid rgba(37,212,230,.10)!important;border-radius:6px!important;background:rgba(4,11,14,.35)!important;overflow:hidden}
  `;
  document.head.appendChild(style);

  function matchTune(target) {
    const raw = target.querySelector('.lookup-result-frequency')?.textContent || '';
    const khz = Number(raw.replace(/,/g,'').match(/[0-9]+(?:\.[0-9]+)?/)?.[0]);
    if (!Number.isFinite(khz)) return null;
    const mhz = khz / 1000;
    for (const band of bands) {
      const tune = (band.quickTunes || []).find((item)=>Math.abs(item.frequencyMHz - mhz) < 0.0006);
      if (tune) return tune;
    }
    return null;
  }

  function decorate(root=document) {
    root.querySelectorAll('.ham-quick-target').forEach((target)=>{
      if (target.querySelector('.ham-frequency-context')) return;
      const tune = matchTune(target);
      if (!tune?.description) return;
      const box = document.createElement('div');
      box.className = `ham-frequency-context ${tune.kind === 'community' ? 'community' : ''}`;
      box.innerHTML = `${tune.description}${tune.sourceUrl ? `<br><a href="${tune.sourceUrl}" target="_blank" rel="noopener noreferrer">${tune.sourceLabel || 'Source'} ↗</a>` : ''}`;
      target.appendChild(box);
    });
  }

  function utcLabel(value) {
    const clean = String(value || '').replace(/\D/g,'').padStart(4,'0');
    if (!/^\d{4}$/.test(clean)) return value || '';
    return `${clean.slice(0,2)}:${clean.slice(2)} UTC`;
  }

  async function refreshPublishedNets() {
    try {
      const response = await fetch('/api/ham-activity', { headers:{ Accept:'application/json' } });
      if (!response.ok) return;
      const data = await response.json();
      const nets = Array.isArray(data?.nets) ? data.nets : [];
      if (!nets.length) return;

      const primary = new Map();
      for (const net of nets) {
        if (!net?.band || !Number.isFinite(Number(net.frequencyMHz))) continue;
        const existing = primary.get(net.band);
        if (!existing || /late/i.test(existing.label || '')) primary.set(net.band, net);
      }

      for (const band of bands) {
        const net = primary.get(band.short);
        if (!net) continue;
        const tune = (band.quickTunes || []).find((item)=>String(item.sourceUrl || '') === OMISS || /OMISS/i.test(item.label || ''));
        if (!tune) continue;
        tune.frequencyMHz = Number(net.frequencyMHz);
        tune.mode = tune.mode || (Number(net.frequencyMHz) < 10 ? 'lsb' : 'usb');
        tune.description = `OMISS currently publishes its ${band.short} SSB net near ${Number(net.frequencyMHz).toFixed(3)} MHz at ${utcLabel(net.timeUtc)}${net.scheduleText ? ` · ${net.scheduleText}` : ''}. The net may move slightly for interference.`;
        tune.sourceLabel = net.sourceLabel || 'OMISS published net schedule';
        tune.sourceUrl = net.sourceUrl || OMISS;
        tune.kind = 'official';
      }

      const hamTab = document.querySelector('.band-tabs [data-band="HAM"]');
      if (hamTab?.classList.contains('active')) hamTab.click();
    } catch {
      // Static band-plan context remains available when the live net schedule is unreachable.
    }
  }

  const grid = document.getElementById('signalGrid');
  if (grid) new MutationObserver(()=>requestAnimationFrame(()=>decorate(grid))).observe(grid,{childList:true,subtree:true});
  decorate();
  refreshPublishedNets();
})();
