import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Eye, Pencil, CheckCircle2, X, Trash2, Download } from 'lucide-react';
import { assemblyApi } from '@/api/production';
import { AssemblyOrder } from '@/types/production';
import { format } from '@/utils/format';
import { exportCsv } from '@/utils/exportCsv';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
const TYPE_TEXT: Record<string, string> = { assemble: '组装', disassemble: '拆解' };
const STATUS_TEXT: Record<string, string> = { draft: '草稿', confirmed: '已确认', cancelled: '已取消' };

export function AssemblyList() {
  // [2026-09-18 权限细化·批 2 生产] 新建=assembly_create；编辑/确认/取消=assembly_edit；删除=assembly_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  const [assemblies, setAssemblies] = useState<AssemblyOrder[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 10 });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);
  const [detail, setDetail] = useState<AssemblyOrder | null>(null);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    fetchList();
  }, [pagination.page, pagination.page_size, debouncedKeyword]);

  const fetchList = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { assembly_no?: string } = {
        page: pagination.page,
        page_size: pagination.page_size,
        assembly_no: debouncedKeyword || undefined,
      };
      const response = await assemblyApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setAssemblies(response.data?.list || []);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch assemblies:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  const doAction = async (fn: (id: string) => Promise<any>, id: string, title: string, successMsg: string, danger = false) => {
    if (!(await confirmAction({ title, danger }))) return;
    try {
      const response = await fn(id);
      if (response.code === 0) {
        message.success(successMsg);
        fetchList();
      } else {
        message.error(response.message || '操作失败');
      }
    } catch (err: any) {
      console.error('Assembly action failed:', err);
      message.error(err?.message || '操作失败，请稍后重试');
    }
  };

  const openDetail = async (id: string) => {
    try {
      const response = await assemblyApi.get(id);
      if (response.code === 0) setDetail(response.data);
    } catch (err) {
      console.error('Failed to fetch assembly detail:', err);
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: AssemblyOrder) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    { key: 'assembly_no', header: '单号', cell: (a) => <span className="text-sm font-medium text-gray-900">{a.assembly_no}</span> },
    {
      key: 'asm_type',
      header: '类型',
      cell: (a) => (
        <span className={`inline-flex px-2 py-0.5 rounded text-xs ${
          a.asm_type === 'disassemble' ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'
        }`}>
          {TYPE_TEXT[a.asm_type || 'assemble'] || a.asm_type}
        </span>
      ),
    },
    {
      key: 'product',
      header: '成品',
      cell: (a) => (
        <span className="text-sm text-gray-700">{a.product_name} <span className="text-gray-400 text-xs">({a.product_code})</span></span>
      ),
    },
    { key: 'qty', header: '数量', headCls: TH_R, cellCls: `${TD} text-sm text-right text-gray-600`, cell: (a) => <span>{format.qty(a.qty)}</span> },
    { key: 'unit_cost', header: '单位成本', headCls: TH_R, cellCls: `${TD} text-sm text-right text-gray-600`, cell: (a) => <span>¥{format.currency(a.unit_cost)}</span> },
    { key: 'total_cost', header: '总成本', headCls: TH_R, cellCls: `${TD} text-sm text-right text-gray-600`, cell: (a) => <span>¥{format.currency(a.total_cost)}</span> },
    {
      key: 'status',
      header: '状态',
      cellCls: `${TD} text-sm`,
      cell: (a) => (
        <span className={`inline-flex px-2 py-0.5 rounded text-xs ${
          a.status === 'confirmed' ? 'bg-green-100 text-green-600'
          : a.status === 'cancelled' ? 'bg-gray-100 text-gray-500'
          : 'bg-orange-100 text-orange-600'}`}>
          {STATUS_TEXT[a.status || 'draft'] || a.status}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: TD,
      cell: (a) => (
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）；确认文案仍在 doAction 内
        <RowActions
          actions={[
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => openDetail(a.id!) },
            ...(a.status === 'draft'
              ? [
                  ...(has('assembly_edit')
                    ? [
                        { key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => navigate(`/assemblies/${a.id}`) },
                        { key: 'confirm', label: '确认', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => doAction(assemblyApi.confirm, a.id!, `确定确认${TYPE_TEXT[a.asm_type || 'assemble']}单 ${a.assembly_no} 吗？`, '已确认并更新库存') },
                        { key: 'cancel', label: '取消', icon: <X className="w-4 h-4" />, onClick: () => doAction(assemblyApi.cancel, a.id!, `确定取消${TYPE_TEXT[a.asm_type || 'assemble']}单 ${a.assembly_no} 吗？`, '已取消', true) },
                      ]
                    : []),
                  ...(has('assembly_delete')
                    ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => doAction(assemblyApi.delete, a.id!, `确定删除${TYPE_TEXT[a.asm_type || 'assemble']}单 ${a.assembly_no} 吗？`, '已删除', true) }]
                    : []),
                ]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'assembly-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="组装/拆解"
        subtitle="半成品与成品的快速组装、拆解"
        extra={
          <div className="flex items-center gap-2">
            <button
              onClick={() => exportCsv(`组装拆解单_${format.today()}.csv`,
                ['单号', '类型', '成品', '数量', '状态'],
                (assemblies || []).map((a: any) => [a.assembly_no, TYPE_TEXT[a.asm_type || 'assemble'] || a.asm_type, a.product_name, a.qty, a.status]))}
              className="btn-secondary flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span className="hidden md:inline">导出 CSV</span>
            </button>
            {has('assembly_create') && (
              <button onClick={() => navigate('/assemblies/create')} className="btn-primary flex items-center gap-2">
                <Plus className="w-5 h-5" />
                <span className="hidden md:inline">新建组装单</span>
              </button>
            )}
          </div>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索组装单号..."
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
              ) : assemblies.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无组装单" /></td></tr>
              ) : (
                assemblies.map((a) => (
                  <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(a)}
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

      {detail && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDetail(null)} />
          <div className="relative bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[85vh] overflow-hidden flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
              <h3 className="text-lg font-semibold text-gray-900">{TYPE_TEXT[detail.asm_type || 'assemble']}单 {detail.assembly_no}</h3>
              <button onClick={() => setDetail(null)} className="icon-btn" title="关闭"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-6 overflow-y-auto space-y-4">
              <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
                <div><span className="text-gray-500">成品：</span>{detail.product_name} ({detail.product_code})</div>
                <div><span className="text-gray-500">数量：</span>{detail.qty}</div>
                <div><span className="text-gray-500">单位成本：</span>¥{format.currency(detail.unit_cost)}</div>
                <div><span className="text-gray-500">状态：</span>{STATUS_TEXT[detail.status || 'draft']}</div>
                {detail.remark && <div className="col-span-2"><span className="text-gray-500">备注：</span>{detail.remark}</div>}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-max">
                  <thead>
                    <tr className="bg-gray-50">
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">组件</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">数量</th>
                      <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">成本</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">批次</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {(detail.edges?.lines || detail.lines || []).map((line: any) => (
                      <tr key={line.id}>
                        <td className="px-4 py-2 text-sm text-gray-700">{line.product_name}</td>
                        <td className="px-4 py-2 text-sm text-right text-gray-700">{line.qty}</td>
                        <td className="px-4 py-2 text-sm text-right text-gray-700">¥{format.currency(line.unit_cost)}</td>
                        <td className="px-4 py-2 text-sm text-gray-500">{line.batch_no || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
