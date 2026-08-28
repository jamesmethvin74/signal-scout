import baseWorker from './worker-program-v4.js';

const WWCR_TIME_ZONE = 'America/Chicago';
const WWCR_SOURCE = 'https://wwcr.com/program-guides/WWCR_Program_Guide.pdf';

const RULES = [];
const add = (days, frequency, start, end, title) => RULES.push({
  days: String(days).split('').map(Number), frequency, start, end, title
});
const MF = '12345';

// WWCR Transmitter #2 — current official program guide, effective Aug. 1, 2026.
add(MF,5935,'00:00','07:00','University Network');
add(MF,7490,'07:00','08:00','Jesse Lee Peterson Show');
add(MF,7490,'08:00','09:00','Challenge Ministries');
add(MF,7490,'09:00','10:00','Narrow Path');
add(MF,12160,'10:00','11:00','The Common Sense Coalition');
add('1235',12160,'11:00','12:00','Worldwide Country Radio');
add('4',12160,'11:00','12:00','Arterburn Radio Transmission');
add(MF,12160,'12:00','12:30','Focus on the Family');
add(MF,12160,'12:30','13:00','Full Gospel Hour');
add(MF,12160,'13:00','13:30','Insight for Living');
add(MF,12160,'13:30','14:00','Real Radio');
add('123',12160,'14:00','15:00','Financial Survival');
add('4',12160,'14:00','15:00','Christian America Ministries');
add('5',12160,'14:00','15:00','The Divided Kingdom');
add('1',9350,'15:00','16:00','Last Radio Playing');
add('2',9350,'15:00','16:00','The Remnant Ministry');
add('3',9350,'15:00','15:30','Essentials of Life and Wellness');
add('3',9350,'15:30','16:00','Buffalo River Church');
add('4',9350,'15:00','15:30','Exceedingly Abundant Ministries');
add('4',9350,'15:30','16:00','Essentials of Life and Wellness');
add('5',9350,'15:00','16:00','Warning');
add('1',9350,'16:00','17:00','Bible Code 7');
add('2',9350,'16:00','17:00','Arterburn Radio Transmission');
add('3',9350,'16:00','17:00','Your Firm Foundation');
add('4',9350,'16:00','17:00','FKB Radio Sermon Time');
add('5',9350,'16:00','16:30','Real Radio');
add('5',9350,'16:30','17:00',"Selwyn's Law");
add('1',9350,'17:00','17:30','Jesus, Come Back!');
add('2345',9350,'17:00','17:30','Christlife Servant Leadership Ministry');
add(MF,9350,'17:30','18:00','Real Radio');
add('1',9350,'18:00','19:00','A Voice In The Wilderness');
add('2',9350,'18:00','18:30','First Light Ministries');
add('2',9350,'18:30','19:00','Essentials of Life and Wellness');
add('3',9350,'18:00','19:00','FKB Radio Sermon Time');
add('4',9350,'18:00','19:00','James McCanney Science Hour');
add('5',9350,'18:00','19:00','A Voice In The Wilderness');
add(MF,5935,'19:00','24:00','University Network');

add('6',5935,'00:00','07:00','University Network');
add('6',7490,'07:00','08:00','The Divided Kingdom');
add('6',7490,'08:00','08:05','Mentor Me Talk');
add('6',7490,'08:05','08:30','Awake Us Now!');
add('6',7490,'08:30','09:00','Disciples Of Christ');
add('6',7490,'09:00','10:00','The Remnant Ministry');
add('6',12160,'10:00','11:00','The Church of the Lord Jesus Christ of the Apostolic Faith');
add('6',12160,'11:00','12:00','FKB Radio Sermon Time');
add('6',12160,'12:00','12:30','The Talking Machine Show');
add('6',12160,'12:30','12:45','Words Of Hope');
add('6',12160,'12:45','13:00','Spiritual Renaissance Broadcast');
add('6',12160,'13:00','14:00','Worship');
add('6',12160,'14:00','15:00','The Pat Boone Show');
add('6',9350,'15:00','15:30','Decision for Christ');
add('6',9350,'15:30','16:00','Words of Jesus');
add('6',9350,'16:00','16:30','The Narrow Way');
add('6',9350,'16:30','16:45','Victory Above');
add('6',9350,'16:45','17:00','Word Seeds');
add('6',9350,'17:00','18:00','Your Firm Foundation');
add('6',9350,'18:00','18:15','Storm Warning: Prove All Things');
add('6',9350,'18:15','18:30',"He's Not Dead, He's Alive");
add('6',9350,'18:30','19:00','Real Radio Weekend');
add('6',5935,'19:00','24:00','University Network');

