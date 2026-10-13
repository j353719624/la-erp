import { message as staticMessage } from 'antd';
import type { MessageInstance } from 'antd/es/message/interface';

/**
 * 全局 message（消除 antd 静态方法告警，2026-09-11）。
 *
 * 背景：antd 6 起，`message.success(...)` 这类静态调用无法消费 ConfigProvider 的主题/国际化，
 * 控制台会持续输出 "Static function can not consume context like dynamic theme"。
 * 项目里有 700+ 处调用，逐处改 hook 不现实 —— 这里用**桥接**：
 *   ① App 根组件用 `<AntdApp>` 包裹，内部的 MessageBridge 调 `App.useApp()` 拿到 context 实例并绑定到这里
 *   ② 各页面保持 `import { message } from '@/utils/appMessage'`，调用点写法完全不变
 *   ③ 尚未挂载（如请求拦截器等早期调用）时自动回退到 antd 静态实例，功能不受影响
 *
 * ⚠️ 新增文件请从 `@/utils/appMessage` 导入 message，不要再从 'antd' 直接导入。
 */
let ctxMessage: MessageInstance | null = null;

/** 由 App 根组件挂载时调用（消费主题/国际化，消除告警） */
export function bindMessage(instance: MessageInstance): void {
  ctxMessage = instance;
}

export const message = new Proxy({} as MessageInstance, {
  get(_target, prop) {
    const inst = (ctxMessage ?? staticMessage) as unknown as Record<string | symbol, unknown>;
    const value = inst[prop as string];
    return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(inst) : value;
  },
});
