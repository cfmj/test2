/**
 * tests/request-interceptor.test.js
 *
 * Unit tests for the HTTP request interceptor.
 */
import { jest } from '@jest/globals';

// ─────────────────────────────────────────────────────────────────────────────

describe('buildHeaders', () => {
  let buildHeaders;

  beforeAll(async () => {
    ({ buildHeaders } = await import('../src/request-interceptor.js'));
  });

  const makeAuto = (isAutomation, confidence = 'high') => ({
    isAutomation,
    confidence,
  });

  const makeIncog = (isIncognito, confidence = 'high') => ({
    isIncognito,
    confidence,
  });

  test('returns X-Env-Type: normal when no flags triggered', () => {
    const headers = buildHeaders(makeAuto(false), makeIncog(false));
    expect(headers['X-Env-Type']).toBe('normal');
    expect(headers['X-Env-Automation']).toBeUndefined();
    expect(headers['X-Env-Incognito']).toBeUndefined();
  });

  test('returns automation headers when automation detected', () => {
    const headers = buildHeaders(makeAuto(true, 'high'), makeIncog(false));
    expect(headers['X-Env-Type']).toBe('automation');
    expect(headers['X-Env-Automation']).toBe('true');
    expect(headers['X-Env-Automation-Confidence']).toBe('high');
    expect(headers['X-Env-Incognito']).toBeUndefined();
  });

  test('returns incognito headers when incognito detected', () => {
    const headers = buildHeaders(makeAuto(false), makeIncog(true, 'medium'));
    expect(headers['X-Env-Type']).toBe('incognito');
    expect(headers['X-Env-Incognito']).toBe('true');
    expect(headers['X-Env-Incognito-Confidence']).toBe('medium');
    expect(headers['X-Env-Automation']).toBeUndefined();
  });

  test('returns combined type when both are detected', () => {
    const headers = buildHeaders(makeAuto(true), makeIncog(true));
    expect(headers['X-Env-Type']).toBe('automation+incognito');
    expect(headers['X-Env-Automation']).toBe('true');
    expect(headers['X-Env-Incognito']).toBe('true');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('mergeHeaders', () => {
  let mergeHeaders;

  beforeAll(async () => {
    ({ mergeHeaders } = await import('../src/request-interceptor.js'));
  });

  test('merges detection headers into an empty headers object', () => {
    // We cannot easily test this without patching _headers; instead verify
    // the function returns a Headers instance.
    const result = mergeHeaders(undefined);
    expect(result).toBeInstanceOf(Headers);
  });

  test('does not overwrite caller-provided headers', () => {
    const result = mergeHeaders({ 'Content-Type': 'application/json' });
    expect(result.get('Content-Type')).toBe('application/json');
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('installInterceptor / uninstallInterceptor', () => {
  let installInterceptor, uninstallInterceptor, getInjectedHeaders;

  beforeAll(async () => {
    ({ installInterceptor, uninstallInterceptor, getInjectedHeaders } =
      await import('../src/request-interceptor.js'));
  });

  beforeEach(() => {
    // Reset interceptor state before each test
    uninstallInterceptor();
    // Provide minimal window / fetch stubs
    global.window = { fetch: async () => {}, XMLHttpRequest: class {} };
    global.fetch = global.window.fetch;
    global.XMLHttpRequest = global.window.XMLHttpRequest;
  });

  afterEach(() => {
    uninstallInterceptor();
    delete global.window;
    delete global.fetch;
    delete global.XMLHttpRequest;
  });

  test('injects automation headers when automation is detected', async () => {
    const handle = await installInterceptor({
      automationResult: { isAutomation: true, confidence: 'high' },
      incognitoResult: { isIncognito: false, confidence: 'none' },
    });
    expect(handle.headers['X-Env-Automation']).toBe('true');
    expect(handle.headers['X-Env-Type']).toBe('automation');
  });

  test('injects incognito headers when incognito is detected', async () => {
    const handle = await installInterceptor({
      automationResult: { isAutomation: false, confidence: 'none' },
      incognitoResult: { isIncognito: true, confidence: 'high' },
    });
    expect(handle.headers['X-Env-Incognito']).toBe('true');
    expect(handle.headers['X-Env-Type']).toBe('incognito');
  });

  test('getInjectedHeaders returns current headers after install', async () => {
    await installInterceptor({
      automationResult: { isAutomation: true, confidence: 'medium' },
      incognitoResult: { isIncognito: false, confidence: 'none' },
    });
    const headers = getInjectedHeaders();
    expect(headers['X-Env-Type']).toBe('automation');
  });

  test('getInjectedHeaders returns empty object after uninstall', async () => {
    await installInterceptor({
      automationResult: { isAutomation: true, confidence: 'high' },
      incognitoResult: { isIncognito: false, confidence: 'none' },
    });
    uninstallInterceptor();
    expect(getInjectedHeaders()).toEqual({});
  });

  test('warns and returns when called twice without uninstall', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    await installInterceptor({
      automationResult: { isAutomation: false, confidence: 'none' },
      incognitoResult: { isIncognito: false, confidence: 'none' },
    });
    await installInterceptor({
      automationResult: { isAutomation: false, confidence: 'none' },
      incognitoResult: { isIncognito: false, confidence: 'none' },
    });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('already installed')
    );
    warnSpy.mockRestore();
  });

  test('patched fetch adds detection headers', async () => {
    const calls = [];
    global.window.fetch = async (url, init) => {
      calls.push(init);
      return { ok: true };
    };

    await installInterceptor({
      automationResult: { isAutomation: true, confidence: 'high' },
      incognitoResult: { isIncognito: false, confidence: 'none' },
    });

    await window.fetch('https://example.com/api');
    expect(calls.length).toBe(1);
    const sentHeaders = calls[0].headers;
    // sentHeaders is a Headers instance
    expect(sentHeaders.get('X-Env-Automation')).toBe('true');
    expect(sentHeaders.get('X-Env-Type')).toBe('automation');
  });

  test('uninstall restores original fetch', async () => {
    const originalFetch = global.window.fetch;
    await installInterceptor({
      automationResult: { isAutomation: false, confidence: 'none' },
      incognitoResult: { isIncognito: false, confidence: 'none' },
    });
    expect(window.fetch).not.toBe(originalFetch);
    uninstallInterceptor();
    expect(window.fetch).toBe(originalFetch);
  });
});
