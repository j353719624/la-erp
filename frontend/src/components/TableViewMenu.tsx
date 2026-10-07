import { useEffect, useState } from 'react';
import { Popover, Checkbox, Input, Button } from 'antd';
import { SlidersHorizontal, Save, X, ChevronUp, ChevronDown, Pencil, Plus } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { FIELD_TYPES, fieldTypeLabel, isValidFieldCode } from '@/utils/fieldTypes';
import {
  applyVisibleCols,
  decodeCols,
  encodeCols,
  listSavedViews,
  moveCol,
  removeSavedView,
  renameSavedView,
  saveSavedView,
  TABLE_VIEW_PARAM,
  type ColumnLabels,
  type SavedTableView,
} from '@/utils/tableView';

interface ColumnMeta {
  key: string;
  header: React.ReactNode;
  /** 纯文本列名（header 为 JSX 时菜单里需要文字标签；缺省时回退到字符串 header / 列 key） */
  label?: string;
}

interface TableViewMenuProps {
  /** 页面标识（本地预设按页面分桶，例如 'product-list'） */
  pageKey: string;
  allColumns: ColumnMeta[];
  /** 锁定列：不允许隐藏（勾选列/操作列），固定首尾 */
  locked?: { leading?: string[]; trailing?: string[] };
  visible: string[] | null;
  /** 自定义列名（列 key → 显示名；仅本视图生效，不改全局字段名） */
  labels?: ColumnLabels | null;
  onLabelsChange?: (labels: ColumnLabels | null) => void;
  /**
   * 新建元数据字段（与「元数据管理 → 字段管理」同一份数据：建完全站表单/详情/列表都能用）。
   * 由页面提供（页面负责权限判断与创建后刷新列）；不传则不显示入口。
   * 返回 `{ appeared: false }` 表示该实体的列表列已被「布局」定制、新字段不会自动进列（需到布局里加）。
   */
  createField?: (input: { name: string; code: string; fieldType: string }) => Promise<{ appeared?: boolean } | void>;
  /** 新建字段入口的提示语（各页实体不同，如“商品”） */
  entityLabel?: string;
  onChange: (cols: string[] | null) => void;
}

// 锁定列的内部 key → 友好名（否则菜单里会直接显示 __sel / __actions 这种内部键）
const LOCKED_COL_LABELS: Record<string, string> = { __sel: '勾选', __actions: '操作' };
const colLabel = (c: ColumnMeta): string =>
  c.label || (typeof c.header === 'string' ? c.header : '') || LOCKED_COL_LABELS[c.key] || c.key;

/**
 * 表格视图菜单（2026-09-11 易用性 P2）：「我的视图」——勾选这张表显示哪些列，保存为命名预设。
 *
 * - 勾选结果写 URL（`?cols=...`）→ 复制地址栏即可分享给同事（对端打开同一套列与列序）
 * - **列可上下调整顺序**（`?cols=` 的数组顺序 = 显示顺序，一并被分享）
 * - 预设存本机（localStorage，按 pageKey 分桶）；同名保存 = 覆盖，已保存视图可重命名/删除
 * - 锁定列（勾选/操作列）强制保留：用户不可能把自己锁到"没有操作按钮"的状态
 */
