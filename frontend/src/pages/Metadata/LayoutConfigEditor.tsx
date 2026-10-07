import { useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Trash2, ArrowUp, ArrowDown, Code2, Eye, GripVertical, Search, Wand2 } from 'lucide-react';
import { Select } from 'antd';
import { message } from '@/utils/appMessage';
import { Field } from '@/types/metadata';
import { tableColumnLabel } from '@/utils/columnLabels';
import { pickDisplayValue } from '@/utils/fieldValue';
import { FIELD_TYPE_LABELS } from '@/config/industryTemplates';

/**
 * 布局配置 · 所见即所得编辑器
 * 把「布局配置 JSON」手写改造为可视化编排（列表列/搜索字段/表单分组），
 * 并保留「JSON 模式」给需要精细控制的高级用户。
 *
 * 产出 JSON 结构与下游消费端完全一致：
 *  - list/mobile: { table: { columns: [{field,label,width}] }, header: { searchFields: [code] } }
 *  - form:        { sections: [{ title, gridCols, fields: [{field}] }] }
 */

interface Props {
  layoutType: 'list' | 'form' | 'mobile';
  fields: Field[];
  sampleRows?: Record<string, any>[];   // 实体样例数据（用于真实数据行预览 + 系统内置列可选）
  config: string;          // 当前 JSON 文本（由父级持有）
  onChange: (json: string) => void;
}

// 不适合作列的隐藏列（created_at/updated_at 允许作为显示列，故不在此列）
const SKIP_COLUMNS = ['id', 'tenant_id', 'deleted_at'];

type DragItem = { kind: 'col' | 'sec' | 'field'; si?: number; from: number } | null;

function pretty(cfg: Record<string, any>): string {
  return JSON.stringify(cfg ?? {}, null, 2);
}

function fieldLabel(fields: Field[], code: string): string {
  const f = fields.find(x => x.code === code);
  return f ? f.name || code : code;
}

// 列显示名（与动态数据页消费端一致）：布局显式显示名(非原始列码) → 字段中文名 → 系统表列中文名 → 原始列码
function colDisplayName(fields: Field[], code: string, label?: string): string {
  const f = fields.find(x => x.code === code);
  const explicit = label && label !== code ? label : '';
  return explicit || f?.name || tableColumnLabel(code) || code;
}

