import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fallbackIfAppStaysClosed, isMobileDevice } from "./navigation";

beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it("手机没有打开 App 时回退网页", () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const openWeb = vi.fn();
  fallbackIfAppStaysClosed(openWeb);
  vi.advanceTimersByTime(2500);
  expect(openWeb).toHaveBeenCalledOnce();
});

it("成功唤起后返回浏览器也不能被延时回退打断", () => {
  const state = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const openWeb = vi.fn();
  fallbackIfAppStaysClosed(openWeb);
  state.mockReturnValue("hidden");document.dispatchEvent(new Event("visibilitychange"));
  state.mockReturnValue("visible");document.dispatchEvent(new Event("visibilitychange"));
  vi.advanceTimersByTime(2500);
  expect(openWeb).not.toHaveBeenCalled();
});

it("页面已离开或组件卸载，不再跳转", () => {
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const openWeb = vi.fn();
  fallbackIfAppStaysClosed(openWeb);
  window.dispatchEvent(new Event("pagehide"));
  const cancel = fallbackIfAppStaysClosed(openWeb);
  cancel();
  vi.advanceTimersByTime(2500);
  expect(openWeb).not.toHaveBeenCalled();
});

it("iPad 桌面 UA 仍视为移动端，普通 Mac 使用网页", () => {
  const device = { userAgent: "Mozilla/5.0 (Macintosh)", maxTouchPoints: 5 };
  vi.stubGlobal("navigator", device);
  expect(isMobileDevice()).toBe(true);
  device.maxTouchPoints = 0;
  expect(isMobileDevice()).toBe(false);
});
