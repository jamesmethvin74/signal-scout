(() => {
  'use strict';

  // Shared local catalog for Zero's tap-to-identify UI and future Lookup/Explore.
  // AM stations are loaded from the static AM catalog before this file.
  const amStations = Array.isArray(window.FREQBEACON_ZERO_AM_CATALOG)
    ? window.FREQBEACON_ZERO_AM_CATALOG
    : [];

  const rawRanges = [["band",30,300,"Longwave","LW","AM / CW","longwave|utility","Low-frequency radio used for beacons, navigation, time signals and some broadcasting outside North America."],["band",520,1710,"Medium Wave / AM Broadcast","AM BC","AM","broadcast","Traditional AM broadcasting. Local stations dominate by day; distant stations can travel much farther after dark."],["band",1800,2000,"160 Meter Amateur Band","160m","LSB / CW / Digital","amateur|voice","The lowest common HF amateur band, known for regional voice and long-distance nighttime activity."],["band",3500,4000,"80 Meter Amateur Band","80m","LSB / CW / Digital","amateur|voice","A popular amateur band for regional voice contacts at night and shorter-range communication during the day."],["band",5330.5,5406.5,"60 Meter Amateur Band","60m","USB / CW / Digital","amateur|voice","A small amateur allocation with channelized or limited-frequency operation depending on country."],["band",7000,7300,"40 Meter Amateur Band","40m","LSB / CW / Digital","amateur|voice","One of the busiest amateur bands, with regional and long-distance voice, Morse and digital activity."],["service-window",8890,9095,"HF Utility","Utility","USB","utility","A useful exploration window for non-broadcast HF traffic such as aeronautical, maritime and other utility communications."],["band",10100,10150,"30 Meter Amateur Band","30m","CW / Digital","amateur|digital","A narrow amateur band used primarily for Morse and digital modes rather than voice."],["service-window",11050,11300,"HF Aviation","Aviation","USB","aviation|utility","A long-distance aeronautical communications window where aircraft and ground stations may be heard in upper sideband."],["band",14000,14350,"20 Meter Amateur Band","20m","USB / CW / Digital","amateur|voice","A premier long-distance amateur band, often active worldwide during daylight and favorable propagation."],["band",18068,18168,"17 Meter Amateur Band","17m","USB / CW / Digital","amateur|voice","A quieter HF amateur band that can provide excellent long-distance contacts when propagation is open."],["band",21000,21450,"15 Meter Amateur Band","15m","USB / CW / Digital","amateur|voice","A higher HF amateur band capable of strong worldwide signals when solar conditions support it."],["band",24890,24990,"12 Meter Amateur Band","12m","USB / CW / Digital","amateur|voice","A compact higher-HF amateur band that can suddenly open for long-distance communication."],["service",26965,27405,"Citizens Band Radio","CB","AM / SSB","cb|voice","The 40-channel U.S. Citizens Band. Channel 19 at 27.185 MHz is widely used for highway traffic."],["band",28000,29700,"10 Meter Amateur Band","10m","USB / CW / FM / Digital","amateur|voice","The highest traditional HF amateur band, capable of dramatic worldwide openings when propagation is favorable."],["band",2300,26100,"Shortwave / HF","Shortwave","AM / SSB / CW / Digital","shortwave|broadcast|utility","High-frequency radio carrying international broadcasting, amateur, aviation, maritime, military and utility signals around the world."]];
  const ranges = rawRanges.map((row) => Object.freeze({
    type: row[0],
    startKHz: row[1],
    endKHz: row[2],
    name: row[3],
    shortName: row[4],
    mode: row[5],
    categories: Object.freeze(String(row[6] || '').split('|').filter(Boolean)),
    description: row[7]
  }));

  window.FREQBEACON_ZERO_IDENTIFICATION_CATALOG = Object.freeze({
    version: 2,
    receivers: Object.freeze([
      Object.freeze({
        match: 'N2YO',
        name: 'N2YO',
        location: 'Chantilly, Virginia',
        lat: 38.8943,
        lon: -77.4311
      })
    ]),
    stations: Object.freeze([...amStations]),
    ranges: Object.freeze(ranges)
  });
})();
