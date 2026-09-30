import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import MapView from "./MapView";

const { load } = vi.hoisted(() => ({ load: vi.fn() }));
vi.mock("../lib/baidu-map", () => ({ loadBaiduMap: load }));

class TestMap {
  static instances: TestMap[] = [];
  constructor() { TestMap.instances.push(this); }
  centerAndZoom = vi.fn();
  enableScrollWheelZoom = vi.fn();
  addOverlay = vi.fn();
  clearOverlays = vi.fn();
  setViewport = vi.fn();
  openInfoWindow = vi.fn();
  zoomIn = vi.fn();
  zoomOut = vi.fn();
  destroy = vi.fn();
}
const api = {
  Map: TestMap,
  Point: class { constructor(public lng: number, public lat: number) {} },
  Polyline: class {},
  Label: class { setStyle() {} addEventListener() {} },
  InfoWindow: class {},
  Size: class {},
};
const day1 = [{ name: "解放碑", lng: 106.58, lat: 29.56 }];
const day2 = [{ name: "观音桥", lng: 106.53, lat: 29.58 }];

beforeEach(() => {
  TestMap.instances = [];
  load.mockReset();
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("百度交互地图连接", () => {
  it("SDK 超过旧的3秒仍等待真实连接，不永久切换到静态图", async () => {
    vi.useFakeTimers();
    let connected!: (value: typeof api) => void;
    load.mockReturnValue(new Promise(resolve => { connected = resolve; }));
    const { container } = render(<MapView points={day1} mapUrl="/saved.png" />);
    await act(async () => { vi.advanceTimersByTime(5000); });
    expect(container.querySelector(".interactive-map")?.getAttribute("data-map-state")).toBe("loading");
    expect(container.querySelector("img")).toBeNull();
    await act(async () => { connected(api); });
    expect(container.querySelector(".interactive-map")?.getAttribute("data-map-state")).toBe("ready");
    expect(TestMap.instances[0].enableScrollWheelZoom).toHaveBeenCalledWith(true);
  });

  it("两天各有独立地图，缩放只作用于对应那一天，卸载清理实例", async () => {
    load.mockResolvedValue(api);
    const view = render(<><MapView points={day1} mapUrl="/day1.png" /><MapView points={day2} mapUrl="/day2.png" /></>);
    await act(async () => {});
    expect(TestMap.instances).toHaveLength(2);
    expect(TestMap.instances[0].centerAndZoom).toHaveBeenCalledWith(expect.objectContaining({ lng: 106.58, lat: 29.56 }), 14);
    expect(TestMap.instances[1].centerAndZoom).toHaveBeenCalledWith(expect.objectContaining({ lng: 106.53, lat: 29.58 }), 14);
    fireEvent.click(screen.getAllByLabelText("放大地图")[1]);
    expect(TestMap.instances[1].zoomIn).toHaveBeenCalledOnce();
    expect(TestMap.instances[0].zoomIn).not.toHaveBeenCalled();
    view.unmount();
    expect(TestMap.instances.every(map => map.destroy.mock.calls.length === 1)).toBe(true);
  });

  it("连接失败明确显示预览，并可点击重新连接恢复交互", async () => {
    load.mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce(api);
    const { container } = render(<MapView points={day1} mapUrl="/saved.png" />);
    await act(async () => {});
    expect(container.querySelector(".interactive-map")?.getAttribute("data-map-state")).toBe("error");
    fireEvent.click(screen.getByRole("button", { name: "重新连接" }));
    await act(async () => {});
    expect(container.querySelector(".interactive-map")?.getAttribute("data-map-state")).toBe("ready");
    expect(container.querySelector("img")).toBeNull();
  });
});
