import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Pencil, Trash2, Power } from 'lucide-react';
import { priceListApi } from '@/api/product';
import { PriceList } from '@/types/product';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
const TYPE_TEXT: Record<string, string> = { customer: '客户价目表', supplier: '供应商价目表' };
const STATUS_TEXT: Record<string, string> = { draft: '草稿', active: '启用', inactive: '停用' };

export function PriceListList() {
  const navigate = useNavigate();
  const [lists, setLists] = useState<PriceList[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', list_type: '', page: 1, page_size: 10 });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  const [type, setType] = useState(urlFilters.list_type);

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, list_type: type, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, type, pagination.page, pagination.page_size]);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    fetchLists();
  }, [pagination.page, pagination.page_size, debouncedKeyword, type]);

  const fetchLists = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { name?: string; list_type?: string } = {
        page: pagination.page,
        page_size: pagination.page_size,
        name: debouncedKeyword || undefined,
        list_type: type || undefined,
      };
      const response = await priceListApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setLists(response.data?.list || []);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch price lists:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const handleDelete = async (item: PriceList) => {
    if (!(await confirmAction({ title: `确定删除价目表「${item.name}」吗？`, content: '删除后不可恢复', danger: true }))) return;
    try {
      const response = await priceListApi.delete(item.id);
      if (response.code === 0) {
        message.success(`价目表「${item.name}」已删除`);
        fetchLists();
      } else {
        message.error(response.message || '删除失败');
      }
    } catch (err) {
      console.error('Failed to delete price list:', err);
      message.error(err instanceof Error && err.message ? err.message : '删除失败，请稍后重试');
    }
  };

  const toggleStatus = async (item: PriceList) => {
    const next = item.status === 'active' ? 'inactive' : 'active';
    if (!(await confirmAction({ title: `确定${next === 'active' ? '启用' : '停用'}价目表 ${item.name} 吗？` }))) return;
    try {
      const response = await priceListApi.update(item.id, { status: next });
      if (response.code === 0) {
        message.success(`价目表 ${item.name} 已${next === 'active' ? '启用' : '停用'}`);
        fetchLists();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err) {
      console.error('Failed to toggle price list:', err);
      message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: PriceList) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    { key: 'name', header: '名称', cell: (item) => <span className="text-sm font-medium text-gray-900">{item.name}</span> },
    { key: 'list_type', header: '类型', cell: (item) => <span className="text-sm text-gray-600">{TYPE_TEXT[item.list_type] || item.list_type}</span> },
    { key: 'entity_name', header: '客户/供应商', cell: (item) => <span className="text-sm text-gray-600">{item.entity_name || '-'}</span> },
    { key: 'currency', header: '币种', cell: (item) => <span className="text-sm text-gray-600">{item.currency}</span> },
    {
      key: 'validity',
      header: '有效期',
      cell: (item) => (
        <span className="text-sm text-gray-600">
          {item.effective_date ? format.date(item.effective_date) : '-'} ~ {item.expiry_date ? format.date(item.expiry_date) : '长期'}
        </span>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (item) => (
        <span className={`inline-flex px-2 py-0.5 rounded text-xs ${
          item.status === 'active' ? 'bg-green-100 text-green-600'
          : item.status === 'inactive' ? 'bg-gray-100 text-gray-500'
          : 'bg-blue-100 text-blue-600'}`}>
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
        // [易用性] 行操作统一折叠；删除/启停的确认仍在 handler（confirmAction）内
        <RowActions
          actions={[
            { key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => navigate(`/price-lists/${item.id}`) },
            { key: 'toggle', label: item.status === 'active' ? '停用' : '启用', icon: <Power className="w-4 h-4" />, onClick: () => toggleStatus(item) },
            {
              key: 'del',
              label: '删除',
              icon: <Trash2 className="w-4 h-4" />,
              danger: true,
              // [2026-09-15] 启用中的价目表后端拒删（防误删正在取价的定价）：入口直接禁用并说明原因，
              // 避免“点完确认才报错”；停用后即可删除（与后端规则一致）
              disabled: item.status === 'active',
              title: item.status === 'active' ? '启用中的价目表不能删除，请先「停用」' : '删除',
              onClick: () => handleDelete(item),
            },
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'price-list-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="价目表"
        subtitle="客户/供应商价格管理"
        extra={
          <button onClick={() => navigate('/price-lists/create')} className="btn-primary flex items-center gap-2">
            <Plus className="w-5 h-5" />
            <span className="hidden md:inline">新建价目表</span>
          </button>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-4">
            <div className="relative flex-1 min-w-[160px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索价目表名称..."
                value={keyword}
                onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
                className="form-input pl-10"
              />
            </div>
            <select value={type} onChange={(e) => { setType(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }} className="form-select w-36">
              <option value="">全部类型</option>
              <option value="customer">客户价目表</option>
              <option value="supplier">供应商价目表</option>
            </select>
            <div className="ml-auto">{viewMenu}</div>
          </div>
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
              ) : lists.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-6">
                    <ListEmpty
                      keyword={keyword}
                      filterNote={type ? `类型「${TYPE_TEXT[type] || type}」` : undefined}
                      onClear={() => { setKeyword(''); setType(''); setPagination(prev => ({ ...prev, page: 1 })); }}
                      title="暂无价目表"
                      description="点击右上角「新建价目表」为客户/供应商定价"
                    />
                  </td>
                </tr>
              ) : (
                lists.map((item) => (
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

        <Pagination
          page={pagination.page}
          pageSize={pagination.page_size}
          total={pagination.total}
          onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
          loading={loading}
          onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
        />
      </div>
    </div>
  );
}