add('0',5935,'00:00','07:00','University Network');
add('0',7490,'07:00','07:15','Word Seeds');
add('0',7490,'07:15','07:30','Global Word Ministry');
add('0',7490,'07:30','08:00','Unity Baptist Broadcast');
add('0',7490,'08:00','09:00','Worship');
add('0',7490,'09:00','09:30','Road Map To Success');
add('0',7490,'09:30','10:00','Glory to God');
add('0',12160,'10:00','11:00','Worship');
add('0',12160,'11:00','12:00','Apostolic Assembly');
add('0',12160,'12:00','12:15','Dawn Bible');
add('0',12160,'12:15','12:30','Bible Gems');
add('0',12160,'12:30','13:00','Foursquare Gospel');
add('0',12160,'13:00','14:00','The Church of the Lord Jesus Christ of the Apostolic Faith');
add('0',12160,'14:00','15:00','The Remnant Ministry');
add('0',9350,'15:00','16:00','FKB Radio Sermon Time');
add('0',9350,'16:00','16:30','Christlife Servant Leadership Ministry');
add('0',9350,'16:30','16:45','Heaven Bound Train');
add('0',9350,'16:45','17:00','Words Of Hope');
add('0',9350,'17:00','18:00','A Voice In The Wilderness');
add('0',9350,'18:00','19:00','Your Firm Foundation');
add('0',5935,'19:00','24:00','University Network');

// WWCR Transmitter #3.
add('1',4840,'00:00','01:00','The Church of the Lord Jesus Christ of the Apostolic Faith');
add('2345',4840,'00:00','01:00','Worldwide Country Radio');
add(MF,4840,'01:00','01:30','Through The Bible');
add(MF,4840,'01:30','02:00','Insight for Living');
add(MF,4840,'02:00','02:30','Grace To You');
add(MF,4840,'02:30','03:00','Turning Point');
add(MF,4840,'03:00','03:30','Love Worth Finding');
add(MF,4840,'03:30','04:00','Truth for Life');
add(MF,4840,'04:00','04:30','Southwest Radio Church');
add(MF,4840,'04:30','05:00','Unshackled');
add(MF,4840,'05:00','05:05','Expectant Faith');
add(MF,4840,'05:05','05:30','Real Radio');
add(MF,4840,'05:30','06:00','Renewing Your Mind');
add(MF,4840,'06:00','06:30','Focus on the Family');
add(MF,4840,'06:30','07:00','Adventures In Odyssey');

add('1',13845,'07:00','07:15','Agape Restoration');
add('2',13845,'07:00','07:15','The King Is Coming');
add('3',13845,'07:00','07:15','Day of Challenge');
add('4',13845,'07:00','07:15','Abounding Grace');
add('5',13845,'07:00','07:15','Study In Grace');
add('1',13845,'07:15','07:30','Day of Challenge');
add('2',13845,'07:15','07:30','Fellow Helpers Broadcast');
add('3',13845,'07:15','07:30','Faith Revival Ministry');
add('4',13845,'07:15','07:30','Lord Of Life Ministries');
add('5',13845,'07:15','07:30','Classical Bible');
add('1',13845,'07:30','07:45','Victory Above Only Ministries');
add('2',13845,'07:30','07:45','Day of Challenge');
add('3',13845,'07:30','08:00','New Harvest International');
add('4',13845,'07:30','08:00','Awake Us Now');
add('5',13845,'07:30','07:45','Finding Grace in the Wilderness');
add('1',13845,'07:45','08:00','Spiritual Renaissance Broadcast');
add('2',13845,'07:45','08:00',"Let's Talk Kingdom");
add('5',13845,'07:45','08:00','But Now I See');
add(MF,13845,'08:00','08:25','Truth for Life');
add(MF,13845,'08:25','08:30','Expectant Faith');
add(MF,13845,'08:30','08:45','The Old Trailblazer');
add(MF,13845,'08:45','09:00','Daily Story Time');
add(MF,13845,'09:00','09:15','Jesus is our Shepherd');
add(MF,13845,'09:15','09:30','The Sower');
add(MF,13845,'09:30','10:00','Christlife Servant Leadership Ministry');
add(MF,13845,'10:00','10:15','Truth, Light, and Life');
add(MF,13845,'10:15','10:30','This Word Is Your Life');
add(MF,13845,'10:30','11:00','Focus on the Family');
add(MF,13845,'11:00','11:30','Family Altar');
add('1234',13845,'11:30','11:45','Rivers of Living Waters');
add('5',13845,'11:30','12:00','The Jesus Message');
add('123',13845,'11:45','12:00','Victorious Living');
add('4',13845,'11:45','12:00','Rivers of Living Waters');
add('123',13845,'12:00','13:00','Call to Decision');
add('4',13845,'12:00','13:00','Your Firm Foundation');
add('5',13845,'12:00','13:00','FKB Radio Sermon Time');
add(MF,13845,'13:00','13:03',"Today's Father");
add(MF,13845,'13:03','13:30','Through The Bible');
add('1234',13845,'13:30','14:00','Adventures In Odyssey');
add('5',13845,'13:30','13:45','Above All Things');
add('5',13845,'13:45','14:00','Sold Out For Jesus');
add(MF,13845,'14:00','14:05','God Lives and Works Today');
add(MF,13845,'14:05','14:15','Spoken Word');
add(MF,13845,'14:15','14:30','Old Trailblazer');
add(MF,13845,'14:30','15:00','Real Radio');
add(MF,13845,'15:00','19:00','University Network');

