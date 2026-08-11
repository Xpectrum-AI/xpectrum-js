/**
 * Xpectrum Voice Widget — Embed Script
 *
 * Drop this script tag into any website to add a voice call widget.
 *
 * Usage:
 *   <script>
 *     window.XpectrumVoiceConfig = {
 *       apiKey: 'app-...',                          // the app's API key
 *       baseUrl: 'https://app.yourserver.com/v1',   // same API base as chat
 *       // The voice agent is determined by the API key.
 *       // Optional:
 *       position: 'bottom-right',    // 'bottom-right' | 'bottom-left'
 *       buttonColor: '#7C3AED',
 *     };
 *   </script>
 *   <script src="https://unpkg.com/xpectrum@1.0.0/dist/voice-embed.min.js" defer></script>
 *
 * Always pin the version (`@1.0.0`) — an unpinned URL resolves to whatever is
 * latest, so a future release would reach live sites without them upgrading.
 */
(function () {
  'use strict';

  var CONFIG_KEY = 'XpectrumVoiceConfig';
  var LOG_PREFIX = '[Xpectrum] ';
  var config = window[CONFIG_KEY];

  if (!config) {
    console.error(LOG_PREFIX + CONFIG_KEY + ' is missing. Define it before loading this script.');
    return;
  }
  if (!config.apiKey) {
    console.error(LOG_PREFIX + CONFIG_KEY + '.apiKey is required.');
    return;
  }
  // No sensible default exists — falling back to the page's own origin would
  // silently 404 every request against the host site.
  if (!config.baseUrl) {
    console.error(LOG_PREFIX + CONFIG_KEY + '.baseUrl is required — your Xpectrum API base URL.');
    return;
  }

  // Load the SDK bundle if not already loaded
  function loadSDK(callback) {
    if (window.Xpectrum) {
      callback();
      return;
    }

    // Resolve the SDK URL relative to this script, so the pinned version carries over
    var scripts = document.getElementsByTagName('script');
    var currentScript = document.currentScript || scripts[scripts.length - 1];
    var sdkUrl = currentScript.src.replace(/voice-embed(\.min)?\.js/, 'xpectrum.umd$1.js');

    var script = document.createElement('script');
    script.src = sdkUrl;
    script.onload = callback;
    script.onerror = function () {
      console.error(LOG_PREFIX + 'Failed to load SDK bundle from: ' + sdkUrl);
    };
    document.head.appendChild(script);
  }

  function init() {
    loadSDK(function () {
      if (!window.Xpectrum || !window.Xpectrum.VoiceWidget) {
        console.error(LOG_PREFIX + 'SDK loaded but VoiceWidget not found.');
        return;
      }

      new window.Xpectrum.VoiceWidget({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        position: config.position || 'bottom-right',
        buttonColor: config.buttonColor || '#7C3AED',
        buttonSize: config.buttonSize || 48,
        zIndex: config.zIndex || 2147483647,
        windowWidth: config.windowWidth || 360,
        windowHeight: config.windowHeight || 480,
      });
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }
})();
