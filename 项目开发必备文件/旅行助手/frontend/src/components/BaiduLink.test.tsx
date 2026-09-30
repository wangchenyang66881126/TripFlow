import { cleanup, createEvent, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import BaiduLink from "./BaiduLink";

const link = { uri: "baidumap://map/direction?mode=transit", web_uri: "https://map.baidu.com/dir/解放碑/山城步道/?querytype=bt" };
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it("电脑上的普通点击与新标签操作都使用真实 HTTPS 链接，不触发 App 协议", () => {
  const openApp = vi.fn();
  render(<BaiduLink link={link} onAppNav={openApp}>公交</BaiduLink>);
  const anchor = screen.getByRole("link", { name: "公交" });
  expect(anchor.getAttribute("href")).toBe(link.web_uri);
  expect(anchor.getAttribute("target")).toBe("_blank");
  expect(anchor.getAttribute("rel")).toContain("noopener");
  const event = createEvent.click(anchor, { button: 0 });
  fireEvent(anchor, event);
  expect(event.defaultPrevented).toBe(false);
  expect(openApp).not.toHaveBeenCalled();
});

it("手机普通点击尝试唤起 App，修饰键点击仍保留网页链接", () => {
  vi.spyOn(navigator, "userAgent", "get").mockReturnValue("Mozilla/5.0 (iPhone)");
  const openApp = vi.fn();
  render(<BaiduLink link={link} onAppNav={openApp}>步行</BaiduLink>);
  const anchor = screen.getByRole("link", { name: "步行" });
  const event = createEvent.click(anchor, { button: 0 });
  fireEvent(anchor, event);
  expect(event.defaultPrevented).toBe(true);
  expect(openApp).toHaveBeenCalledExactlyOnceWith(link);
  const modified = createEvent.click(anchor, { button: 0, metaKey: true });
  fireEvent(anchor, modified);
  expect(modified.defaultPrevented).toBe(false);
  expect(openApp).toHaveBeenCalledTimes(1);
});
