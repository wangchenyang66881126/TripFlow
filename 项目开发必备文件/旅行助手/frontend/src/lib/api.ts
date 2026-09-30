import type {
  AppNavResponse,
  HotelsResponse,
  InputMode,
  PhotosResponse,
  PlacesResponse,
  RouteResponse,
  Task,
} from "./types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...init,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg =
      (data as { error?: { message?: string } }).error?.message ??
      `请求失败（HTTP ${res.status}）`;
    throw new Error(msg);
  }
  return data as T;
}

export const api = {
  openPreset: () =>
    request<{ trip_id: string; status: string; preset: boolean }>("/api/v1/trips/preset", { method: "POST" }),

  createTrip: (source_link: string, mode: InputMode = "guide") =>
    request<{ trip_id: string; task_id: string }>("/api/v1/trips", {
      method: "POST",
      body: JSON.stringify({ source_link, mode }),
    }),

  getTask: (taskId: string) => request<Task>(`/api/v1/tasks/${taskId}`),

  getPlaces: (tripId: string) =>
    request<PlacesResponse>(`/api/v1/trips/${tripId}/places`),

  updatePlace: (tripId: string, placeId: number, body: Record<string, unknown>) =>
    request(`/api/v1/trips/${tripId}/places/${placeId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    }),

  createRoute: (tripId: string) =>
    request<{ trip_id: string; task_id: string }>(
      `/api/v1/trips/${tripId}/route`,
      { method: "POST" },
    ),

  getRoute: (tripId: string) =>
    request<RouteResponse>(`/api/v1/trips/${tripId}/route`),

  getAppNav: (tripId: string) =>
    request<AppNavResponse>(`/api/v1/trips/${tripId}/app-nav`),

  getPhotos: (tripId: string) =>
    request<PhotosResponse>(`/api/v1/trips/${tripId}/photos`),

  getHotels: (tripId: string) =>
    request<HotelsResponse>(`/api/v1/trips/${tripId}/hotels`),

  createExport: (tripId: string) =>
    request<{ trip_id: string; task_id: string }>(
      `/api/v1/trips/${tripId}/export`,
      { method: "POST" },
    ),
};
