/**
 * 飞书端内 H5 免登（JSSDK）：
 * 仅在飞书客户端内有效——加载官方 JS-SDK 后出现 window.h5sdk / window.tt，
 * 用 tt.requestAccess（旧版降级 tt.requestAuthCode）静默获取临时登录凭证 code，
 * 交给后端 /auth/feishu/free-login 换 user_access_token。
 */

const FEISHU_JS_SDK_URL =
  'https://lf1-cdn-tos.bytegoofy.com/goofy/lark/op/h5-js-sdk-1.5.26.js';

const g = window as any;

let sdkPromise: Promise<void> | null = null;

function loadSdk(): Promise<void> {
  if (g.h5sdk || g.tt) return Promise.resolve();
  if (sdkPromise) return sdkPromise;
  sdkPromise = new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = FEISHU_JS_SDK_URL;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('飞书 JS-SDK 加载失败'));
    document.head.appendChild(s);
  });
  return sdkPromise;
}

/** 粗略判断是否飞书环境（userAgent 含 Feishu/Lark，或 SDK 注入后存在 tt） */
export function isFeishuEnv(): boolean {
  return /feishu|lark/i.test(navigator.userAgent) || !!(g.tt || g.h5sdk);
}

/** 取免登临时登录凭证 code（新接口优先，errno 103 / 缺失则降级旧接口） */
export async function fetchFeishuFreeCode(appId: string): Promise<string> {
  await loadSdk();
  // h5sdk.ready 后桥接才可用；给个超时兜底避免永久等待
  await new Promise<void>((resolve) => {
    if (g.h5sdk && typeof g.h5sdk.ready === 'function') {
      let done = false;
      const finish = () => {
        if (!done) { done = true; resolve(); }
      };
      g.h5sdk.ready(finish);
      setTimeout(finish, 3000);
    } else {
      resolve();
    }
  });
  if (!g.tt) throw new Error('请在飞书客户端内打开');

  const requestAuthCode = () =>
    new Promise<string>((resolve, reject) => {
      g.tt.requestAuthCode({
        appId,
        success: (r: any) => {
          if (r?.code) resolve(r.code);
          else reject(new Error('未取得免登 code'));
        },
        fail: (e: any) =>
          reject(new Error(`飞书免登失败：${e?.errString || e?.errMsg || ''}`)),
      });
    });

  const fmtErr = (e: any) =>
    `errno=${e?.errno ?? '?'} ${e?.errString || e?.errMsg || JSON.stringify(e || {})}`;

  if (g.tt && typeof g.tt.requestAccess === 'function') {
    return new Promise<string>((resolve, reject) => {
      g.tt.requestAccess({
        appID: appId,
        scopeList: [], // 空数组 = 仅授予应用获取用户凭证信息权限（免登）
        success: (r: any) => {
          if (r?.code) resolve(r.code);
          else reject(new Error('未取得免登 code'));
        },
        fail: (e: any) => {
          // 新接口失败(含 20029/103 等)一律再试旧版 requestAuthCode，桌面端更可能走通
          requestAuthCode().then(resolve).catch((e2) => {
            reject(new Error(`飞书免登失败：requestAccess(${fmtErr(e)}) → requestAuthCode(${fmtErr(e2)})`));
          });
        },
      });
    });
  }
  return requestAuthCode();
}
