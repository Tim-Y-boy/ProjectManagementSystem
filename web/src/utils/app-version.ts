export function createVersionCheck(options: {
  current: string;
  url: () => string;
  read: () => Promise<string>;
  replace: (url: string) => void;
  canReload: () => boolean;
}) {
  let pending = false;
  let redirected = false;
  return async () => {
    if (pending || redirected || !options.canReload()) return;
    pending = true;
    try {
      const version = await options.read();
      if (!version || version === options.current || !options.canReload()) return;
      const url = new URL(options.url());
      // Avoid loops if a proxy briefly serves an old entry during deployment.
      if (url.searchParams.get('_appv') === version) return;
      url.searchParams.set('_appv', version);
      redirected = true;
      options.replace(url.href);
    } catch {
      // Offline/version endpoint failures must not block normal use.
    } finally {
      pending = false;
    }
  };
}
