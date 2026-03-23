/**
 * automation-detector.js
 *
 * Detects whether the current browser session is driven by an automation
 * framework such as Selenium WebDriver, Puppeteer, Playwright, or PhantomJS.
 *
 * Each check returns a boolean-like value.  The exported `detectAutomation`
 * function aggregates all checks and returns a detailed result object.
 */

// ---------------------------------------------------------------------------
// Individual signal checks
// ---------------------------------------------------------------------------

/**
 * navigator.webdriver is set to `true` by the W3C WebDriver specification
 * whenever a browser is controlled via WebDriver (Selenium, Playwright,
 * Puppeteer with `--enable-automation`, etc.).
 *
 * References:
 *   https://www.w3.org/TR/webdriver/#dfn-webdriver
 */
function checkWebDriverFlag() {
  return typeof navigator !== 'undefined' && navigator.webdriver === true;
}

/**
 * Headless Chrome omits the `window.chrome` runtime object that real Chrome
 * exposes.  When absent it is a strong signal of a headless environment.
 */
function checkMissingChrome() {
  if (typeof window === 'undefined') return false;
  // Only meaningful in a Chromium-based browser
  const isChromium = /Chrome|Chromium/.test(navigator.userAgent);
  if (!isChromium) return false;
  return !window.chrome || !window.chrome.runtime;
}

/**
 * Headless Chrome / Puppeteer historically reported an empty plugins list.
 * Modern versions have improved this, but it remains a useful secondary signal.
 */
function checkEmptyPlugins() {
  if (typeof navigator === 'undefined') return false;
  return navigator.plugins && navigator.plugins.length === 0;
}

/**
 * Automation frameworks often leave detectable global properties on
 * `window` or `document`.
 *
 * Property list compiled from:
 *   - https://github.com/nicehash/nicehash-easy-miner
 *   - https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth
 *   - Various public anti-bot research
 */
function checkInjectedProperties() {
  if (typeof window === 'undefined') return false;

  const windowProps = [
    '_phantom',
    '__nightmare',
    'callPhantom',
    '_selenium',
    'domAutomation',
    'domAutomationController',
    '__webdriver_evaluate',
    '__selenium_evaluate',
    '__webdriver_script_fn',
    '__driver_evaluate',
    '__webdriver_unwrapped',
    '__selenium_unwrapped',
    '__fxdriver_evaluate',
    '__driver_unwrapped',
    '__fxdriver_unwrapped',
    // Playwright / CDP signals
    '__playwright',
    '__pw_manual',
    // Cypress
    'Cypress',
    '__cypress',
  ];

  const documentProps = [
    '__webdriver_evaluate',
    '__selenium_evaluate',
    '__webdriver_script_fn',
    '__driver_evaluate',
    '__webdriver_unwrapped',
    '__selenium_unwrapped',
    '__fxdriver_evaluate',
    '__driver_unwrapped',
    '__fxdriver_unwrapped',
  ];

  for (const prop of windowProps) {
    if (prop in window) return true;
  }

  if (typeof document !== 'undefined') {
    for (const prop of documentProps) {
      if (prop in document) return true;
    }
  }

  return false;
}

/**
 * Checks the User-Agent string for well-known headless / automation tokens.
 */
function checkHeadlessUserAgent() {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent || '';
  return /HeadlessChrome|PhantomJS|Headless/.test(ua);
}

/**
 * `navigator.languages` is usually a non-empty array in real browsers.
 * Automation environments sometimes expose an empty array.
 */
function checkMissingLanguages() {
  if (typeof navigator === 'undefined') return false;
  return (
    !navigator.languages ||
    navigator.languages.length === 0 ||
    navigator.language === ''
  );
}

/**
 * Real browsers expose a non-trivial permission state for `notifications`.
 * Headless Chrome returns `"denied"` without ever prompting, which is unusual
 * for a fresh profile.
 *
 * NOTE: This is an async check; it resolves to `true` when the signal fires.
 *
 * @returns {Promise<boolean>}
 */
async function checkNotificationPermission() {
  if (
    typeof window === 'undefined' ||
    !('Notification' in window) ||
    !navigator.permissions
  ) {
    return false;
  }
  try {
    const permissionStatus = await navigator.permissions.query({
      name: 'notifications',
    });
    // In headless Chrome the status is "denied" even though the user was
    // never prompted — a real browser would return "default".
    return (
      Notification.permission === 'denied' &&
      permissionStatus.state === 'prompt'
    );
  } catch {
    return false;
  }
}

/**
 * The Connection Rtt (Round-Trip Time) exposed by the Network Information API
 * is 0 in many headless environments.
 */
function checkZeroRtt() {
  if (typeof navigator === 'undefined' || !navigator.connection) return false;
  return navigator.connection.rtt === 0;
}

/**
 * Checks if `document.hasFocus()` returns false, which is common in headless
 * environments since there is no real display.
 */
function checkDocumentFocus() {
  if (typeof document === 'undefined') return false;
  return !document.hasFocus();
}

// ---------------------------------------------------------------------------
// Aggregate detector
// ---------------------------------------------------------------------------

/**
 * Detects whether the page is running inside an automation environment.
 *
 * @returns {Promise<AutomationResult>}
 *
 * @typedef {Object} AutomationResult
 * @property {boolean} isAutomation  - `true` if any automation signal was found.
 * @property {Object}  signals       - Breakdown of each individual check.
 * @property {string}  confidence    - 'high' | 'medium' | 'low'
 */
async function detectAutomation() {
  const signals = {
    webdriverFlag: checkWebDriverFlag(),
    missingChrome: checkMissingChrome(),
    emptyPlugins: checkEmptyPlugins(),
    injectedProperties: checkInjectedProperties(),
    headlessUserAgent: checkHeadlessUserAgent(),
    missingLanguages: checkMissingLanguages(),
    notificationPermission: await checkNotificationPermission(),
    zeroRtt: checkZeroRtt(),
    documentFocus: checkDocumentFocus(),
  };

  const trueCount = Object.values(signals).filter(Boolean).length;
  const total = Object.keys(signals).length;

  // Weight: webdriverFlag and headlessUserAgent are very high-confidence
  const highConfidenceHit =
    signals.webdriverFlag ||
    signals.headlessUserAgent ||
    signals.injectedProperties;

  let confidence;
  if (highConfidenceHit || trueCount >= 3) {
    confidence = 'high';
  } else if (trueCount >= 2) {
    confidence = 'medium';
  } else if (trueCount >= 1) {
    confidence = 'low';
  } else {
    confidence = 'none';
  }

  return {
    isAutomation: trueCount >= 1,
    signals,
    confidence,
    score: `${trueCount}/${total}`,
  };
}

export {
  detectAutomation,
  checkWebDriverFlag,
  checkMissingChrome,
  checkEmptyPlugins,
  checkInjectedProperties,
  checkHeadlessUserAgent,
  checkMissingLanguages,
  checkNotificationPermission,
  checkZeroRtt,
  checkDocumentFocus,
};
