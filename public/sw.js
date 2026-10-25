// 서비스 워커 — 데스크톱 알림을 받아 띄우고, 누르면 그 화면을 연다 (2026-10 알림 A · 0041).
// 캐시는 하지 않는다 — 업무 화면이 옛것으로 보이면 안 된다. 알림만 맡는다.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => e.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let msg = { title: "팀보드", body: "", url: "/v3/control" };
  try { msg = { ...msg, ...event.data.json() }; } catch { if (event.data) msg.body = event.data.text(); }
  event.waitUntil(self.registration.showNotification(msg.title, {
    body: msg.body, tag: msg.tag, renotify: !!msg.tag, icon: "/brand/app-192.png?v=2", badge: "/brand/app-192.png?v=2",
    data: { url: msg.url },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || "/v3/control", self.location.origin).href;
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const same = wins.find((w) => w.url.startsWith(self.location.origin));
    if (same) { await same.focus(); return same.navigate(url); }
    return self.clients.openWindow(url);
  })());
});
