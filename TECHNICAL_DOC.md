# Web 环境检测技术文档

> **Web Environment Detection — Technical Documentation**
>
> 版本 / Version: 1.0.0 · 日期 / Date: 2026-03-23

---

## 目录 / Table of Contents

1. [背景与目标](#1-背景与目标--background--goals)
2. [整体架构](#2-整体架构--architecture)
3. [自动化环境检测](#3-自动化环境检测--automation-detection)
4. [无痕/隐私模式检测](#4-无痕隐私模式检测--incognitoprivate-mode-detection)
5. [HTTP 请求头注入](#5-http-请求头注入--http-header-injection)
6. [主入口 API](#6-主入口-api--main-api)
7. [目录结构](#7-目录结构--project-structure)
8. [快速上手](#8-快速上手--quick-start)
9. [自定义请求头参考](#9-自定义请求头参考--custom-header-reference)
10. [浏览器兼容性](#10-浏览器兼容性--browser-compatibility)
11. [已知局限与绕过风险](#11-已知局限与绕过风险--known-limitations)
12. [测试](#12-测试--testing)
13. [参考资料](#13-参考资料--references)

---

## 1. 背景与目标 / Background & Goals

### 1.1 问题背景

现代 Web 应用需要识别以下两类异常访问场景：

| 场景 | 典型工具 | 风险 |
|------|----------|------|
| **自动化环境** | Selenium WebDriver、Puppeteer、Playwright、PhantomJS | 爬虫、自动化攻击、刷量、CI 环境误触发 |
| **无痕/隐私模式** | Chrome 无痕窗口、Firefox 隐私标签、Safari 专用浏览 | 绕过会话追踪、广告欺诈、反检测测试 |

### 1.2 设计目标

- ✅ **优先使用浏览器原生 API**，无需额外服务端参与
- ✅ **检测后自动上报**：将检测结果注入到每一个 HTTP 请求的自定义请求头中
- ✅ **低侵入性**：以一个 `<script>` 标签即可嵌入任意现有页面
- ✅ **多信号融合**：单一信号误判率高，多信号聚合可提升置信度
- ✅ **可扩展**：每类检测均以独立模块封装，便于新增信号

---

## 2. 整体架构 / Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        Browser (Page Context)                        │
│                                                                      │
│  ┌──────────────────────┐    ┌──────────────────────────────────┐   │
│  │  automation-detector │    │      incognito-detector          │   │
│  │                      │    │                                  │   │
│  │  • navigator.webdriver    │  • Storage Quota (Chromium)      │   │
│  │  • Injected props    │    │  • IndexedDB blocked (Firefox)   │   │
│  │  • Headless UA       │    │  • IDBFactory error (Safari)     │   │
│  │  • Missing chrome    │    │  • localStorage blocked          │   │
│  │  • Empty plugins     │    │  • SW unavailable                │   │
│  │  • Zero RTT          │    │                                  │   │
│  │  • Notification perm │    │                                  │   │
│  └──────────┬───────────┘    └───────────────┬──────────────────┘   │
│             │                                │                      │
│             └───────────────┬────────────────┘                      │
│                             ▼                                        │
│                    ┌────────────────┐                                │
│                    │  env-detector  │  (main entry, detect())        │
│                    └───────┬────────┘                                │
│                             │                                        │
│                             ▼                                        │
│                  ┌──────────────────────┐                            │
│                  │  request-interceptor │                            │
│                  │                      │                            │
│                  │  Patches window.fetch│                            │
│                  │  Patches XHR.send()  │                            │
│                  └──────────┬───────────┘                            │
│                             │ inject headers                         │
│                             ▼                                        │
│              ┌──────────────────────────────┐                        │
│              │  Every fetch / XHR request   │                        │
│              │  ────────────────────────    │                        │
│              │  X-Env-Type: automation      │  ──►  Server / API     │
│              │  X-Env-Automation: true      │                        │
│              │  X-Env-Automation-Confidence │                        │
│              └──────────────────────────────┘                        │
└──────────────────────────────────────────────────────────────────────┘
```

### 模块职责

| 模块 | 职责 |
|------|------|
| `src/automation-detector.js` | 检测自动化环境，返回详细信号及置信度 |
| `src/incognito-detector.js` | 检测无痕/隐私模式，返回详细信号及置信度 |
| `src/request-interceptor.js` | 拦截 fetch/XHR，注入自定义请求头 |
| `src/env-detector.js` | 主入口，导出全部 API，提供便捷 `detect()` 方法 |

---

## 3. 自动化环境检测 / Automation Detection

### 3.1 检测信号列表

| 信号名 | 原理 | 权重 |
|--------|------|------|
| `webdriverFlag` | `navigator.webdriver === true`（W3C WebDriver 规范强制要求） | ★★★ 高 |
| `headlessUserAgent` | UA 字符串包含 `HeadlessChrome`、`PhantomJS`、`Headless` | ★★★ 高 |
| `injectedProperties` | 检查 `window/_phantom/__nightmare/__playwright/domAutomation/Cypress` 等自动化框架注入的全局属性 | ★★★ 高 |
| `missingChrome` | Chromium 无头模式下 `window.chrome.runtime` 不存在 | ★★ 中 |
| `emptyPlugins` | `navigator.plugins.length === 0`（无头 Chrome 无插件） | ★★ 中 |
| `notificationPermission` | 无头 Chrome 中 `Notification.permission` 为 `"denied"` 而权限状态仍为 `"prompt"` | ★★ 中 |
| `missingLanguages` | `navigator.languages` 为空数组或 `navigator.language` 为空字符串 | ★ 低 |
| `zeroRtt` | Network Information API 中 `navigator.connection.rtt === 0` | ★ 低 |
| `documentFocus` | `document.hasFocus()` 返回 `false`（无真实显示器时常见） | ★ 低 |

### 3.2 置信度算法

```
高置信度 (high)  : webdriverFlag || headlessUserAgent || injectedProperties 任一为真
                   OR 总触发信号数 >= 3
中置信度 (medium): 总触发信号数 >= 2
低置信度 (low)  : 总触发信号数 >= 1
无 (none)       : 全部为 false
```

### 3.3 代码示例

```js
import { detectAutomation } from './src/automation-detector.js';

const result = await detectAutomation();
// result = {
//   isAutomation: true,
//   confidence: 'high',
//   score: '3/9',
//   signals: {
//     webdriverFlag: true,
//     missingChrome: true,
//     emptyPlugins: true,
//     injectedProperties: false,
//     headlessUserAgent: false,
//     missingLanguages: false,
//     notificationPermission: false,
//     zeroRtt: false,
//     documentFocus: false,
//   }
// }
```

---

## 4. 无痕/隐私模式检测 / Incognito/Private Mode Detection

> 浏览器厂商有意阻止无痕模式检测，因此没有任何方法可以 100% 可靠地判断。
> 本方案结合多种技术，针对不同浏览器选用最适合的方法。

### 4.1 主要检测方法

#### 4.1.1 Chromium（Chrome / Edge）— 存储配额检测 ★★★

**原理**：Chrome 在无痕模式下将可用存储配额限制为固定上限（通常 ≤ 120 MB）；
普通模式下配额取决于磁盘剩余空间（通常 > 1 GB）。

```js
const { quota } = await navigator.storage.estimate();
const quotaMB = quota / (1024 * 1024);
const isIncognito = quotaMB < 120; // 阈值：120 MB
```

**参考**：[Chrome Storage Partitioning](https://developer.chrome.com/docs/privacy-security/storage-partitioning)

**局限**：
- 低内存设备上普通模式配额也可能 < 120 MB（误判）
- Chrome 130+ 调整了配额计算方式，阈值可能需要调整

#### 4.1.2 Firefox — IndexedDB 阻断检测 ★★★

**原理**：Firefox 在隐私模式下，所有 `indexedDB.open()` 调用均触发 `onerror`
（错误名为 `UnknownError`）；普通模式下正常打开。

```js
const req = indexedDB.open('__priv_test__');
req.onerror = () => /* 隐私模式 */;
req.onsuccess = () => /* 普通模式 */;
```

#### 4.1.3 Safari — IDBFactory 异常 ★★★

**原理**：Safari（macOS/iOS）私密浏览模式下，调用 `indexedDB.open()` 抛出
`SecurityError`，而非返回一个请求对象。

```js
try {
  const req = indexedDB.open('__test__');
  req.onerror = () => /* 私密模式 */;
} catch (e) {
  // e.name === 'SecurityError' → 私密模式
}
```

#### 4.1.4 localStorage 阻断 ★★（降级检测）

部分旧版浏览器或极端配置下，私密模式会阻止 `localStorage.setItem()`。

#### 4.1.5 Service Worker 不可用 ★（辅助信号）

大多数浏览器在私密/无痕模式下禁用 Service Worker 注册。

### 4.2 浏览器分支策略

```
getBrowserEngine()
    ├─ 'chromium'  → checkChromiumStorageQuota()  [主]
    ├─ 'firefox'   → checkFirefoxIndexedDB()       [主]
    ├─ 'safari'    → checkSafariPrivate()          [主]
    └─ 'unknown'   → 并行执行全部 async 检查      [兜底]
```

### 4.3 返回结构

```js
{
  isIncognito: true,
  confidence: 'high',
  method: 'storage-quota',      // 触发主检测方法
  quotaMB: 117,                 // Chromium 专属：检测到的配额
  signals: {
    storageQuotaLow: true,
    indexedDBBlocked: false,
    localStorageBlocked: false,
    serviceWorkerUnavailable: true,
  }
}
```

---

## 5. HTTP 请求头注入 / HTTP Header Injection

### 5.1 工作原理

`request-interceptor.js` 在检测完成后，**一次性替换** `window.fetch` 和
`window.XMLHttpRequest`，使得页面后续所有请求自动携带检测头。

#### 5.1.1 fetch 拦截

```js
const _originalFetch = window.fetch;

window.fetch = function patchedFetch(input, init = {}) {
  const newInit = { ...init, headers: mergeHeaders(init.headers) };
  return _originalFetch.call(window, input, newInit);
};
```

`mergeHeaders()` 将检测头合并到调用者已有的 headers 中，**不覆盖**调用者自行设置的同名 header。

#### 5.1.2 XHR 拦截

```js
class PatchedXHR extends OriginalXHR {
  send(body) {
    for (const [key, value] of Object.entries(_headers)) {
      this.setRequestHeader(key, value);
    }
    super.send(body);
  }
}
window.XMLHttpRequest = PatchedXHR;
```

### 5.2 注入时机

```
页面加载
  └─► detect() / installInterceptor()
        ├─ 并行运行 detectAutomation() + detectIncognito()
        ├─ 生成 _headers 对象
        ├─ 替换 window.fetch
        ├─ 替换 window.XMLHttpRequest
        └─ 后续所有请求自动注入 headers ✅
```

### 5.3 卸载

```js
import { uninstallInterceptor } from './src/request-interceptor.js';
uninstallInterceptor(); // 恢复原始 fetch 和 XHR
```

---

## 6. 主入口 API / Main API

### `detect(options?): Promise<DetectionResult>`

最简单的用法：一行代码完成检测 + 拦截器安装。

```js
import { detect } from './src/env-detector.js';

const result = await detect({
  installInterceptor: true,  // 默认 true，自动 patch fetch/XHR
  verbose: true,             // 默认 false，true 时将结果打印到 console
});

console.log(result.envType);               // 'normal' | 'automation' | 'incognito' | 'automation+incognito'
console.log(result.isAutomation);          // boolean
console.log(result.automationConfidence);  // 'high' | 'medium' | 'low' | 'none'
console.log(result.isIncognito);           // boolean
console.log(result.incognitoConfidence);   // 'high' | 'medium' | 'low' | 'none'
console.log(result.headers);              // { 'X-Env-Type': 'automation', ... }
```

#### 返回结构（`DetectionResult`）

```ts
interface DetectionResult {
  isAutomation: boolean;
  automationConfidence: 'high' | 'medium' | 'low' | 'none';
  automationSignals: Record<string, boolean>;
  automationScore: string;           // e.g. "3/9"

  isIncognito: boolean;
  incognitoConfidence: 'high' | 'medium' | 'low' | 'none';
  incognitoSignals: Record<string, boolean>;
  incognitoMethod: string;           // e.g. "storage-quota"
  quotaMB: number | null;            // Chromium only

  envType: 'normal' | 'automation' | 'incognito' | 'automation+incognito';
  headers: Record<string, string>;   // Headers injected into requests
}
```

---

## 7. 目录结构 / Project Structure

```
web-env-detector/
├── src/
│   ├── automation-detector.js   # 自动化环境检测（9 个信号）
│   ├── incognito-detector.js    # 无痕模式检测（多浏览器适配）
│   ├── request-interceptor.js  # fetch / XHR 拦截器
│   └── env-detector.js         # 主入口，detect() 便捷方法
├── demo/
│   └── index.html               # 交互式演示页面（浏览器直接打开）
├── tests/
│   ├── automation-detector.test.js
│   ├── incognito-detector.test.js
│   └── request-interceptor.test.js
├── jest.config.json
├── package.json
└── TECHNICAL_DOC.md             # 本文档
```

---

## 8. 快速上手 / Quick Start

### 方式一：ES Module（现代浏览器 / 打包器）

```html
<script type="module">
  import { detect } from './src/env-detector.js';

  // 检测并自动注入请求头
  const result = await detect({ verbose: true });

  if (result.isAutomation) {
    console.warn('⚠️ 自动化环境:', result.automationConfidence);
  }
  if (result.isIncognito) {
    console.warn('⚠️ 无痕模式:', result.incognitoConfidence);
  }
</script>
```

### 方式二：按需使用检测模块

```js
import { detectAutomation } from './src/automation-detector.js';
import { detectIncognito }   from './src/incognito-detector.js';
import { installInterceptor } from './src/request-interceptor.js';

const [autoResult, incogResult] = await Promise.all([
  detectAutomation(),
  detectIncognito(),
]);

// 只在确认有问题时才安装拦截器
if (autoResult.isAutomation || incogResult.isIncognito) {
  const { headers } = await installInterceptor({ autoResult, incogResult });
  console.log('注入的请求头:', headers);
}
```

### 方式三：运行演示页面

```bash
npm run demo        # 启动本地 HTTP 服务器，访问 http://localhost:8080
```

或者直接用浏览器打开 `demo/index.html`（需要通过 HTTP 服务器，不支持 `file://` 协议，
因 `navigator.storage` 等 API 需要 Secure Context）。

---

## 9. 自定义请求头参考 / Custom Header Reference

| 请求头 | 值 | 触发条件 |
|--------|----|----------|
| `X-Env-Type` | `normal` / `automation` / `incognito` / `automation+incognito` | **始终注入** |
| `X-Env-Automation` | `true` | 检测到自动化环境 |
| `X-Env-Automation-Confidence` | `high` / `medium` / `low` | 检测到自动化环境 |
| `X-Env-Incognito` | `true` | 检测到无痕/隐私模式 |
| `X-Env-Incognito-Confidence` | `high` / `medium` / `low` | 检测到无痕/隐私模式 |

### 服务端使用示例（Node.js / Express）

```js
app.use((req, res, next) => {
  const envType    = req.headers['x-env-type'] || 'unknown';
  const automation = req.headers['x-env-automation'] === 'true';
  const incognito  = req.headers['x-env-incognito'] === 'true';

  if (automation) {
    // 记录日志、限流、返回 CAPTCHA 等
    logger.warn('Automation detected', { confidence: req.headers['x-env-automation-confidence'] });
  }
  if (incognito) {
    // 提示用户、统计、差异化内容等
    logger.info('Incognito mode detected');
  }

  next();
});
```

---

## 10. 浏览器兼容性 / Browser Compatibility

| 功能 | Chrome | Firefox | Safari | Edge |
|------|:------:|:-------:|:------:|:----:|
| `navigator.webdriver` | ✅ 75+ | ✅ 74+ | ✅ 16.4+ | ✅ 79+ |
| `navigator.storage.estimate()` | ✅ 61+ | ✅ 57+ | ✅ 15.2+ | ✅ 79+ |
| IndexedDB 私密模式检测 | ✅ | ✅ | ✅ | ✅ |
| `navigator.permissions` | ✅ 43+ | ✅ 46+ | ✅ 16+ | ✅ 79+ |
| `navigator.connection` | ✅ | ❌ | ❌ | ✅ |
| Service Worker | ✅ | ✅ | ✅ 11.1+ | ✅ |

> **注意**：存储配额检测需要 **Secure Context**（`https://` 或 `localhost`）。

---

## 11. 已知局限与绕过风险 / Known Limitations

### 11.1 自动化检测局限

| 局限 | 说明 |
|------|------|
| **Stealth 插件** | `puppeteer-extra-plugin-stealth` 等工具可以清除 `navigator.webdriver`、伪造插件列表等，大幅降低检出率 |
| **新版无头模式** | Chrome 112+ 的 "新无头模式"（`--headless=new`）修复了部分指纹泄露 |
| `documentFocus` | 部分自动化工具会模拟焦点；CI 环境中也可能失去焦点，导致误判 |

### 11.2 无痕模式检测局限

| 局限 | 说明 |
|------|------|
| **配额阈值漂移** | Chrome 每个版本可能调整无痕模式配额上限，建议定期校准阈值 |
| **低内存设备** | 正常模式下配额也可能 < 120 MB，可能误判为无痕 |
| **未来 API 收紧** | 浏览器厂商可能进一步限制存储 API 用于隐私检测 |

### 11.3 安全建议

- 检测结果仅作**辅助风控信号**，不应作为唯一安全依据
- 建议与服务端 IP 风险评分、行为分析等结合使用
- 不要向用户直接暴露检测结果（避免被针对性绕过）

---

## 12. 测试 / Testing

### 运行测试

```bash
npm test
```

当前共 **52 个单元测试**，覆盖：

- `automation-detector.js` — 各信号函数及聚合逻辑
- `incognito-detector.js` — 各检测方法及浏览器分支
- `request-interceptor.js` — 请求头构建、fetch/XHR 拦截、安装/卸载生命周期

### 测试覆盖要点

| 测试文件 | 用例数 | 覆盖功能 |
|----------|:------:|---------|
| `automation-detector.test.js` | 18 | webdriver 标志、UA 检测、注入属性、插件列表、语言、RTT、集成测试 |
| `incognito-detector.test.js`  | 22 | 引擎识别、localStorage、SW、存储配额、IndexedDB、集成测试 |
| `request-interceptor.test.js` | 12 | 请求头构建、mergeHeaders、安装/卸载、fetch 拦截验证 |

---

## 13. 参考资料 / References

| 资源 | 链接 |
|------|------|
| W3C WebDriver 规范 | https://www.w3.org/TR/webdriver/#dfn-webdriver |
| Chrome Storage API | https://developer.chrome.com/docs/privacy-security/storage-partitioning |
| puppeteer-extra-plugin-stealth | https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth |
| CreepJS（浏览器指纹对比） | https://github.com/abrahamjuliot/creepjs |
| MDN `navigator.webdriver` | https://developer.mozilla.org/en-US/docs/Web/API/Navigator/webdriver |
| MDN `StorageManager.estimate()` | https://developer.mozilla.org/en-US/docs/Web/API/StorageManager/estimate |
| MDN `IndexedDB` | https://developer.mozilla.org/en-US/docs/Web/API/IndexedDB_API |

---

*本文档由 Web 环境检测项目自动生成并维护。*
