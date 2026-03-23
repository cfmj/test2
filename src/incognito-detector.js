/**
 * incognito-detector.js
 *
 * Detects whether the browser is running in a private / incognito session.
 *
 * The fundamental challenge is that browsers intentionally make it difficult
 * to detect private mode to preserve user privacy.  No single method is
 * 100 % reliable across all browsers and versions; this module combines
 * several complementary techniques.
 *
 * Supported browsers:
 *   - Chrome / Chromium  (Storage Quota estimation)
 *   - Firefox            (IndexedDB restriction in private mode)
 *   - Safari             (IDBFactory restriction in private mode)
 *   - Edge (Chromium)    (same as Chrome)
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getBrowserEngine() {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent;
  if (/Firefox\//.test(ua)) return 'firefox';
  if (/Safari\//.test(ua) && !/Chrome/.test(ua)) return 'safari';
  if (/Chrome\/|Chromium\//.test(ua)) return 'chromium';
  return 'unknown';
}

// ---------------------------------------------------------------------------
// Chromium: Storage Quota estimation
// ---------------------------------------------------------------------------
/**
 * In Chromium-based browsers, incognito mode caps the available storage quota
 * to a small value (typically ≤ 120 MB, usually derived from RAM).  In a
 * regular session the quota reflects actual disk space (often gigabytes).
 *
 * Reference:
 *   https://developer.chrome.com/docs/privacy-security/storage-partitioning
 *   Observed behaviour: incognito quota ~120 MB; normal > 1 GB.
 *
 * @returns {Promise<{isIncognito: boolean, quotaMB: number|null}>}
 */
async function checkChromiumStorageQuota() {
  if (typeof navigator === 'undefined' || !navigator.storage) {
    return { isIncognito: false, quotaMB: null };
  }
  try {
    const { quota } = await navigator.storage.estimate();
    const quotaMB = quota / (1024 * 1024);
    // Threshold: incognito quota is ≤ 120 MB in practice.
    // Normal sessions report > 1000 MB on most devices.
    const INCOGNITO_THRESHOLD_MB = 120;
    return {
      isIncognito: quotaMB < INCOGNITO_THRESHOLD_MB,
      quotaMB: Math.round(quotaMB),
    };
  } catch {
    return { isIncognito: false, quotaMB: null };
  }
}

// ---------------------------------------------------------------------------
// Firefox: IndexedDB in private mode
// ---------------------------------------------------------------------------
/**
 * Firefox in private mode blocks `indexedDB.open()` and throws a
 * `DOMException` with name `"UnknownError"`, while regular mode succeeds.
 *
 * @returns {Promise<boolean>} true = likely incognito
 */
async function checkFirefoxIndexedDB() {
  if (typeof indexedDB === 'undefined') return false;
  return new Promise((resolve) => {
    const testDbName = `__priv_test_${Date.now()}`;
    let req;
    try {
      req = indexedDB.open(testDbName);
    } catch {
      // Opening threw synchronously — private mode signal
      return resolve(true);
    }
    req.onerror = () => resolve(true);
    req.onsuccess = (e) => {
      // Cleanup the test database
      try {
        e.target.result.close();
        indexedDB.deleteDatabase(testDbName);
      } catch {
        // best-effort cleanup
      }
      resolve(false);
    };
  });
}

// ---------------------------------------------------------------------------
// Safari: IDBFactory throws in private mode
// ---------------------------------------------------------------------------
/**
 * Safari (iOS and macOS) in private browsing mode throws a
 * `SecurityError` when any IndexedDB operation is attempted.
 *
 * @returns {Promise<boolean>}
 */
async function checkSafariPrivate() {
  if (typeof indexedDB === 'undefined') return false;
  return new Promise((resolve) => {
    try {
      // Safari private mode throws synchronously on `open`
      const req = indexedDB.open('__safari_priv_test__');
      req.onerror = () => resolve(true);
      req.onsuccess = (e) => {
        try {
          e.target.result.close();
          indexedDB.deleteDatabase('__safari_priv_test__');
        } catch {
          // ignore
        }
        resolve(false);
      };
    } catch {
      resolve(true);
    }
  });
}

