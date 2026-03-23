/**
 * request-interceptor.js
 *
 * Wraps both `window.fetch` and `XMLHttpRequest` so that any environment
 * detection results are automatically injected as custom HTTP request headers
 * on every outgoing request made from the page.
 *
 * Custom headers added when a condition is detected:
 *
 *   X-Env-Automation: true          (automation environment detected)
 *   X-Env-Automation-Confidence: high|medium|low
 *   X-Env-Incognito: true           (private/incognito mode detected)
 *   X-Env-Incognito-Confidence: high|medium|low
 *   X-Env-Type: automation|incognito|automation+incognito|normal
 *
 * Usage:
 *   import { installInterceptor, uninstallInterceptor } from './request-interceptor.js';
 *
 *   const interceptor = await installInterceptor();
 *   // All subsequent fetch / XHR calls will carry the detection headers.
 *   // To remove: interceptor.uninstall();
 */

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

let _headers = {};          // Headers to be injected; populated on install
let _originalFetch = null;  // Saved reference to original window.fetch
let _installed = false;

// ---------------------------------------------------------------------------
// Header-injection helpers
// ---------------------------------------------------------------------------

/**
 * Merges detection headers into a `Headers` object (or plain object).
 * Returns a new `Headers` instance.
 *
 * @param {Headers|Record<string,string>|undefined} existing
 * @returns {Headers}
 */
function mergeHeaders(existing) {
  const merged = new Headers(existing || {});
  for (const [key, value] of Object.entries(_headers)) {
    // Only add if not already set by the caller
    if (!merged.has(key)) {
      merged.set(key, value);
    }
  }
  return merged;
}

// ---------------------------------------------------------------------------
// fetch interceptor
// ---------------------------------------------------------------------------

/**
 * Replaces `window.fetch` with a version that injects detection headers.
 */
function patchFetch() {
  if (typeof window === 'undefined' || !window.fetch) return;
  _originalFetch = window.fetch;

  window.fetch = function patchedFetch(input, init = {}) {
    const newInit = { ...init, headers: mergeHeaders(init.headers) };
    return _originalFetch.call(window, input, newInit);
  };
}

/**
 * Restores the original `window.fetch`.
 */
function restoreFetch() {
  if (_originalFetch && typeof window !== 'undefined') {
    window.fetch = _originalFetch;
    _originalFetch = null;
  }
}

// ---------------------------------------------------------------------------
// XMLHttpRequest interceptor
// ---------------------------------------------------------------------------

let _OriginalXHR = null;

/**
 * Replaces `window.XMLHttpRequest` with a subclass that automatically calls
 * `setRequestHeader` for every detection header before sending.
 */
function patchXHR() {
  if (typeof window === 'undefined' || !window.XMLHttpRequest) return;
  _OriginalXHR = window.XMLHttpRequest;

  class PatchedXHR extends _OriginalXHR {
    send(body) {
      for (const [key, value] of Object.entries(_headers)) {
        try {
          this.setRequestHeader(key, value);
        } catch {
          // setRequestHeader can throw if called at the wrong time; ignore.
        }
      }
      super.send(body);
    }
  }

  window.XMLHttpRequest = PatchedXHR;
}

/**
 * Restores the original `window.XMLHttpRequest`.
 */
function restoreXHR() {
  if (_OriginalXHR && typeof window !== 'undefined') {
    window.XMLHttpRequest = _OriginalXHR;
    _OriginalXHR = null;
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the set of headers to inject from detection results.
 *
 * @param {import('./automation-detector.js').AutomationResult} automationResult
 * @param {import('./incognito-detector.js').IncognitoResult}   incognitoResult
 * @returns {Record<string, string>}
 */
function buildHeaders(automationResult, incognitoResult) {
  const headers = {};

  if (automationResult.isAutomation) {
    headers['X-Env-Automation'] = 'true';
    headers['X-Env-Automation-Confidence'] = automationResult.confidence;
  }

  if (incognitoResult.isIncognito) {
    headers['X-Env-Incognito'] = 'true';
    headers['X-Env-Incognito-Confidence'] = incognitoResult.confidence;
  }

  let envType = 'normal';
  if (automationResult.isAutomation && incognitoResult.isIncognito) {
    envType = 'automation+incognito';
  } else if (automationResult.isAutomation) {
    envType = 'automation';
  } else if (incognitoResult.isIncognito) {
    envType = 'incognito';
  }
  headers['X-Env-Type'] = envType;

  return headers;
}

/**
 * Installs the interceptor.  Runs environment detection, patches fetch and
 * XHR, then returns a handle with an `uninstall()` method.
 *
 * @param {Object} [options]
 * @param {import('./automation-detector.js').AutomationResult} [options.automationResult]
 *   Pre-computed result (skips detection if provided).
 * @param {import('./incognito-detector.js').IncognitoResult}   [options.incognitoResult]
 *   Pre-computed result (skips detection if provided).
 * @returns {Promise<InterceptorHandle>}
 *
 * @typedef {Object} InterceptorHandle
 * @property {Record<string,string>} headers - The headers being injected.
 * @property {Function}              uninstall - Removes the interceptor.
 */
async function installInterceptor(options = {}) {
  if (_installed) {
    console.warn('[env-detector] Interceptor is already installed.');
    return { headers: _headers, uninstall: uninstallInterceptor };
  }

  let { automationResult, incognitoResult } = options;

  // Run detection if not provided
  if (!automationResult || !incognitoResult) {
    const { detectAutomation } = await import('./automation-detector.js');
    const { detectIncognito } = await import('./incognito-detector.js');
    const [auto, incog] = await Promise.all([
      automationResult || detectAutomation(),
      incognitoResult || detectIncognito(),
    ]);
    automationResult = auto;
    incognitoResult = incog;
  }

  _headers = buildHeaders(automationResult, incognitoResult);

  patchFetch();
  patchXHR();
  _installed = true;

  return {
    headers: { ..._headers },
    uninstall: uninstallInterceptor,
  };
}

/**
 * Removes the interceptor and restores the original fetch / XHR.
 */
function uninstallInterceptor() {
  restoreFetch();
  restoreXHR();
  _headers = {};
  _installed = false;
}

/**
 * Returns a copy of the headers currently being injected.
 * Returns an empty object if the interceptor is not installed.
 *
 * @returns {Record<string, string>}
 */
function getInjectedHeaders() {
  return { ..._headers };
}

export {
  installInterceptor,
  uninstallInterceptor,
  getInjectedHeaders,
  buildHeaders,
  mergeHeaders,
};
