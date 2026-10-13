import { useEffect, useState } from 'react';
import { Popover, Input, Button } from 'antd';
import { Bookmark, Pencil, Trash2, X } from 'lucide-react';
import { message } from '@/utils/appMessage';
import {
  cleanFilterParams,
  listFilterPresets,
  removeFilterPreset,
  renameFilterPreset,
  saveFilterPreset,
  type FilterPreset,
} from '@/utils/filterPresets';

interface FilterPresetMenuProps {
  /** 页面标识（预设按页面分桶，例如 'sales-orders'） */
  pageKey: string;
  /** 当前筛选（页面组装；空值会被自动过滤，不含分页键） */
  currentParams: Record<string, string>;
  /** 应用预设：页面把 params 写回筛选状态（页面既有 syncUrl 会自动同步到 URL） */
  onApply: (params: Record<string, string>) => void;
}

/**
 * 「我的筛选」下拉（2026-09-12，U-03 设置便利性改进）。
 *
 * - 保存：把当前筛选条件命名存本机（localStorage 按 pageKey 分桶）
 * - 应用：一键套用 → 页面 state 更新 → URL 自动同步（**分享地址栏即可让同事看到同一套筛选**）
 * - 可重命名/删除；同名保存 = 覆盖
 *
 * 与「我的视图」同一设计原则：预设是个人偏好（本机），URL 才是分享载体。
 */
export function FilterPresetMenu({ pageKey, currentParams, onApply }: FilterPresetMenuProps) {
  const [open, setOpen] = useState(false);
  const [presets, setPresets] = useState<FilterPreset[]>([]);
  const [name, setName] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameText, setRenameText] = useState('');

  // 挂载即加载（按钮显示数量）；打开时刷新（其它标签页/手改 localStorage 后保持一致）
  useEffect(() => {
    setPresets(listFilterPresets(pageKey));
  }, [pageKey, open]);

  const currentClean = cleanFilterParams(currentParams);
  const currentCount = Object.keys(currentClean).length;

  const handleSave = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      message.warning('请先给这组筛选起个名字（如「本月未收款」）');
      return;
    }
    if (currentCount === 0) {
      message.warning('当前没有设置任何筛选条件，先选好条件再保存');
      return;
    }
    setPresets(saveFilterPreset(pageKey, trimmed, currentClean));
    setName('');
    message.success(`已保存筛选「${trimmed}」（存本机；地址栏 URL 可分享给同事）`);
  };

  const handleApply = (p: FilterPreset) => {
    onApply(p.params);
    setOpen(false);
    message.success(`已应用筛选「${p.name}」`);
  };

  const content = (
    <div className="w-80 text-sm">
      <div className="flex items-center justify-between mb-2">
        <span className="font-medium text-gray-700 flex items-center gap-1.5">
          <Bookmark className="w-3.5 h-3.5 text-blue-500" />
          我的筛选
        </span>
        <button type="button" onClick={() => setOpen(false)} className="p-1 text-gray-400 hover:text-gray-600" aria-label="关闭">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {presets.length === 0 ? (
        <p className="text-gray-400 text-xs py-2">还没有保存的筛选：设置好条件后在这里命名保存，下次一键套用。</p>
      ) : (
        <div className="max-h-64 overflow-y-auto -mx-1">
          {presets.map((p) => (
            <div key={p.name} className="flex items-center gap-1 px-1.5 py-1 rounded hover:bg-gray-50">
              {renaming === p.name ? (
                <>
                  <Input
                    size="small"
                    value={renameText}
                    onChange={(e) => setRenameText(e.target.value)}
                    onPressEnter={() => {
                      setPresets(renameFilterPreset(pageKey, p.name, renameText));
                      setRenaming(null);
                    }}
                    autoFocus
                  />
                  <Button
                    size="small"
                    type="text"
                    onClick={() => {
                      setPresets(renameFilterPreset(pageKey, p.name, renameText));
                      setRenaming(null);
                    }}
                  >
                    存
                  </Button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleApply(p)}
                    className="flex-1 text-left truncate text-gray-700 hover:text-blue-600"
                    title={`应用「${p.name}」`}
                  >
                    {p.name}
                  </button>
                  <span className="text-xs text-gray-300 shrink-0">{Object.keys(p.params).length} 项</span>
                  <button
                    type="button"
                    onClick={() => {
                      setRenaming(p.name);
                      setRenameText(p.name);
                    }}
                    className="p-1 text-gray-400 hover:text-gray-600 shrink-0"
                    title="重命名"
                    aria-label="重命名"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setPresets(removeFilterPreset(pageKey, p.name))}
                    className="p-1 text-gray-400 hover:text-red-500 shrink-0"
                    title="删除"
                    aria-label="删除"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="border-t border-gray-100 mt-2 pt-2">
        <div className="flex items-center gap-1.5">
          <Input
            size="small"
            placeholder="给当前筛选起名，如「本月未收款」"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onPressEnter={handleSave}
          />
          <Button size="small" type="primary" onClick={handleSave} disabled={currentCount === 0}>
            保存
          </Button>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          {currentCount === 0 ? '当前无筛选条件' : `当前 ${currentCount} 个条件将保存`}（存本机；地址栏 URL 可分享给同事）
        </p>
      </div>
    </div>
  );

  return (
    <Popover content={content} trigger="click" open={open} onOpenChange={setOpen} placement="bottomLeft">
      <button type="button" className="btn-secondary flex items-center gap-1.5" title="保存/套用常用筛选条件（存本机）">
        <Bookmark className="w-4 h-4" />
        <span>
          我的筛选{presets.length > 0 ? `（${presets.length}）` : ''}
        </span>
      </button>
    </Popover>
  );
}
