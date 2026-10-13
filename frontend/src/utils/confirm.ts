import { Modal } from 'antd';
import type { ReactNode } from 'react';

// 与 Tailwind blue-600 / ConfigProvider 主题一致（静态 Modal.confirm 不在 ConfigProvider 上下文内，需手动指定）
const PRIMARY_COLOR = '#2563eb';

/**
 * 全局确认框**桥接**（2026-09-11，与 `utils/appMessage` 同一模式）。
 *
 * 背景：antd 6 起 `Modal.confirm(...)` 静态调用无法消费 ConfigProvider 的主题/国际化，
 * 控制台持续输出 "Static function can not consume context like dynamic theme"，
 * 且弹窗不吃暗色主题。
 *   ① App 根组件（`<AntdApp>` 内）用 `App.useApp()` 拿到 modal 实例 → `bindModalConfirm(modal.confirm)`
 *   ② 各页面继续 `confirmAction({...})`（或 `modalConfirm(...)`），调用点写法不变
 *   ③ 尚未挂载时自动回退 antd 静态 `Modal.confirm`，功能不受影响
 *
 * ⚠️ 新增确认框请用本模块，不要再直接 `Modal.confirm`。
 */
type ConfirmProps = Parameters<typeof Modal.confirm>[0];
type ConfirmFn = (props: ConfirmProps) => unknown;

let ctxConfirm: ConfirmFn | null = null;

/** 由 App 根组件挂载时调用（消费主题/国际化，消除告警） */
export function bindModalConfirm(fn: ConfirmFn): void {
  ctxConfirm = fn;
}

/** 底层弹确认框（自动走 App context 实例，回退静态实现）—— 需要自定义 onOk 时用这个 */
export function modalConfirm(props: ConfirmProps): unknown {
  return (ctxConfirm ?? (Modal.confirm as unknown as ConfirmFn))(props);
}

interface ConfirmOptions {
  title: string;
  content?: ReactNode;
  okText?: string;
  cancelText?: string;
  /** 危险操作（删除等）显示红色确认键 */
  danger?: boolean;
  /** 自定义图标（如「恢复备份」的危险警示图标） */
  icon?: ReactNode;
}

/**
 * 统一操作确认（基于 AntD Modal.confirm）：
 * 替换原生 window.confirm，保持确认语义但 UI 统一为 Ant Design 风格。
 * 返回 Promise<boolean>：确认 true / 取消 false。
 */
export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise((resolve) => {
    modalConfirm({
      title: options.title,
      content: options.content,
      icon: options.icon,
      okText: options.okText || '确定',
      cancelText: options.cancelText || '取消',
      okButtonProps: options.danger
        ? { danger: true }
        : { style: { background: PRIMARY_COLOR, borderColor: PRIMARY_COLOR } },
      centered: true,
      onOk: () => resolve(true),
      onCancel: () => resolve(false),
    });
  });
}

