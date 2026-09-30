import { describe, expect, it, vi } from "vitest";
import { api } from "./api";

function mockFetch(ok: boolean, body: unknown, status = ok ? 200 : 400) {
  return vi.fn().mockResolvedValue({
    ok,
    status,
    json: async () => body,
  }) as unknown as typeof fetch;
}

describe("api 层", () => {
  it("明确传递一句话模式，旧调用默认攻略模式", async () => {
    const fetcher = mockFetch(true, { trip_id: "abc", task_id: "def" });
    vi.stubGlobal("fetch", fetcher);
    await api.createTrip("成都三天", "idea");
    expect(fetcher).toHaveBeenLastCalledWith("/api/v1/trips", expect.objectContaining({body: JSON.stringify({source_link: "成都三天", mode: "idea"})}));
    await api.createTrip("重庆攻略");
    expect(fetcher).toHaveBeenLastCalledWith("/api/v1/trips", expect.objectContaining({body: JSON.stringify({source_link: "重庆攻略", mode: "guide"})}));
    vi.unstubAllGlobals();
  });
  it("成功时返回数据", async () => {
    vi.stubGlobal("fetch", mockFetch(true, { trip_id: "abc", task_id: "def" }));
    const res = await api.createTrip("https://example.com");
    expect(res.trip_id).toBe("abc");
    vi.unstubAllGlobals();
  });

  it("失败时抛出统一错误消息", async () => {
    vi.stubGlobal(
      "fetch",
      mockFetch(false, { error: { code: "X", message: "服务器坏了" } }),
    );
    await expect(api.getTask("task1")).rejects.toThrow("服务器坏了");
    vi.unstubAllGlobals();
  });

  it("无 error 字段时回退 HTTP 状态码", async () => {
    vi.stubGlobal("fetch", mockFetch(false, {}));
    await expect(api.getTask("task1")).rejects.toThrow("HTTP 400");
    vi.unstubAllGlobals();
  });
});
