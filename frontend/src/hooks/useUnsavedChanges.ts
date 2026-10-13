import { useEffect } from 'react';

/**
 * 单据表单"未保存就离开"防护（易用性 P1）。
 *
 * 解决的痛点：录了一半的订单，误点侧边栏/浏览器刷新，整单内容直接消失且**没有任何提示**。
 * 覆盖三种跑法：
 *  1. 刷新 / 关标签 / 关浏览器 → beforeunload 原生提示（浏览器自身弹窗）
 *  2. 点侧边栏菜单或任意内部链接跳走 → 捕获阶段拦截并确认（取消则本次跳转不生效）
 *  3. 表单里的"返回/取消"按钮 → 页面调用本 hook 返回的 confirmLeave() 再决定是否离开
 *
 * 用法：
 * ```tsx
 * const confirmLeave = useUnsavedChanges(isDirty);
 * ...
 * <button onClick={() => { if (confirmLeave()) navigate('/sales-orders'); }}>取消</button>
 * ```
 * 注意：只对"新建/编辑中"建议开启（列表明细弹窗等轻交互不要挂，否则打扰）。
 */
export function useUnsavedChanges(dirty: boolean, message = '当前内容尚未保存，确定离开吗？未保存的内容会丢失。') {
  useEffect(() => {
    if (!dirty) return;

    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // 触发浏览器原生"离开此页面？"确认
    };

    const onClickCapture = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      // <a href> 或侧边栏菜单（带 data-nav-link 标记的按钮）
      const el = target?.closest?.('a[href], [data-nav-link]') as HTMLElement | null;
      if (!el) return;
      if (el.getAttribute('target') === '_blank' || el.hasAttribute('download')) return;
      const href = el.getAttribute('href') || el.getAttribute('data-nav-link') || '';
      if (!href || href.startsWith('#') || href.startsWith('javascript:')) return;
      // 外部链接不拦（本站内导航才拦）
      if (/^https?:\/\//i.test(href) && !href.startsWith(window.location.origin)) return;
      if (!window.confirm(message)) {
        e.preventDefault();
        e.stopPropagation(); // 阻断 React 委托的 onClick（侧边栏按钮是 JS 跳转，必须 stop）
      }
    };

    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('click', onClickCapture, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClickCapture, true);
    };
  }, [dirty, message]);

  /** 供"返回/取消"等编程式导航调用：返回 true 表示可以离开 */
  return (): boolean => {
    if (!dirty) return true;
    return window.confirm(message);
  };
}
