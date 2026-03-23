/**
 * tests/incognito-detector.test.js
 *
 * Unit tests for incognito / private mode detection logic.
 */

// ── tests ─────────────────────────────────────────────────────────────────────

describe('getBrowserEngine', () => {
  let getBrowserEngine;

  beforeAll(async () => {
    ({ getBrowserEngine } = await import('../src/incognito-detector.js'));
  });

  afterEach(() => {
    delete global.navigator;
  });

  test('identifies chromium', () => {
    global.navigator = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
        '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    };
    expect(getBrowserEngine()).toBe('chromium');
  });

  test('identifies firefox', () => {
    global.navigator = {
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; rv:125.0) Gecko/20100101 Firefox/125.0',
    };
    expect(getBrowserEngine()).toBe('firefox');
  });

  test('identifies safari', () => {
    global.navigator = {
      userAgent:
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/605.1.15 ' +
        '(KHTML, like Gecko) Version/17.4.1 Safari/605.1.15',
    };
    expect(getBrowserEngine()).toBe('safari');
  });

  test('returns unknown for unrecognised UA', () => {
    global.navigator = { userAgent: 'SomeUnknownBrowser/1.0' };
    expect(getBrowserEngine()).toBe('unknown');
  });

  test('returns unknown when navigator is undefined', () => {
    delete global.navigator;
    expect(getBrowserEngine()).toBe('unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('checkLocalStorageBlocked', () => {
  let checkLocalStorageBlocked;

  beforeAll(async () => {
    ({ checkLocalStorageBlocked } = await import('../src/incognito-detector.js'));
  });

  afterEach(() => {
    delete global.localStorage;
  });

  test('returns false when localStorage works normally', () => {
    const store = {};
    global.localStorage = {
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
    };
    expect(checkLocalStorageBlocked()).toBe(false);
  });

  test('returns true when localStorage.setItem throws', () => {
    global.localStorage = {
      setItem: () => { throw new DOMException('SecurityError'); },
      removeItem: () => {},
    };
    expect(checkLocalStorageBlocked()).toBe(true);
  });

  test('returns true when localStorage is undefined', () => {
    delete global.localStorage;
    expect(checkLocalStorageBlocked()).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('checkServiceWorkerUnavailable', () => {
  let checkServiceWorkerUnavailable;

  beforeAll(async () => {
    ({ checkServiceWorkerUnavailable } = await import('../src/incognito-detector.js'));
  });

  afterEach(() => {
    delete global.navigator;
  });

  test('returns true when serviceWorker is not in navigator', () => {
    global.navigator = { userAgent: 'Chrome/124' };
    expect(checkServiceWorkerUnavailable()).toBe(true);
  });

  test('returns false when serviceWorker is present', () => {
    global.navigator = { userAgent: 'Chrome/124', serviceWorker: {} };
    expect(checkServiceWorkerUnavailable()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('checkChromiumStorageQuota', () => {
  let checkChromiumStorageQuota;

  beforeAll(async () => {
    ({ checkChromiumStorageQuota } = await import('../src/incognito-detector.js'));
  });

  afterEach(() => {
    delete global.navigator;
  });

  test('flags incognito when quota < 120 MB', async () => {
    global.navigator = {
      userAgent: 'Chrome/124',
      storage: {
        estimate: async () => ({ quota: 100 * 1024 * 1024 }), // 100 MB
      },
    };
    const result = await checkChromiumStorageQuota();
    expect(result.isIncognito).toBe(true);
    expect(result.quotaMB).toBe(100);
  });

  test('does not flag normal mode when quota >= 120 MB', async () => {
    global.navigator = {
      userAgent: 'Chrome/124',
      storage: {
        estimate: async () => ({ quota: 5000 * 1024 * 1024 }), // 5 GB
      },
    };
    const result = await checkChromiumStorageQuota();
    expect(result.isIncognito).toBe(false);
    expect(result.quotaMB).toBe(5000);
  });

  test('returns false when navigator.storage is absent', async () => {
    global.navigator = { userAgent: 'Chrome/124' };
    const result = await checkChromiumStorageQuota();
    expect(result.isIncognito).toBe(false);
    expect(result.quotaMB).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('checkFirefoxIndexedDB', () => {
  let checkFirefoxIndexedDB;

  beforeAll(async () => {
    ({ checkFirefoxIndexedDB } = await import('../src/incognito-detector.js'));
  });

  afterEach(() => {
    delete global.indexedDB;
  });

  test('returns true when indexedDB.open throws (private mode)', async () => {
    global.indexedDB = {
      open: () => { throw new DOMException('UnknownError'); },
    };
    const result = await checkFirefoxIndexedDB();
    expect(result).toBe(true);
  });

  test('returns true when request.onerror fires', async () => {
    let errorCb;
    global.indexedDB = {
      open: () => {
        const req = {};
        setTimeout(() => errorCb && errorCb(), 0);
        Object.defineProperty(req, 'onerror', {
          set(fn) { errorCb = fn; },
          get() { return errorCb; },
        });
        return req;
      },
    };
    const result = await checkFirefoxIndexedDB();
    expect(result).toBe(true);
  });

  test('returns false when indexedDB.open succeeds', async () => {
    let successCb;
    const fakeDb = { close: () => {} };
    global.indexedDB = {
      open: () => {
        const req = {};
        setTimeout(() => {
          if (successCb) successCb({ target: { result: fakeDb } });
        }, 0);
        Object.defineProperty(req, 'onsuccess', {
          set(fn) { successCb = fn; },
          get() { return successCb; },
        });
        return req;
      },
      deleteDatabase: () => {},
    };
    const result = await checkFirefoxIndexedDB();
    expect(result).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('detectIncognito (integration)', () => {
  let detectIncognito;

  beforeAll(async () => {
    ({ detectIncognito } = await import('../src/incognito-detector.js'));
  });

  afterEach(() => {
    delete global.navigator;
    delete global.indexedDB;
    delete global.localStorage;
  });

  test('detects incognito via low storage quota', async () => {
    global.navigator = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36',
      storage: {
        estimate: async () => ({ quota: 80 * 1024 * 1024 }),
      },
    };
    const store = {};
    global.localStorage = {
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
    };
    const result = await detectIncognito();
    expect(result.isIncognito).toBe(true);
    expect(result.signals.storageQuotaLow).toBe(true);
    expect(result.confidence).toBe('high');
  });

  test('returns no incognito for normal environment', async () => {
    global.navigator = {
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124 Safari/537.36',
      serviceWorker: {},
      storage: {
        estimate: async () => ({ quota: 10000 * 1024 * 1024 }),
      },
    };
    const store = {};
    global.localStorage = {
      setItem: (k, v) => { store[k] = v; },
      removeItem: (k) => { delete store[k]; },
    };
    const result = await detectIncognito();
    expect(result.isIncognito).toBe(false);
    expect(result.confidence).toBe('none');
  });
});
