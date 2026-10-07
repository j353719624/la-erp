import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Check, Trash2, Save, Printer } from 'lucide-react';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { productionApi } from '@/api/production';
import { warehouseApi } from '@/api/product';
import { WorkOrder } from '@/types/production';
import { format, toLocalDateISO } from '@/utils/format';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
import { confirmAction } from '@/utils/confirm';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';
const STATUS_TEXT: Record<string, string> = { draft: '草稿', confirmed: '已入库', cancelled: '已取消' };
const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-yellow-50 text-yellow-700',
  confirmed: 'bg-green-50 text-green-600',
  cancelled: 'bg-gray-100 text-gray-500',
};

interface ReceiptItem {
  id: string;
  receipt_no?: string;
  work_order_no?: string;
  receipt_date?: string;
  status?: string;
  lines?: any[];
}

interface LineRow {
  product_id: string;
  product_name: string;
  product_code: string;
  // 数量/成本以字符串保留输入中间态（type=text inputMode=decimal），提交前 Number() 化
  qty: number | string;
  unit_cost: number | string;
  batch_no: string;
  // [2026-09-16] 商品自定义字段（行内小字展示）
  ext_fields?: Record<string, unknown>;
}

export function ProductionReceiptPage() {
  // [2026-09-18 权限细化·批 2 生产] 新增=production_receipt_create；确认入库=production_receipt_edit；删除=production_receipt_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  // [2026-09-16] 商品自定义字段中文名（入库行内小字展示用）
  const productLabels = useProductFieldLabels();
  const [list, setList] = useState<ReceiptItem[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 10 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  const [status, setStatus] = useState('');
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);

  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [warehouses, setWarehouses] = useState<any[]>([]);
  const [woId, setWoId] = useState('');
  const [woNo, setWoNo] = useState('');
  const [whId, setWhId] = useState('');
  const [receiptDate, setReceiptDate] = useState(format.today());
  const [remark, setRemark] = useState('');
  const [lines, setLines] = useState<LineRow[]>([{ product_id: '', product_name: '', product_code: '', qty: 0, unit_cost: 0, batch_no: '' }]);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const res = await productionApi.receiptList({ page: pagination.page, page_size: pagination.page_size, receipt_no: debouncedKeyword || undefined, status: status || undefined } as any);
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setList(res.data?.list ?? []);
        setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
      }
    } catch {
      // 静默
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  }, [pagination.page, pagination.page_size, debouncedKeyword, status]);

  useEffect(() => { fetchList(); }, [fetchList]);

  useEffect(() => {
    if (modalOpen) {
      productionApi.workOrderList({ page: 1, page_size: 1000 }).then(res => {
        if (res.code === 0) setWorkOrders(res.data?.list ?? []);
      }).catch((err: any) => console.warn('工单列表加载失败（可能缺 work_order 权限）:', err?.message || err));
      warehouseApi.list({ page: 1, page_size: 1000 }).then((res: any) => {
        if (res.code === 0) setWarehouses(res.data?.list ?? []);
      }).catch((err: any) => console.warn('仓库列表加载失败（可能缺 warehouse_list 权限）:', err?.message || err));
    }
  }, [modalOpen]);

  const onSelectWorkOrder = (id: string) => {
    setWoId(id);
    const wo = workOrders.find(w => w.id === id);
    setWoNo(wo?.order_no || '');
    const planQty = Number(wo?.quantity || wo?.qty) || 0;
    const row: LineRow = {
      product_id: wo?.product_id || '',
      product_name: wo?.product_name || '',
      product_code: wo?.product_code || '',
      qty: planQty,
      // 成品入库成本默认按工单已发生材料成本均摊（可手改），避免默认 0 成本入库
      unit_cost: planQty > 0 ? Math.round((Number(wo?.material_cost || 0) / planQty) * 100) / 100 : 0,
      batch_no: '',
      // [2026-09-16] 商品自定义字段（工单行产品边带出，行内小字展示）
      ext_fields: (wo as any)?.edges?.product?.ext_fields,
    };
    setLines([row]);
  };

  const handleCreate = async () => {
    if (!woId) { message.warning('请选择生产工单'); return; }
    if (lines.length === 0 || lines.every(l => !l.product_id || !l.qty)) { message.warning('请填写入库明细'); return; }
    setSaving(true);
    try {
      const res = await productionApi.createReceipt({
        work_order_id: woId,
        work_order_no: woNo,
        warehouse_id: whId || undefined,
        receipt_date: toLocalDateISO(receiptDate),
        remark,
        lines: lines.filter(l => l.product_id && Number(l.qty) > 0).map(l => ({
          product_id: l.product_id, product_name: l.product_name, product_code: l.product_code,
          qty: Number(l.qty) || 0, unit_cost: Number(l.unit_cost) || 0, batch_no: l.batch_no,
        })),
      });
      if (res.code === 0) {
        message.success('入库单已创建');
        setModalOpen(false);
        resetModal();
        fetchList();
      } else {
        message.error(res.message || '创建失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '创建失败');
    } finally {
      setSaving(false);
    }
  };

  const resetModal = () => {
    setWoId(''); setWoNo(''); setWhId(''); setReceiptDate(format.today()); setRemark('');
    setLines([{ product_id: '', product_name: '', product_code: '', qty: 0, unit_cost: 0, batch_no: '' }]);
  };

  const handleConfirm = async (r: ReceiptItem) => {
    if (!(await confirmAction({ title: `确定确认入库单 ${r.receipt_no} 吗？`, content: '确认后将生成入库流水并更新库存' }))) return;
    const res = await productionApi.confirmReceipt(r.id);
    if (res.code === 0) { message.success('已入库'); fetchList(); }
    else message.error(res.message || '确认失败');
  };

  const handleDelete = async (r: ReceiptItem) => {
    if (!(await confirmAction({ title: `确定删除入库单 ${r.receipt_no} 吗？`, danger: true }))) return;
    const res = await productionApi.deleteReceipt(r.id);
    if (res.code === 0) { message.success('已删除'); fetchList(); }
    else message.error(res.message || '删除失败');
  };

  const updateLine = (idx: number, patch: Partial<LineRow>) => {
    setLines(prev => prev.map((l, i) => (i === idx ? { ...l, ...patch } : l)));
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: ReceiptItem) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'receipt_no', header: '入库单号', cell: (r) => <span className="font-medium text-gray-900">{r.receipt_no}</span> },
    { key: 'work_order_no', header: '工单', cell: (r) => <span className="text-gray-600 text-sm">{r.work_order_no || (r as any).edges?.work_order?.order_no || '-'}</span> },
    { key: 'receipt_date', header: '入库日期', cell: (r) => <span className="text-gray-500 text-sm">{format.date(r.receipt_date)}</span> },
    { key: 'line_count', header: '物料数', cell: (r) => <span className="text-gray-500 text-sm">{((r as any).edges?.lines?.length ?? r.lines?.length) ?? '-'}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (r) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLOR[r.status || ''] || 'bg-gray-100 text-gray-600'}`}>
          {STATUS_TEXT[r.status || ''] || r.status}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (r) => (
        // [易用性] 行操作统一折叠；确认/删除的确认仍在 handler（confirmAction）内
        <RowActions
          actions={[
            { key: 'print', label: '打印', icon: <Printer className="w-4 h-4" />, onClick: () => navigate(`/print/production_receipt/${r.id}`) },
            ...(r.status === 'draft'
              ? [
                  ...(has('production_receipt_edit')
                    ? [{ key: 'confirm', label: '确认入库', icon: <Check className="w-4 h-4" />, onClick: () => handleConfirm(r) }]
                    : []),
                  ...(has('production_receipt_delete')
                    ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(r) }]
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
    pageKey: 'production-receipt-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="生产入库"
        subtitle="完工产品入库"
        extra={
          has('production_receipt_create') && (
            <button onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新增入库</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="搜索入库单号..." value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }} className="form-input pl-10" />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }} className="form-input md:w-40">
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="confirmed">已入库</option>
            <option value="cancelled">已取消</option>
          </select>
          <div className="ml-auto flex items-center">{viewMenu}</div>
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
              ) : list.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无入库单" description="完工产品可发起生产入库" /></td></tr>
              ) : (
                list.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(r)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && list.length > 0 && (
          <Pagination page={pagination.page} pageSize={pagination.page_size} total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))} loading={loading} onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))} />
        )}
      </div>

      <Modal title="新增生产入库" open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} width={760}>
        <div className="space-y-4 pt-4">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">生产工单</label>
              <SearchSelect
                value={woId}
                onChange={(v) => onSelectWorkOrder(v ?? '')}
                placeholder="请选择工单"
                options={workOrders.map(wo => ({ value: wo.id, label: `${wo.order_no}（${wo.product_name}）` }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">入库仓库</label>
              <SearchSelect
                value={whId}
                onChange={(v) => setWhId(v ?? '')}
                placeholder="请选择仓库"
                options={warehouses.map((w: any) => ({ value: w.id, label: w.name }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">入库日期</label>
              <input type="date" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} className="form-input" />
            </div>
          </div>

          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">产品</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-28">入库数量</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-28">单位成本</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-28">批号</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.map((l, idx) => (
                  <tr key={idx}>
                    <td className="px-4 py-2 text-sm text-gray-700">
                      {l.product_name || '（选择工单后自动带出）'}
                      <LineProductExt line={l} labels={productLabels} />
                    </td>
                    <td className="px-4 py-2">
                      <input type="text" inputMode="decimal" value={l.qty ?? ''} onChange={e => updateLine(idx, { qty: e.target.value })} className="form-input !py-1" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="text" inputMode="decimal" value={l.unit_cost ?? ''} onChange={e => updateLine(idx, { unit_cost: e.target.value })} className="form-input !py-1" />
                    </td>
                    <td className="px-4 py-2">
                      <input type="text" value={l.batch_no} onChange={e => updateLine(idx, { batch_no: e.target.value })} className="form-input !py-1" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
            <textarea value={remark} onChange={e => setRemark(e.target.value)} rows={2} className="form-input" />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button onClick={() => setModalOpen(false)} className="btn-secondary">取消</button>
            <button onClick={handleCreate} disabled={saving} className="btn-primary flex items-center gap-2">
              <Save className="w-4 h-4" /> {saving ? '创建中...' : '创建入库单'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
