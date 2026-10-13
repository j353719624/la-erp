import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Eye, Pencil, XCircle, Trash2, CheckCircle2, Wallet, PackageOpen } from 'lucide-react';
import { Modal, InputNumber } from 'antd';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { consignmentApi, ConsignmentOrder, ConsignmentOrderLine } from '@/api/inventory';
import { format } from '@/utils/format';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { Pagination } from '@/components/Pagination';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';

const STATUS_TEXT: Record<string, string> = {
  draft: '草稿',
  confirmed: '寄售中',
  settled: '已结清',
  cancelled: '已取消',
};

const STATUS_CLS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-500',
  confirmed: 'bg-blue-50 text-blue-600',
  settled: 'bg-green-50 text-green-600',
  cancelled: 'bg-red-50 text-red-500',
};

const lineRemain = (l: ConsignmentOrderLine) =>
  (parseFloat(l.qty) || 0) - (parseFloat(l.sold_qty) || 0) - (parseFloat(l.returned_qty) || 0);

export function ConsignmentList() {
  const navigate = useNavigate();
  // [2026-09-18 权限细化] 新增=consignment_create；编辑/确认/取消=consignment_edit；删除=consignment_delete
  const { has } = usePermission();
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ status: '', page: 1, page_size: 10 });
  const [status, setStatus] = useState(urlFilters.status);
  const [list, setList] = useState<ConsignmentOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(urlFilters.page);
  const [pageSize, setPageSize] = useState(urlFilters.page_size);
  const [loading, setLoading] = useState(true);

  // [易用性 P1] 条件变化 → 写回 URL
  useEffect(() => {
    syncUrl({ status, page, page_size: pageSize });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, page, pageSize]);

  const [detail, setDetail] = useState<ConsignmentOrder | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [action, setAction] = useState<'sold' | 'return'>('sold');
  const [lineQty, setLineQty] = useState<Record<string, string>>({});
  // 退回序列号（逗号分隔文本，key=行 id）
  const [lineSerials, setLineSerials] = useState<Record<string, string>>({});
  // 请求竞态守卫：状态筛选/翻页快速切换时丢弃过期响应
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const res = await consignmentApi.list({ page, page_size: pageSize, status: status || undefined });
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

  const openDetail = async (id: string) => {
    setDetailOpen(true);
    const res = await consignmentApi.get(id);
    if (res.code === 0) setDetail(res.data);
    else message.error(res.message || '加载失败');
  };

  const doAction = async (actionName: 'confirm' | 'sold' | 'return' | 'cancel', id: string) => {
    try {
      let res: any;
      if (actionName === 'confirm') res = await consignmentApi.confirm(id);
      else if (actionName === 'cancel') res = await consignmentApi.cancel(id);
      else {
        const lines = Object.entries(lineQty)
          .filter(([, q]) => q && parseFloat(q) > 0)
          .map(([lineId, q]) => ({
            line_id: lineId,
            qty: parseFloat(q),
            // 序列号商品退回必填序列号（售出忽略）
            serial_nos: (lineSerials[lineId] || '').split(/[,，]\s*/).filter(Boolean),
          }));
        if (lines.length === 0) {
          message.warning('请填写数量');
          return;
        }
        res = actionName === 'sold' ? await consignmentApi.sold(id, lines) : await consignmentApi.returnItems(id, lines);
      }
      if (res.code === 0) {
        const linkedNo = res.data?.linked_sales_order_no || '';
        message.success(
          actionName === 'confirm' ? '寄售已确认出库'
            : actionName === 'sold' ? (linkedNo ? `售出已登记，已联动销售订单 ${linkedNo}` : '售出已登记')
            : actionName === 'return' ? '退回已入库' : '已取消'
        );
        setDetail(res.data?.consignment || res.data || null);
        setLineQty({});
        fetchList();
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '操作失败');
    }
  };

  const openAction = (detailData: ConsignmentOrder, act: 'sold' | 'return') => {
    setDetail(detailData);
    setAction(act);
    setLineQty({});
    setLineSerials({});
  };

  const handleDelete = async (item: ConsignmentOrder) => {
    if (!(await confirmAction({
      title: '删除寄售单',
      content: `确定删除寄售单 ${item.consignment_no} 吗？`,
      okText: '删除',
      danger: true,
    }))) return;
    const res = await consignmentApi.remove(item.id);
    if (res.code === 0) {
      message.success('已删除');
      fetchList();
    } else {
      message.error(res.message || '删除失败');
    }
  };

  const actionModalOpen = !!detail && (action === 'sold' || action === 'return') && detail.status === 'confirmed';

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: ConsignmentOrder) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'consignment_no', header: '寄售单号', cell: (item) => <span className="font-medium">{item.consignment_no}</span> },
    { key: 'party_name', header: '代销方', cell: (item) => <span className="text-gray-700">{item.party_name || '-'}</span> },
    { key: 'total_qty', header: '寄出数量', headCls: TH_R, cellCls: `${TD} text-right`, cell: (item) => <span>{format.qty(item.total_qty)}</span> },
    { key: 'sold_qty', header: '已售', headCls: TH_R, cellCls: `${TD} text-right`, cell: (item) => <span className="text-blue-600">{format.qty(item.sold_qty)}</span> },
    { key: 'returned_qty', header: '已退', headCls: TH_R, cellCls: `${TD} text-right`, cell: (item) => <span className="text-green-600">{format.qty(item.returned_qty)}</span> },
    { key: 'total_amount', header: '寄售成本', headCls: TH_R, cellCls: `${TD} text-right`, cell: (item) => <span>{format.currency(parseFloat(item.total_amount || '0'))}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (item) => (
        <span className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_CLS[item.status] || ''}`}>
          {STATUS_TEXT[item.status] || item.status}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD}`,
      cell: (item) => (
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）
        <RowActions
          actions={[
            { key: 'detail', label: '查看详情', icon: <Eye className="w-4 h-4" />, onClick: () => openDetail(item.id) },
            ...(item.status === 'draft'
              ? [
                  ...(has('consignment_edit')
                    ? [
                        { key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => navigate(`/inventory/consignments/${item.id}/edit`) },
                        { key: 'confirm', label: '确认寄售出库', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => doAction('confirm', item.id) },
                        { key: 'cancel', label: '取消', icon: <XCircle className="w-4 h-4" />, onClick: () => doAction('cancel', item.id) },
                      ]
                    : []),
                  ...(has('consignment_delete')
                    ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(item) }]
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
    pageKey: 'consignment-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="寄售代销"
        subtitle="商品发往代销方，售出结算、未售退回"
        extra={
          has('consignment_create') && (
            <button onClick={() => navigate('/inventory/consignments/new')} className="btn-primary flex items-center gap-2">
              <Plus className="w-4 h-4" />
              新建寄售单
            </button>
          )
        }
      />

      <div className="card p-4">
        <div className="flex flex-wrap items-center gap-3">
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="form-input w-40">
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="confirmed">寄售中</option>
            <option value="settled">已结清</option>
            <option value="cancelled">已取消</option>
          </select>
          <div className="ml-auto">{viewMenu}</div>
        </div>
      </div>

      <div className="card p-4">
        {loading ? (
          <TableSkeleton rows={5} />
        ) : list.length === 0 ? (
          <ListEmpty
            filterNote={status ? `状态「${STATUS_TEXT[status] || status}」` : undefined}
            onClear={status ? () => { setStatus(''); setPage(1); } : undefined}
            title="暂无寄售单"
            description="点击右上角「新建寄售单」开始录入"
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

      {/* 详情弹窗 */}
      <Modal open={detailOpen} onCancel={() => setDetailOpen(false)} footer={null} title={detail ? `寄售单 ${detail.consignment_no}` : '详情'} width={760}>
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                <div className="text-gray-500 text-xs">代销方</div>
                <div className="font-medium mt-1">{detail.party_name || '-'}</div>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                <div className="text-gray-500 text-xs">仓库</div>
                <div className="font-medium mt-1">{detail.edges?.warehouse?.name || '-'}</div>
              </div>
              <div className="rounded-lg bg-gray-50 border border-gray-100 p-3">
                <div className="text-gray-500 text-xs">寄出/已售/已退</div>
                <div className="font-medium mt-1">{format.qty(detail.total_qty)} / <span className="text-blue-600">{format.qty(detail.sold_qty)}</span> / <span className="text-green-600">{format.qty(detail.returned_qty)}</span></div>
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
                    <th style={{ textAlign: 'center' }}>商品</th>
                    <th style={{ textAlign: 'center' }}>寄出</th>
                    <th style={{ textAlign: 'center' }}>已售</th>
                    <th style={{ textAlign: 'center' }}>已退</th>
                    <th style={{ textAlign: 'center' }}>未结</th>
                    <th style={{ textAlign: 'center' }}>成本</th>
                    <th style={{ textAlign: 'center' }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {(detail.edges?.lines || []).map((l) => {
                    const remain = lineRemain(l);
                    return (
                      <tr key={l.id}>
                        <td style={{ textAlign: 'center' }}>{l.product_name || l.product_code || l.product_id}</td>
                        <td style={{ textAlign: 'center' }}>{format.qty(l.qty)}</td>
                        <td style={{ textAlign: 'center' }} className="text-blue-600">{format.qty(l.sold_qty)}</td>
                        <td style={{ textAlign: 'center' }} className="text-green-600">{format.qty(l.returned_qty)}</td>
                        <td style={{ textAlign: 'center' }} className="text-amber-600">{format.qty(remain)}</td>
                        <td style={{ textAlign: 'center' }}>{format.currency(parseFloat(l.unit_cost || '0'))}</td>
                        <td style={{ textAlign: 'center' }}>
                          {detail.status === 'confirmed' && remain > 0 && (
                            <div className="flex items-center justify-center gap-1">
                              <button onClick={() => { setDetail(detail); setAction('sold'); setLineQty({}); setLineSerials({}); }} className="btn-primary text-xs flex items-center gap-1">
                                <Wallet className="w-3.5 h-3.5" />售出
                              </button>
                              <button onClick={() => { setDetail(detail); setAction('return'); setLineQty({}); setLineSerials({}); }} className="btn-secondary text-xs flex items-center gap-1">
                                <PackageOpen className="w-3.5 h-3.5" />退回
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {actionModalOpen && (
              <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-blue-700">
                    {action === 'sold' ? '登记售出数量' : '登记退回数量'}
                  </h4>
                  <div className="flex gap-2">
                    <button onClick={() => doAction(action, detail.id)} className="btn-primary text-xs">
                      确认{action === 'sold' ? '售出' : '退回'}
                    </button>
                    <button onClick={() => setAction('none' as any)} className="btn-secondary text-xs">取消</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
                  {(detail.edges?.lines || []).filter((l) => lineRemain(l) > 0).map((l) => (
                    <div key={l.id} className="rounded-lg bg-white border border-gray-100 p-3">
                      <div className="text-xs text-gray-500 mb-1">{l.product_name || l.product_code}（未结 {format.qty(lineRemain(l))}）</div>
                      <InputNumber
                        style={{ width: '100%' }}
                        min={0}
                        max={lineRemain(l)}
                        precision={2}
                        value={lineQty[l.id] ? parseFloat(lineQty[l.id]) : undefined}
                        onChange={(v) => setLineQty((p) => ({ ...p, [l.id]: v != null ? String(v) : '' }))}
                        placeholder="0"
                      />
                      {action === 'return' && (
                        <input
                          type="text"
                          value={lineSerials[l.id] || ''}
                          onChange={(e) => setLineSerials((p) => ({ ...p, [l.id]: e.target.value }))}
                          placeholder="归还序列号(逗号分隔)"
                          className="form-input mt-2"
                         autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
