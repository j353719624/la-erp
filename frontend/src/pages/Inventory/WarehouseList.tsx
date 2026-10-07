import { useState, useEffect } from 'react';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Edit, Trash2, Upload, Eye } from 'lucide-react';
import { Field } from '@/types/metadata';
import { loadEntityListLayout, isEntityListLayoutCustomized, entityColLabel, buildDetailColumns } from '@/utils/entityLayout';
import type { LayoutColumn } from '@/utils/entityLayout';
import { warehouseApi } from '@/api/product';
import { Warehouse } from '@/types/product';
import { format } from '@/utils/format';
import { pickFieldValue } from '@/utils/dimLabel';
import { Pagination } from '@/components/Pagination';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { RowActions } from '@/components/RowActions';
import { RecordDetailModal } from '@/components/RecordDetailModal';
import { ImportModal } from '@/components/ImportModal';
import { PERM_IMPORT_EXPORT, hasPermissionNow, usePermission } from '@/hooks/usePermission';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { useRowSelection } from '@/hooks/useRowSelection';
import { useBatchAction } from '@/hooks/useBatchAction';
import { FilterPresetMenu } from '@/components/FilterPresetMenu';
import { entityApi, fieldApi } from '@/api/metadata';
import { useAuthStore } from '@/store/auth';
export function WarehouseList() {
  const navigate = useNavigate();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', status: '', page: 1, page_size: 10 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  // [U-03 2026-09-13] 筛选维度：状态（此前仅关键词，接不了「我的筛选」的条件组合）
  const [status, setStatus] = useState(urlFilters.status);

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, status, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, status, pagination.page, pagination.page_size]);
  const [importOpen, setImportOpen] = useState(false);
  // 「查看」详情弹窗（复用列表列描述符渲染，元数据列一并展示）
  const [detail, setDetail] = useState<Warehouse | null>(null);
  // [布局] warehouse 实体默认 list 布局（GET /v1/metadata/layouts/* 需 system 权限，403 时静默回退默认列）
  const [layoutCols, setLayoutCols] = useState<LayoutColumn[]>([]);
  const [layoutCustomized, setLayoutCustomized] = useState(false);
  const [metaFields, setMetaFields] = useState<Field[]>([]);
  // 请求竞态守卫：快速切换搜索/翻页时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  // [布局] 挂载时读取 warehouse 实体默认 list 布局（失败/无权限静默 → 保持页面默认列）
  useEffect(() => {
    loadEntityListLayout('warehouse').then((data) => {
      setMetaFields(data.fields);
      setLayoutCols(data.listColumns);
      setLayoutCustomized(isEntityListLayoutCustomized(data.listColumns));
    });
  }, []);

  useEffect(() => {
    fetchWarehouses();
  }, [keyword, status, pagination.page, pagination.page_size]);

  const fetchWarehouses = async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const response = await warehouseApi.list({
        page: pagination.page,
        page_size: pagination.page_size,
        name: keyword || undefined,
        status: status || undefined,
      });
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        const data = response.data?.list || [];
        const total = response.data?.total || 0;
        setWarehouses(data);
        setPagination(prev => ({ ...prev, total }));
      }
    } catch (err) {
      console.error('Failed to fetch warehouses:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!(await confirmAction({ title: `确定删除仓库 ${name} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await warehouseApi.delete(id);
      if (response.code === 0) {
        message.success(`仓库 ${name} 已删除`);
        fetchWarehouses();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete warehouse:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  // [2026-09-18 权限细化] 新增=warehouse_create；编辑=warehouse_edit；删除=warehouse_delete
  const { has } = usePermission();
  // [U-05 2026-09-13] 批量删除：自管 Set + 页头按钮 → 统一钩子（逐条执行 + **失败原因汇总**）
  const sel = useRowSelection({ rows: warehouses, getKey: (w) => w.id });
  const batch = useBatchAction({
    selection: sel,
    label: (w) => w.name || w.code || w.id,
    onDone: fetchWarehouses,
    actions: [
      {
        key: 'del',
        label: '批量删除',
        icon: <Trash2 className="w-4 h-4" />,
        danger: true,
        eligible: () => has('warehouse_delete'),
        confirm: (rows) => ({
          title: `确定删除选中的 ${rows.length} 个仓库吗？`,
          content: '删除后不可恢复；已有库存/单据的仓库会被跳过，并在结果里列出原因',
          danger: true,
        }),
        run: (w) => warehouseApi.delete(w.id),
      },
    ],
    exportSpec: {
      filename: `仓库_选中_${format.today()}.csv`,
      headers: ['编码', '名称', '地址', '默认仓库', '状态'],
      row: (w) => [w.code, w.name, w.address || '', w.is_default ? '是' : '否', format.statusText(w.status)],
    },
  });

  // ── [布局] 仓库列表按「warehouse」实体默认 list 布局驱动信息列 ──────────────
  const scalarText = (v: unknown): string => {
    if (v === null || v === undefined || v === '') return '-';
    if (typeof v === 'boolean') return v ? '是' : '否';
    if (typeof v === 'object') return JSON.stringify(v);
    return String(v);
  };

  // 信息列 → 单元格（业务列按业务渲染，未命中回退原始字段）
  const renderInfoCell = (code: string, w: Warehouse): ReactNode => {
    switch (code) {
      case 'address':
        return <span className="text-gray-500 text-sm block max-w-[260px] truncate" title={w.address || ''}>{w.address || '-'}</span>;
      case 'remark':
        return <span className="text-gray-500 text-sm block max-w-[220px] truncate" title={w.remark || ''}>{w.remark || '-'}</span>;
      case 'created_at':
        return <span className="text-gray-500 text-sm">{format.date(w.created_at, 'YYYY-MM-DD HH:mm') || '-'}</span>;
      case 'updated_at':
        return <span className="text-gray-500 text-sm">{format.date(w.created_at, 'YYYY-MM-DD HH:mm') || '-'}</span>;
      default: {
        // 元数据自定义字段（值存 ext / ext_fields）或仓库真实字段 → 统一取值回退
        const v = pickFieldValue(w as unknown as Record<string, any>, code);
        if (v !== undefined && v !== null && v !== '') return <span className="text-gray-500 text-sm">{scalarText(v)}</span>;
        return <span className="text-gray-500 text-sm">-</span>;
      }
    }
  };

  // 本页“始终展示”的固定列（勾选/编码/名称/默认仓库/状态/操作）；布局列引用这些码时跳过
  const FIXED_INFO_SKIP = new Set([
    'code', 'name', 'is_default', 'status',
    'id', 'tenant_id', 'deleted_at', 'ext', 'ext_fields',
  ]);

  // 布局信息列（有序、去重）：用户有意配置了布局时按其列渲染；否则默认显示地址列
  const infoCols: LayoutColumn[] = (() => {
    if (layoutCustomized && layoutCols.length > 0) {
      const seen = new Set<string>();
      const out: LayoutColumn[] = [];
      for (const c of layoutCols) {
        if (!c?.field || seen.has(c.field)) continue;
        seen.add(c.field);
        if (FIXED_INFO_SKIP.has(c.field)) continue;
        out.push({ field: c.field, label: c.label, width: c.width });
      }
      return out;
    }
    return [{ field: 'address', label: '地址' }];
  })();

  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cell: (w: Warehouse) => ReactNode;
    cellCls?: string;
    width?: number;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';

  const selCol: RowCol = {
    key: '__sel',
    headCls: 'px-4 py-3 w-10',
    cellCls: 'px-4 py-4',
    header: (
      <input
        type="checkbox"
        checked={sel.state === 'all'}
        ref={(el) => { if (el) el.indeterminate = sel.state === 'some'; }}
        onChange={sel.toggleAll}
        className="w-4 h-4 accent-blue-600 cursor-pointer"
        aria-label="全选本页"
      />
    ),
    cell: (w) => (
      <input
        type="checkbox"
        checked={sel.isSelected(w)}
        onChange={() => sel.toggle(w)}
        className="w-4 h-4 accent-blue-600 cursor-pointer"
        aria-label={`选择 ${w.code}`}
      />
    ),
  };

  const codeCol: RowCol = {
    key: 'code',
    header: '仓库编码',
    cell: (w) => <span className="font-medium text-gray-900">{w.code}</span>,
  };

  const nameCol: RowCol = {
    key: 'name',
    header: '仓库名称',
    cell: (w) => <span className="text-gray-900">{w.name}</span>,
  };

  const defaultCol: RowCol = {
    key: 'is_default',
    header: '默认仓库',
    cell: (w) =>
      w.is_default ? (
        <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">是</span>
      ) : (
        <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">否</span>
      ),
  };

  const statusCol: RowCol = {
    key: 'status',
    header: '状态',
    cell: (w) => (
      <span className={`px-2 py-1 rounded-full text-xs font-medium ${format.statusColor(w.status)}`}>{format.statusText(w.status)}</span>
    ),
  };

  const actionsCol: RowCol = {
    key: '__actions',
    headCls: TH_R,
    cellCls: `${TD} text-right`,
    header: '操作',
    cell: (w) => (
      <RowActions
        actions={[
          { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => setDetail(w) },
          ...(has('warehouse_edit')
            ? [{ key: 'edit', label: '编辑', icon: <Edit className="w-4 h-4" />, onClick: () => navigate(`/warehouses/${w.id}/edit`) }]
            : []),
          ...(has('warehouse_delete')
            ? [
                {
                  key: 'del',
                  label: '删除',
                  icon: <Trash2 className="w-4 h-4" />,
                  danger: true,
                  onClick: () => handleDelete(w.id, w.name),
                },
              ]
            : []),
        ]}
      />
    ),
  };

  const infoColOf = (lc: LayoutColumn): RowCol => ({
    key: lc.field,
    width: lc.width,
    header: entityColLabel(lc.field, lc.label, metaFields),
    cell: (w) => renderInfoCell(lc.field, w),
  });

  // 列顺序：勾选/编码/名称 + 布局信息列 + 默认仓库/状态/操作（页面默认列）
  const baseRowCols: RowCol[] = [
    selCol,
    codeCol,
    nameCol,
    ...infoCols.map(infoColOf),
    defaultCol,
    statusCol,
    actionsCol,
  ];

  // [2026-09-12] 元数据自定义字段 → 追加为「可选列」（默认隐藏，视图菜单可勾选显示）
  const baseColKeys = new Set(baseRowCols.map((c) => c.key));
  const META_COL_SKIP = new Set(['id', 'tenant_id', 'deleted_at', 'ext', 'ext_fields']);
  const metaExtraCols: RowCol[] = metaFields
    .filter((f) => f.code && !baseColKeys.has(f.code) && !META_COL_SKIP.has(f.code))
    .sort((a, b) => (a.sort_order || 0) - (b.sort_order || 0) || a.code.localeCompare(b.code))
    .map((f) => ({
      key: f.code,
      header: f.name || entityColLabel(f.code, undefined, metaFields),
      cell: (w) => renderInfoCell(f.code, w),
    }));
  const rowCols: RowCol[] = [...baseRowCols, ...metaExtraCols];
  // 默认可见列 = 页面基础列（附加的自定义字段默认不显示，勾选后写入 URL 可分享）
  const defaultVisible = baseRowCols.map((c) => c.key);

  // [易用性 P2] 我的视图：可见列写入 URL（?cols=）可分享；列定义仍由元数据布局决定
  // [易用性 P2] 视图内新建字段（联动元数据；字段 API 需 system 权限，无权则不显示入口）
  const { permissions } = useAuthStore();
  const canManageFields = permissions.includes('*') || permissions.includes('system');
  const createEntityField = async (input: { name: string; code: string; fieldType: string }) => {
    const entRes = await entityApi.getByCode('warehouse');
    const entityId = (entRes as { data?: { id?: string } }).data?.id;
    if (!entityId) throw new Error('未找到仓库实体定义');
    await fieldApi.create({ entity_id: entityId, code: input.code, name: input.name, field_type: input.fieldType });
    // 重新拉布局 + 字段：新字段随即进入「视图 → 显示列」可选列（表单/详情同步可用）
    const data = await loadEntityListLayout('warehouse');
    setMetaFields(data.fields);
    setLayoutCustomized(isEntityListLayoutCustomized(data.listColumns));
    return { appeared: true };
  };
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'warehouse-list',
    columns: rowCols,
    locked: { leading: ['__sel'], trailing: ['__actions'] },
    labelOf: (key) => metaFields.find((f) => f.code === key)?.name || '',
    createField: canManageFields ? createEntityField : undefined,
    entityLabel: '仓库',
    defaultVisible,
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="仓库管理"
        subtitle="仓库列表"
        extra={
          <>
            {hasPermissionNow(PERM_IMPORT_EXPORT) && (
            <button onClick={() => setImportOpen(true)} className="btn-secondary flex items-center gap-2" title="批量导入仓库（CSV/Excel）">
              <Upload className="w-4 h-4" />
              <span className="hidden md:inline">导入</span>
            </button>
            )}
            {has('warehouse_create') && (
              <button
                onClick={() => navigate('/warehouses/create')}
                className="btn-primary flex items-center gap-2"
              >
                <Plus className="w-5 h-5" />
                <span className="hidden md:inline">新增仓库</span>
              </button>
            )}
          </>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[160px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索仓库名称或编码..."
                value={keyword}
                onChange={(e) => setKeyword(e.target.value)}
                className="form-input pl-10"
              />
            </div>
            {/* [U-03 2026-09-13] 筛选维度：状态（配合「我的筛选」保存「停用仓库」这类条件） */}
            <select
              value={status}
              onChange={(e) => { setStatus(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-select w-28"
              aria-label="仓库状态筛选"
            >
              <option value="">全部状态</option>
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
            <FilterPresetMenu
              pageKey="warehouse-list"
              currentParams={{ keyword, status }}
              onApply={(p) => {
                setKeyword(p.keyword ?? '');
                setStatus(p.status ?? '');
                setPagination((prev) => ({ ...prev, page: 1 }));
              }}
            />
            <div className="ml-auto">{viewMenu}</div>
          </div>
        </div>

        {/* [U-05] 批量工具条（有勾选才显示）；失败汇总弹窗必须独立渲染在页面根 */}
        {sel.count > 0 && <div className="px-4 pb-3">{batch.bar}</div>}
        {batch.failureModal}

        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {visibleColumns.map((c) => (
                  <th
                    key={c.key}
                    className={c.headCls || TH_L}
                    style={c.width ? { width: c.width } : undefined}
                  >
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : warehouses.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6">
                  {/* [U-03] 状态也是筛选条件：只判断关键词会把「筛了停用没结果」误报成「暂无数据」 */}
                  <ListEmpty
                    keyword={keyword}
                    filterNote={status ? `状态「${format.statusText(status)}」` : undefined}
                    onClear={() => { setKeyword(''); setStatus(''); setPagination(prev => ({ ...prev, page: 1 })); }}
                    title="暂无仓库数据"
                    description="点击右上角「新增仓库」创建（库位/货架需先建仓库）"
                  />
                </td></tr>
              ) : (
                warehouses.map((item) => (
                  <tr key={item.id} className={`hover:bg-gray-50 transition-colors ${sel.isSelected(item) ? 'bg-blue-50' : ''}`}>
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(item)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && warehouses.length > 0 && (
          <Pagination
            page={pagination.page}
            pageSize={pagination.page_size}
            total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
            loading={loading}
          />
        )}
      </div>

      <ImportModal
        open={importOpen}
        title="批量导入仓库（CSV / Excel）"
        importUrl="/v1/import/warehouses"
        templateUrl="/v1/export/warehouses-template"
        templateUrlXlsx="/v1/export/warehouses-template?format=xlsx"
        templateHint="编码,名称,地址,是否默认,备注"
        duplicateStrategy
        onClose={() => setImportOpen(false)}
        onSuccess={fetchWarehouses}
      />

      <RecordDetailModal
        open={!!detail}
        title={detail ? `仓库详情 · ${detail.code}` : '仓库详情'}
        record={detail}
        columns={buildDetailColumns<Warehouse>({ listColumns: rowCols, metaFields, renderField: renderInfoCell })}
        onClose={() => setDetail(null)}
      />
    </div>
  );
}
