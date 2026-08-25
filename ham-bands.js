window.SIGNAL_SCOUT_HAM_BANDS = [
  {
    name: '160 meters', short: '160m', minMHz: 1.8, maxMHz: 2.0,
    character: 'Regional / nighttime HF',
    modes: 'CW · SSB · AM · digital',
    listen: '1.800–2.000 MHz',
    starts: ['1.810 MHz CW QRP', '1.910 MHz SSB QRP', '1.995–2.000 MHz beacons'],
    quickTunes: [
      { label: 'CW QRP', frequencyMHz: 1.810, mode: 'usb' },
      { label: 'SSB QRP', frequencyMHz: 1.910, mode: 'lsb' },
      { label: 'Beacon range', frequencyMHz: 1.9975, mode: 'usb' }
    ],
    note: 'Best after dark. Atmospheric noise and antenna size make this a challenging but interesting band for portable listening.',
    day: 20, night: 82, dusk: 68
  },
  {
    name: '80 / 75 meters', short: '80m', minMHz: 3.5, maxMHz: 4.0,
    character: 'Regional voice and nets',
    modes: 'CW · SSB · AM · digital',
    listen: '3.500–4.000 MHz',
    starts: ['3.570–3.600 MHz digital', '3.845 MHz SSTV', '3.885 MHz AM activity'],
    quickTunes: [
      { label: 'Digital', frequencyMHz: 3.573, mode: 'usb' },
      { label: 'SSTV', frequencyMHz: 3.845, mode: 'lsb' },
      { label: 'AM activity', frequencyMHz: 3.885, mode: 'am' }
    ],
    note: 'One of the best evening and nighttime bands for hearing relatively nearby amateurs and regional nets.',
    day: 35, night: 91, dusk: 76
  },
  {
    name: '60 meters', short: '60m', minMHz: 5.3305, maxMHz: 5.4035,
    character: 'Channelized / regional',
    modes: 'USB · CW · digital',
    listen: '5.3305–5.4035 MHz plus 5.3515–5.3665 MHz segment',
    starts: ['5.3305 MHz', '5.3465 MHz', '5.3515–5.3665 MHz', '5.3715 MHz', '5.4035 MHz'],
    quickTunes: [
      { label: 'Channel 1', frequencyMHz: 5.3305, mode: 'usb' },
      { label: 'Channel 2', frequencyMHz: 5.3465, mode: 'usb' },
      { label: 'USB segment', frequencyMHz: 5.3570, mode: 'usb' },
      { label: 'Channel 4', frequencyMHz: 5.3715, mode: 'usb' },
      { label: 'Channel 5', frequencyMHz: 5.4035, mode: 'usb' }
    ],
    note: 'A small U.S. amateur allocation with channel/segment restrictions. Often useful around dusk, overnight, and early morning.',
    day: 45, night: 78, dusk: 72
  },
  {
    name: '40 meters', short: '40m', minMHz: 7.0, maxMHz: 7.3,
    character: 'Very active day/night HF',
    modes: 'CW · SSB · AM · digital',
    listen: '7.000–7.300 MHz',
    starts: ['7.040 MHz RTTY/data DX', '7.074 MHz FT8 activity', '7.171 MHz SSTV', '7.290 MHz AM activity'],
    quickTunes: [
      { label: 'RTTY / data', frequencyMHz: 7.040, mode: 'usb' },
      { label: 'FT8', frequencyMHz: 7.074, mode: 'usb' },
      { label: 'SSTV', frequencyMHz: 7.171, mode: 'lsb' },
      { label: 'AM activity', frequencyMHz: 7.290, mode: 'am' }
    ],
    note: 'A great exploration band. Regional signals are common after dark; longer-distance signals can be heard day and night depending on conditions.',
    day: 62, night: 94, dusk: 86
  },
  {
    name: '30 meters', short: '30m', minMHz: 10.1, maxMHz: 10.15,
    character: 'CW / digital DX',
    modes: 'CW · RTTY · digital',
    listen: '10.100–10.150 MHz',
    starts: ['10.130–10.140 MHz RTTY', '10.140–10.150 MHz packet/data'],
    quickTunes: [
      { label: 'RTTY', frequencyMHz: 10.136, mode: 'usb' },
      { label: 'Packet / data', frequencyMHz: 10.145, mode: 'usb' }
    ],
    note: 'No phone operation in the U.S. allocation. Excellent for CW and digital signals and often open beyond local daylight hours.',
    day: 68, night: 76, dusk: 82
  },
  {
    name: '20 meters', short: '20m', minMHz: 14.0, maxMHz: 14.35,
    character: 'Premier daytime DX band',
    modes: 'CW · SSB · digital · SSTV',
    listen: '14.000–14.350 MHz',
    starts: ['14.074 MHz FT8 activity', '14.100 MHz beacon network', '14.230 MHz SSTV', '14.286 MHz AM activity'],
    quickTunes: [
      { label: 'FT8', frequencyMHz: 14.074, mode: 'usb' },
      { label: 'Beacon network', frequencyMHz: 14.100, mode: 'usb' },
      { label: 'SSTV', frequencyMHz: 14.230, mode: 'usb' },
      { label: 'AM activity', frequencyMHz: 14.286, mode: 'am' }
    ],
    note: 'Usually one of the best places to hear long-distance amateurs during daylight and into early evening.',
    day: 93, night: 52, dusk: 79
  },
  {
    name: '17 meters', short: '17m', minMHz: 18.068, maxMHz: 18.168,
    character: 'Daytime / DX',
    modes: 'CW · SSB · digital',
    listen: '18.068–18.168 MHz',
    starts: ['18.100–18.105 MHz RTTY', '18.105–18.110 MHz packet/data'],
    quickTunes: [
      { label: 'RTTY', frequencyMHz: 18.103, mode: 'usb' },
      { label: 'Packet / data', frequencyMHz: 18.108, mode: 'usb' }
    ],
    note: 'Often quieter than 20 meters and capable of excellent DX when daytime ionospheric conditions cooperate.',
    day: 80, night: 34, dusk: 64
  },
  {
    name: '15 meters', short: '15m', minMHz: 21.0, maxMHz: 21.45,
    character: 'Daytime long-distance',
    modes: 'CW · SSB · digital · SSTV',
    listen: '21.000–21.450 MHz',
    starts: ['21.070–21.110 MHz RTTY/data', '21.340 MHz SSTV'],
    quickTunes: [
      { label: 'RTTY / data', frequencyMHz: 21.080, mode: 'usb' },
      { label: 'SSTV', frequencyMHz: 21.340, mode: 'usb' }
    ],
    note: 'Can produce strong international signals when the band is open. Much more dependent on solar/ionospheric conditions than 20 or 40 meters.',
    day: 72, night: 22, dusk: 48
  },
  {
    name: '12 meters', short: '12m', minMHz: 24.89, maxMHz: 24.99,
    character: 'Solar-dependent DX',
    modes: 'CW · SSB · digital',
    listen: '24.890–24.990 MHz',
    starts: ['24.920–24.925 MHz RTTY', '24.925–24.930 MHz packet/data'],
    quickTunes: [
      { label: 'RTTY', frequencyMHz: 24.922, mode: 'usb' },
      { label: 'Packet / data', frequencyMHz: 24.927, mode: 'usb' }
    ],
    note: 'A daytime band that can suddenly come alive during favorable solar conditions and then sound completely dead.',
    day: 58, night: 15, dusk: 35
  },
  {
    name: '10 meters', short: '10m', minMHz: 28.0, maxMHz: 29.7,
    character: 'Highly variable / sporadic',
    modes: 'CW · SSB · AM · FM · beacons · digital',
    listen: '28.000–29.700 MHz',
    starts: ['28.200–28.300 MHz beacons', '28.300–29.300 MHz phone', '28.680 MHz SSTV', '29.000–29.200 MHz AM'],
    quickTunes: [
      { label: 'Beacon range', frequencyMHz: 28.250, mode: 'usb' },
      { label: 'SSB calling area', frequencyMHz: 28.400, mode: 'usb' },
      { label: 'SSTV', frequencyMHz: 28.680, mode: 'usb' },
      { label: 'AM activity', frequencyMHz: 29.000, mode: 'am' }
    ],
    note: 'When 10 meters opens it can be spectacular. Beacons around 28.2–28.3 MHz are a quick way to tell whether propagation is alive.',
    day: 48, night: 10, dusk: 28
  }
];
