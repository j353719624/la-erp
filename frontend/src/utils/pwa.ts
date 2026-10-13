/**
 * PWA 注册与安装提示（设计文档 9.1）
 * - 注册 Service Worker（vite-plugin-pwa autoUpdate：发现新版本自动接管并刷新，无「待刷新」提示）
 * - 监听 beforeinstallprompt 暴露安装能力
 *
 * [P3-3 2026-09-17 审查清理] 删除了 needRefresh/onNeedRefresh 死代码：
 * registerSW 配 autoUpdate 模式下 onNeedRefresh 永不触发（自动更新不弹提示），
 * 保留会让调用方误以为「有新版本等用户确认」；升级自愈改由 main.tsx 的 vite:preloadError
 * 监听 + public/boot-guard.js 负责（真正生效的机制）。
 */
import { registerSW } from 'virtual:pwa-register';

export interface PWARegistration {
  /** 是否可安装（浏览器已满足 installability 条件） */
  installable: boolean;
  /** 触发浏览器安装提示 */
  promptInstall: () => void;
  /** 手动检查更新（触发 SW 更新检查；autoUpdate 下发现新版即自动刷新） */
  update: () => void;
}

let installPromptEvent: any = null;

/**
 * 初始化 PWA：注册 SW + 捕获安装事件。
 * 返回当前可安装状态；组件可订阅回调感知变化。
 */
export function initPWA(onChange?: (state: { installable: boolean }) => void): PWARegistration {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installPromptEvent = e;
    onChange?.({ installable: true });
  });

  window.addEventListener('appinstalled', () => {
    installPromptEvent = null;
    onChange?.({ installable: false });
  });

  const updateSW = registerSW({
    immediate: true,
    onOfflineReady() {
      // 仅静态资源预缓存（vendor/index/css，白名单），业务数据与懒加载页面仍需联网：
      // 不要提示「可离线使用」——实际离线只能打开框架（P3-3）
      console.info('[PWA] 应用静态资源已缓存（离线仅供打开框架，业务需联网）');
    },
  });

  return {
    installable: !!installPromptEvent,
    promptInstall: () => {
      if (installPromptEvent) {
        installPromptEvent.prompt();
        installPromptEvent = null;
      }
    },
    update: () => updateSW(true),
  };
}
