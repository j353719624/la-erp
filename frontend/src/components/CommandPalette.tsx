import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, CornerDownLeft, History } from 'lucide-react';
import { Modal } from 'antd';
import { menuItems } from '@/components/Layout/Sidebar';
import { useAuthStore } from '@/store/auth';
import { useAppStore } from '@/store/app';
import { hiddenInPersonalMode } from '@/utils/menuPreview';
import { LS } from '@/utils/localKeys';

const RECENT_KEY = LS.commandRecent;
const PALETTE_EVENT = 'la-erp:command-palette';

/** 任意位置打开命令面板（顶栏搜索框按钮调用） */
export const openCommandPalette = () => window.dispatchEvent(new Event(PALETTE_EVENT));

interface PaletteItem {
  label: string;
  /** 所属一级菜单（叶子项为空） */
  group: string;
  path: string;
}

/**
 * 命令面板（易用性 P1）：Ctrl/⌘+K 唤起，输入关键词即可跳转任意功能页。
 *
 * 解决的老痛点：ERP 菜单 13 组近百个页面，找一个功能要展开几层菜单来回点；
 * 键盘党/熟练用户希望"输入即可达"。菜单来源与侧边栏同源（含权限过滤），不会指到无权限页面。
 */
export function CommandPalette() {
  const navigate = useNavigate();
  const { permissions } = useAuthStore();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const [recent, setRecent] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]') as string[]; } catch { return []; }
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // 全量条目（与侧边栏同源 + 同样的权限/个人模式过滤规则）
  const personalMode = useAppStore((s) => s.personalMode);
  const allItems = useMemo<PaletteItem[]>(() => {
    const has = (code?: string) => !code || permissions.includes('*') || permissions.includes(code);
    const out: PaletteItem[] = [];
    menuItems.forEach((m) => {
      const children = (m.children ?? [])
        .map((c) => ({ ...c, permission: c.permission ?? m.permission }))
        .filter((c) => has(c.permission) && !hiddenInPersonalMode(c.path, personalMode));
      if (children.length > 0) {
        children.forEach((c) => out.push({ label: c.label, group: m.label, path: c.path }));
      } else if (has(m.permission) && !hiddenInPersonalMode(m.path, personalMode)) {
        out.push({ label: m.label, group: '', path: m.path });
      }
    });
    return out;
  }, [permissions, personalMode]);

  // Ctrl+K / ⌘K 唤起；顶栏按钮通过自定义事件唤起
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setQ(''); setActive(0); setOpen((v) => !v);
      }
    };
    const onOpen = () => { setQ(''); setActive(0); setOpen(true); };
    window.addEventListener('keydown', onKey);
    window.addEventListener(PALETTE_EVENT, onOpen);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener(PALETTE_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 60);
  }, [open]);

  const keyword = q.trim().toLowerCase();
  const matched = useMemo(() => {
    if (!keyword) return [];
    return allItems
      .filter((i) => `${i.group} ${i.label}`.toLowerCase().includes(keyword))
      .slice(0, 40);
  }, [allItems, keyword]);

  // 无关键词时展示"最近访问"
  const recentItems = useMemo(
    () => recent.map((p) => allItems.find((i) => i.path === p)).filter(Boolean) as PaletteItem[],
    [recent, allItems],
  );
  const list = keyword ? matched : recentItems;

  const go = (item?: PaletteItem) => {
    if (!item) return;
    const next = [item.path, ...recent.filter((p) => p !== item.path)].slice(0, 5);
    setRecent(next);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    setOpen(false);
    navigate(item.path);
  };

  // 键盘导航（↑↓ 选择，Enter 跳转；Esc 由 Modal 处理）
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, list.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
    else if (e.key === 'Enter') { e.preventDefault(); go(list[active]); }
  };

  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  return (
    <Modal
      open={open}
      onCancel={() => setOpen(false)}
      footer={null}
      closable={false}
      width={560}
      style={{ top: 24, paddingBottom: 24 }}
      styles={{ body: { padding: 0 } }}
    >
      <div className="flex items-center gap-2.5 px-4 py-3 border-b border-gray-100">
        <Search className="w-4 h-4 text-gray-400 shrink-0" />
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => { setQ(e.target.value); setActive(0); }}
          onKeyDown={onKeyDown}
          placeholder="搜索功能 / 页面，如：订单、库存、报表、权限"
          aria-label="命令面板搜索"
          className="flex-1 outline-none text-sm bg-transparent"
        />
        <kbd className="text-[10px] text-gray-400 border border-gray-200 rounded px-1.5 py-0.5">Esc</kbd>
      </div>

      {/* 矮屏（手机横屏 844×390 等）下列表高度按视口收缩，避免面板超出屏幕 */}
      <div ref={listRef} className="max-h-[45vh] md:max-h-80 overflow-y-auto py-1.5">
        {!keyword && (
          <p className="px-4 py-1.5 text-[11px] text-gray-400 flex items-center gap-1">
            <History className="w-3 h-3" /> 最近访问
          </p>
        )}
        {list.length === 0 && (
          <p className="px-4 py-6 text-sm text-gray-400 text-center">
            {keyword ? `没有匹配「${q.trim()}」的功能` : '近 5 次打开过的页面会显示在这里；输入关键词搜索功能'}
          </p>
        )}
        {list.map((item, idx) => (
          <button
            key={item.path + idx}
            type="button"
            data-idx={idx}
            onMouseEnter={() => setActive(idx)}
            onClick={() => go(item)}
            className={`w-full flex items-center justify-between gap-3 px-4 py-2.5 text-left transition-colors ${
              idx === active ? 'bg-blue-50' : 'hover:bg-gray-50'
            }`}
          >
            <span className="min-w-0">
              <span className="text-sm text-gray-800">{item.label}</span>
              {item.group && <span className="text-xs text-gray-400 ml-2">{item.group}</span>}
            </span>
            {idx === active && <CornerDownLeft className="w-3.5 h-3.5 text-gray-300 shrink-0" />}
          </button>
        ))}
      </div>

      <div className="px-4 py-2 border-t border-gray-100 text-[11px] text-gray-400 flex items-center gap-4">
        <span>↑↓ 选择</span><span>Enter 跳转</span><span>Esc 关闭</span>
        <span className="ml-auto">Ctrl / ⌘ + K</span>
      </div>
    </Modal>
  );
}
