import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Eye, Pencil, XCircle, Trash2, Wallet, RefreshCw } from 'lucide-react';
import { Modal, InputNumber } from 'antd';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { paymentPlanApi, PaymentPlan, PaymentPlanItem } from '@/api/finance';
import { PaymentMethodSelect } from '@/components/PaymentMethodSelect';
import { format } from '@/utils/format';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { RowActions } from '@/components/RowActions';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { Pagination } from '@/components/Pagination';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';

type TabKey = 'all' | 'receivable' | 'payable';

const STATUS_TEXT: Record<string, string> = {
  active: '执行中',
  completed: '已完成',
  cancelled: '已取消',
};

const STATUS_CLS: Record<string, string> = {
  active: 'bg-blue-50 text-blue-600',
  completed: 'bg-green-50 text-green-600',
  cancelled: 'bg-gray-100 text-gray-500',
};

const ITEM_STATUS_TEXT: Record<string, string> = {
  pending: '待收/付',
  partial: '部分收/付',
  paid: '已收/付',
};

const ITEM_STATUS_CLS: Record<string, string> = {
  pending: 'bg-gray-100 text-gray-500',
  partial: 'bg-amber-50 text-amber-600',
  paid: 'bg-green-50 text-green-600',
};

export function PaymentPlanList() {
  // [2026-09-18 权限细化] 新建=payment_plan_create；编辑/取消=payment_plan_edit；删除=payment_plan_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ tab: 'all', status: '', page: 1, page_size: 10 });
  const [tab, setTab] = useState<TabKey>(urlFilters.tab as TabKey);
  const [status, setStatus] = useState(urlFilters.status);
  const [list, setList] = useState<PaymentPlan[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(urlFilters.page);
  const [pageSize, setPageSize] = useState(urlFilters.page_size);
  const [loading, setLoading] = useState(true);

  // [易用性 P1] 条件变化 → 写回 URL
  useEffect(() => {
    syncUrl({ tab, status, page, page_size: pageSize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, status, page, pageSize]);

  // 详情弹窗
  const [detail, setDetail] = useState<PaymentPlan | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  // 请求竞态守卫：收付页签/状态筛选/翻页快速切换时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  // 登记收/付
  const [receiveItem, setReceiveItem] = useState<PaymentPlanItem | null>(null);
  const [receiveAmount, setReceiveAmount] = useState<string>('');
  const [receiveMethod, setReceiveMethod] = useState<string>('');

  const fetchList = useCallback(async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const res = await paymentPlanApi.list({
        page,
        page_size: pageSize,
        plan_type: tab === 'all' ? undefined : tab,
        status: status || undefined,
      });
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
  }, [page, pageSize, tab, status, nextSeq, isCurrent]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetailOpen(true);
    try {
      const res = await paymentPlanApi.get(id);
      if (res.code === 0) setDetail(res.data);
      else message.error(res.message || '加载失败');
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '加载详情失败');
    } finally {
      setDetailLoading(false);
    }
  };

  const handleReceive = async () => {
    if (!detail || !receiveItem) return;
    const amount = receiveAmount;
    if (!amount || parseFloat(amount) <= 0) {
      message.warning('请输入登记金额');
      return;
    }
    try {
      const res = await paymentPlanApi.receive(detail.id, receiveItem.id, amount, receiveMethod || undefined);
      if (res.code === 0) {
        message.success('登记成功');
        setReceiveItem(null);
        setReceiveAmount('');
        setReceiveMethod('');
        setDetail(res.data);
        fetchList();
      } else {
        message.error(res.message || '登记失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '登记失败');
    }
  };

  const handleCancel = async (plan: PaymentPlan) => {
    if (!(await confirmAction({
      title: '取消计划',
      content: `确定取消计划 ${plan.plan_no} 吗？取消后不可恢复。`,
      okText: '取消计划',
      cancelText: '再想想',
    }))) return;
    try {
      const res = await paymentPlanApi.cancel(plan.id);
      if (res.code === 0) {
        message.success('计划已取消');
        fetchList();
      } else {
        message.error(res.message || '取消失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '取消失败');
    }
  };

  const handleDelete = async (plan: PaymentPlan) => {
    if (!(await confirmAction({
      title: '删除计划',
      content: `确定删除计划 ${plan.plan_no} 吗？`,
      okText: '删除',
      danger: true,
    }))) return;
    try {
      const res = await paymentPlanApi.remove(plan.id);
      if (res.code === 0) {
        message.success('已删除');
        fetchList();
      } else {
        message.error(res.message || '删除失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '删除失败');
    }
  };

  const itemBalance = (it: PaymentPlanItem) => (parseFloat(it.planned_amount) || 0) - (parseFloat(it.received_amount) || 0);
  const planBalance = (p: PaymentPlan) => (parseFloat(p.total_amount) || 0) - (parseFloat(p.received_amount) || 0);
  const typeText = (t: string) => (t === 'receivable' ? '收款计划' : '付款计划');
  // 该期最近一次登记的收/付款方式（登记历史存 plan.ext.receive_records）
  const lastReceiveMethod = (it: PaymentPlanItem) => {
    const records = (detail?.ext as any)?.receive_records as Array<{ item_id?: string; method?: string }> | undefined;
    if (!Array.isArray(records)) return '';
    const mine = records.filter((r) => r && r.item_id === it.id && r.method);
    return mine.length ? mine[mine.length - 1].method! : '';
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: PaymentPlan) => ReactNode;
  }
  const TH_C = 'px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-4 py-4';
  const rowCols: RowCol[] = [
    { key: 'plan_no', header: '计划单号', cell: (p) => <span className="font-medium">{p.plan_no}</span> },
    {
      key: 'plan_type',
      header: '类型',
      cell: (p) => (
        <span className={`inline-block px-2 py-0.5 rounded text-xs ${p.plan_type === 'receivable' ? 'bg-blue-50 text-blue-600' : 'bg-orange-50 text-orange-600'}`}>
          {typeText(p.plan_type)}
        </span>
      ),
    },
    { key: 'party_name', header: '往来单位', cell: (p) => <span>{p.party_name || '-'}</span> },
    { key: 'source_no', header: '来源单号', cell: (p) => <span>{p.source_no || '-'}</span> },
    { key: 'total_amount', header: '总金额', cell: (p) => <span>{format.currency(parseFloat(p.total_amount || '0'))}</span> },
    { key: 'received_amount', header: '已收/付', cell: (p) => <span className="text-green-600">{format.currency(parseFloat(p.received_amount || '0'))}</span> },
    { key: 'balance', header: '余额', cell: (p) => <span className="text-amber-600">{format.currency(planBalance(p))}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (p) => (
        <span className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_CLS[p.status] || ''}`}>{STATUS_TEXT[p.status] || p.status}</span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      cell: (p) => (
        // [易用性] 行操作统一折叠；取消/删除的确认仍在 handler（confirmAction）内
        <RowActions
          actions={[
            { key: 'view', label: '查看详情', icon: <Eye className="w-4 h-4" />, onClick: () => openDetail(p.id) },
            ...(p.status === 'active' && has('payment_plan_edit')
              ? [
                  { key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => navigate(`/finance/payment-plans/${p.id}/edit`) },
                  { key: 'cancel', label: '取消计划', icon: <XCircle className="w-4 h-4" />, onClick: () => handleCancel(p) },
                ]
              : []),
            ...(p.status === 'active' && has('payment_plan_delete')
              ? [
                  { key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(p) },
                ]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'payment-plan-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="收付款计划"
        subtitle="按到期日分期收/付款，逐期登记到账"
        extra={
          has('payment_plan_create') && (
            <button onClick={() => navigate('/finance/payment-plans/new')} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              新建计划
            </button>
          )
        }
      />

      {/* 筛选 */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-lg border border-gray-200 overflow-hidden">
            {([
              ['all', '全部'],
              ['receivable', '收款计划'],
              ['payable', '付款计划'],
            ] as [TabKey, string][]).map(([key, label]) => (
              <button
                key={key}
                onClick={() => { setTab(key); setPage(1); }}
                className={`px-4 py-2 text-sm ${tab === key ? 'bg-blue-600 text-white' : 'bg-white text-gray-600'}`}
              >
                {label}
              </button>
            ))}
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="form-input w-40">
            <option value="">全部状态</option>
            <option value="active">执行中</option>
            <option value="completed">已完成</option>
            <option value="cancelled">已取消</option>
          </select>
          <button onClick={fetchList} className="btn-secondary flex items-center gap-2">
            <RefreshCw className="w-4 h-4" />
            刷新
          </button>
        </div>
      </div>

      {/* 列表 */}
      <div className="card p-4">
        <div className="flex items-center justify-end mb-2">
          <div className="ml-auto">{viewMenu}</div>
        </div>
        {loading ? (
          <TableSkeleton rows={5} />
        ) : list.length === 0 ? (
          <EmptyState description="暂无收付款计划" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  {visibleColumns.map((c) => (
                    <th key={c.key} className={c.headCls || TH_C}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {list.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(p)}
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

      {/* 详情弹窗 */}
      <Modal
        open={detailOpen}
        onCancel={() => setDetailOpen(false)}
        footer={null}
        title={detail ? `${typeText(detail.plan_type)} ${detail.plan_no}` : '计划详情'}
        width={760}
      >
        {detailLoading ? (
          <TableSkeleton rows={3} />
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                <div className="text-gray-500 text-xs">往来单位</div>
                <div className="font-medium mt-1">{detail.party_name || '-'}</div>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                <div className="text-gray-500 text-xs">来源单号</div>
                <div className="font-medium mt-1">{detail.source_no || '-'}</div>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                <div className="text-gray-500 text-xs">总金额 / 已收付</div>
                <div className="font-medium mt-1">{format.currency(parseFloat(detail.total_amount || '0'))} / <span className="text-green-600">{format.currency(parseFloat(detail.received_amount || '0'))}</span></div>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                <div className="text-gray-500 text-xs">状态</div>
                <div className="font-medium mt-1">
                  <span className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_CLS[detail.status] || ''}`}>{STATUS_TEXT[detail.status] || detail.status}</span>
                </div>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="data-table w-full">
                <thead>
                  <tr>
                    <th style={{ textAlign: 'center' }}>期数</th>
                    <th style={{ textAlign: 'center' }}>到期日</th>
                    <th style={{ textAlign: 'center' }}>计划金额</th>
                    <th style={{ textAlign: 'center' }}>已收/付</th>
                    <th style={{ textAlign: 'center' }}>余额</th>
                    <th style={{ textAlign: 'center' }}>登记方式</th>
                    <th style={{ textAlign: 'center' }}>状态</th>
                    <th style={{ textAlign: 'center' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.edges?.items || []).map((it) => (
                    <tr key={it.id}>
                      <td style={{ textAlign: 'center' }}>{it.seq}</td>
                      <td style={{ textAlign: 'center' }}>{format.date(it.due_date)}</td>
                      <td style={{ textAlign: 'center' }}>{format.currency(parseFloat(it.planned_amount || '0'))}</td>
                      <td style={{ textAlign: 'center' }} className="text-green-600">{format.currency(parseFloat(it.received_amount || '0'))}</td>
                      <td style={{ textAlign: 'center' }} className="text-amber-600">{format.currency(itemBalance(it))}</td>
                      <td style={{ textAlign: 'center' }} className="text-gray-500">{lastReceiveMethod(it) || '—'}</td>
                      <td style={{ textAlign: 'center' }}>
                        <span className={`inline-block px-2 py-0.5 rounded text-xs ${ITEM_STATUS_CLS[it.status] || ''}`}>
                          {ITEM_STATUS_TEXT[it.status] || it.status}
                        </span>
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        {detail.status === 'active' && itemBalance(it) > 0 && (
                          <button
                            onClick={() => { setReceiveItem(it); setReceiveAmount(''); setReceiveMethod(''); }}
                            className="btn-primary text-xs flex items-center gap-1 mx-auto"
                          >
                            <Wallet className="w-3.5 h-3.5" />
                            {detail.plan_type === 'receivable' ? '登记收款' : '登记付款'}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>

      {/* 登记收/付弹窗 */}
      <Modal
        open={!!receiveItem}
        onCancel={() => setReceiveItem(null)}
        title={`${detail?.plan_type === 'receivable' ? '登记收款' : '登记付款'} — 第 ${receiveItem?.seq} 期`}
        okText="确认登记"
        cancelText="取消"
        onOk={handleReceive}
      >
        {receiveItem && (
          <div className="space-y-3">
            <div className="text-sm text-gray-600">
              计划金额：<b>{format.currency(parseFloat(receiveItem.planned_amount || '0'))}</b>
              {'　'}已收/付：<b className="text-green-600">{format.currency(parseFloat(receiveItem.received_amount || '0'))}</b>
              {'　'}余额：<b className="text-amber-600">{format.currency(itemBalance(receiveItem))}</b>
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">本次登记金额 *</label>
              <InputNumber
                style={{ width: '100%' }}
                min={0.01}
                max={itemBalance(receiveItem)}
                precision={2}
                value={receiveAmount ? parseFloat(receiveAmount) : undefined}
                onChange={(v) => setReceiveAmount(v != null ? String(v) : '')}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">{detail?.plan_type === 'receivable' ? '收款方式' : '付款方式'}</label>
              <PaymentMethodSelect
                value={receiveMethod}
                onChange={(v) => setReceiveMethod(v || '')}
                placeholder={detail?.plan_type === 'receivable' ? '请选择或输入收款方式' : '请选择或输入付款方式'}
              />
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
