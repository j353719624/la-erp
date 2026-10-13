import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, PlayCircle, CheckCircle2, XCircle, Eye, Printer } from 'lucide-react';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { contractApi, PurchaseContract } from '@/api/order';
import { format } from '@/utils/format';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { usePermission } from '@/hooks/usePermission';
import { confirmAction } from '@/utils/confirm';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { Pagination } from '@/components/Pagination';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';

const STATUS_TEXT: Record<string, string> = {
  draft: '草稿',
  active: '生效中',
  completed: '已完成',
  cancelled: '已取消',
};

const STATUS_CLS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-500',
  active: 'bg-blue-50 text-blue-600',
  completed: 'bg-green-50 text-green-600',
  cancelled: 'bg-red-50 text-red-500',
};

export function ContractList() {
  // [2026-09-18 权限细化·第3批] 采购合同独立四件套
  const { has } = usePermission();
  const navigate = useNavigate();
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ status: '', page: 1, page_size: 10 });
  const [status, setStatus] = useState(urlFilters.status);
  const [list, setList] = useState<PurchaseContract[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(urlFilters.page);
  const [pageSize, setPageSize] = useState(urlFilters.page_size);
  const [loading, setLoading] = useState(true);

  // [易用性 P1] 条件变化 → 写回 URL
  useEffect(() => {
    syncUrl({ status, page, page_size: pageSize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page, pageSize]);
  const [detail, setDetail] = useState<PurchaseContract | null>(null);
  // 请求竞态守卫：状态筛选/翻页快速切换时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const res = await contractApi.list({ page, page_size: pageSize, status: status || undefined });
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setList(res.data?.list || []);
        setTotal(res.data?.total || 0);
      } else {
        message.error(res.message || '加载失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '加载失败');
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  }, [page, pageSize, status, nextSeq, isCurrent]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const doAction = async (action: 'activate' | 'complete' | 'cancel', item: PurchaseContract) => {
    const conf = action === 'activate'
      ? { title: '生效合同', content: `确定让合同 ${item.contract_no} 生效吗？生效后不可再编辑。`, okText: '生效' }
      : action === 'complete'
        ? { title: '完成合同', content: `确定将合同 ${item.contract_no} 标记为已完成吗？`, okText: '完成' }
        : { title: '取消合同', content: `确定取消合同 ${item.contract_no} 吗？取消后不可恢复。`, okText: '取消', danger: true };
    if (!(await confirmAction(conf))) return;
    try {
      const res = action === 'activate' ? await contractApi.activate(item.id) : action === 'complete' ? await contractApi.complete(item.id) : await contractApi.cancel(item.id);
      if (res.code === 0) {
        message.success(action === 'activate' ? '合同已生效' : action === 'complete' ? '合同已完成' : '合同已取消');
        fetchList();
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '操作失败');
    }
  };

  const handleDelete = async (item: PurchaseContract) => {
    if (!(await confirmAction({
      title: '删除合同',
      content: `确定删除合同 ${item.contract_no} 吗？`,
      okText: '删除',
      danger: true,
    }))) return;
    const res = await contractApi.remove(item.id);
    if (res.code === 0) {
      message.success('已删除');
      fetchList();
    } else {
      message.error(res.message || '删除失败');
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: PurchaseContract) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    { key: 'contract_no', header: '合同编号', cell: (item) => <span className="font-medium">{item.contract_no}</span> },
    { key: 'supplier_name', header: '供应商', cell: (item) => <span>{item.supplier_name || (item as any).edges?.supplier?.name || '-'}</span> },
    { key: 'contract_date', header: '签订日期', cell: (item) => <span>{item.contract_date ? format.date(item.contract_date) : '-'}</span> },
    { key: 'end_date', header: '有效期至', cell: (item) => <span>{item.end_date ? format.date(item.end_date) : '-'}</span> },
    { key: 'total_amount', header: '合同金额', headCls: TH_R, cellCls: `${TD} text-right`, cell: (item) => <span>{format.currency(parseFloat(item.total_amount || '0'))}</span> },
    {
      key: 'progress',
      header: '执行进度',
      cell: (item) => {
        const executed = parseFloat(item.executed_amount || '0');
        const rate = parseFloat(item.progress_rate || '0');
        const pct = Math.min(100, Math.max(0, rate));
        return (
          <div className="min-w-[120px]">
            <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
              <span>¥{format.currency(executed)} / {item.order_count || 0} 单</span>
              <span className="font-medium text-blue-600">{format.qty(rate, 2)}%</span>
            </div>
            <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
              <div className="h-full bg-blue-500 rounded-full" style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      },
    },
    {
      key: 'status',
      header: '状态',
      cell: (item) => (
        <span className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_CLS[item.status] || ''}`}>{STATUS_TEXT[item.status] || item.status}</span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} whitespace-nowrap`,
      cell: (item) => (
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）
        <RowActions
          actions={[
            { key: 'print', label: '打印合同', icon: <Printer className="w-4 h-4" />, onClick: () => navigate(`/print/purchase_contract/${item.id}`) },
            { key: 'detail', label: '详情', icon: <Eye className="w-4 h-4" />, onClick: () => setDetail(item) },
            ...(item.status === 'draft' && has('purchase_contract_edit')
              ? [
                  { key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => navigate(`/purchase-contracts/${item.id}/edit`) },
                  { key: 'activate', label: '生效', icon: <PlayCircle className="w-4 h-4" />, onClick: () => doAction('activate', item) },
                  { key: 'cancel', label: '取消', icon: <XCircle className="w-4 h-4" />, onClick: () => doAction('cancel', item) },
                ]
              : []),
            ...(item.status === 'draft' && has('purchase_contract_delete')
              ? [
                  { key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(item) },
                ]
              : []),
            ...(item.status === 'active' && has('purchase_contract_edit')
              ? [
                  { key: 'complete', label: '完成', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => doAction('complete', item) },
                  { key: 'cancel', label: '取消', icon: <XCircle className="w-4 h-4" />, danger: true, onClick: () => doAction('cancel', item) },
                ]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'purchase-contract-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="采购合同"
        subtitle="与供应商签订采购框架合同，全生命周期管理"
        extra={
          has('purchase_contract_create') && (
            <button onClick={() => navigate('/purchase-contracts/new')} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              新建合同
            </button>
          )
        }
      />

      <div className="card p-4 flex items-center gap-3">
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="form-input w-40">
          <option value="">全部状态</option>
          <option value="draft">草稿</option>
          <option value="active">生效中</option>
          <option value="completed">已完成</option>
          <option value="cancelled">已取消</option>
        </select>
        <div className="ml-auto">{viewMenu}</div>
      </div>

      <div className="card p-4">
        {loading ? (
          <TableSkeleton rows={5} />
        ) : list.length === 0 ? (
          <ListEmpty
            filterNote={status ? `状态「${STATUS_TEXT[status] || status}」` : undefined}
            onClear={status ? () => { setStatus(''); setPage(1); } : undefined}
            title="暂无采购合同"
            description="点右上角「新建合同」录入框架合同，采购订单关联后即可看到执行进度"
          />
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
                {list.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(item)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {total > 0 && (
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(size) => { setPageSize(size); setPage(1); }}
            loading={loading}
          />
        )}
      </div>

      <Modal open={!!detail} onCancel={() => setDetail(null)} footer={null} title={detail ? `采购合同 ${detail.contract_no}` : '合同详情'}>
        {detail && (
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
              <div className="text-gray-500 text-xs">供应商</div>
              <div className="font-medium mt-1">{detail.supplier_name || (detail as any).edges?.supplier?.name || '-'}</div>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
              <div className="text-gray-500 text-xs">签订日期</div>
              <div className="font-medium mt-1">{detail.contract_date ? format.date(detail.contract_date) : '-'}</div>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
              <div className="text-gray-500 text-xs">有效期</div>
              <div className="font-medium mt-1">{detail.start_date ? format.date(detail.start_date) : '-'} ~ {detail.end_date ? format.date(detail.end_date) : '-'}</div>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
              <div className="text-gray-500 text-xs">合同金额</div>
              <div className="font-medium mt-1">{format.currency(parseFloat(detail.total_amount || '0'))}</div>
            </div>
            <div className="rounded-lg bg-gray-50 border border-gray-100 p-3 col-span-2">
              <div className="text-gray-500 text-xs">备注</div>
              <div className="font-medium mt-1">{detail.remark || '-'}</div>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
