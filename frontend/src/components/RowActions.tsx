import React from 'react';
import { Dropdown } from 'antd';
import { MoreHorizontal } from 'lucide-react';
import { confirmAction } from '@/utils/confirm';

/**
 * 行操作单元格（列表页统一用法）
 *
 * 背景（2026-09-11 客户反馈）：列表「操作」列有 4 个图标按钮，横屏手机下宽达 200+px；
 * 冻结操作列后更显得占地方。改为：
 *   - 宽屏（≥1024px 宽且 ≥561px 高）：全部图标平铺（保持原观感）
 *   - 窄屏/矮屏（手机、横屏）：只留 1 个主操作 + 「⋮ 更多」下拉菜单（列宽降到 ~70px）
 *
 * 用法：
 *   <RowActions actions={[
 *     { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => open(id) },
 *     { key: 'edit', label: '编辑', icon: <Edit className="w-4 h-4" />, onClick: () => nav(id) },
 *     { key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true,
 *       confirm: '确定删除 XX 吗？删除后不可恢复', onClick: () => del(id) },
 *   ]} />
 */
export interface RowAction {
  key: string;
  label: string;
  icon: React.ReactNode;
  onClick?: () => void;
  /** 危险操作（红色） */
  danger?: boolean;
  /** 有值时点击弹确认框（文案即确认内容） */
  confirm?: string;
  /** 主操作：窄屏直接显示（默认取第一个） */
  primary?: boolean;
  /** 附加的标题提示（默认用 label） */
  title?: string;
  /** 禁用（如“转单中”“恢复中”） */
  disabled?: boolean;
}

const BTN = 'p-1.5 rounded-lg transition-colors';

function trigger(a: RowAction) {
  if (!a.onClick) return;
  if (a.confirm) {
    void confirmAction({ title: a.confirm, danger: a.danger }).then((ok) => {
      if (ok) a.onClick?.();
    });
    return;
  }
  a.onClick();
}

function IconButton({ action }: { action: RowAction }) {
  return (
    <button
      type="button"
      onClick={() => trigger(action)}
      disabled={action.disabled}
      title={action.title || action.label}
      aria-label={action.label}
      className={`${BTN} ${action.disabled ? 'text-gray-300 cursor-not-allowed' : action.danger ? 'text-red-600 hover:bg-red-50' : 'text-blue-600 hover:bg-blue-50'}`}
    >
      {action.icon}
    </button>
  );
}

export function RowActions({ actions }: { actions: RowAction[] }) {
  const list = (actions || []).filter(Boolean);
  if (list.length === 0) return null;
  const primary = list.find((a) => a.primary) || list[0];
  const rest = list.filter((a) => a !== primary);

  return (
    <>
      {/* 宽屏：全部平铺（2026-09-12 间距收紧：p-2→p-1.5 + gap-2→gap-1，图标间空隙 24px→16px） */}
      <div className="row-actions-wide flex items-center justify-end gap-1">
        {list.map((a) => (
          <IconButton key={a.key} action={a} />
        ))}
      </div>
      {/* 窄屏/矮屏：主操作 + 更多菜单（列宽大幅缩小，横屏不必左右滑） */}
      <div className="row-actions-compact flex items-center justify-end gap-1">
        <IconButton action={primary} />
        {rest.length > 0 && (
          <Dropdown
            trigger={['click']}
            placement="bottomRight"
            menu={{
              items: rest.map((a) => ({
                key: a.key,
                label: a.label,
                icon: a.icon,
                danger: a.danger,
                disabled: a.disabled,
              })),
              onClick: ({ key }) => {
                const a = rest.find((x) => x.key === key);
                if (a) trigger(a);
              },
            }}
          >
            <button
              type="button"
              className={`${BTN} text-gray-600 hover:bg-gray-100`}
              title="更多操作"
              aria-label="更多操作"
            >
              <MoreHorizontal className="w-4 h-4" />
            </button>
          </Dropdown>
        )}
      </div>
    </>
  );
}
