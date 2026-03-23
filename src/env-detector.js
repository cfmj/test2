/**
 * env-detector.js
 *
 * Main entry point for the Web Environment Detector library.
 *
 * This module re-exports the full public API and provides a convenience
 * `detect()` function that runs both automation and incognito detection
 * and optionally installs the request interceptor.
 *
 * Quick start:
 *
 *   import { detect } from './env-detector.js';
 *
 *   const result = await detect({ installInterceptor: true });
 *   console.log(result.isAutomation);  // true/false
 *   console.log(result.isIncognito);   // true/false
 *   console.log(result.headers);       // headers that will be injected
 */

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
} from './automation-detector.js';

export {
  detectIncognito,
  checkChromiumStorageQuota,
  checkFirefoxIndexedDB,
  checkSafariPrivate,
  checkLocalStorageBlocked,
  checkServiceWorkerUnavailable,
  getBrowserEngine,
} from './incognito-detector.js';

export {
  installInterceptor,
  uninstallInterceptor,
  getInjectedHeaders,
  buildHeaders,
} from './request-interceptor.js';

// ---------------------------------------------------------------------------
// Convenience API
// ---------------------------------------------------------------------------

import { detectAutomation } from './automation-detector.js';
import { detectIncognito } from './incognito-detector.js';
import {
  installInterceptor,
  buildHeaders,
} from './request-interceptor.js';

/**
 * Runs full environment detection and (optionally) installs the HTTP
 * request interceptor so that every subsequent fetch / XHR carries the
 * detection headers.
 *
 * @param {Object}  [options]
 * @param {boolean} [options.installInterceptor=true]  - Patch fetch / XHR.
 * @param {boolean} [options.verbose=false]            - Log results to console.
 *
 * @returns {Promise<DetectionResult>}
 *
 * @typedef {Object} DetectionResult
 * @property {boolean}  isAutomation          - Automation environment detected.
 * @property {string}   automationConfidence  - 'high'|'medium'|'low'|'none'
 * @property {Object}   automationSignals     - Per-signal breakdown.
 * @property {boolean}  isIncognito           - Incognito/private mode detected.
 * @property {string}   incognitoConfidence   - 'high'|'medium'|'low'|'none'
 * @property {Object}   incognitoSignals      - Per-signal breakdown.
 * @property {string}   envType               - 'normal'|'automation'|'incognito'|'automation+incognito'
 * @property {Record<string,string>} headers  - Custom headers injected into requests.
 */
async function detect(options = {}) {
  const { installInterceptor: shouldInstall = true, verbose = false } = options;

  const [automationResult, incognitoResult] = await Promise.all([
    detectAutomation(),
    detectIncognito(),
  ]);

  const headers = buildHeaders(automationResult, incognitoResult);

  if (shouldInstall) {
    await installInterceptor({ automationResult, incognitoResult });
  }

  const result = {
    isAutomation: automationResult.isAutomation,
    automationConfidence: automationResult.confidence,
    automationSignals: automationResult.signals,
    automationScore: automationResult.score,
    isIncognito: incognitoResult.isIncognito,
    incognitoConfidence: incognitoResult.confidence,
    incognitoSignals: incognitoResult.signals,
    incognitoMethod: incognitoResult.method,
    quotaMB: incognitoResult.quotaMB,
    envType: headers['X-Env-Type'] || 'normal',
    headers,
  };

  if (verbose) {
    console.group('[env-detector] Detection Results');
    console.log('Environment Type:', result.envType);
    console.log('Automation:', result.isAutomation, `(${result.automationConfidence})`);
    console.log('Automation Signals:', result.automationSignals);
    console.log('Incognito:', result.isIncognito, `(${result.incognitoConfidence})`);
    console.log('Incognito Signals:', result.incognitoSignals);
    console.log('Injected Headers:', result.headers);
    console.groupEnd();
  }

  return result;
}

export { detect };
