import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Check, Trash2, Save, Printer } from 'lucide-react';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { productionApi } from '@/api/production';
import { warehouseApi, productApi } from '@/api/product';
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
import { productOptionLabel, productOptionSearch } from '@/utils/productLabel';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';

const STATUS_TEXT: Record<string, string> = { draft: '草稿', confirmed: '已领料', cancelled: '已取消' };
const STATUS_COLOR: Record<string, string> = {
  draft: 'bg-yellow-50 text-yellow-700',
  confirmed: 'bg-green-50 text-green-600',
  cancelled: 'bg-gray-100 text-gray-500',
};

interface PickingItem {
  id: string;
  picking_no?: string;
  work_order_no?: string;
  picking_date?: string;
  status?: string;
  lines?: any[];
  created_at?: string;
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

export function ProductionPickingPage() {
  // [2026-09-18 权限细化·批 2 生产] 新增=picking_create；确认领料=picking_edit；删除=picking_delete
  const { has } = usePermission();
  const navigate = useNavigate();
  // [2026-09-16] 商品自定义字段中文名（领料行内小字展示用）
  const productLabels = useProductFieldLabels();
  const [list, setList] = useState<PickingItem[]>([]);
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
  const [pickingDate, setPickingDate] = useState(format.today());
  const [remark, setRemark] = useState('');
  const [lines, setLines] = useState<LineRow[]>([]);

  // 直接领料（不关联工单）：仅当生产设置开启后显示入口
  const [allowDirect, setAllowDirect] = useState(false);
  const [mode, setMode] = useState<'workorder' | 'direct'>('workorder');
  const [products, setProducts] = useState<any[]>([]);
  const [candidate, setCandidate] = useState('');

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const res = await productionApi.pickingList({ page: pagination.page, page_size: pagination.page_size, picking_no: debouncedKeyword || undefined, status: status || undefined } as any);
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

  // 读取生产设置：判断是否开放“直接领料”入口（普通 work_order 角色也可读）
  useEffect(() => {
    productionApi.productionSettings().then(res => {
      if (res.code === 0) setAllowDirect(!!res.data?.allow_no_workorder_pick);
    }).catch(() => { /* 默认不开放 */ });
  }, []);

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

  // 直接领料模式：一次性加载商品（用于手工选料）
  useEffect(() => {
    if (modalOpen && allowDirect && products.length === 0) {
      productApi.list({ page: 1, page_size: 1000, status: 'active' } as any).then((res: any) => {
        if (res.code === 0) setProducts(res.data?.list ?? []);
      }).catch(() => { /* 静默 */ });
    }
  }, [modalOpen, allowDirect, products.length]);

  const onSelectWorkOrder = async (id: string) => {
    setWoId(id);
    const wo = workOrders.find(w => w.id === id);
    setWoNo(wo?.order_no || '');
    if (!id) { setLines([]); return; }
    try {
      const res = await productionApi.getBomItems(id);
      if (res.code === 0 && Array.isArray(res.data)) {
        setLines((res.data as any[]).map((item: any) => ({
          product_id: item.product_id,
          product_name: item.product_name || item.edges?.product?.name || '',
          product_code: item.product_code || item.edges?.product?.code || '',
          qty: Number(item.qty) || 0,
          unit_cost: Number(item.unit_cost) || 0,
          batch_no: '',
          // [2026-09-16] 商品自定义字段（BOM 带出行内小字展示）
          ext_fields: item.ext_fields,
        })));
      }
    } catch { /* 静默 */ }
  };

  const handleCreate = async () => {
    if (mode === 'workorder') {
      if (!woId) { message.warning('请选择生产工单'); return; }
    } else if (!allowDirect) {
      message.warning('直接领料未开启，请在【生产设置】开启');
      return;
    }
    if (lines.length === 0 || lines.every(l => !l.product_id || !l.qty)) { message.warning('请填写领料明细'); return; }
    setSaving(true);
    try {
      const res = await productionApi.createPicking({
        work_order_id: mode === 'workorder' ? woId : undefined,
        work_order_no: mode === 'workorder' ? woNo : undefined,
        warehouse_id: whId || undefined,
        picking_date: toLocalDateISO(pickingDate),
        remark,
        lines: lines.filter(l => l.product_id && Number(l.qty) > 0).map(l => ({
          product_id: l.product_id, product_name: l.product_name, product_code: l.product_code, qty: Number(l.qty) || 0, unit_cost: Number(l.unit_cost) || 0, batch_no: l.batch_no,
        })),
      });
      if (res.code === 0) {
        message.success('领料单已创建');
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
    setWoId(''); setWoNo(''); setWhId(''); setPickingDate(format.today()); setRemark(''); setLines([]);
    setMode('workorder'); setCandidate('');
  };

  // 直接领料：从商品下拉添加一条明细
  const handleAddDirectProduct = () => {
    if (!candidate) { message.warning('请先选择物料'); return; }
    const p = products.find((x: any) => x.id === candidate);
    if (!p) return;
    if (lines.some(l => l.product_id === p.id)) { message.warning('该物料已在领料明细中'); return; }
    setLines(prev => [...prev, {
      product_id: p.id,
      product_name: p.name,
      product_code: p.code,
      qty: 1,
      unit_cost: Number(p.purchase_price ?? p.cost_price ?? 0) || 0,
      batch_no: '',
      // [2026-09-16] 商品自定义字段（行内小字展示）
      ext_fields: p.ext_fields,
    }]);
    setCandidate('');
  };

  // ⚠️ http 层在业务失败时是 **抛异常**（interceptor: Promise.reject(new Error(message))），
  // 不是返回 code≠0；此前无 try/catch → 点“确定”后页面没任何反应（静默失败，用户 2026-09-11 报“确认不了”）
  const handleConfirm = async (p: PickingItem) => {
    if (!(await confirmAction({ title: `确定确认领料单 ${p.picking_no} 吗？`, content: '确认后将生成出库流水并计入工单成本' }))) return;
    try {
      const res = await productionApi.confirmPicking(p.id);
      if (res.code === 0) { message.success('已领料'); fetchList(); }
      else message.error(res.message || '确认失败');
    } catch (e: any) {
      message.error(e?.message || '确认失败');
    }
  };

  const handleDelete = async (p: PickingItem) => {
    if (!(await confirmAction({ title: `确定删除领料单 ${p.picking_no} 吗？`, danger: true }))) return;
    try {
      const res = await productionApi.deletePicking(p.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); }
      else message.error(res.message || '删除失败');
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
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
    cell: (row: PickingItem) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'picking_no', header: '领料单号', cell: (p) => <span className="font-medium text-gray-900">{p.picking_no}</span> },
    { key: 'work_order_no', header: '工单', cell: (p) => <span className="text-gray-600 text-sm">{p.work_order_no || (p as any).edges?.work_order?.order_no || '-'}</span> },
    { key: 'picking_date', header: '领料日期', cell: (p) => <span className="text-gray-500 text-sm">{format.date(p.picking_date)}</span> },
    { key: 'line_count', header: '物料数', cell: (p) => <span className="text-gray-500 text-sm">{((p as any).edges?.lines?.length ?? p.lines?.length) ?? '-'}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (p) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLOR[p.status || ''] || 'bg-gray-100 text-gray-600'}`}>
          {STATUS_TEXT[p.status || ''] || p.status}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (p) => (
        // [易用性] 行操作统一折叠；确认/删除的确认仍在 handler（confirmAction）内
        <RowActions
          actions={[
            { key: 'print', label: '打印', icon: <Printer className="w-4 h-4" />, onClick: () => navigate(`/print/production_picking/${p.id}`) },
            ...(p.status === 'draft'
              ? [
                  ...(has('picking_edit')
                    ? [{ key: 'confirm', label: '确认领料', icon: <Check className="w-4 h-4" />, onClick: () => handleConfirm(p) }]
                    : []),
                  ...(has('picking_delete')
                    ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(p) }]
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
    pageKey: 'production-picking-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="生产领料"
        subtitle="按工单 BOM 领用生产物料"
        extra={
          has('picking_create') && (
            <button onClick={() => setModalOpen(true)} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新增领料</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input type="text" placeholder="搜索领料单号..." value={keyword}
              onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }} className="form-input pl-10" />
          </div>
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }} className="form-input md:w-40">
            <option value="">全部状态</option>
            <option value="draft">草稿</option>
            <option value="confirmed">已领料</option>
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
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无领料单" description="按工单 BOM 发起生产领料" /></td></tr>
              ) : (
                list.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(p)}
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

      <Modal title="新增生产领料" open={modalOpen} onCancel={() => setModalOpen(false)} footer={null} width={760}>
        <div className="space-y-4 pt-4">
          {allowDirect && (
            <div className="flex items-center justify-between gap-3">
              <div className="inline-flex rounded-lg border border-gray-200 overflow-hidden">
                <button
                  type="button"
                  onClick={() => { setMode('workorder'); onSelectWorkOrder(''); }}
                  className={`px-4 py-2 text-sm transition-colors ${mode === 'workorder' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >按工单领料</button>
                <button
                  type="button"
                  onClick={() => { setMode('direct'); setLines([]); }}
                  className={`px-4 py-2 text-sm transition-colors ${mode === 'direct' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
                >直接领料（不关联工单）</button>
              </div>
              {mode === 'direct' && <span className="text-xs text-gray-400">无需先建工单，选择物料后直接出库</span>}
            </div>
          )}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {mode === 'workorder' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">生产工单</label>
                <SearchSelect
                  value={woId}
                  onChange={(v) => onSelectWorkOrder(v ?? '')}
                  placeholder="请选择工单"
                  options={workOrders.map(wo => ({ value: wo.id, label: `${wo.order_no}（${wo.product_name}）` }))}
                />
              </div>
            ) : (
              <div className="flex items-end pb-1">
                <div className="px-3 py-2 w-full bg-blue-50 border border-blue-100 rounded-lg text-sm text-blue-700">直接领料：不关联工单</div>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">领料仓库</label>
              <SearchSelect
                value={whId}
                onChange={(v) => setWhId(v ?? '')}
                placeholder="请选择仓库"
                options={warehouses.map((w: any) => ({ value: w.id, label: w.name }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">领料日期</label>
              <input type="date" value={pickingDate} onChange={e => setPickingDate(e.target.value)} className="form-input" />
            </div>
          </div>

          {mode === 'direct' && (
            <div className="flex items-center gap-2">
              <div className="flex-1">
                <SearchSelect
                  value={candidate}
                  onChange={(v) => setCandidate(v ?? '')}
                  placeholder="请选择要领出的物料"
                  allowClear
                  options={products.map((p: any) => ({ value: p.id, label: productOptionLabel(p), search: productOptionSearch(p) }))}
                />
              </div>
              <button type="button" onClick={handleAddDirectProduct} className="btn-secondary flex items-center gap-1 whitespace-nowrap">
                <Plus className="w-4 h-4" /> 添加物料
              </button>
            </div>
          )}

          <div className="overflow-x-auto border border-gray-200 rounded-lg">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">物料</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-28">领料数量</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-28">单位成本</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500 w-28">批号</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {lines.length === 0 ? (
                  <tr><td colSpan={4} className="px-4 py-8 text-center text-sm text-gray-400">{mode === 'direct' ? '选择物料后点“添加物料”加入明细' : '选择工单后自动带出 BOM 物料'}</td></tr>
                ) : (
                  lines.map((l, idx) => (
                    <tr key={idx}>
                      <td className="px-4 py-2 text-sm text-gray-700">
                        <div className="flex items-center justify-between gap-2">
                          <span className="min-w-0">{l.product_name}（{l.product_code}）</span>
                          {mode === 'direct' && (
                            <button
                              type="button"
                              onClick={() => setLines(prev => prev.filter((_, i) => i !== idx))}
                              title="删除"
                              className="p-1 text-red-500 hover:bg-red-50 rounded-lg transition-colors flex-shrink-0"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
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
                  ))
                )}
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
              <Save className="w-4 h-4" /> {saving ? '创建中...' : '创建领料单'}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
