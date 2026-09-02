(() => {
  const params = new URLSearchParams(window.location.search);
  const receiver = params.get('receiver');
  const frequency = params.get('frequency');
  const mode = String(params.get('mode') || '').toLowerCase();

  if (receiver) document.getElementById('receiver').value = receiver;
  if (frequency && Number.isFinite(Number(frequency))) document.getElementById('frequency').value = frequency;
  if (['am', 'sam', 'usb', 'lsb'].includes(mode)) document.getElementById('mode').value = mode;
})();
