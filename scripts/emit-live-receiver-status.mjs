const url = 'https://freqbeacon.methvindigitalworks.com/api/explore/status';
try {
  const response = await fetch(url, { headers: { 'User-Agent': 'FREQBEACON build diagnostic' } });
  const text = await response.text();
  console.error('LIVE_RECEIVER_STATUS=' + text);
  process.exit(42);
} catch (error) {
  console.error('LIVE_RECEIVER_STATUS_ERROR=' + (error?.stack || error));
  process.exit(43);
}
