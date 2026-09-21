(() => {
  'use strict';

  // Philippine AM identification seed from National Telecommunications Commission
  // regulator records. The September 2025 national list supplies authorized
  // company/frequency/location records. Current Region VII NTC records additionally
  // supply Cebu/Negros Oriental call signs and powers. Call signs on unchanged
  // NCR/Davao company+frequency pairs are cross-referenced to the NTC Dec. 2022 list.
  //
  // Coordinates below are deliberately marked approximate: they represent the
  // published city/area, not an invented transmitter site. They are used only to
  // keep local receiver ranking geographically sensible.
  const SOURCE = 'Philippines NTC — authorized AM radio stations';
  const SOURCE_DATE = '2025-09';
  const SOURCE_URL = 'https://ntc.gov.ph/wp-content/uploads/2025/AUTHORIZED_BROADCAST_STATIONS/AM_List_September_2025.pdf';

  const hubs = Object.freeze({
    ncr:        { lat: 14.6500, lon: 120.9800, location: 'Metro Manila / Bulacan' },
    cebu:       { lat: 10.3157, lon: 123.8854, location: 'Cebu City, Cebu' },
    bogo:       { lat: 11.0510, lon: 124.0050, location: 'Bogo City, Cebu' },
    dumaguete:  { lat: 9.3077,  lon: 123.3054, location: 'Dumaguete / Negros Oriental' },
    davao:      { lat: 7.0731,  lon: 125.6128, location: 'Davao City, Davao del Sur' },
    tagum:      { lat: 7.4478,  lon: 125.8070, location: 'Tagum, Davao del Norte' },
    digos:      { lat: 6.7490,  lon: 125.3570, location: 'Digos, Davao del Sur' },
    mati:       { lat: 6.9550,  lon: 126.2160, location: 'Mati City, Davao Oriental' }
  });

  // [hub, frequency kHz, call sign, licensee/station owner, published location, power W]
  // Empty call signs mean the current NTC national list does not publish one and
  // there is no safe current cross-reference in this seed.
  const rows = Object.freeze([
    // NCR / Metro Manila and adjacent Bulacan assignments — NTC Sep. 2025.
    ['ncr',558,'DZXL','Radio Mindanao Network, Inc.','Bulacan',null],
    ['ncr',594,'DZBB','GMA Network, Inc.','Obando, Bulacan',null],
    ['ncr',630,'','Philippine Collectivemedia Corp','Obando, Bulacan',null],
    ['ncr',666,'DZRH','Manila Broadcasting Company','Valenzuela, Metro Manila',null],
    ['ncr',702,'DZAS','Far East Broadcasting Company, Inc.','Bocaue, Bulacan',null],
    ['ncr',738,'DZRB','Philippine Broadcasting Service','Malolos, Bulacan',null],
    ['ncr',774,'DWWW','Interactive Broadcast Media, Inc.','Valenzuela City, Metro Manila',null],
    ['ncr',810,'DZRJ','Free Air Broadcasting Network, Inc.','Quezon City, Metro Manila',null],
    ['ncr',846,'DZRV','Radio Veritas-Global Broadcasting System, Inc.','Meycauayan, Bulacan',null],
    ['ncr',882,'DWIZ','Aliw Broadcasting Corporation','Obando, Bulacan',null],
    ['ncr',918,'DZSR','Philippine Broadcasting Service','Valenzuela, Metro Manila',null],
    ['ncr',954,'DZEM','Christian Era Broadcasting Service, Inc.','Obando, Bulacan',null],
    ['ncr',1026,'DZAR','Swara Sug Media Corporation','Malabon, Metro Manila',null],
    ['ncr',1062,'DZEC','Eagle Broadcasting Corporation','Obando, Bulacan',null],
    ['ncr',1098,'DWAD','Crusaders Broadcasting System','Mandaluyong, Metro Manila',null],
    ['ncr',1206,'DWAN','Intercontinental Broadcasting Corporation','Quezon City, Metro Manila',null],
    ['ncr',1242,'DWBL','FBS Radio Network','Valenzuela, Metro Manila',null],
    ['ncr',1278,'DZRM','Philippine Broadcasting Service','Valenzuela, Metro Manila',null],
    ['ncr',1314,'DWXI','Delta Broadcasting System','Cavite / Metro Manila',null],
    ['ncr',1350,'DZXQ','Information Broadcast Unlimited, Inc.','Malabon, Metro Manila',null],
    ['ncr',1386,'','Cebu Broadcasting Company','Metro Manila',null],
    ['ncr',1422,'DWBC','Advanced Media Broadcasting System, Inc.','Quezon City, Metro Manila',null],
    ['ncr',1494,'DWSS','Supreme Broadcasting System, Inc.','Valenzuela, Metro Manila',null],
    ['ncr',1602,'DZUP','University of the Philippines','Quezon City, Metro Manila',null],
    ['ncr',1638,'','Vanguard Radio Network, Inc.','Malolos, Bulacan',null],
    ['ncr',1674,'DWGI','Guzman Institute of Technology','Manila, Metro Manila',null],
    ['ncr',1674,'DZBF','City of Marikina','Marikina, Metro Manila',null],

    // Cebu — current NTC Region VII regulator page, including published power.
    ['cebu',540,'DYRB','Radio Audience Developers Integrated Organization, Inc.','Cebu City',10000],
    ['cebu',576,'DYMR','Philippine Broadcasting Service','Cebu / Carcar',50000],
    ['cebu',612,'DYHP','Radio Mindanao Network, Inc.','Cebu City',10000],
    ['cebu',648,'DYXR','Manila Broadcasting Company','Talisay, Cebu',5000],
    ['cebu',675,'DYKC','Radio Philippines Network','Mandaue City, Cebu',5000],
    ['cebu',765,'DYAR','Swara Sug Media Corporation','Cebu City',5000],
    ['cebu',846,'','Prime Broadcasting Network','Cebu City',5000],
    ['bogo',864,'DYHH','Sarraga Integrated and Management Corp.','Bogo City, Cebu',10000],
    ['cebu',909,'DYLA','Vimcontu Broadcasting Corp.','Cebu City',10000],
    ['cebu',963,'DYMF',"People's Broadcasting Service, Inc.",'Cebu City',10000],
    ['cebu',999,'DYSS','GMA Network, Inc.','Cebu City',10000],
    ['bogo',1152,'DYCM','Makati Broadcasting Network Corporation','Bogo City, Cebu',10000],
    ['cebu',1215,'DYRF','Word Broadcasting Corporation','Cebu City',10000],
    ['cebu',1260,'DYDD','Sarraga Integrated and Management Corp.','Cebu City',10000],
    ['cebu',1305,'DYFX','Eagle Broadcasting Corporation','Talisay, Cebu',10000],
    ['bogo',1377,'','Manila Broadcasting Company','Bogo City, Cebu',5000],
    ['cebu',1395,'DYRC','Cebu Broadcasting Company','Talisay / Cebu City',5000],
    ['cebu',1512,'DYAB','ABS-CBN Broadcasting Corp.','Mandaue / Talisay, Cebu',10000],
    ['cebu',1584,'DYAY','Allied Broadcasting Center Inc.','Minglanilla, Cebu',10000],

    // Negros Oriental — current NTC Region VII regulator page.
    ['dumaguete',801,'DYWC','Franciscan Broadcasting Corp.','Sibulan / Dumaguete',5000],
    ['dumaguete',891,'DYSR','National Council of Churches in the Philippines','Dumaguete',10000],
    ['dumaguete',1134,'DYRM','Philippine Radio Corporation','Dumaguete City',1000],
    ['dumaguete',1458,'DYZZ','Sarraga Integrated and Management Corp.','Guihulngan City, Negros Oriental',10000],

    // Davao — NTC Sep. 2025 national list; unchanged call signs cross-referenced
    // against the regulator's Dec. 2022 call-sign list.
    ['davao',576,'DXMF',"People's Broadcasting Service, Inc.",'Davao City',null],
    ['davao',621,'DXDC','Radio Mindanao Network, Inc.','Davao City',null],
    ['davao',666,'DXRP','Philippine Broadcasting Service','Davao City',null],
    ['davao',711,'DXRD','Swara Sug Media Corporation','Davao City',null],
    ['davao',783,'DXRA','RMC Broadcasting Corporation','Davao City',null],
    ['davao',819,'DXUM','Mt. Apo Science Foundation','Davao City',null],
    ['davao',855,'DXGO','Pacific Broadcasting System, Inc.','Davao City',null],
    ['davao',900,'DXIP','Southern Broadcasting Network','Davao City',null],
    ['tagum',936,'DXDN','University of Mindanao Broadcasting','Tagum, Davao del Norte',null],
    ['davao',981,'DXOW','Radyo Pilipino Corp.','Davao City',null],
    ['davao',1017,'DXRR','Kalayaan Broadcasting System','Davao City',null],
    ['davao',1071,'DXKT','Radio Philippines Network, Inc.','Davao City',null],
    ['davao',1125,'DXGM','GMA Network, Inc.','Davao City',null],
    ['digos',1161,'DXDS','University of Mindanao Broadcasting','Digos, Davao del Sur',null],
    ['davao',1197,'DXFE','Far East Broadcasting Company, Inc.','Davao City',null],
    ['davao',1224,'DXED','Eagle Broadcasting Corporation','Davao City',null],
    ['davao',1260,'DXRF','Manila Broadcasting Company','Davao City',null],
    ['davao',1332,'','Christian Era Broadcasting Service, Inc.','Davao City',null],
    ['mati',1584,'','Philippine Broadcasting Service','Mati City, Davao Oriental',null]
  ]);

  const catalog = rows.map(([hubKey, frequencyKHz, callsign, company, publishedLocation, powerW], index) => {
    const hub = hubs[hubKey];
    const display = callsign || company;
    return Object.freeze({
      type: 'station',
      id: `ph-ntc-am-${frequencyKHz}-${String(callsign || index).toLowerCase()}`,
      band: 'MW',
      frequencyKHz,
      callsign,
      name: display,
      company,
      location: publishedLocation || hub.location,
      country: 'Philippines',
      lat: hub.lat,
      lon: hub.lon,
      powerW: Number.isFinite(powerW) ? powerW : undefined,
      mode: 'AM',
      categories: ['broadcast', 'MW'],
      source: SOURCE,
      sourceAuthority: 'Philippines NTC',
      sourceTier: 1,
      sourceDate: SOURCE_DATE,
      sourceUrl: SOURCE_URL,
      locationApproximate: true,
      matchToleranceKHz: 4,
      description: callsign
        ? `${callsign} · ${company} · authorized Philippine AM assignment`
        : `${company} · authorized Philippine AM assignment`
    });
  });

  window.FREQBEACON_PHILIPPINES_AM_CATALOG = Object.freeze(catalog);
})();