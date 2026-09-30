import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import App from "./App";
import { api } from "./lib/api";
import { PRESET_TEXT } from "./lib/preset";

vi.mock("./components/MapView", () => ({ default: () => <div>交互地图</div> }));
const place = { id: 1, day: 1, seq: 1, name: "解放碑", type: "景点", lat: 29.56, lng: 106.58,
  confirmed: true, skipped: false, geocode_status: "ok" };
const places = { trip_id: "cqpreset01", status: "done", city: "重庆", title: "重庆预设两日游",
  preset: true, input_text: PRESET_TEXT, places: [place] };

beforeEach(() => {
  window.history.replaceState(null, "", "/");
  vi.spyOn(api, "createTrip").mockRejectedValue(new Error("演示不得调用真实生成"));
  vi.spyOn(api, "getPlaces").mockResolvedValue(places);
  vi.spyOn(api, "getRoute").mockResolvedValue({ trip_id: "cqpreset01", days: [
    { day: 1, places: [place], segments: [], map_url: "/map" },
  ] });
  vi.spyOn(api, "getHotels").mockResolvedValue({ trip_id: "cqpreset01", days: [] });
  vi.spyOn(api, "getPhotos").mockResolvedValue({ trip_id: "cqpreset01", photos: {} });
  vi.spyOn(api, "getAppNav").mockResolvedValue({ max_via: 15, uris: [], days: [] });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); window.history.replaceState(null, "", "/"); });

it("开始演示直接打开预设，连点不重复提交，结果也不能更换攻略", async () => {
  let resolve!: (value: { trip_id: string; status: string; preset: boolean }) => void;
  const open = vi.spyOn(api, "openPreset").mockReturnValue(new Promise(r => { resolve = r; }));
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "生成演示行程" }));
  fireEvent.click(screen.getByRole("button", { name: "开始演示" }));
  expect(open).toHaveBeenCalledOnce();
  resolve({ trip_id: "cqpreset01", status: "done", preset: true });
  await screen.findByText("动线结果");
  expect(api.createTrip).not.toHaveBeenCalled();
  expect(window.location.search).toBe("?trip=cqpreset01");
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).readOnly).toBe(true);
  expect(screen.queryByRole("button", { name: "调整地点" })).toBeNull();
});

it("预设读取失败显示错误，不回退付费生成；可重新打开", async () => {
  vi.spyOn(api, "openPreset").mockRejectedValueOnce(new Error("演示暂时无法读取"))
    .mockResolvedValue({ trip_id: "cqpreset01", status: "done", preset: true });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: "开始演示" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("alert").textContent).toContain("演示暂时无法读取");
  fireEvent.click(screen.getByRole("button", { name: "开始演示" }));
  await screen.findByText("动线结果");
  expect(api.createTrip).not.toHaveBeenCalled();
});

it("刷新或分享链接恢复预设，不提交任何生成请求", async () => {
  const open = vi.spyOn(api, "openPreset");
  window.history.replaceState(null, "", "/share/cqpreset01");
  render(<App />);
  await screen.findByText("动线结果");
  await waitFor(() => expect(api.getHotels).toHaveBeenCalledWith("cqpreset01"));
  expect(open).not.toHaveBeenCalled();
  expect(api.createTrip).not.toHaveBeenCalled();
  expect((screen.getByRole("textbox") as HTMLTextAreaElement).value).toBe(PRESET_TEXT);
});
