// Emergency fallback KiwiSDR endpoints for FREQBEACON.
//
// The primary worldwide inventory comes from KiwiSDR's owner-authorized cached
// public.list feed. These few records are retained only so listening can fail
// soft if the cached directory is temporarily unavailable.
export const APPROVED_SDR_RECEIVERS = Object.freeze([
  Object.freeze({
    id:'florida',
    name:'Florida KiwiSDR',
    location:'Palm Harbor, Florida',
    country:'United States',
    host:'22315.proxy.kiwisdr.com',
    upstreamHost:'22315.proxy.kiwisdr.com',
    hostname:'22315.proxy.kiwisdr.com',
    protocol:'http:',
    lat:28.0781,
    lon:-82.7637,
    minKHz:10,
    maxKHz:30000,
    receiverType:'KiwiSDR',
    version:'',
    antenna:'',
    source:'manual-static'
  }),
  Object.freeze({
    id:'north-carolina',
    name:'North Carolina KiwiSDR',
    location:'Apex, North Carolina',
    country:'United States',
    host:'22904.proxy.kiwisdr.com',
    upstreamHost:'22904.proxy.kiwisdr.com',
    hostname:'22904.proxy.kiwisdr.com',
    protocol:'http:',
    lat:35.7327,
    lon:-78.8503,
    minKHz:10,
    maxKHz:30000,
    receiverType:'KiwiSDR',
    version:'',
    antenna:'',
    source:'manual-static'
  }),
  Object.freeze({
    id:'pennsylvania',
    name:'Pennsylvania KiwiSDR',
    location:'Ridley Park, Pennsylvania',
    country:'United States',
    host:'22479.proxy.kiwisdr.com',
    upstreamHost:'22479.proxy.kiwisdr.com',
    hostname:'22479.proxy.kiwisdr.com',
    protocol:'http:',
    lat:39.8812,
    lon:-75.3238,
    minKHz:10,
    maxKHz:30000,
    receiverType:'KiwiSDR',
    version:'',
    antenna:'',
    source:'manual-static'
  })
]);

export const APPROVED_SDR_RECEIVER_IDS = Object.freeze(
  APPROVED_SDR_RECEIVERS.map((receiver) => receiver.id)
);

export function approvedSdrReceiver(receiverId) {
  const id = String(receiverId || '').trim();
  return APPROVED_SDR_RECEIVERS.find((receiver) => receiver.id === id) || null;
}

export function isApprovedSdrReceiverId(receiverId) {
  return Boolean(approvedSdrReceiver(receiverId));
}
