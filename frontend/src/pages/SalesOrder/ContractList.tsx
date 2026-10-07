import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, PlayCircle, CheckCircle2, XCircle, Eye, Printer } from 'lucide-react';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { salesContractApi, SalesContract } from '@/api/order';
import { format } from '@/utils/format';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { usePermission } from '@/hooks/usePermission';
import { confirmAction } from '@/utils/confirm';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { Pagination } from '@/components/Pagination';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';

/**
 * 销售合同（2026-09-11）
 *
 * 与采购合同对称：`合同 → 订单 → 出库/收款` 单据链，支持执行进度（已下单/已收款/执行率/收款率）。
 * 客户方合同号（客户 PO 号）用于与客户对账。
 */
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

const money = (v: string | number | undefined) => `¥${format.currency(Number(v ?? 0))}`;
const pctText = (v: string | number | undefined) => `${Number(v ?? 0)}%`;

export function ContractList() {
  // [2026-09-18 权限细化·第3批] 销售合同独立四件套
  const { has } = usePermission();
  const navigate = useNavigate();
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ status: '', page: 1, page_size: 10 });
  const [status, setStatus] = useState(urlFilters.status);
  const [list, setList] = useState<SalesContract[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(urlFilters.page);
  const [pageSize, setPageSize] = useState(urlFilters.page_size);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<SalesContract | null>(null);

  useEffect(() => {
    syncUrl({ status, page, page_size: pageSize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page, pageSize]);

  // 请求竞态守卫：状态筛选/翻页快速切换时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      const res = await salesContractApi.list({ page, page_size: pageSize, status: status || undefined });
      if (res.code === 0) {
        if (!isCurrent(seq)) return;
        setList(res.data?.list || []);
        setTotal(res.data?.total || 0);
      }
    } catch (e: any) {
      message.error(e?.message || '加载失败');
    } finally {
      if (isCurrent(seq)) setLoading(false);
    }
  }, [page, pageSize, status, nextSeq, isCurrent]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const doAction = async (action: 'activate' | 'complete' | 'cancel', item: SalesContract) => {
    const conf = action === 'activate'
      ? { title: '生效合同', content: `确定让销售合同 ${item.contract_no} 生效吗？生效后不可再编辑。`, okText: '生效' }
      : action === 'complete'
        ? { title: '完成合同', content: `确定将销售合同 ${item.contract_no} 标记为已完成吗？`, okText: '完成' }
        : { title: '取消合同', content: `确定取消销售合同 ${item.contract_no} 吗？取消后不可恢复。`, okText: '取消', danger: true };
    if (!(await confirmAction(conf))) return;
    try {
      const res = action === 'activate'
        ? await salesContractApi.activate(item.id)
        : action === 'complete' ? await salesContractApi.complete(item.id) : await salesContractApi.cancel(item.id);
      if (res.code === 0) {
        message.success(action === 'activate' ? '合同已生效' : action === 'complete' ? '合同已完成' : '合同已取消');
        fetchList();
      }
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  };

  const handleDelete = async (item: SalesContract) => {
    const ok = await confirmAction({
      title: `删除销售合同 ${item.contract_no}？`,
      content: '已关联销售订单的合同需先解除关联；删除为软删除。',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await salesContractApi.remove(item.id);
      if (res.code === 0) {
        message.success('已删除');
        fetchList();
      }
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: SalesContract) => ReactNode;
  }
  const TH_L = 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-4 py-4';
  const rowCols: RowCol[] = [
    { key: 'contract_no', header: '合同号', cell: (c) => <span className="font-mono text-sm text-gray-900">{c.contract_no}</span> },
    { key: 'customer_name', header: '客户', cell: (c) => <span className="text-gray-800">{c.customer_name || '-'}</span> },
    { key: 'customer_contract_no', header: '客户合同号', cell: (c) => <span className="text-gray-500 text-sm">{c.customer_contract_no || '-'}</span> },
    { key: 'contract_date', header: '签订日期', cell: (c) => <span className="text-gray-600 text-sm">{c.contract_date ? String(c.contract_date).slice(0, 10) : '-'}</span> },
    {
      key: 'validity',
      header: '有效期',
      cell: (c) => (
        <span className="text-gray-600 text-sm">
          {c.start_date ? String(c.start_date).slice(0, 10) : '-'} ~ {c.end_date ? String(c.end_date).slice(0, 10) : '-'}
        </span>
      ),
    },
    { key: 'total_amount', header: '合同金额', headCls: TH_R, cellCls: `${TD} text-right`, cell: (c) => <span className="text-gray-900 font-medium">{money(c.total_amount)}</span> },
    {
      key: 'progress',
      header: '执行进度',
      cell: (c) => (
        <div className="text-sm">
          <div className="text-gray-700">
            已下单 {money(c.ordered_amount)}（{c.order_count || 0} 单）
          </div>
          <div className="text-xs text-gray-500">
            已收款 {money(c.paid_amount)} · 执行 {pctText(c.progress_rate)} · 收款 {pctText(c.receipt_rate)}
          </div>
          <div className="mt-1 h-1.5 w-24 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500"
              style={{ width: `${Math.min(100, Math.max(0, Number(c.progress_rate || 0)))}%` }}
            />
          </div>
        </div>
      ),
    },
    {
      key: 'status',
      header: '状态',
      cell: (c) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_CLS[c.status] || ''}`}>
          {STATUS_TEXT[c.status] || c.status}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} whitespace-nowrap`,
      cell: (c) => (
        <RowActions
          actions={[
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => setDetail(c) },
            { key: 'print', label: '打印合同', icon: <Printer className="w-4 h-4" />, onClick: () => navigate(`/print/sales_contract/${c.id}`) },
            ...(c.status === 'draft' && has('sales_contract_edit')
              ? [
                  { key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => navigate(`/sales-contracts/${c.id}/edit`) },
                  { key: 'activate', label: '生效', icon: <PlayCircle className="w-4 h-4" />, onClick: () => doAction('activate', c) },
                ]
              : c.status === 'active' && has('sales_contract_edit')
                ? [
                    { key: 'complete', label: '完成', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => doAction('complete', c) },
                  ]
                : []),
            ...(c.status !== 'completed' && c.status !== 'cancelled' && has('sales_contract_edit')
              ? [{ key: 'cancel', label: '取消', icon: <XCircle className="w-4 h-4" />, onClick: () => doAction('cancel', c) }]
              : []),
            ...(c.status === 'draft' && has('sales_contract_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(c) }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'sales-contract-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="销售合同"
        subtitle="与客户签订销售合同，跟踪下单执行率与收款率（合同 → 订单 → 出库/收款）"
        extra={
          has('sales_contract_create') && (
            <button onClick={() => navigate('/sales-contracts/new')} className="btn-primary flex items-center gap-2">
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

      <div className="card">
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
                <tr><td colSpan={visibleColumns.length} className="px-4 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-4">
                    <ListEmpty
                      filterNote={status ? `状态「${STATUS_TEXT[status] || status}」` : undefined}
                      onClear={() => { setStatus(''); setPage(1); }}
                      title="暂无销售合同"
                      description="点右上角「新建合同」录入，之后在销售订单里关联即可看到执行进度"
                    />
                  </td>
                </tr>
              ) : (
                list.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((col) => (
                      <td key={col.key} className={col.cellCls || TD}>
                        {col.cell(c)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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

      {/* 查看详情（只读） */}
      <Modal
        title={`销售合同 ${detail?.contract_no || ''}`}
        open={!!detail}
        onCancel={() => setDetail(null)}
        footer={null}
        width={640}
      >
        {detail && (
          <div className="space-y-3 text-sm py-2">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-gray-400">客户：</span>{detail.customer_name || '-'}</div>
              <div><span className="text-gray-400">客户合同号：</span>{detail.customer_contract_no || '-'}</div>
              <div><span className="text-gray-400">合同金额：</span>{money(detail.total_amount)}</div>
              <div><span className="text-gray-400">状态：</span>{STATUS_TEXT[detail.status] || detail.status}</div>
              <div><span className="text-gray-400">签订日期：</span>{detail.contract_date ? String(detail.contract_date).slice(0, 10) : '-'}</div>
              <div><span className="text-gray-400">有效期：</span>{detail.start_date ? String(detail.start_date).slice(0, 10) : '-'} ~ {detail.end_date ? String(detail.end_date).slice(0, 10) : '-'}</div>
            </div>
            <div className="border-t border-gray-100 pt-3 grid grid-cols-3 gap-3">
              <div><div className="text-xs text-gray-400">已下单</div><div className="font-medium">{money(detail.ordered_amount)}</div></div>
              <div><div className="text-xs text-gray-400">已收款</div><div className="font-medium">{money(detail.paid_amount)}</div></div>
              <div><div className="text-xs text-gray-400">关联订单</div><div className="font-medium">{detail.order_count || 0} 单</div></div>
              <div><div className="text-xs text-gray-400">执行率</div><div className="font-medium">{pctText(detail.progress_rate)}</div></div>
              <div><div className="text-xs text-gray-400">收款率</div><div className="font-medium">{pctText(detail.receipt_rate)}</div></div>
            </div>
            {detail.remark && <div className="border-t border-gray-100 pt-3 text-gray-600">备注：{detail.remark}</div>}
            <div className="text-xs text-gray-400 border-t border-gray-100 pt-3">
              执行进度 = 关联销售订单金额合计（不含已取消订单）；收款率 = 已收款 / 已下单金额。
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
