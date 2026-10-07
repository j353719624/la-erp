import { useState, useEffect } from 'react';
import { Plus, Search, Edit, Trash2, Upload } from 'lucide-react';
import { locationApi } from '@/api/inventory';
import { warehouseApi } from '@/api/product';
import { Location } from '@/types/inventory';
import { Warehouse } from '@/types/product';
import { Pagination } from '@/components/Pagination';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { ImportModal } from '@/components/ImportModal';
import { useRequestGuard } from '@/hooks/useRequestGuard';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { PERM_IMPORT_EXPORT, hasPermissionNow, usePermission } from '@/hooks/usePermission';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
const STATUS_TEXT: Record<string, string> = { active: '启用', inactive: '停用' };

export function LocationList() {
  // [2026-09-18 权限细化] 新增=location_create；编辑=location_edit；删除=location_delete
  const { has } = usePermission();
  // 请求竞态守卫：快速切换搜索/翻页时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();
  const [locations, setLocations] = useState<Location[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 10 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);
  const [modalOpen, setModalOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<Location | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ name: '', warehouse_id: '', area: '', status: 'active', remark: '' });

  useEffect(() => {
    fetchLocations();
    fetchWarehouses();
  }, [keyword, pagination.page, pagination.page_size]);

  const fetchLocations = async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const res = await locationApi.list({
        page: pagination.page,
        page_size: pagination.page_size,
        name: keyword || undefined,
      });
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setLocations(res.data?.list || []);
        setPagination(prev => ({ ...prev, total: res.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch locations:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  };

  const fetchWarehouses = async () => {
    try {
      const res = await warehouseApi.list({ page: 1, page_size: 1000 });
      if (res.code === 0) setWarehouses(res.data?.list || []);
    } catch (err) {
      console.error('Failed to fetch warehouses:', err);
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Location) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'code', header: '库位编码', cell: (item) => <span className="font-mono text-sm text-gray-700">{item.code}</span> },
    { key: 'name', header: '库位名称', cell: (item) => <span className="font-medium text-gray-900">{item.name}</span> },
    {
      key: 'warehouse',
      header: '所属仓库',
      cell: (item) => (
        <span className="text-gray-600 text-sm">{warehouses.find((w) => w.id === item.warehouse_id)?.name || '-'}</span>
      ),
    },
    {
      key: 'area',
      header: '面积(m²)',
      headCls: TH_R,
      cellCls: TD,
      cell: (item) => <span className="text-gray-600 text-sm">{item.area ?? '-'}</span>,
    },
    {
      key: 'status',
      header: '状态',
      cell: (item) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${item.status === 'active' ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
          {STATUS_TEXT[item.status] || item.status}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (item) => (
        <div className="flex items-center justify-end gap-1">
          {has('location_edit') && (
            <button onClick={() => openEdit(item)} className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors" title="编辑">
              <Edit className="w-4 h-4" />
            </button>
          )}
          {has('location_delete') && (
            <button onClick={() => handleDelete(item)} className="p-1.5 text-red-600 hover:bg-red-50 rounded-lg transition-colors" title="删除">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'location-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', warehouse_id: '', area: '', status: 'active', remark: '' });
    setModalOpen(true);
  };

  const openEdit = (item: Location) => {
    setEditing(item);
    setForm({
      name: item.name,
      warehouse_id: item.warehouse_id || '',
      area: item.area != null ? String(item.area) : '',
      status: item.status || 'active',
      remark: item.remark || '',
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      message.warning('请填写库位名称');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        warehouse_id: form.warehouse_id || undefined,
        area: form.area === '' ? undefined : Number(form.area),
        status: form.status,
        remark: form.remark || undefined,
      };
      const res = editing
        ? await locationApi.update(editing.id, payload)
        : await locationApi.create(payload);
      if (res.code === 0) {
        message.success(editing ? '库位已更新' : '库位已创建');
        setModalOpen(false);
        fetchLocations();
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (err) {
      console.error('Failed to save location:', err);
      message.error(err instanceof Error && err.message ? err.message : '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (item: Location) => {
    if (!(await confirmAction({ title: `确定删除库位 ${item.name} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const res = await locationApi.delete(item.id);
      if (res.code === 0) {
        message.success(`库位 ${item.name} 已删除`);
        fetchLocations();
      } else {
        message.error(res.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete location:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="库位管理"
        subtitle="仓库下的库位（区域）管理"
        extra={
          <>
            {hasPermissionNow(PERM_IMPORT_EXPORT) && has('location_create') && (
              <button onClick={() => setImportOpen(true)} className="btn-secondary flex items-center gap-2" title="批量导入库位（CSV/Excel）">
                <Upload className="w-4 h-4" />
                <span className="hidden md:inline">导入</span>
              </button>
            )}
            {has('location_create') && (
              <button onClick={openCreate} className="btn-primary flex items-center gap-2">
                <Plus className="w-5 h-5" />
                <span className="hidden md:inline">新增库位</span>
              </button>
            )}
          </>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索库位名称..."
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-input pl-10"
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
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : locations.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无库位数据" /></td></tr>
              ) : (
                locations.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
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

        {!loading && locations.length > 0 && (
          <Pagination
            page={pagination.page}
            pageSize={pagination.page_size}
            total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            loading={loading}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
          />
        )}
      </div>

      <Modal
        title={editing ? `编辑库位 ${editing.name}` : '新增库位'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
      >
        <div className="space-y-4 py-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">库位名称 *</label>
            <input type="text" value={form.name} onChange={(e) => setForm(prev => ({ ...prev, name: e.target.value }))} className="form-input" placeholder="如：A区" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">所属仓库</label>
            <SearchSelect
              value={form.warehouse_id}
              onChange={(v) => setForm(prev => ({ ...prev, warehouse_id: v ?? '' }))}
              placeholder="请选择仓库"
              options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">面积（m²）</label>
            <input type="number" min="0" step="any" value={form.area} onChange={(e) => setForm(prev => ({ ...prev, area: e.target.value }))} className="form-input" placeholder="请输入面积" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">状态</label>
            <select value={form.status} onChange={(e) => setForm(prev => ({ ...prev, status: e.target.value }))} className="form-select">
              <option value="active">启用</option>
              <option value="inactive">停用</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <input type="text" value={form.remark} onChange={(e) => setForm(prev => ({ ...prev, remark: e.target.value }))} className="form-input" />
          </div>
        </div>
      </Modal>

      {/* 库位批量导入（2026-09-18 医药/WMS）：先导仓库 → 导库位 → 导货架 → 再导期初库存 */}
      <ImportModal
        open={importOpen}
        title="批量导入库位（CSV / Excel）"
        importUrl="/v1/import/locations"
        templateUrl="/v1/export/locations-template"
        templateUrlXlsx="/v1/export/locations-template?format=xlsx"
        templateHint="编码, 名称, 仓库编码, 面积, 备注"
        hintExtra="仓库编码需先在「仓库管理」建好（或先导「仓库导入」）；编码留空自动生成；同名判定 = 同仓库内同名（不同仓库的同名库位是两个库位）。预览不会写入数据。"
        duplicateStrategy
        onClose={() => setImportOpen(false)}
        onSuccess={fetchLocations}
      />
    </div>
  );
}
