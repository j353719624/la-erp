import { useEffect, useState } from 'react';
import { Plus, Edit2, Trash2, CheckCircle2, LayoutGrid, Search, Users, Shield } from 'lucide-react';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { entityApi, layoutApi, fieldApi, dynamicApi } from '@/api/metadata';
import { userApi, roleApi } from '@/api/system';
import { Entity, Field, Layout } from '@/types/metadata';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { confirmAction } from '@/utils/confirm';
import { normalizeLayoutConfig } from '@/utils/layoutConfig';
import { tableColumnLabel } from '@/utils/columnLabels';
import { LayoutConfigEditor } from './LayoutConfigEditor';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useTableView } from '@/hooks/useTableView';
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';

const LAYOUT_TYPES = [
  { value: 'list', label: '列表页' },
  { value: 'form', label: '表单页' },
  { value: 'mobile', label: '移动端' },
];
const SCOPES = [
  { value: 'system', label: '系统级（所有用户）' },
  { value: 'role', label: '角色级（指定角色）' },
  { value: 'user', label: '用户级（指定用户）' },
];
const LIST_CONFIG_TEMPLATE = `{
  "table": {
    "columns": [
      { "field": "name", "label": "名称", "width": 200 }
    ]
  },
  "header": {
    "searchFields": ["name"]
  }
}`;
const FORM_CONFIG_TEMPLATE = `{
  "sections": [
    {
      "title": "基本信息",
      "gridCols": 2,
      "fields": [
        { "field": "name", "span": 1 }
      ]
    }
  ]
}`;

