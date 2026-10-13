import { useEffect, useState } from 'react';

/**
 * 通用"表单被用户动过"检测（未保存离开防护的配套，2026-09-11）。
 *
 * 背景：`useUnsavedChanges(dirty)` 需要页面给出 dirty。单据表单字段各异（客户/供应商/仓库/明细…），
 * 逐页手写字段列表既慢又容易漏（同类残留）。这里观察**用户的真实交互**：
 *   ① `input` / `change` —— 文本输入、下拉选择、日期、数字步进
 *   ② `click` 击中"非导航类按钮" —— 添加明细行、删除行、切换回补方式等（这些不改输入值但同样会丢内容）
 *
 * ⚠️ 不要用 MutationObserver 观察表单 DOM：加载/回填数据也会改 DOM，会把"什么都没做"的页面判成脏，
 * 用户点返回被无辜拦截（实测踩过）。
 *
 * 已排除的按钮（点它们不算"动过表单"）：返回/取消/保存/提交/导出/打印/查询/刷新/关闭/翻页；
 * 否则"点保存后跳转"或"点取消想走"都会被自己的防护拦下。
 *
 * 用法（页面 2 行）：
 * ```tsx
 * const dirty = useFormInteracted();
 * const confirmLeave = useUnsavedChanges(dirty);
 * ```
 */
const NAV_BUTTON_RE = /^(返回|取消|关闭|保存|提交|确定|导出|打印|下载|查询|搜索|刷新|重置|上一页|下一页|首页|末页)$/;

const INPUT_SELECTOR = 'input, textarea, select, [contenteditable="true"], .ant-picker, .ant-select, .ant-input-number';

export function useFormInteracted(ready = true): boolean {
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!ready || touched) return;
    const root = (document.querySelector('form') as HTMLElement | null)
      ?? (document.querySelector('main') as HTMLElement | null);
    if (!root) return;

    const onEdit = (e: Event) => {
      const t = e.target as HTMLElement | null;
      if (t?.closest(INPUT_SELECTOR)) setTouched(true);
    };
    const onClick = (e: Event) => {
      const btn = (e.target as HTMLElement | null)?.closest('button, a, [role="button"]') as HTMLElement | null;
      if (!btn) return;
      if (NAV_BUTTON_RE.test((btn.textContent || '').trim())) return; // 导航/工具类按钮
      if (btn.closest('.page-header')) return;                       // 页头（返回/工具栏）
      setTouched(true);
    };

    root.addEventListener('input', onEdit, true);
    root.addEventListener('change', onEdit, true);
    root.addEventListener('click', onClick, true);
    return () => {
      root.removeEventListener('input', onEdit, true);
      root.removeEventListener('change', onEdit, true);
      root.removeEventListener('click', onClick, true);
    };
  }, [ready, touched]);

  return touched;
}
