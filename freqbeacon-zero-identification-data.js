(() => {
  'use strict';

  // Lightweight local catalog shared by Zero's tap-to-identify UI and future
  // lookup/explore surfaces. Keep this file static: no schedules or live fetches.
  window.FREQBEACON_ZERO_IDENTIFICATION_CATALOG = Object.freeze({
    version: 1,

    receivers: Object.freeze([
      Object.freeze({
        match: 'N2YO',
        name: 'N2YO',
        location: 'Chantilly, Virginia',
        lat: 38.8943,
        lon: -77.4311
      })
    ]),

    stations: Object.freeze([
      Object.freeze({
        type: 'station',
        frequencyKHz: 630,
        callsign: 'WSBN',
        name: 'ESPN 630 DC',
        location: 'Washington, DC',
        lat: 38.9072,
        lon: -77.0369,
        mode: 'AM',
        categories: Object.freeze(['sports']),
        description: 'Sports radio and ESPN programming for the Washington, DC area.'
      })
    ]),

    ranges: Object.freeze([
      Object.freeze({
        type: 'band', startKHz: 30, endKHz: 300,
        name: 'Longwave', shortName: 'LW', mode: 'AM / CW',
        categories: Object.freeze(['longwave', 'utility']),
        description: 'Low-frequency radio used for beacons, navigation, time signals and some broadcasting outside North America.'
      }),
      Object.freeze({
        type: 'band', startKHz: 520, endKHz: 1710,
        name: 'Medium Wave / AM Broadcast', shortName: 'AM BC', mode: 'AM',
        categories: Object.freeze(['broadcast']),
        description: 'Traditional AM broadcasting. Local stations dominate by day; distant stations can travel much farther after dark.'
      }),
      Object.freeze({
        type: 'band', startKHz: 1800, endKHz: 2000,
        name: '160 Meter Amateur Band', shortName: '160m', mode: 'LSB / CW / Digital',
        categories: Object.freeze(['amateur', 'voice']),
        description: 'The lowest common HF amateur band, known for regional voice and long-distance nighttime activity.'
      }),
      Object.freeze({
        type: 'band', startKHz: 3500, endKHz: 4000,
        name: '80 Meter Amateur Band', shortName: '80m', mode: 'LSB / CW / Digital',
        categories: Object.freeze(['amateur', 'voice']),
        description: 'A popular amateur band for regional voice contacts at night and shorter-range communication during the day.'
      }),
      Object.freeze({
        type: 'band', startKHz: 5330.5, endKHz: 5406.5,
        name: '60 Meter Amateur Band', shortName: '60m', mode: 'USB / CW / Digital',
        categories: Object.freeze(['amateur', 'voice']),
        description: 'A small amateur allocation with channelized or limited-frequency operation depending on country.'
      }),
      Object.freeze({
        type: 'band', startKHz: 7000, endKHz: 7300,
        name: '40 Meter Amateur Band', shortName: '40m', mode: 'LSB / CW / Digital',
        categories: Object.freeze(['amateur', 'voice']),
        description: 'One of the busiest amateur bands, with regional and long-distance voice, Morse and digital activity.'
      }),
      Object.freeze({
        type: 'service-window', startKHz: 8890, endKHz: 9095,
        name: 'HF Utility', shortName: 'Utility', mode: 'USB',
        categories: Object.freeze(['utility']),
        description: 'A useful exploration window for non-broadcast HF traffic such as aeronautical, maritime and other utility communications.'
      }),
      Object.freeze({
        type: 'band', startKHz: 10100, endKHz: 10150,
        name: '30 Meter Amateur Band', shortName: '30m', mode: 'CW / Digital',
        categories: Object.freeze(['amateur', 'digital']),
        description: 'A narrow amateur band used primarily for Morse and digital modes rather than voice.'
      }),
      Object.freeze({
        type: 'service-window', startKHz: 11050, endKHz: 11300,
        name: 'HF Aviation', shortName: 'Aviation', mode: 'USB',
        categories: Object.freeze(['aviation', 'utility']),
        description: 'A long-distance aeronautical communications window where aircraft and ground stations may be heard in upper sideband.'
      }),
      Object.freeze({
        type: 'band', startKHz: 14000, endKHz: 14350,
        name: '20 Meter Amateur Band', shortName: '20m', mode: 'USB / CW / Digital',
        categories: Object.freeze(['amateur', 'voice']),
        description: 'A premier long-distance amateur band, often active worldwide during daylight and favorable propagation.'
      }),
      Object.freeze({
        type: 'band', startKHz: 18068, endKHz: 18168,
        name: '17 Meter Amateur Band', shortName: '17m', mode: 'USB / CW / Digital',
        categories: Object.freeze(['amateur', 'voice']),
        description: 'A quieter HF amateur band that can provide excellent long-distance contacts when propagation is open.'
      }),
      Object.freeze({
        type: 'band', startKHz: 21000, endKHz: 21450,
        name: '15 Meter Amateur Band', shortName: '15m', mode: 'USB / CW / Digital',
        categories: Object.freeze(['amateur', 'voice']),
        description: 'A higher HF amateur band capable of strong worldwide signals when solar conditions support it.'
      }),
      Object.freeze({
        type: 'band', startKHz: 24890, endKHz: 24990,
        name: '12 Meter Amateur Band', shortName: '12m', mode: 'USB / CW / Digital',
        categories: Object.freeze(['amateur', 'voice']),
        description: 'A compact higher-HF amateur band that can suddenly open for long-distance communication.'
      }),
      Object.freeze({
        type: 'service', startKHz: 26965, endKHz: 27405,
        name: 'Citizens Band Radio', shortName: 'CB', mode: 'AM / SSB',
        categories: Object.freeze(['cb', 'voice']),
        description: 'The 40-channel U.S. Citizens Band. Channel 19 at 27.185 MHz is widely used for highway traffic.'
      }),
      Object.freeze({
        type: 'band', startKHz: 28000, endKHz: 29700,
        name: '10 Meter Amateur Band', shortName: '10m', mode: 'USB / CW / FM / Digital',
        categories: Object.freeze(['amateur', 'voice']),
        description: 'The highest traditional HF amateur band, capable of dramatic worldwide openings when propagation is favorable.'
      }),
      Object.freeze({
        type: 'band', startKHz: 2300, endKHz: 26100,
        name: 'Shortwave / HF', shortName: 'Shortwave', mode: 'AM / SSB / CW / Digital',
        categories: Object.freeze(['shortwave', 'broadcast', 'utility']),
        description: 'High-frequency radio carrying international broadcasting, amateur, aviation, maritime, military and utility signals around the world.'
      })
    ])
  });
})();