export function LayoutList() {
  // [2026-09-18 权限细化·第4批] 元数据管理四件套（旧码 system）
  const { has } = usePermission();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [entityId, setEntityId] = useState('');
  const [layouts, setLayouts] = useState<Layout[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [sampleRows, setSampleRows] = useState<Record<string, any>[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Layout | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    name: '',
    layout_type: 'list',
    scope: 'system',
    scope_id: '',
    is_default: false,
    config: LIST_CONFIG_TEMPLATE,
  });
  // 请求竞态守卫（两路独立）：实体切换拉布局列表 / 拉字段——防实体 A 旧响应覆盖实体 B
  const { nextSeq: layoutsNext, isCurrent: layoutsCurrent } = useRequestGuard();
  const { nextSeq: fieldsNext, isCurrent: fieldsCurrent } = useRequestGuard();

  useEffect(() => {
    entityApi.list({ page: 1, page_size: 1000 }).then(res => {
      if (res.code === 0) {
        const list = res.data?.list ?? [];
        setEntities(list);
        if (list.length > 0) setEntityId(list[0].id);
      }
    });
    // 预加载角色与用户（用于作用域选择）
    roleApi.list({ page: 1, page_size: 1000 }).then(res => {
      if (res.code === 0) setRoles(res.data?.list ?? []);
    }).catch(() => {});
    userApi.list({ page: 1, page_size: 1000 }).then(res => {
      if (res.code === 0) setUsers(res.data?.list ?? []);
    }).catch(() => {});
  }, []);

  const fetchLayouts = async (id: string) => {
    if (!id) { setLayouts([]); return; }
    const seq = layoutsNext(); // [竞态守卫] 实体快速切换时丢弃过期布局列表
    setLoading(true);
    try {
      const res = await layoutApi.list(id);
      if (!layoutsCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
      if (res.code === 0) setLayouts(res.data ?? []);
    } catch {
      if (layoutsCurrent(seq)) setLayouts([]);
    } finally {
      if (layoutsCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  };

  useEffect(() => {
    fetchLayouts(entityId);
  }, [entityId]);

  // 加载实体字段（供可视化编辑器选择列/字段）
  useEffect(() => {
    if (!entityId) { setFields([]); return; }
    const seq = fieldsNext(); // [竞态守卫] 实体快速切换时丢弃过期字段
    fieldApi.list(entityId).then(res => {
      if (!fieldsCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
      if (res.code === 0) setFields(res.data ?? []);
    }).catch(() => { if (fieldsCurrent(seq)) setFields([]); });
  }, [entityId, fieldsNext, fieldsCurrent]);

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', layout_type: 'list', scope: 'system', scope_id: '', is_default: false, config: LIST_CONFIG_TEMPLATE });
    fetchSampleRows(entities.find(e => e.id === entityId)?.code);
    setModalOpen(true);
  };

  const openEdit = (l: Layout) => {
    setEditing(l);
    setForm({
      name: l.name,
      layout_type: l.layout_type,
      scope: l.scope,
      scope_id: l.scope_id || '',
      is_default: l.is_default,
      // 归一化历史格式（顶层 columns → table/sections），保证编辑器打开能回显现有列
      config: JSON.stringify(normalizeLayoutConfig(l.config ?? {}, l.layout_type), null, 2),
    });
    fetchSampleRows(entities.find(e => e.id === entityId)?.code);
    setModalOpen(true);
  };

  // 拉取实体样例数据：供可视化编辑器「真实数据预览」与「数据表列」候选使用
  const fetchSampleRows = async (code?: string) => {
    if (!code) { setSampleRows([]); return; }
    try {
      const res = await dynamicApi.list(code, { page: 1, page_size: 5 });
      setSampleRows((res.data as any)?.list ?? []);
    } catch {
      setSampleRows([]);
    }
  };

  const handleLayoutTypeChange = (t: string) => {
    setForm(prev => ({
      ...prev,
      layout_type: t,
      // 新建时切换类型重置为对应模板（避免旧类型配置残留混入）；编辑态类型不可改
      config: editing ? prev.config : (t === 'form' ? FORM_CONFIG_TEMPLATE : LIST_CONFIG_TEMPLATE),
    }));
  };

  const handleSave = async () => {
    let config: Record<string, any> = {};
    try {
      config = JSON.parse(form.config || '{}');
    } catch {
      message.error('布局配置 JSON 格式错误');
      return;
    }
    if (!form.name.trim()) {
      message.error('请填写布局名称');
      return;
    }
    if (form.scope !== 'system' && !form.scope_id) {
      message.error(form.scope === 'role' ? '请选择作用角色' : '请选择作用用户');
      return;
    }
    setSaving(true);
    try {
      if (editing) {
        const res = await layoutApi.update(editing.id, {
          name: form.name,
          scope: form.scope,
          scope_id: form.scope_id || null,
          is_default: form.is_default,
          config,
        });
        if (res.code !== 0) { message.error(res.message || '保存失败'); return; }
      } else {
        if (!entityId) { message.error('请先选择实体'); return; }
        const res = await layoutApi.create({
          entity_id: entityId,
          name: form.name,
          layout_type: form.layout_type,
          scope: form.scope,
          scope_id: form.scope_id || null,
          is_default: form.is_default,
          config,
        });
        if (res.code !== 0) { message.error(res.message || '保存失败'); return; }
      }
      message.success('布局已保存');
      setModalOpen(false);
      fetchLayouts(entityId);
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (l: Layout) => {
    if (!(await confirmAction({ title: `确定删除布局「${l.name}」吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const res = await layoutApi.delete(l.id);
      if (res.code === 0) { message.success('已删除'); fetchLayouts(entityId); }
      else message.error(res.message || '删除失败');
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '删除失败');
    }
  };

  const currentEntity = entities.find(e => e.id === entityId);

  // [2026-09-13] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Layout) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'name', header: '布局名称', cellCls: `${TD} font-medium text-gray-900`, cell: (l) => <span>{l.name}</span> },
    {
      key: 'layout_type',
      header: '类型',
      cellCls: `${TD} text-gray-700 text-sm`,
      cell: (l) => <span>{LAYOUT_TYPES.find(t => t.value === l.layout_type)?.label || l.layout_type}</span>,
    },
    {
      key: 'scope',
      header: '作用域',
      cellCls: `${TD} text-gray-700 text-sm`,
      cell: (l) => {
        const scopeLabel = SCOPES.find(s => s.value === l.scope)?.label || l.scope;
        const scopeTarget = l.scope === 'role'
          ? (roles.find(r => r.id === l.scope_id)?.name || '角色')
          : l.scope === 'user'
            ? (users.find(u => u.id === l.scope_id)?.name || '用户')
            : '';
        return (
          <span className="inline-flex items-center gap-1">
            {l.scope === 'role' && <Shield className="w-3.5 h-3.5 text-gray-400" />}
            {l.scope === 'user' && <Users className="w-3.5 h-3.5 text-gray-400" />}
            {scopeLabel}{scopeTarget ? ` · ${scopeTarget}` : ''}
          </span>
        );
      },
    },
    {
      key: 'columns',
      header: '列配置',
      cellCls: 'px-6 py-4 text-gray-500 text-sm max-w-[320px] truncate',
      cell: (l) => {
        const ncfg = normalizeLayoutConfig(l.config ?? {}, l.layout_type);
        const cols = ncfg?.table?.columns;
        // 与应用页同规则的中文回退：显式显示名(非列码) → 字段中文名 → 表列中文名 → 列码
        const colText = Array.isArray(cols)
          ? cols.map((c: any) => {
              const f = fields.find((x: Field) => x.code === c.field);
              return c.label && c.label !== c.field
                ? c.label
                : f?.name || tableColumnLabel(c.field) || c.field;
            }).join(', ')
          : '—';
        return <span>{colText}</span>;
      },
    },
    {
      key: 'is_default',
      header: '默认',
      cell: (l) => (
        l.is_default ? (
          <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium bg-blue-50 text-blue-600">
            <CheckCircle2 className="w-3.5 h-3.5" />默认
          </span>
        ) : (
          <span className="text-gray-400 text-xs">—</span>
        )
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (l) => (
        <div className="flex items-center justify-end gap-1">
          {has('metadata_edit') && (
            <button onClick={() => openEdit(l)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="编辑">
              <Edit2 className="w-4 h-4" />
            </button>
          )}
          {has('metadata_delete') && (
            <button onClick={() => handleDelete(l)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="删除">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      ),
    },
  ];
  // [2026-09-13] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'layout-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="布局管理"
        subtitle="按实体配置列表/表单/移动端布局，动态数据页将按默认布局渲染"
        extra={
          entityId && has('metadata_create') ? (
            <button onClick={openCreate} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新建布局</span>
            </button>
          ) : undefined
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex items-center gap-3">
          <div className="flex items-center gap-2 max-w-md flex-1">
            <LayoutGrid className="w-4 h-4 text-gray-400" />
            <SearchSelect
              value={entityId}
              onChange={(v) => setEntityId(v ?? '')}
              placeholder="请选择实体"
              options={entities.map(e => ({ value: e.id, label: `${e.name}（${e.code}）` }))}
            />
          </div>
          <div className="ml-auto">{viewMenu}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {visibleColumns.map((c) => (
                  <th key={c.key} className={c.headCls || TH_L}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={4} /></td></tr>
              ) : layouts.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><EmptyState title="暂无布局" description={`为「${currentEntity?.name || ''}」创建布局，动态数据页将按布局渲染`} /></td></tr>
              ) : (
                layouts.map(l => (
                  <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(l)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        title={editing ? '编辑布局' : '新建布局'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText="保存"
        cancelText="取消"
        confirmLoading={saving}
        width={900}
        destroyOnHidden
      >
        <div className="space-y-4 pt-2">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">布局名称 *</label>
              <input
                type="text"
                value={form.name}
                onChange={e => setForm(prev => ({ ...prev, name: e.target.value }))}
                className="form-input"
                placeholder="如：默认列表布局"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">布局类型</label>
              <select
                value={form.layout_type}
                onChange={e => handleLayoutTypeChange(e.target.value)}
                disabled={!!editing}
                className="form-select"
              >
                {LAYOUT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">作用域</label>
              <select
                value={form.scope}
                onChange={e => setForm(prev => ({ ...prev, scope: e.target.value, scope_id: '' }))}
                className="form-select"
              >
                {SCOPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
          </div>
          {form.scope !== 'system' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {form.scope === 'role' ? '作用角色 *' : '作用用户 *'}
              </label>
              {form.scope === 'role' ? (
                <SearchSelect
                  value={form.scope_id}
                  onChange={(v) => setForm(prev => ({ ...prev, scope_id: v ?? '' }))}
                  placeholder="请选择角色"
                  allowClear
                  options={roles.map(r => ({ value: r.id, label: `${r.name}（${r.code}）` }))}
                />
              ) : (
                <SearchSelect
                  value={form.scope_id}
                  onChange={(v) => setForm(prev => ({ ...prev, scope_id: v ?? '' }))}
                  placeholder="请选择用户"
                  allowClear
                  options={users.map(u => ({ value: u.id, label: `${u.name}（${u.username}）` }))}
                />
              )}
            </div>
          )}
          <div className="flex items-center gap-2">
            <input
              id="layout-default"
              type="checkbox"
              checked={form.is_default}
              onChange={e => setForm(prev => ({ ...prev, is_default: e.target.checked }))}
              className="w-4 h-4 accent-blue-600 cursor-pointer"
            />
            <label htmlFor="layout-default" className="text-sm text-gray-700 cursor-pointer">设为默认布局（动态数据页将优先使用）</label>
          </div>
          <LayoutConfigEditor
            key={`${editing?.id || 'new'}-${form.layout_type}`}
            layoutType={form.layout_type as 'list' | 'form' | 'mobile'}
            fields={fields}
            sampleRows={sampleRows}
            config={form.config}
            onChange={(json) => setForm(prev => ({ ...prev, config: json }))}
          />
        </div>
      </Modal>
    </div>
  );
}