add('1',4840,'19:00','20:00','Jesus, Come Back!');
add('2',4840,'19:00','20:00','The Remnant Ministry');
add('3',4840,'19:00','20:00','The Remnant Ministry');
add('4',4840,'19:00','20:00','The Divided Kingdom');
add('5',4840,'19:00','20:00','The Remnant Ministry');
add(MF,4840,'20:00','21:00','Challenge Ministries');
add(MF,4840,'21:00','21:15','Jesus is our Shepherd');
add('1234',4840,'21:15','21:30','The Sower');
add('5',4840,'21:15','21:30','Storm Warning: Prove All Things');
add(MF,4840,'21:30','22:00','Real Radio');
add(MF,4840,'22:00','23:00','Call to Decision');
add('1234',4840,'23:00','24:00','Challenge Ministries');
add('5',4840,'23:00','24:00','Todd Thompson Show');

add('6',4840,'00:00','01:00','Christian America Ministries');
add('6',4840,'01:00','02:00','VORW');
add('6',4840,'02:00','02:30','Grace to You Weekend');
add('6',4840,'02:30','02:45','Storm Warning: Prove All Things');
add('6',4840,'02:45','03:00','Words Of Hope');
add('6',4840,'03:00','04:00','Focus on the Family Weekend');
add('6',4840,'04:00','05:00','The Pat Boone Show');
add('6',4840,'05:00','05:55','Worship With Andy Chrisman (Hour 1)');
add('6',4840,'05:55','06:00','Mentor Me Talk');
add('6',4840,'06:00','07:00','Worship With Andy Chrisman (Hour 2)');
add('6',13845,'07:00','07:15','The Faithway Baptist Hour');
add('6',13845,'07:15','07:30','Words Of Hope');
add('6',13845,'07:30','08:00','Set for Life');
add('6',13845,'08:00','08:15','Wonderful Words of Life');
add('6',13845,'08:15','08:30','Sold Out for Jesus');
add('6',13845,'08:30','08:45',"He's Not Dead, He's Alive");
add('6',13845,'08:45','09:00','Knowing the Word');
add('6',13845,'09:00','09:05','Mentor Me Talk');
add('6',13845,'09:05','09:30','Awake Us Now');
add('6',13845,'09:30','10:00','Christlife Servant Leadership Ministry');
add('6',13845,'10:00','10:15','Spiritual Renaissance Broadcast');
add('6',13845,'10:15','10:30','Bible Gems');
add('6',13845,'10:30','10:45','Science, Scripture and Salvation');
add('6',13845,'10:45','11:00','Words Of Hope');
add('6',13845,'11:00','11:30','Glory to God Ministries');
add('6',13845,'11:30','12:00','Desencadenados');
add('6',13845,'12:00','12:30','Through The Bible');
add('6',13845,'12:30','13:00','Decision for Christ');
add('6',13845,'13:00','13:15','Missionary Broadcast Ministry');
add('6',13845,'13:15','13:30','Truth, Light & Life');
add('6',13845,'13:30','13:45','Merry Street Church Of God');
add('6',13845,'13:45','14:00','Bible Gems');
add('6',13845,'14:00','19:00','University Network');
add('6',4840,'19:00','19:30','Air and Wave Radio Show');
add('6',4840,'19:30','20:00','WaveScan');
add('6',4840,'20:00','21:00','TruthHouse Ministries');
add('6',4840,'21:00','22:00','Worship');
add('6',4840,'22:00','22:15','Ask WWCR');
add('6',4840,'22:15','22:30','Storm Warning: Above All Things');
add('6',4840,'22:30','23:00','Essentials of Life and Wellness');
add('6',4840,'23:00','24:00','Transmitter 42');

