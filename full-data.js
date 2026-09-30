(() => {
  'use strict';

  const stations = window.SIGNAL_SCOUT_STATIONS || (window.SIGNAL_SCOUT_STATIONS = []);
  const shortwave = stations.filter((station) => station.band === 'SW');

  window.SIGNAL_SCOUT_FULL_SW = shortwave;
  window.SIGNAL_SCOUT_DATA_STATE = {
    loading: false,
    loaded: true,
    source: 'built-in catalog',
    count: shortwave.length,
    error: null,
    complianceMode: true
  };

  const sourceNote = document.querySelector('.source-note');
  if (sourceNote) {
    sourceNote.textContent = 'Using the built-in FREQBEACON catalog. External schedule expansion is paused until each source’s reuse permission is documented.';
  }

  window.SIGNAL_SCOUT_DATA_READY = Promise.resolve(shortwave);
})();