export function TableViewMenu({ pageKey, allColumns, locked, visible, labels, onLabelsChange, createField, entityLabel, onChange }: TableViewMenuProps) {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<SavedTableView[]>([]);
  const [name, setName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');
  const [renamingCol, setRenamingCol] = useState<string | null>(null);
  const [colNameText, setColNameText] = useState('');
  // 新建字段（元数据联动）
  const [addingField, setAddingField] = useState(false);
  const [newFieldName, setNewFieldName] = useState('');
  const [newFieldCode, setNewFieldCode] = useState('');
  const [newFieldType, setNewFieldType] = useState('string');
  const [savingField, setSavingField] = useState(false);

  useEffect(() => {
    if (open) setPresets(listSavedViews(pageKey));
  }, [open, pageKey]);

  const lockedKeys = new Set([...(locked?.leading ?? []), ...(locked?.trailing ?? [])]);
  const lockedList = [...(locked?.leading ?? []), ...(locked?.trailing ?? [])];
  const selectable = allColumns.filter((c) => !lockedKeys.has(c.key));
  // 顺序：可见列在前（数组顺序就是显示顺序，可上下移、可随 URL 分享），未显示的列排在下方
  const shownKeys = (visible ?? allColumns.map((c) => c.key)).filter((k) => allColumns.some((c) => c.key === k));
  const shownCount = shownKeys.length;
  const orderedColumns = [
    ...shownKeys.map((k) => allColumns.find((c) => c.key === k)!),
    ...selectable.filter((c) => !shownKeys.includes(c.key)),
  ];

  const toggle = (key: string, checked: boolean) => {
    if (checked) onChange(shownKeys.includes(key) ? shownKeys : [...shownKeys, key]);
    else onChange(shownKeys.filter((k) => k !== key));
  };

  /** 上移/下移一列（锁定列不动也不作为跨越目标） */
  const reorder = (key: string, dir: -1 | 1) => {
    const next = moveCol(shownKeys, key, dir, lockedList);
    if (next !== shownKeys) onChange(next);
  };

  /** 开始改列名（预填当前显示名） */
  const startColRename = (c: ColumnMeta) => {
    setRenamingCol(c.key);
    setColNameText(labels?.[c.key] || colLabel(c));
  };

  /** 提交列名：改回页面默认名（或清空）= 删除该列的自定义名 */
  const commitColRename = () => {
    if (!renamingCol) return;
    const key = renamingCol;
    const col = allColumns.find((c) => c.key === key);
    const def = col ? colLabel(col) : key;
    const text = colNameText.trim();
    const next: ColumnLabels = { ...(labels || {}) };
    if (!text || text === def) delete next[key];
    else next[key] = text;
    onLabelsChange?.(Object.keys(next).length ? next : null);
    setRenamingCol(null);
  };

  /** 恢复默认：列、列序与自定义列名一起回到页面默认 */
  const restoreDefault = () => {
    onChange(null);
    onLabelsChange?.(null);
  };

  const doSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      message.warning('请输入视图名称，例如“精简版”');
      return;
    }
    const cols = applyVisibleCols(allColumns, shownKeys, locked).map((c) => c.key);
    setPresets(saveSavedView(pageKey, trimmed, cols, labels));
    setName('');
    message.success(`已保存视图「${trimmed}」（仅本机可见，分享请复制当前网址）`);
  };

  const startRename = (v: SavedTableView) => {
    setRenamingId(v.id);
    setRenameText(v.name);
  };

  const commitRename = () => {
    if (!renamingId) return;
    const trimmed = renameText.trim();
    const before = presets.find((v) => v.id === renamingId);
    if (!trimmed) {
      setRenamingId(null);
      return;
    }
    if (before && trimmed !== before.name && presets.some((v) => v.id !== renamingId && v.name === trimmed)) {
      message.warning(`已存在名为「${trimmed}」的视图，换个名字或先删掉旧的`);
      setRenamingId(null);
      return;
    }
    setPresets(renameSavedView(pageKey, renamingId, trimmed));
    setRenamingId(null);
  };

  const cancelAddField = () => {
    setAddingField(false);
    setNewFieldName('');
    setNewFieldCode('');
    setNewFieldType('string');
  };

  /** 新建元数据字段：名称 + 编码 + 类型 → 交给页面调 API（建完表单/详情/列表全站可用） */
  const doCreateField = async () => {
    if (!createField) return;
    const fieldName = newFieldName.trim();
    if (!fieldName) {
      message.warning('请输入字段名称，例如“产地”');
      return;
    }
    const code = (newFieldCode.trim() || `f${Date.now().toString(36).slice(-6)}`).toLowerCase();
    if (!isValidFieldCode(code)) {
      message.warning('字段编码需以小写字母开头，只能包含小写字母/数字/下划线');
      return;
    }
    setSavingField(true);
    try {
      const res = await createField({ name: fieldName, code, fieldType: newFieldType });
      const appeared = res && typeof res === 'object' ? res.appeared : undefined;
      if (appeared === false) {
        message.warning(
          `字段「${fieldName}」已创建（可在「元数据管理 → 字段管理」看到，${entityLabel || '本模块'}表单/详情也可用）；本列表的列由「布局」配置决定，如需在列表里显示，请到 元数据管理 → 布局 把它加入列表列`,
          6,
        );
      } else {
        message.success(`字段「${fieldName}」已创建，可在“显示列”里勾选显示（表单/详情同步可用）`);
      }
      cancelAddField();
    } catch (e) {
      message.error(`创建字段失败：${e instanceof Error ? e.message : '请稍后重试'}`);
    } finally {
      setSavingField(false);
    }
  };

  const content = (
    <div className="w-72 space-y-3">
      <div>
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs font-medium text-gray-600">
            显示列（{shownCount}/{allColumns.length}）
          </span>
          <button type="button" className="text-xs text-blue-600 hover:underline" onClick={restoreDefault}>
            恢复默认
          </button>
        </div>
        <div className="max-h-56 overflow-y-auto pr-1 space-y-0.5">
          {orderedColumns.map((c) => {
            const shown = shownKeys.includes(c.key);
            const pos = shownKeys.indexOf(c.key);
            return (
              <div key={c.key} className="flex items-center gap-0.5">
                {renamingCol === c.key ? (
                  <Input
                    size="small"
                    autoFocus
                    className="flex-1"
                    value={colNameText}
                    placeholder={colLabel(c)}
                    onChange={(e) => setColNameText(e.target.value)}
                    onPressEnter={commitColRename}
                    onBlur={commitColRename}
                  />
                ) : (
                  <>
                    <Checkbox
                      className="flex-1 min-w-0"
                      checked={shown}
                      onChange={(e) => toggle(c.key, e.target.checked)}
                    >
                      <span className="text-sm">{labels?.[c.key] || colLabel(c)}</span>
                    </Checkbox>
                    {/* 锁定列（勾选/操作）改名无意义：key 是内部标识，改了下次也不知该叫什么 */}
                    {!lockedKeys.has(c.key) && (
                      <button
                        type="button"
                        title="改列名（仅本视图显示，不影响全局字段名）"
                        aria-label={`${colLabel(c)} 改列名`}
                        onClick={() => startColRename(c)}
                        className="p-0.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                      >
                        <Pencil className="w-3 h-3" />
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  title="上移"
                  aria-label={`${colLabel(c)} 上移`}
                  disabled={!shown || pos <= 0}
                  onClick={() => reorder(c.key, -1)}
                  className="p-0.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-25 disabled:hover:bg-transparent"
                >
                  <ChevronUp className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  title="下移"
                  aria-label={`${colLabel(c)} 下移`}
                  disabled={!shown || pos < 0 || pos >= shownKeys.length - 1}
                  onClick={() => reorder(c.key, 1)}
                  className="p-0.5 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50 disabled:opacity-25 disabled:hover:bg-transparent"
                >
                  <ChevronDown className="w-3.5 h-3.5" />
                </button>
              </div>
            );
          })}
          {selectable.length === 0 && <p className="text-xs text-gray-400">当前表格暂无可隐藏的列</p>}
        </div>
        <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
          勾选决定显示哪些列，↑↓ 调整顺序，✎ 可改列名（如把“原产国”显示为“产地”，只影响你自己的视图，不改全局字段名）。列、列序与列名都写入网址，复制网址即可分享给同事。
        </p>
      </div>

      <div className="border-t border-gray-100 pt-2">
        <div className="text-xs font-medium text-gray-600 mb-2">我的视图（本机保存）</div>
        {presets.length === 0 ? (
          <p className="text-xs text-gray-400 mb-2">还没有保存的视图</p>
        ) : (
          <div className="space-y-1 mb-2">
            {presets.map((v) => (
              <div key={v.id} className="flex items-center gap-1 text-sm">
                {renamingId === v.id ? (
                  <Input
                    size="small"
                    autoFocus
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onPressEnter={commitRename}
                    onBlur={commitRename}
                  />
                ) : (
                  <>
                    <button
                      type="button"
                      className="flex-1 text-left px-2 py-1 rounded hover:bg-gray-50 text-gray-700 truncate"
                      title={`应用视图「${v.name}」`}
                      onClick={() => {
                        onChange(v.cols);
                        onLabelsChange?.(v.labels ?? null);
                      }}
                    >
                      {v.name}
                    <span className="ml-1 text-[11px] text-gray-400">({v.cols.length} 列)</span>
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded text-gray-400 hover:text-blue-600 hover:bg-blue-50"
                      title="重命名该视图"
                      onClick={() => startRename(v)}
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      type="button"
                      className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50"
                      title="删除该视图"
                      onClick={() => setPresets(removeSavedView(pageKey, v.id))}
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </>
                )}
              </div>
            ))}
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Input
            size="small"
            value={name}
            placeholder="视图名称，如：精简版"
            onChange={(e) => setName(e.target.value)}
            onPressEnter={doSave}
          />
          <Button size="small" icon={<Save className="w-3.5 h-3.5" />} onClick={doSave}>
            保存
          </Button>
        </div>
      </div>

      {/* 新建字段（与元数据联动）：建完成为正式字段，表单/详情/列表全站可用 */}
      {createField && (
        <div className="border-t border-gray-100 pt-2">
          {addingField ? (
            <div className="space-y-1.5">
              <Input
                size="small"
                autoFocus
                value={newFieldName}
                placeholder={`字段名称，如：产地`}
                onChange={(e) => setNewFieldName(e.target.value)}
              />
              <Input
                size="small"
                value={newFieldCode}
                placeholder="字段编码（小写英文，留空自动生成）"
                onChange={(e) => setNewFieldCode(e.target.value)}
               autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
              <select
                value={newFieldType}
                onChange={(e) => setNewFieldType(e.target.value)}
                className="form-select w-full text-sm"
                aria-label="字段类型"
              >
                {FIELD_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
              <div className="flex items-center gap-1.5">
                <Button size="small" type="primary" loading={savingField} onClick={doCreateField}>
                  创建字段
                </Button>
                <Button size="small" onClick={cancelAddField}>
                  取消
                </Button>
              </div>
              <p className="text-[11px] text-gray-400 leading-relaxed">
                新字段会加入「元数据管理 → 字段管理」（当前类型：{fieldTypeLabel(newFieldType)}），
                {entityLabel || '本模块'}的表单/详情/列表都能用；编码创建后建议不要再改。
              </p>
            </div>
          ) : (
            <button
              type="button"
              className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
              onClick={() => setAddingField(true)}
            >
              <Plus className="w-3.5 h-3.5" /> 新建字段（同步到元数据）
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      trigger="click"
      placement="bottomRight"
      content={content}
      title={
        <span className="flex items-center gap-1.5 text-sm">
          <SlidersHorizontal className="w-4 h-4" /> 表格视图
        </span>
      }
    >
      <button type="button" className="btn-secondary flex items-center gap-1.5" title="选择显示哪些列 / 保存我的视图">
        <SlidersHorizontal className="w-4 h-4" />
        <span className="hidden sm:inline">视图</span>
        {visible && <span className="text-xs text-blue-600">{shownCount}</span>}
      </button>
    </Popover>
  );
}

export { TABLE_VIEW_PARAM, decodeCols, encodeCols };
export type { SavedTableView };