add('0',4840,'00:00','01:00','Christian America Ministries');
add('0',4840,'01:00','02:00','Worship');
add('0',4840,'02:00','03:00','Worship With Andy Chrisman');
add('0',4840,'03:00','03:15','Mentor Me Talk');
add('0',4840,'03:15','03:30','Storm Warning: Above All Things');
add('0',4840,'03:30','04:00','Real Radio - Weekend');
add('0',4840,'04:00','04:30','Foursquare Gospel');
add('0',4840,'04:30','04:45','Sold Out For Jesus');
add('0',4840,'04:45','05:00','Words Of Hope');
add('0',4840,'05:00','06:00','Bible Code 7');
add('0',4840,'06:00','06:30','Awake Us Now!');
add('0',4840,'06:30','07:00','First Light Ministries');
add('0',13845,'07:00','08:00','Worship');
add('0',13845,'08:00','08:30','Latin Catholic Mass');
add('0',13845,'08:30','09:00','Exceedingly Abundant Ministries');
add('0',13845,'09:00','09:30','Decision for Christ');
add('0',13845,'09:30','09:45','Limitless');
add('0',13845,'09:45','10:00','From the Field');
add('0',13845,'10:00','11:00','Church of the Lord Jesus Christ of the Apostolic Faith');
add('0',13845,'11:00','12:00','Morning Worship Hour');
add('0',13845,'12:00','19:00','University Network');
add('0',4840,'19:00','19:30','The Narrow Way');
add('0',4840,'19:30','19:45','IHS Together');
add('0',4840,'19:45','20:00',"Let's Talk Kingdom");
add('0',4840,'20:00','21:00','Transmitter 42');
add('0',4840,'21:00','22:00','Power Of Prophecy');
add('0',4840,'22:00','22:30','Decision for Christ');
add('0',4840,'22:30','23:00','Church Of Lord Jesus Christ');
add('0',4840,'23:00','24:00','VORW');

// WWCR Transmitter #4.
add('123',7520,'19:00','20:00','A Call to Decision');
add('4',7520,'19:00','20:00','Christian America Ministries');
add('5',7520,'19:00','20:00','Warning');
add(MF,7520,'20:00','21:00','Hal Turner Radio Show');
add(MF,5890,'21:00','22:00','TruthHouse Ministries');
add(MF,5890,'22:00','23:00','Tony Alamo Ministries');

function minutes(value) {
  if (value === '24:00') return 1440;
  const [hour, minute] = String(value).split(':').map(Number);
  return hour * 60 + minute;
}

function zonedParts(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: WWCR_TIME_ZONE,
    weekday:'short', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hourCycle:'h23'
  }).formatToParts(date);
  const values = {};
  for (const part of parts) values[part.type] = part.value;
  const dayMap = { Sun:0, Mon:1, Tue:2, Wed:3, Thu:4, Fri:5, Sat:6 };
  return {
    weekday:dayMap[values.weekday], year:Number(values.year), month:Number(values.month), day:Number(values.day),
    hour:Number(values.hour), minute:Number(values.minute)
  };
}

function localWallToUtc(parts, minuteOfDay, dayOffset = 0) {
  const base = new Date(Date.UTC(parts.year, parts.month - 1, parts.day + dayOffset));
  const y = base.getUTCFullYear();
  const m = base.getUTCMonth() + 1;
  const d = base.getUTCDate();
  const hour = Math.floor((minuteOfDay % 1440) / 60);
  const minute = minuteOfDay % 60;
  const desiredWall = Date.UTC(y, m - 1, d, hour, minute);
  let guess = desiredWall;
  for (let i = 0; i < 4; i += 1) {
    const seen = zonedParts(new Date(guess));
    const seenWall = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
    guess += desiredWall - seenWall;
  }
  return new Date(guess);
}

