/**
 * Xpectrum Chat Widget — Embed Script
 *
 * Drop this script tag into any website to add a chat widget.
 *
 * Usage:
 *   <script>
 *     window.XpectrumChatConfig = {
 *       apiKey: 'YOUR_API_KEY',
 *       baseUrl: 'https://app.yourserver.com/v1',
 *       // Optional branding:
 *       logo: 'https://yoursite.com/logo.png',
 *       title: 'Acme Support',
 *       welcomeMessage: 'Hi! How can I help?',
 *       inputPlaceholder: 'Ask us anything…',
 *       // Optional question chips:
 *       starterQuestions: true,      // true = from console | false | ['Where is my order?', …]
 *       suggestions: true,           // follow-up questions under each reply
 *       // Optional theme:
 *       theme: 'light',              // 'light' | 'dark' | 'auto'
 *       primaryColor: '#7C3AED',
 *       backgroundColor: '#ffffff',
 *       textColor: '#111111',
 *       fontFamily: 'Inter, sans-serif',
 *       fontSize: 14,
 *       borderRadius: 12,
 *       // Optional layout:
 *       position: 'bottom-right',    // 'bottom-right' | 'bottom-left'
 *     };
 *   </script>
 *   <script src="https://unpkg.com/xpectrum@1.1.0/dist/chat-embed.min.js" defer></script>
 *
 * Always pin the version (`@1.1.0`) — an unpinned URL resolves to whatever is
 * latest, so a future release would reach live sites without them upgrading.
 */
(function () {
  'use strict';

  var CONFIG_KEY = 'XpectrumChatConfig';
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
    console.error(
      LOG_PREFIX + CONFIG_KEY + '.baseUrl is required — use the "API Server" value from your console.',
    );
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
    var sdkUrl = currentScript.src.replace(/chat-embed(\.min)?\.js/, 'xpectrum.umd$1.js');

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
      if (!window.Xpectrum || !window.Xpectrum.ChatWidget) {
        console.error(LOG_PREFIX + 'SDK loaded but ChatWidget not found.');
        return;
      }

      new window.Xpectrum.ChatWidget({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        user: config.user,
        anonymousTtlDays: config.anonymousTtlDays,
        // Branding
        logo: config.logo,
        title: config.title,
        welcomeMessage: config.welcomeMessage,
        inputPlaceholder: config.inputPlaceholder,
        // Question chips
        starterQuestions: config.starterQuestions,
        suggestions: config.suggestions,
        // Layout
        position: config.position || 'bottom-right',
        buttonSize: config.buttonSize || 48,
        windowWidth: config.windowWidth || 400,
        windowHeight: config.windowHeight || 600,
        zIndex: config.zIndex || 2147483647,
        // Theme
        theme: config.theme || 'light',
        primaryColor: config.primaryColor,
        onPrimaryColor: config.onPrimaryColor,
        buttonColor: config.buttonColor,
        backgroundColor: config.backgroundColor,
        textColor: config.textColor,
        fontFamily: config.fontFamily,
        fontSize: config.fontSize,
        borderRadius: config.borderRadius,
      });
    });
  }

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    init();
  } else {
    window.addEventListener('DOMContentLoaded', init);
  }
})();
