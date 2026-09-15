const api = 'https://data.gov.uk/api/action/package_show?id=536c7762-762c-4e29-b976-f30aa5bda2a5';
try {
  const r = await fetch(api, {signal: AbortSignal.timeout(30000)});
  if (!r.ok) throw new Error(`data.gov.uk API failed: ${r.status} ${r.statusText}`);
  const payload = await r.json();
  const resources = payload?.result?.resources || [];
  const mf = resources.find((x) => /\bMF data\b/i.test(String(x.name || x.description || '')));
  if (!mf) throw new Error('data.gov.uk MF resource not found');
  const candidate = mf.cache_url || mf.cache_url_original || mf.datastore_url || mf.url;
  if (!candidate) throw new Error('data.gov.uk MF resource has no candidate URL');
  if (/ofcom\.org\.uk/i.test(candidate) && !mf.cache_url && !mf.cache_url_original && !mf.datastore_url) {
    throw new Error('data.gov.uk exposes only the Ofcom origin, no government cache');
  }
  const rr = await fetch(candidate, {redirect:'follow',signal:AbortSignal.timeout(30000)});
  if (!rr.ok) throw new Error(`government MF candidate failed: ${rr.status} ${rr.statusText}`);
  const text = await rr.text();
  if (text.length < 1000) throw new Error(`government MF candidate too small: ${text.length}`);
  console.log(`Government MF candidate reachable: ${candidate} (${text.length} chars)`);
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