function formatWindow(start, end, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone, hour:'numeric', minute:'2-digit', hour12:true });
    const zone = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName:'short' })
      .formatToParts(start).find((part) => part.type === 'timeZoneName')?.value || '';
    return `${formatter.format(start)}–${formatter.format(end)}${zone ? ` ${zone}` : ''}`;
  } catch {
    return `${start.toISOString().slice(11,16)}–${end.toISOString().slice(11,16)} UTC`;
  }
}

function occurrenceForRule(rule, at, offset) {
  const current = zonedParts(at);
  const localDate = new Date(Date.UTC(current.year, current.month - 1, current.day + offset));
  if (!rule.days.includes(localDate.getUTCDay())) return null;
  const local = {
    year:localDate.getUTCFullYear(), month:localDate.getUTCMonth()+1, day:localDate.getUTCDate(),
    weekday:localDate.getUTCDay(), hour:0, minute:0
  };
  const startMin = minutes(rule.start);
  const endMin = minutes(rule.end);
  const start = localWallToUtc(local, startMin);
  const end = endMin === 1440 ? localWallToUtc(local, 0, 1) : localWallToUtc(local, endMin);
  return { ...rule, startDate:start, endDate:end };
}

function resolveWwcr(request) {
  const url = new URL(request.url);
  const station = String(url.searchParams.get('station') || '').trim().toUpperCase();
  if (!station.includes('WWCR')) return null;
  const frequency = Number(url.searchParams.get('frequency'));
  const at = url.searchParams.get('at') ? new Date(url.searchParams.get('at')) : new Date();
  let displayTimeZone = url.searchParams.get('tz') || 'UTC';
  if (!Number.isFinite(frequency) || Number.isNaN(at.getTime())) return null;
  try { new Intl.DateTimeFormat('en-US', { timeZone:displayTimeZone }).format(at); }
  catch { displayTimeZone = 'UTC'; }

  const relevant = RULES.filter((rule) => Math.abs(rule.frequency - frequency) < 0.6);
  if (!relevant.length) return null;
  const occurrences = [];
  for (const rule of relevant) {
    for (let offset = -7; offset <= 7; offset += 1) {
      const occ = occurrenceForRule(rule, at, offset);
      if (occ) occurrences.push(occ);
    }
  }
  const now = at.getTime();
  const active = occurrences
    .filter((item) => item.startDate.getTime() <= now && now < item.endDate.getTime())
    .sort((a,b) => (a.endDate-a.startDate) - (b.endDate-b.startDate));
  if (!active.length) return null;
  const current = active[0];
  const next = occurrences
    .filter((item) => item.startDate.getTime() >= current.endDate.getTime())
    .sort((a,b) => a.startDate-b.startDate)[0] || null;

  return new Response(JSON.stringify({
    station:'WWCR', frequency, at:at.toISOString(), status:'verified', verified:true,
    program:current.title,
    window:formatWindow(current.startDate, current.endDate, displayTimeZone),
    start:current.startDate.toISOString(), end:current.endDate.toISOString(),
    next:next ? {
      program:next.title,
      window:formatWindow(next.startDate, next.endDate, displayTimeZone),
      start:next.startDate.toISOString()
    } : null,
    sourceUrl:WWCR_SOURCE,
    sourceLabel:'WWCR official Program Guide — Aug. 1, 2026'
  }), {
    headers:{ 'content-type':'application/json; charset=utf-8', 'cache-control':'public, max-age=60' }
  });
}

function injectExpansion(response) {
  const contentType = String(response.headers.get('content-type') || '');
  if (!contentType.includes('text/html')) return response;
  return response.text().then((html) => {
    if (!html.includes('program-guide-expansion.js')) {
      html = html.replace(
        '<script src="card-collapse.js?v=1"></script>',
        '<script src="program-guide-expansion.js?v=1"></script>\n  <script src="card-collapse.js?v=1"></script>'
      );
    }
    return new Response(html, {
      status:response.status,
      statusText:response.statusText,
      headers:response.headers
    });
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/program-guide') {
      const wwcr = resolveWwcr(request);
      if (wwcr) return wwcr;
    }
    const response = await baseWorker.fetch(request, env, ctx);
    if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/index.html')) {
      return injectExpansion(response);
    }
    return response;
  }
};
