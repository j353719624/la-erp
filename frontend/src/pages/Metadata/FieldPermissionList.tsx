import { useEffect, useState } from 'react';
import { ShieldCheck, Save } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { entityApi, fieldApi, fieldPermissionApi } from '@/api/metadata';
import { roleApi } from '@/api/system';
import { Entity, Field } from '@/types/metadata';
import { FIELD_TYPE_LABELS } from '@/config/industryTemplates';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { usePermission } from '@/hooks/usePermission';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';

const ACCESS_LEVELS = [
  { value: 'write', label: '可写', className: 'bg-green-50 text-green-700 border-green-200' },
  { value: 'read', label: '只读', className: 'bg-blue-50 text-blue-700 border-blue-200' },
  { value: 'none', label: '隐藏', className: 'bg-red-50 text-red-700 border-red-200' },
];

// 字段级权限管理：按 角色 + 实体 配置字段的 read/write/none（设计文档 7.1）
export function FieldPermissionList() {
  // [2026-09-18 权限细化] 按钮级门控：保存配置=metadata_edit（本页无删除按钮）
  const { has } = usePermission();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [roles, setRoles] = useState<any[]>([]);
  const [entityId, setEntityId] = useState('');
  const [roleId, setRoleId] = useState('');
  const [fields, setFields] = useState<Field[]>([]);
  const [perms, setPerms] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  // 请求竞态守卫（两路独立）：实体切换拉字段 / 角色或实体切换拉权限配置——防 A+B 旧响应覆盖 A+C
  const { nextSeq: fieldsNext, isCurrent: fieldsCurrent } = useRequestGuard();
  const { nextSeq: permsNext, isCurrent: permsCurrent } = useRequestGuard();

  useEffect(() => {
    entityApi.list({ page: 1, page_size: 1000 }).then(res => {
      if (res.code === 0) {
        const list = res.data?.list ?? [];
        setEntities(list);
        if (list.length > 0) setEntityId(list[0].id);
      }
    });
    roleApi.list({ page: 1, page_size: 1000 }).then(res => {
      if (res.code === 0) {
        const list = res.data?.list ?? [];
        setRoles(list);
        if (list.length > 0) setRoleId(list[0].id);
      }
    });
  }, []);

  useEffect(() => {
    if (!entityId) { setFields([]); return; }
    const seq = fieldsNext(); // [竞态守卫] 实体快速切换时丢弃过期字段
    fieldApi.list(entityId).then(res => {
      if (!fieldsCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
      if (res.code === 0) {
        // 仅展示可配置字段（跳过系统内置列）
        const SKIP = ['id', 'tenant_id', 'created_at', 'updated_at', 'deleted_at', 'code', 'name', 'status', 'ext'];
        setFields((res.data ?? []).filter(f => !SKIP.includes(f.code)));
      }
    });
  }, [entityId, fieldsNext, fieldsCurrent]);

  useEffect(() => {
    if (!roleId || !entityId) { setPerms({}); return; }
    const seq = permsNext(); // [竞态守卫] 角色/实体切换时丢弃过期权限配置
    setLoading(true);
    fieldPermissionApi.list({ role_id: roleId, entity_id: entityId })
      .then(res => {
        if (!permsCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        const map: Record<string, string> = {};
        (res.data ?? []).forEach((p: any) => { map[p.field_code] = p.access_level; });
        setPerms(map);
      })
      .catch(() => { if (permsCurrent(seq)) setPerms({}); })
      .finally(() => { if (permsCurrent(seq)) setLoading(false); });
  }, [roleId, entityId, permsNext, permsCurrent]);

  const setLevel = (code: string, level: string) => {
    setPerms(prev => ({ ...prev, [code]: level }));
  };

  const handleSave = async () => {
    if (!roleId || !entityId) { message.error('请先选择角色与实体'); return; }
    setSaving(true);
    try {
      const items = fields.map(f => ({
        field_code: f.code,
        access_level: perms[f.code] || 'write',
      }));
      const res = await fieldPermissionApi.batchSave({ role_id: roleId, entity_id: entityId, items });
      if (res.code === 0) message.success(`已保存 ${res.data?.saved ?? items.length} 条字段权限`);
      else message.error(res.message || '保存失败');
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const currentEntity = entities.find(e => e.id === entityId);

  // [2026-09-13] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Field) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-3';
  const rowCols: RowCol[] = [
    {
      key: 'field',
      header: '字段',
      cellCls: TD,
      cell: (f) => (
        <>
          <div className="font-medium text-gray-900 text-sm">{f.name}</div>
          <div className="text-xs text-gray-400 font-mono">{f.code}</div>
        </>
      ),
    },
    { key: 'field_type', header: '类型', cellCls: `${TD} text-sm text-gray-500`, cell: (f) => <span>{FIELD_TYPE_LABELS[f.field_type] || f.field_type}</span> },
    {
      key: 'is_required',
      header: '必填',
      cell: (f) => (
        f.is_required ? (
          <span className="px-2 py-0.5 rounded-full text-xs bg-orange-50 text-orange-600">必填</span>
        ) : (
          <span className="text-gray-300 text-xs">—</span>
        )
      ),
    },
    {
      key: 'access',
      header: '访问级别',
      cellCls: TD,
      cell: (f) => (
        <div className="flex items-center gap-2">
          {ACCESS_LEVELS.map(lv => (
            <button
              key={lv.value}
              onClick={() => setLevel(f.code, lv.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                (perms[f.code] || 'write') === lv.value
                  ? lv.className
                  : 'border-gray-200 text-gray-400 hover:border-gray-300'
              }`}
            >
              {lv.label}
            </button>
          ))}
        </div>
      ),
    },
  ];
  // [2026-09-13] 我的视图：可见列写 URL（?cols=）可分享；⚠「访问级别」是唯一可操作列，锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'field-permission-list',
    columns: rowCols,
    locked: { trailing: ['access'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="字段级权限"
        subtitle="按 角色 × 实体 配置字段的可写/只读/隐藏（动态数据页表单与列表实时生效）"
        extra={
          has('metadata_edit') && (
            <button onClick={handleSave} disabled={saving || !roleId || !entityId} className="btn-primary flex items-center gap-2">
              <Save className="w-4 h-4" />
              <span className="hidden md:inline">{saving ? '保存中...' : '保存配置'}</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 max-w-3xl">
            <div className="flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-gray-400 shrink-0" />
              <SearchSelect
                value={roleId}
                onChange={(v) => setRoleId(v ?? '')}
                placeholder="请选择角色"
                options={roles.map(r => ({ value: r.id, label: `${r.name}（${r.code}）` }))}
              />
            </div>
            <SearchSelect
              value={entityId}
              onChange={(v) => setEntityId(v ?? '')}
              placeholder="请选择实体"
              options={entities.map(e => ({ value: e.id, label: `${e.name}（${e.code}）` }))}
            />
          </div>
          <div className="flex justify-end mt-3">{viewMenu}</div>
        </div>

        {loading ? (
          <div className="p-6"><TableSkeleton rows={6} /></div>
        ) : fields.length === 0 ? (
          <EmptyState title="暂无字段" description={`为「${currentEntity?.name || ''}」创建字段后可配置字段级权限`} />
        ) : (
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
                {fields.map(f => (
                  <tr key={f.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(f)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
