import type { Router } from 'vue-router';
import { createVersionCheck } from './app-version';

declare const __APP_VERSION__: string;

export function installVersionCheck(router: Router) {
  if (!import.meta.env.PROD) return;
  let editing = false;
  const markEditing = () => { editing = true; };
  document.addEventListener('input', markEditing, true);
  document.addEventListener('change', markEditing, true);
  const check = createVersionCheck({
    current: __APP_VERSION__,
    url: () => window.location.href,
    canReload: () => !editing && document.visibilityState === 'visible',
    replace: url => window.location.replace(url),
    read: async () => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), 5000);
      try {
        const response = await fetch(`/version.json?t=${Date.now()}`, {
          cache: 'no-store', signal: controller.signal,
        });
        if (!response.ok) return '';
        const data = await response.json();
        return typeof data.version === 'string' ? data.version : '';
      } finally { window.clearTimeout(timer); }
    },
  });
  window.addEventListener('pageshow', () => { void check(); });
  document.addEventListener('visibilitychange', () => { void check(); });
  router.afterEach((to, from, failure) => {
    if (!failure && to.path !== from.path) {
      editing = false;
      void check();
    }
  });
  void router.isReady().then(check);
}
