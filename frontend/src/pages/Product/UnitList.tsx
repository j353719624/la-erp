import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Edit, Trash2, Upload } from 'lucide-react';
import { unitApi } from '@/api/product';
import { Unit } from '@/types/product';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { ImportModal } from '@/components/ImportModal';
import { PERM_IMPORT_EXPORT, hasPermissionNow } from '@/hooks/usePermission';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { RowActions } from '@/components/RowActions';
import { useRowSelection } from '@/hooks/useRowSelection';
import { useBatchAction } from '@/hooks/useBatchAction';
import { FilterPresetMenu } from '@/components/FilterPresetMenu';
import type { ReactNode } from 'react';
export function UnitList() {
  const navigate = useNavigate();
  const [units, setUnits] = useState<Unit[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', status: '', is_base: '', page: 1, page_size: 10 });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  // [U-03 2026-09-13] 筛选维度：状态 + 是否基础单位（此前仅关键词，接不了「我的筛选」）
  const [status, setStatus] = useState(urlFilters.status);
  const [isBase, setIsBase] = useState(urlFilters.is_base);

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, status, is_base: isBase, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, status, isBase, pagination.page, pagination.page_size]);
  const [importOpen, setImportOpen] = useState(false);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    fetchUnits();
  }, [pagination.page, pagination.page_size, debouncedKeyword, status, isBase]);

  const fetchUnits = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { name?: string; status?: string; is_base?: boolean } = {
        page: pagination.page,
        page_size: pagination.page_size,
        name: debouncedKeyword || undefined,
        status: status || undefined,
        is_base: isBase === 'true' ? true : undefined,
      };
      const response = await unitApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setUnits(response.data?.list || []);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch units:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!(await confirmAction({ title: `确定删除计量单位 ${name} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await unitApi.delete(id);
      if (response.code === 0) {
        message.success(`计量单位 ${name} 已删除`);
        fetchUnits();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete unit:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  // [U-05 2026-09-13] 批量删除：自管 Set + 页头按钮 → 统一钩子（逐条执行 + **失败原因汇总**）
  const sel = useRowSelection({ rows: units, getKey: (u) => u.id });
  const batch = useBatchAction({
    selection: sel,
    label: (u) => u.name || u.code || u.id,
    onDone: fetchUnits,
    actions: [
      {
        key: 'del',
        label: '批量删除',
        icon: <Trash2 className="w-4 h-4" />,
        danger: true,
        confirm: (rows) => ({
          title: `确定删除选中的 ${rows.length} 个单位吗？`,
          content: '删除后不可恢复；已被商品/单据引用的单位会被跳过，并在结果里列出原因',
          danger: true,
        }),
        run: (u) => unitApi.delete(u.id),
      },
    ],
    exportSpec: {
      filename: `计量单位_选中_${format.today()}.csv`,
      headers: ['编码', '名称', '备注', '是否基础单位', '状态'],
      row: (u) => [u.code, u.name, u.remark || '', u.is_base ? '是' : '否', format.statusText(u.status)],
    },
  });

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Unit) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    {
      key: '__sel',
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
      headCls: 'px-4 py-3 w-10',
      cellCls: 'px-4 py-4',
      cell: (item) => (
        <input
          type="checkbox"
          checked={sel.isSelected(item)}
          onChange={() => sel.toggle(item)}
          className="w-4 h-4 accent-blue-600 cursor-pointer"
          aria-label={`选择 ${item.code}`}
        />
      ),
    },
    { key: 'code', header: '单位编码', cell: (item) => <span className="font-medium text-gray-900">{item.code}</span> },
    { key: 'name', header: '单位名称', cell: (item) => <span className="text-gray-900">{item.name}</span> },
    { key: 'remark', header: '备注', cell: (item) => <span className="text-gray-500 text-sm">{item.remark || '-'}</span> },
    {
      key: 'is_base',
      header: '是否基础单位',
      cell: (item) => (
        item.is_base ? (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">是</span>
        ) : (
          <span className="px-2 py-1 rounded-full text-xs font-medium bg-gray-100 text-gray-500">否</span>
        )
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (item) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${format.statusColor(item.status)}`}>{format.statusText(item.status)}</span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      // [2026-09-14 统一操作列] 手写按钮迁移 RowActions：窄屏折叠「主操作 + ⋮」，操作列 ~88px
      cell: (item) => (
        <RowActions
          actions={[
            { key: 'edit', label: '编辑', icon: <Edit className="w-4 h-4" />, primary: true, onClick: () => navigate(`/units/${item.id}/edit`) },
            { key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(item.id, item.name) },
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；多选列/操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'unit-list',
    columns: rowCols,
    locked: { leading: ['__sel'], trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="计量单位"
        subtitle="计量单位列表"
        extra={
          <>
            {hasPermissionNow(PERM_IMPORT_EXPORT) && (
            <button onClick={() => setImportOpen(true)} className="btn-secondary flex items-center gap-2" title="批量导入计量单位（CSV/Excel）">
              <Upload className="w-4 h-4" />
              <span className="hidden md:inline">导入</span>
            </button>
            )}
            <button
              onClick={() => navigate('/units/create')}
              className="btn-primary flex items-center gap-2"
            >
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新增单位</span>
            </button>
          </>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索单位名称或编码..."
              value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
              className="form-input pl-10"
            />
          </div>
          {/* [U-03 2026-09-13] 筛选维度：状态 + 仅基础单位（配合「我的筛选」保存「基础单位 + 已停用」） */}
          <select
            value={status}
            onChange={(e) => { setStatus(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
            className="form-select w-28"
            aria-label="单位状态筛选"
          >
            <option value="">全部状态</option>
            <option value="active">启用</option>
            <option value="inactive">停用</option>
          </select>
          <select
            value={isBase}
            onChange={(e) => { setIsBase(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
            className="form-select w-32"
            aria-label="是否基础单位筛选"
          >
            <option value="">全部单位</option>
            <option value="true">仅基础单位</option>
          </select>
          <FilterPresetMenu
            pageKey="unit-list"
            currentParams={{ keyword: debouncedKeyword, status, is_base: isBase }}
            onApply={(p) => {
              setKeyword(p.keyword ?? '');
              setStatus(p.status ?? '');
              setIsBase(p.is_base ?? '');
              setPagination((prev) => ({ ...prev, page: 1 }));
            }}
          />
          <div className="ml-auto">{viewMenu}</div>
        </div>

        {/* [U-05] 批量工具条（有勾选才显示）；失败汇总弹窗必须独立渲染在页面根 */}
        {sel.count > 0 && <div className="px-4 pb-3">{batch.bar}</div>}
        {batch.failureModal}

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
              ) : units.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6">
                  <ListEmpty
                    keyword={keyword}
                    filterNote={[
                      status ? `状态「${format.statusText(status)}」` : '',
                      isBase === 'true' ? '仅基础单位' : '',
                    ].filter(Boolean).join(' + ') || undefined}
                    onClear={() => { setKeyword(''); setStatus(''); setIsBase(''); setPagination(prev => ({ ...prev, page: 1 })); }}
                    title="暂无计量单位数据"
                  />
                </td></tr>
              ) : (
                units.map((item) => (
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

        {!loading && units.length > 0 && (
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

      <ImportModal
        open={importOpen}
        title="批量导入计量单位（CSV / Excel）"
        importUrl="/v1/import/units"
        templateUrl="/v1/export/units-template"
        templateUrlXlsx="/v1/export/units-template?format=xlsx"
        templateHint="编码,名称,是否基础单位,备注"
        duplicateStrategy
        onClose={() => setImportOpen(false)}
        onSuccess={fetchUnits}
      />
    </div>
  );
}
