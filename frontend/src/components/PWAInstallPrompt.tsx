import { useEffect, useState } from 'react';
import { Smartphone, Download, X } from 'lucide-react';
import { initPWA } from '@/utils/pwa';
import { LS } from '@/utils/localKeys';

/**
 * PWA 安装提示浮层（右下角/左下角）
 * 设计文档 9.1：浏览器端 PWA 免安装即时更新、移动端可添加到主屏幕
 *
 * [P3-3 2026-09-17 审查清理] 移除「发现新版本 → 刷新」分支：SW 为 autoUpdate 模式，
 * onNeedRefresh 永不触发（该 UI 永远不可达）；升级自愈由 vite:preloadError 监听 + boot-guard 负责。
 */
export function PWAInstallPrompt() {
  const [installable, setInstallable] = useState(false);
  // 关闭状态持久化（2026-09-12）：用户点过关闭后，刷新页面不再打扰
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(LS.pwaPromptDismissed) === '1';
    } catch {
      return false;
    }
  });
  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(LS.pwaPromptDismissed, '1');
    } catch {
      /* 忽略 */
    }
  };

  useEffect(() => {
    const pwa = initPWA(({ installable: inst }) => {
      setInstallable(inst);
    });
    // 初始同步一次
    setInstallable(pwa.installable);
    return () => {
      // 组件卸载时清理（SW 注册常驻，无需注销）
    };
  }, []);

  if (dismissed || !installable) return null;

  // [交互修复] 浮层移到左下角：此前 fixed right-4 会盖住移动端右下角吸底表单操作区（取消/保存按钮 z-20 < 本浮层 z-50），
  // 用户点保存时被浮层拦截 = 点不动的经典物理层遮挡。左下角通常为空白，无冲突。
  return (
    <div className="fixed bottom-4 left-4 z-50 flex items-center gap-3 bg-white rounded-xl shadow-lg border border-gray-100 px-4 py-3 max-w-sm animate-fade-in">
      <Smartphone className="w-5 h-5 text-green-600 shrink-0" />
      <div className="flex-1">
        <p className="text-sm font-medium text-gray-800">安装 LA-ERP 专业版</p>
        <p className="text-xs text-gray-500">添加到主屏幕，随时快速访问</p>
      </div>
      <button
        onClick={() => initPWA().promptInstall()}
        className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 transition-colors"
      >
        <Download className="w-3.5 h-3.5" />
        安装
      </button>
      <button onClick={dismiss} className="p-1 text-gray-400 hover:text-gray-600" aria-label="关闭">
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}