// ---------------------------------------------------------------------------
// Cookie / localStorage smoke test
// ---------------------------------------------------------------------------
/**
 * Some environments (very old Firefox private mode, certain Safari versions)
 * block `localStorage` entirely in private sessions.
 *
 * @returns {boolean}
 */
function checkLocalStorageBlocked() {
  try {
    if (typeof localStorage === 'undefined') return true;
    const key = '__priv_ls_test__';
    localStorage.setItem(key, '1');
    localStorage.removeItem(key);
    return false;
  } catch {
    return true;
  }
}

// ---------------------------------------------------------------------------
// Service Worker availability
// ---------------------------------------------------------------------------
/**
 * Service Workers are unavailable in private/incognito mode in most browsers
 * (Chrome disables them in incognito by default; Firefox and Safari too).
 *
 * This is a weak signal on its own because some sites disable SW intentionally.
 *
 * @returns {boolean}
 */
function checkServiceWorkerUnavailable() {
  return typeof navigator !== 'undefined' && !('serviceWorker' in navigator);
}

// ---------------------------------------------------------------------------
// Aggregate detector
// ---------------------------------------------------------------------------

/**
 * Detects whether the browser is in a private / incognito session.
 *
 * @returns {Promise<IncognitoResult>}
 *
 * @typedef {Object} IncognitoResult
 * @property {boolean}     isIncognito - true if likely incognito / private.
 * @property {Object}      signals     - Breakdown of each check.
 * @property {string}      method      - Primary detection method used.
 * @property {string}      confidence  - 'high' | 'medium' | 'low' | 'none'
 * @property {number|null} quotaMB     - Detected storage quota (Chromium only).
 */
async function detectIncognito() {
  const engine = getBrowserEngine();
  const signals = {
    localStorageBlocked: false,
    serviceWorkerUnavailable: false,
    storageQuotaLow: false,
    indexedDBBlocked: false,
  };
  let quotaMB = null;
  let method = 'none';

  // Common checks (all browsers)
  signals.localStorageBlocked = checkLocalStorageBlocked();
  signals.serviceWorkerUnavailable = checkServiceWorkerUnavailable();

  if (engine === 'chromium') {
    const quotaResult = await checkChromiumStorageQuota();
    signals.storageQuotaLow = quotaResult.isIncognito;
    quotaMB = quotaResult.quotaMB;
    if (signals.storageQuotaLow) method = 'storage-quota';
  } else if (engine === 'firefox') {
    signals.indexedDBBlocked = await checkFirefoxIndexedDB();
    if (signals.indexedDBBlocked) method = 'indexeddb-blocked';
  } else if (engine === 'safari') {
    signals.indexedDBBlocked = await checkSafariPrivate();
    if (signals.indexedDBBlocked) method = 'indexeddb-security-error';
  } else {
    // Fallback: try all async checks
    const [quotaResult, idbBlocked] = await Promise.all([
      checkChromiumStorageQuota(),
      checkFirefoxIndexedDB(),
    ]);
    signals.storageQuotaLow = quotaResult.isIncognito;
    signals.indexedDBBlocked = idbBlocked;
    quotaMB = quotaResult.quotaMB;
    if (signals.storageQuotaLow) method = 'storage-quota';
    else if (signals.indexedDBBlocked) method = 'indexeddb-blocked';
  }

  const trueCount = Object.values(signals).filter(Boolean).length;

  // Determine confidence
  const highConfidenceHit =
    signals.storageQuotaLow || signals.indexedDBBlocked;
  let confidence;
  if (highConfidenceHit) {
    confidence = 'high';
  } else if (signals.localStorageBlocked) {
    confidence = 'medium';
  } else if (trueCount >= 1) {
    confidence = 'low';
  } else {
    confidence = 'none';
  }

  return {
    isIncognito: trueCount >= 1,
    signals,
    method,
    confidence,
    quotaMB,
  };
}

export {
  detectIncognito,
  checkChromiumStorageQuota,
  checkFirefoxIndexedDB,
  checkSafariPrivate,
  checkLocalStorageBlocked,
  checkServiceWorkerUnavailable,
  getBrowserEngine,
};
