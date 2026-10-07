/**
 * [PWA 升级自愈 2026-09-17] boot guard（挂载于 index.html，普通外链脚本）
 *
 * 背景：升级部署后，旧 Service Worker / 浏览器缓存可能返回"升级前的旧 index.html"
 * （引用已删除的旧 hash 资源 → 服务器 SPA 回退返回 HTML → 浏览器 MIME 拒载 → #root 空白 = 白屏）。
 * 行为：页面 load 后 5 秒检测 #root 是否已挂载；未挂载且在线 → 注销全部 Service Worker +
 *       清空 CacheStorage 并刷新一次（sessionStorage 计数最多 2 次，防死循环；正常挂载则清计数）。
 *       [2026-09-17 审查加固] 只注销 SW 不够：导航缓存（NetworkFirst）可能存着旧 index.html，
 *       慢网下被喂回（反复白屏/长期停在旧版）→ 必须先清空 CacheStorage；恢复联网时重新武装检测。
 *
 * ⚠️ 三条约束（改动前必读）：
 *   1. 必须外链：CSP `script-src 'self'` 拦截内联脚本（internal/api/middleware/security_headers.go）
 *   2. 不带 ?v= 版本参数、且不在 SW 预缓存清单（vite.config.ts globPatterns 白名单之外）——永远走网络拿最新
 *   3. 计数键名 `la_boot_guard` 与 main.tsx 的清除逻辑保持一致
 *
 * 兼容：ES5 语法（浏览器直接解析，不经打包）。检测：scripts/check_pwa_boot.mjs。
 */
(function () {
  var KEY = 'la_boot_guard';
  function check() {
    try {
      if (!navigator.onLine) return;
      var root = document.getElementById('root');
      if (root && root.childElementCount > 0) {
        sessionStorage.removeItem(KEY);
        return;
      }
      var n = parseInt(sessionStorage.getItem(KEY) || '0', 10) || 0;
      if (n >= 2) return;
      sessionStorage.setItem(KEY, String(n + 1));
      var reloaded = false;
      function reloadOnce() {
        if (reloaded) return;
        reloaded = true;
        try { location.reload(); } catch (e) { /* 忽略 */ }
      }
      // [2026-09-17 审查修复] 先清空全部 CacheStorage 再刷新（导航缓存里的旧 index.html 会反复复活）
      function clearCachesThenReload() {
        try {
          if (window.caches && caches.keys) {
            caches.keys().then(function (keys) {
              return Promise.all(keys.map(function (k) { return caches.delete(k); }));
            }).catch(function () {}).then(reloadOnce);
            setTimeout(reloadOnce, 1500); // 清理异常/超时兜底：绝不卡住自愈
            return;
          }
        } catch (e) { /* 忽略 */ }
        reloadOnce();
      }
      if (navigator.serviceWorker && navigator.serviceWorker.getRegistrations) {
        navigator.serviceWorker.getRegistrations().then(function (rs) {
          return Promise.all(rs.map(function (r) { return r.unregister(); }));
        }).catch(function () {}).then(clearCachesThenReload);
      } else {
        clearCachesThenReload();
      }
    } catch (e) { /* 隐私模式等场景静默 */ }
  }
  if (document.readyState === 'complete') { setTimeout(check, 5000); }
  else { window.addEventListener('load', function () { setTimeout(check, 5000); }); }
  // [2026-09-17 审查修复] 离线时 check 直接返回不自愈；恢复联网后重新武装一次检测
  window.addEventListener('online', function () { setTimeout(check, 1000); });
})();
