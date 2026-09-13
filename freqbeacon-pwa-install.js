(() => {
  'use strict';

  const installButton = document.querySelector('#installAppButton');
  if (!installButton) return;

  let deferredPrompt = null;

  function installedStandalone() {
    return window.matchMedia?.('(display-mode: standalone)').matches
      || window.navigator.standalone === true;
  }

  function hideInstall() {
    installButton.hidden = true;
    installButton.disabled = false;
    installButton.textContent = 'INSTALL APP';
  }

  if (installedStandalone()) {
    hideInstall();
    return;
  }

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredPrompt = event;
    installButton.hidden = false;
  });

  installButton.addEventListener('click', async () => {
    if (!deferredPrompt) return;
    installButton.disabled = true;
    installButton.textContent = 'INSTALLING…';

    try {
      deferredPrompt.prompt();
      await deferredPrompt.userChoice;
    } catch (error) {
      console.warn('FREQBEACON install prompt failed:', error);
    } finally {
      deferredPrompt = null;
      hideInstall();
    }
  });

  window.addEventListener('appinstalled', () => {
    deferredPrompt = null;
    hideInstall();
  });
})();
