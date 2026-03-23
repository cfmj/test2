/**
 * tests/automation-detector.test.js
 *
 * Unit tests for automation detection logic.
 * Runs in Node.js with a simulated browser-like global environment.
 */

// ── helpers ──────────────────────────────────────────────────────────────────

/**
 * Build a minimal navigator-like object that can be placed on `global`.
 */
function makeNavigator(overrides = {}) {
  return {
    webdriver: false,
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/124.0.0.0 Safari/537.36',
    plugins: { length: 4 },
    languages: ['en-US', 'en'],
    language: 'en-US',
    connection: { rtt: 50 },
    permissions: null,
    ...overrides,
  };
}

function makeWindow(overrides = {}) {
  return {
    chrome: { runtime: {} },
    ...overrides,
  };
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('checkWebDriverFlag', () => {
  let checkWebDriverFlag;

  beforeAll(async () => {
    ({ checkWebDriverFlag } = await import('../src/automation-detector.js'));
  });

  afterEach(() => {
    delete global.navigator;
  });

  test('returns true when navigator.webdriver is true', () => {
    global.navigator = makeNavigator({ webdriver: true });
    expect(checkWebDriverFlag()).toBe(true);
  });

  test('returns false when navigator.webdriver is false', () => {
    global.navigator = makeNavigator({ webdriver: false });
    expect(checkWebDriverFlag()).toBe(false);
  });

  test('returns false when navigator is undefined', () => {
    delete global.navigator;
    expect(checkWebDriverFlag()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('checkHeadlessUserAgent', () => {
  let checkHeadlessUserAgent;

  beforeAll(async () => {
    ({ checkHeadlessUserAgent } = await import('../src/automation-detector.js'));
  });

  afterEach(() => {
    delete global.navigator;
  });

  test('returns true for HeadlessChrome UA', () => {
    global.navigator = makeNavigator({
      userAgent: 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/124.0',
    });
    expect(checkHeadlessUserAgent()).toBe(true);
  });

  test('returns true for PhantomJS UA', () => {
    global.navigator = makeNavigator({
      userAgent: 'Mozilla/5.0 (Unknown; Linux x86_64) AppleWebKit PhantomJS/2.1',
    });
    expect(checkHeadlessUserAgent()).toBe(true);
  });

  test('returns false for normal Chrome UA', () => {
    global.navigator = makeNavigator();
    expect(checkHeadlessUserAgent()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('checkInjectedProperties', () => {
  let checkInjectedProperties;

  beforeAll(async () => {
    ({ checkInjectedProperties } = await import('../src/automation-detector.js'));
  });

  afterEach(() => {
    delete global.window;
    delete global.document;
  });

  test('returns true when _phantom is present on window', () => {
    global.window = makeWindow({ _phantom: true });
    global.document = {};
    expect(checkInjectedProperties()).toBe(true);
  });

  test('returns true when domAutomation is present on window', () => {
    global.window = makeWindow({ domAutomation: true });
    global.document = {};
    expect(checkInjectedProperties()).toBe(true);
  });

  test('returns true when __playwright is present', () => {
    global.window = makeWindow({ __playwright: {} });
    global.document = {};
    expect(checkInjectedProperties()).toBe(true);
  });

  test('returns false for a clean window', () => {
    global.window = makeWindow();
    global.document = {};
    expect(checkInjectedProperties()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('checkEmptyPlugins', () => {
  let checkEmptyPlugins;

  beforeAll(async () => {
    ({ checkEmptyPlugins } = await import('../src/automation-detector.js'));
  });

  afterEach(() => {
    delete global.navigator;
  });

  test('returns true when plugins length is 0', () => {
    global.navigator = makeNavigator({ plugins: { length: 0 } });
    expect(checkEmptyPlugins()).toBe(true);
  });

  test('returns false when plugins are present', () => {
    global.navigator = makeNavigator({ plugins: { length: 3 } });
    expect(checkEmptyPlugins()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('checkMissingLanguages', () => {
  let checkMissingLanguages;

  beforeAll(async () => {
    ({ checkMissingLanguages } = await import('../src/automation-detector.js'));
  });

  afterEach(() => {
    delete global.navigator;
  });

  test('returns true when languages is empty', () => {
    global.navigator = makeNavigator({ languages: [] });
    expect(checkMissingLanguages()).toBe(true);
  });

  test('returns true when language is empty string', () => {
    global.navigator = makeNavigator({ languages: [], language: '' });
    expect(checkMissingLanguages()).toBe(true);
  });

  test('returns false when languages are present', () => {
    global.navigator = makeNavigator();
    expect(checkMissingLanguages()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('checkZeroRtt', () => {
  let checkZeroRtt;

  beforeAll(async () => {
    ({ checkZeroRtt } = await import('../src/automation-detector.js'));
  });

  afterEach(() => {
    delete global.navigator;
  });

  test('returns true when RTT is 0', () => {
    global.navigator = makeNavigator({ connection: { rtt: 0 } });
    expect(checkZeroRtt()).toBe(true);
  });

  test('returns false when RTT is non-zero', () => {
    global.navigator = makeNavigator({ connection: { rtt: 20 } });
    expect(checkZeroRtt()).toBe(false);
  });

  test('returns false when connection is absent', () => {
    global.navigator = makeNavigator({ connection: null });
    expect(checkZeroRtt()).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('detectAutomation (integration)', () => {
  let detectAutomation;

  beforeAll(async () => {
    ({ detectAutomation } = await import('../src/automation-detector.js'));
  });

  afterEach(() => {
    delete global.navigator;
    delete global.window;
    delete global.document;
  });

  test('detects automation when webdriver flag is set', async () => {
    global.navigator = makeNavigator({ webdriver: true });
    global.window = makeWindow();
    global.document = { hasFocus: () => true };
    const result = await detectAutomation();
    expect(result.isAutomation).toBe(true);
    expect(result.signals.webdriverFlag).toBe(true);
    expect(['high', 'medium', 'low']).toContain(result.confidence);
  });

  test('returns no automation for clean environment', async () => {
    global.navigator = makeNavigator();
    global.window = makeWindow();
    global.document = { hasFocus: () => true };
    const result = await detectAutomation();
    expect(result.isAutomation).toBe(false);
    expect(result.confidence).toBe('none');
  });

  test('result includes score string', async () => {
    global.navigator = makeNavigator();
    global.window = makeWindow();
    global.document = { hasFocus: () => true };
    const result = await detectAutomation();
    expect(result.score).toMatch(/^\d+\/\d+$/);
  });
});