function fmtVal(v: any): string {
  if (v === null || v === undefined) return '—';
  if (typeof v === 'boolean') return v ? '✓' : '✗';
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

// 预览取值：列字段码与数据实际存储键不一致时（如列 color、数据存 TEST001COLOR）按同义键回退，
// 图片列 → 📷/—；枚举原样值（active）转中文，与真实列表渲染一致。取值统一走 pickDisplayValue。
function previewVal(row: Record<string, any>, field: string): any {
  const v = pickDisplayValue(row, field);
  if (field === 'status' && typeof v === 'string') {
    const map: Record<string, string> = { active: '启用', inactive: '停用', disabled: '禁用' };
    return map[v] ?? v;
  }
  return v;
}

// 数组内 from→to 重排（通用，供列/分组/组内字段拖拽）
function reorderArr<T>(arr: T[], from: number, to: number): T[] {
  if (from === to) return arr;
  const next = [...arr];
  const [x] = next.splice(from, 1);
  next.splice(to, 0, x);
  return next;
}

export function LayoutConfigEditor({ layoutType, fields, sampleRows = [], config, onChange }: Props) {
  const isForm = layoutType === 'form';
  const [jsonMode, setJsonMode] = useState(false);
  // jsonText 始终等于当前配置文本（可视/JSON 两模式的唯一事实源）
  const [jsonText, setJsonText] = useState(() => {
    try {
      const obj = JSON.parse(config || '{}');
      return JSON.stringify(obj, null, 2);
    } catch {
      return config || '{}';
    }
  });
  // 可视化数据模型（仅在可视模式下使用；从 jsonText 初始化）
  const [cfg, setCfg] = useState<Record<string, any>>(() => {
    try { return JSON.parse(config || '{}'); } catch { return {}; }
  });
  const [addListField, setAddListField] = useState<string | undefined>(undefined);
  const [sectionFieldPick, setSectionFieldPick] = useState<Record<number, string | undefined>>({});
  const advancedInit = useRef(false);

  const candidates = useMemo(() => fields.filter(f => !SKIP_COLUMNS.includes(f.code)), [fields]);

  // 从样例数据行推导「表列」：覆盖系统内置/未在字段管理配置的真实列（created_at/created_by…）
  const tableCols = useMemo(() => {
    const set: string[] = [];
    for (const r of sampleRows) {
      for (const k of Object.keys(r)) {
        if (!SKIP_COLUMNS.includes(k) && !set.includes(k) && !fields.some(f => f.code === k)) set.push(k);
      }
    }
    return set;
  }, [sampleRows, fields]);

  // 拖拽排序（列 / 分组 / 组内字段）：ref 同步读写保证连续 drag 事件可靠，state 仅用于视觉高亮
  const [drag, setDrag] = useState<DragItem>(null);
  const dragRef = useRef<DragItem>(null);
  const beginDrag = (d: DragItem) => { dragRef.current = d; setDrag(d); };
  const endDrag = () => { dragRef.current = null; setDrag(null); };

  // 可视模式任何改动：更新模型 + jsonText + 上抛
  const commit = (next: Record<string, any>) => {
    setCfg(next);
    const t = pretty(next);
    setJsonText(t);
    onChange(t);
  };

  // JSON 模式与可视模式互切
  const enterVisual = () => {
    try {
      const obj = JSON.parse(jsonText);
      if (typeof obj !== 'object' || obj === null) throw new Error('not object');
      setCfg(obj);
      setJsonMode(false);
    } catch {
      message.error('JSON 格式错误，无法切换到可视化模式，请先修正');
    }
  };
  const enterJson = () => {
    advancedInit.current = true;
    setJsonMode(true);
  };
  const formatJson = () => {
    try {
      const o = JSON.parse(jsonText);
      const t = pretty(o);
      setJsonText(t);
      onChange(t);
      message.success('已格式化');
    } catch {
      message.error('JSON 格式错误');
    }
  };

  useEffect(() => {
    // 布局类型切换或打开新布局时，若父级 config 变化且尚未进入 JSON 手改，则同步
    if (!advancedInit.current) {
      setJsonText(config || '{}');
      try { setCfg(JSON.parse(config || '{}')); } catch { setCfg({}); }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutType, config]);

  // ---------------- list / mobile：表格列 + 搜索字段 ----------------
  const columns: any[] = Array.isArray(cfg?.table?.columns) ? cfg.table.columns : [];
  const searchFields: string[] = Array.isArray(cfg?.header?.searchFields) ? cfg.header.searchFields : [];

  const setSearchField = (code?: string) => {
    commit({ ...cfg, table: cfg.table || { columns }, header: { searchFields: code ? [code] : [] } });
  };

  const addColumn = (code: string) => {
    if (!code) return;
    const f = fields.find(x => x.code === code);
    // 默认显示名：元数据字段取中文名；数据表列(非字段)取系统表列中文名，避免存成英文列码
    const next = [...columns, { field: code, label: f?.name || tableColumnLabel(code) || code }];
    commit({ ...cfg, table: { columns: next }, header: cfg.header || { searchFields } });
    setAddListField(undefined);
  };

  const updateColumn = (i: number, patch: Record<string, any>) => {
    const next = columns.map((c, idx) => (idx === i ? { ...c, ...patch } : c));
    commit({ ...cfg, table: { columns: next }, header: cfg.header || { searchFields } });
  };

  const moveColumn = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= columns.length) return;
    const next = [...columns];
    [next[i], next[j]] = [next[j], next[i]];
    commit({ ...cfg, table: { columns: next }, header: cfg.header || { searchFields } });
  };

  const removeColumn = (i: number) => {
    const next = columns.filter((_, idx) => idx !== i);
    commit({ ...cfg, table: { columns: next }, header: cfg.header || { searchFields } });
  };

  // 拖拽落点：列 / 分组 / 组内字段
  const handleDrop = (kind: 'col' | 'sec' | 'field', si: number | undefined, to: number) => {
    const d = dragRef.current;
    if (!d || d.kind !== kind || (kind === 'field' && d.si !== si)) { endDrag(); return; }
    if (kind === 'col') {
      commit({ ...cfg, table: { columns: reorderArr(columns, d.from, to) }, header: cfg.header || { searchFields } });
    } else if (kind === 'sec') {
      commit({ ...cfg, sections: reorderArr(sections, d.from, to) });
    } else if (d.si !== undefined) {
      const s = sections[d.si];
      if (s) {
        const fs = reorderArr(s.fields || [], d.from, to);
        commit({ ...cfg, sections: sections.map((x, idx) => (idx === d.si ? { ...x, fields: fs } : x)) });
      }
    }
    endDrag();
  };

  const usedColCodes = columns.map((c: any) => c.field);
  const leftoverColFields = candidates.filter(f => !usedColCodes.includes(f.code));
  const leftoverTableCols = tableCols.filter(c => !usedColCodes.includes(c));

  // ---------------- form：分组编排 ----------------
  const sections: any[] = Array.isArray(cfg?.sections) ? cfg.sections : [];

  const addSection = () => {
    const next = [...sections, { title: `分组 ${sections.length + 1}`, gridCols: 2, fields: [] }];
    commit({ ...cfg, sections: next });
  };
  const updateSection = (i: number, patch: Record<string, any>) => {
    const next = sections.map((s, idx) => (idx === i ? { ...s, ...patch } : s));
    commit({ ...cfg, sections: next });
  };
  const removeSection = (i: number) => {
    commit({ ...cfg, sections: sections.filter((_, idx) => idx !== i) });
  };
  const addSectionField = (si: number, code: string) => {
    if (!code) return;
    const next = sections.map((s, idx) =>
      idx === si ? { ...s, fields: [...(s.fields || []), { field: code }] } : s);
    commit({ ...cfg, sections: next });
    setSectionFieldPick(prev => ({ ...prev, [si]: undefined }));
  };
  const removeSectionField = (si: number, fi: number) => {
    const next = sections.map((s, idx) =>
      idx === si ? { ...s, fields: (s.fields || []).filter((_: any, fidx: number) => fidx !== fi) } : s);
    commit({ ...cfg, sections: next });
  };
  const moveSectionField = (si: number, fi: number, dir: -1 | 1) => {
    const fj = fi + dir;
    const s = sections[si];
    if (!s || fj < 0 || fj >= (s.fields || []).length) return;
    const fs = [...(s.fields || [])];
    [fs[fi], fs[fj]] = [fs[fj], fs[fi]];
    const next = sections.map((x, idx) => (idx === si ? { ...x, fields: fs } : x));
    commit({ ...cfg, sections: next });
  };

  const moveSection = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    commit({ ...cfg, sections: reorderArr(sections, i, j) });
  };

  const usedFormCodes = sections.flatMap((s: any) => (s.fields || []).map((f: any) => f.field));
  const leftoverFormFields = candidates.filter(f => !usedFormCodes.includes(f.code));

  // ---------------- 渲染 ----------------
  return (
    <div className="space-y-4">
      {/* 模式切换 */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">
          {isForm
            ? '拖动分组 / 组内字段可调整顺序；未分组的非核心字段将自动显示在「其他字段」'
            : '选择要显示的列（可拖拽排序、改显示名与列宽），下方用真实数据实时预览'}
        </span>
        <button
          type="button"
          onClick={jsonMode ? enterVisual : enterJson}
          className="btn-secondary flex items-center gap-1.5 !px-3 !py-1.5 text-xs"
        >
          {jsonMode ? <><Eye className="w-3.5 h-3.5" />可视化模式</> : <><Code2 className="w-3.5 h-3.5" />JSON 模式</>}
        </button>
      </div>

      {jsonMode ? (
        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-gray-400">
              可直接编辑原始配置。字段值必须为字段编码（见字段管理）。
            </span>
            <button type="button" onClick={formatJson}
              className="btn-secondary flex items-center gap-1 !px-2.5 !py-1 text-xs">
              <Wand2 className="w-3.5 h-3.5" />格式化
            </button>
          </div>
          <textarea
            value={jsonText}
            onChange={e => { setJsonText(e.target.value); onChange(e.target.value); }}
            rows={16}
            className="form-input font-mono text-xs w-full"
            spellCheck={false}
          />
        </div>
      ) : isForm ? (
        /* ================= 表单页可视化 ================= */
        <div className="space-y-3">
          {sections.map((sec, si) => (
            <div
              key={si}
              onDragOver={e => e.preventDefault()}
              onDrop={() => handleDrop('sec', undefined, si)}
              className={`border rounded-lg p-3 bg-gray-50/50 transition-shadow ${
                drag?.kind === 'sec' && drag.from !== si ? 'border-blue-300 ring-1 ring-blue-200' : 'border-gray-200'
              }`}
            >
              <div className="flex items-center gap-2 mb-2">
                <div
                  draggable
                  onDragStart={() => beginDrag({ kind: 'sec', from: si })}
                  onDragOver={e => e.preventDefault()}
                  onDragEnd={endDrag}
                  onDrop={() => handleDrop('sec', undefined, si)}
                  title="拖动排序分组"
                  className="p-0.5 -m-0.5 rounded cursor-grab active:cursor-grabbing hover:bg-gray-200/70"
                >
                  <GripVertical className="w-4 h-4 text-gray-300" />
                </div>
                <input
                  value={sec.title || ''}
                  onChange={e => updateSection(si, { title: e.target.value })}
                  className="form-input flex-1 cursor-text"
                  placeholder="分组标题，如：基本信息"
                />
                <div className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap">
                  每行
                  <select
                    value={sec.gridCols ?? 2}
                    onChange={e => updateSection(si, { gridCols: Number(e.target.value) })}
                    className="form-select !py-1 !text-xs w-auto cursor-pointer"
                  >
                    <option value={1}>1 列</option>
                    <option value={2}>2 列</option>
                    <option value={3}>3 列</option>
                  </select>
                </div>
                <button type="button" onClick={() => moveSection(si, -1)} disabled={si === 0}
                  className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30" title="分组前移">
                  <ArrowUp className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => moveSection(si, 1)} disabled={si === sections.length - 1}
                  className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30" title="分组后移">
                  <ArrowDown className="w-3.5 h-3.5" />
                </button>
                <button type="button" onClick={() => removeSection(si)} title="删除分组"
                  className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors">
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
              <div className={`grid gap-2 ${(sec.gridCols ?? 2) > 2 ? 'grid-cols-1 md:grid-cols-3' : (sec.gridCols ?? 2) > 1 ? 'grid-cols-1 md:grid-cols-2' : 'grid-cols-1'}`}>
                {(sec.fields || []).map((f: any, fi: number) => (
                  <div
                    key={fi}
                    draggable
                    onDragStart={() => beginDrag({ kind: 'field', si, from: fi })}
                    onDragOver={e => e.preventDefault()}
                    onDragEnd={endDrag}
                    onDrop={() => handleDrop('field', si, fi)}
                    className={`flex items-center gap-1 bg-white border border-gray-200 rounded-md px-2 py-1.5 cursor-grab active:cursor-grabbing ${
                      drag?.kind === 'field' && drag.si === si && drag.from === fi ? 'opacity-50' : ''
                    }`}
                  >
                    <GripVertical className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                    <span className="flex-1 truncate text-sm text-gray-700">{fieldLabel(fields, f.field)}</span>
                    <button type="button" onClick={() => moveSectionField(si, fi, -1)} disabled={fi === 0}
                      className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30" title="前移">
                      <ArrowUp className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => moveSectionField(si, fi, 1)} disabled={fi === (sec.fields || []).length - 1}
                      className="p-0.5 text-gray-400 hover:text-gray-600 disabled:opacity-30" title="后移">
                      <ArrowDown className="w-3.5 h-3.5" />
                    </button>
                    <button type="button" onClick={() => removeSectionField(si, fi)} className="p-0.5 text-red-400 hover:text-red-600" title="移除">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                <Select
                  className="w-full"
                  placeholder="＋ 添加字段到本组…"
                  value={sectionFieldPick[si] ?? null}
                  onChange={(v) => addSectionField(si, v)}
                  options={leftoverFormFields.map(f => ({ value: f.code, label: `${f.name}（${f.code}）` }))}
                  size="small"
                  notFoundContent={leftoverFormFields.length ? undefined : '已全部添加'}
                />
              </div>
            </div>
          ))}
          <button type="button" onClick={addSection} className="btn-secondary flex items-center gap-1.5 w-full justify-center !py-2 text-sm">
            <Plus className="w-4 h-4" />添加分组
          </button>
          {leftoverFormFields.length > 0 && (
            <div className="rounded-lg border border-dashed border-gray-300 p-3">
              <div className="text-xs text-gray-400 mb-1">以下字段未放入任何分组，将自动显示在「其他字段」：</div>
              <div className="flex flex-wrap gap-1.5">
                {leftoverFormFields.map(f => (
                  <span key={f.id} className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-500">
                    {f.name}（{f.code}）
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        /* ================= 列表/移动端可视化 ================= */
        <div className="space-y-3">
          {/* 搜索字段 */}
          <div className="flex items-center gap-2">
            <Search className="w-4 h-4 text-gray-400 shrink-0" />
            <span className="text-sm text-gray-600 whitespace-nowrap">顶部搜索字段</span>
            <Select
              className="flex-1"
              allowClear
              placeholder="不设置搜索框"
              value={searchFields[0]}
              onChange={(v?: string) => setSearchField(v)}
              options={candidates.map(f => ({ value: f.code, label: `${f.name}（${f.code}）` }))}
            />
          </div>

          {/* 显示列 */}
          <div>
            <div className="text-sm font-medium text-gray-700 mb-2">显示列（按此顺序显示）</div>
            <div className="space-y-1.5">
              {columns.map((c, i) => {
                const f = fields.find(x => x.code === c.field);
                const isTableCol = !f && tableCols.includes(c.field);
                return (
                  <div
                    key={i}
                    draggable
                    onDragStart={() => beginDrag({ kind: 'col', from: i })}
                    onDragOver={e => e.preventDefault()}
                    onDragEnd={endDrag}
                    onDrop={() => handleDrop('col', undefined, i)}
                    className={`flex items-center gap-2 bg-white border border-gray-200 rounded-lg px-3 py-2 cursor-grab active:cursor-grabbing ${
                      drag?.kind === 'col' && drag.from === i ? 'opacity-50' : ''
                    } ${drag?.kind === 'col' && drag.from !== i ? 'border-blue-300' : ''}`}
                  >
                    <GripVertical className="w-4 h-4 text-gray-300 shrink-0" />
                    <div className="w-44 truncate">
                      <div className="text-sm text-gray-800 truncate">{colDisplayName(fields, c.field, c.label)}</div>
                      <div className="text-xs text-gray-400 truncate">
                        {f ? `(${c.field})${f.field_type ? ' · ' + (FIELD_TYPE_LABELS[f.field_type] || f.field_type) : ''}` : isTableCol ? `${c.field} · 表列` : `字段不存在：${c.field}`}
                      </div>
                    </div>
                    <input
                      value={c.label ?? ''}
                      onChange={e => updateColumn(i, { label: e.target.value })}
                      placeholder={f?.name || tableColumnLabel(c.field) || c.field}
                      className="form-input flex-1 !py-1.5 text-sm"
                    />
                    <div className="flex items-center gap-1 text-xs text-gray-400 whitespace-nowrap">
                      宽
                      <input
                        type="number"
                        min={40}
                        value={c.width ?? ''}
                        onChange={e => updateColumn(i, { width: e.target.value === '' ? undefined : Number(e.target.value) })}
                        placeholder="默认"
                        className="form-input !py-1.5 !w-20 text-sm"
                      />
                    </div>
                    <button type="button" onClick={() => moveColumn(i, -1)} disabled={i === 0}
                      className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30" title="前移">
                      <ArrowUp className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => moveColumn(i, 1)} disabled={i === columns.length - 1}
                      className="p-1 text-gray-400 hover:text-gray-600 disabled:opacity-30" title="后移">
                      <ArrowDown className="w-4 h-4" />
                    </button>
                    <button type="button" onClick={() => removeColumn(i)} className="p-1 text-red-400 hover:text-red-600" title="移除该列">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                );
              })}
              <Select
                className="w-full"
                placeholder="＋ 添加列…（支持拖动手柄调整顺序）"
                value={addListField ?? null}
                onChange={(v) => v && addColumn(v)}
                showSearch
                optionFilterProp="label"
                options={[
                  ...(leftoverColFields.length ? [{
                    label: '字段管理',
                    options: leftoverColFields.map(f => ({ value: f.code, label: `${f.name}（${f.code}）` })),
                  }] : []),
                  ...(leftoverTableCols.length ? [{
                    label: '数据表列（系统内置）',
                    options: leftoverTableCols.map(c => {
                      const t = tableColumnLabel(c);
                      return { value: c, label: t ? `${t}（${c}）` : c };
                    }),
                  }] : []),
                ]}
                notFoundContent={leftoverColFields.length || leftoverTableCols.length ? '没有更多可添加的列' : '已全部添加'}
              />
              {candidates.length === 0 && tableCols.length === 0 && (
                <div className="text-xs text-amber-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                  该实体暂无可用字段：可先到「字段管理」添加字段；「数据表列」需实体存在数据后出现（供选择系统内置列）。
                </div>
              )}
            </div>
          </div>

          {/* 实时预览 */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-sm font-medium text-gray-700">预览效果</span>
              {columns.length > 0 && sampleRows.length > 0 && (
                <span className="text-xs text-gray-400">使用真实数据预览（最多显示 3 条）</span>
              )}
            </div>
            <div className="border border-gray-200 rounded-lg overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    {columns.map((c, i) => (
                      <th key={i} style={c.width ? { width: c.width } : undefined}
                        className="px-3 py-2 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                        {colDisplayName(fields, c.field, c.label)}
                      </th>
                    ))}
                    {columns.length === 0 && (
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-400">尚未添加列</th>
                    )}
                    <th className="px-3 py-2 text-right text-xs font-medium text-gray-400">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {sampleRows.slice(0, 3).map((row, ri) => (
                    <tr key={ri} className="bg-white">
                      {columns.map((c, ci) => (
                        <td key={ci} className="px-3 py-2 text-xs text-gray-600 whitespace-nowrap max-w-[240px] truncate">
                          {fmtVal(previewVal(row, c.field))}
                        </td>
                      ))}
                      {columns.length === 0 && <td className="px-3 py-2" />}
                      <td className="px-3 py-2" />
                    </tr>
                  ))}
                  {columns.length > 0 && sampleRows.length === 0 && (
                    <tr>
                      <td colSpan={columns.length + 1} className="px-3 py-4 text-center text-xs text-gray-400 bg-white">
                        暂无示例数据 — 保存后到动态数据页查看真实效果
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
