export function isMobileDevice(): boolean {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
    || (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
}

// App 成功打开会触发隐藏 / pagehide；返回浏览器时不能再误跳网页。
export function fallbackIfAppStaysClosed(openWeb: () => void, delay = 2500): () => void {
  let left = false;
  const onHide = () => { if (document.visibilityState === "hidden") left = true; };
  const onLeave = () => { left = true; };
  const cleanup = () => {
    window.clearTimeout(timer);
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("pagehide", onLeave);
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("pagehide", onLeave);
  const timer = window.setTimeout(() => {
    cleanup();
    if (!left && document.visibilityState === "visible") openWeb();
  }, delay);
  return cleanup;
}
