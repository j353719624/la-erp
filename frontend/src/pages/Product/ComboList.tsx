import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Search, Pencil, Boxes, PackageOpen, Trash2, Eye, X, RefreshCw } from 'lucide-react';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { comboApi } from '@/api/combo';
import { warehouseApi } from '@/api/product';
import { ComboListItem, ComboDetail, Warehouse } from '@/types/product';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { pickDefaultWarehouse } from '@/utils/docDefaults';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
interface OpModalState {
  type: 'assemble' | 'disassemble';
  product: ComboListItem;
}

export function ComboList() {
  const navigate = useNavigate();
  const [rows, setRows] = useState<ComboListItem[]>([]);
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
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [detail, setDetail] = useState<ComboDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [op, setOp] = useState<OpModalState | null>(null);
  const [opQty, setOpQty] = useState<string>('1');
  const [opWarehouse, setOpWarehouse] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchWarehouses = useCallback(async () => {
    try {
      const res = await warehouseApi.list({ page: 1, page_size: 1000 });
      if (res.code === 0) {
        const list = res.data.list || [];
        setWarehouses(list);
        if (list.length > 0) {
          // [2026-09-12 上下文复查] 统一走 pickDefaultWarehouse（会跳过停用仓；此前只认 is_default 不看状态）
          const def = pickDefaultWarehouse(list);
          if (def) setWarehouseId(prev => prev || def.id);
        }
      }
    } catch (err) {
      console.error('Failed to fetch warehouses:', err);
    }
  }, []);

  useEffect(() => {
    fetchWarehouses();
  }, [fetchWarehouses]);

  const fetchList = useCallback(async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams & { name?: string; warehouse_id?: string } = {
        page: pagination.page,
        page_size: pagination.page_size,
        name: debouncedKeyword || undefined,
        warehouse_id: warehouseId || undefined,
      };
      const response = await comboApi.list(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setRows(response.data?.list || []);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch combo products:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  }, [pagination.page, pagination.page_size, debouncedKeyword, warehouseId]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    setDetail(null);
    try {
      const res = await comboApi.get(id);
      if (res.code === 0) setDetail(res.data);
    } catch (err) {
      console.error('Failed to fetch combo detail:', err);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleRemove = async (p: ComboListItem) => {
    if (!(await confirmAction({ title: `确定取消「${p.name}」的组合商品标记吗？`, content: '将删除其组装配方（商品本身保留，可继续正常销售/出库）', danger: true }))) return;
    try {
      const res = await comboApi.remove(p.id);
      if (res.code === 0) {
        message.success(`「${p.name}」已取消组合标记`);
        fetchList();
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (err: any) {
      message.error(err?.message || '操作失败，请稍后重试');
    }
  };

  const submitOp = async () => {
    if (!op) return;
    const qty = parseFloat(opQty);
    if (!qty || qty <= 0) {
      message.warning('请输入大于 0 的数量');
      return;
    }
    if (!opWarehouse) {
      message.warning('请选择仓库');
      return;
    }
    setSubmitting(true);
    try {
      const isAsm = op.type === 'assemble';
      const res = isAsm
        ? await comboApi.assemble(op.product.id, opWarehouse, qty)
        : await comboApi.disassemble(op.product.id, opWarehouse, qty);
      if (res.code === 0) {
        message.success(isAsm
          ? `已组装 ${op.product.name} × ${qty}（单件成本 ${res.data?.unit_cost != null ? Number(res.data.unit_cost).toFixed(2) : '-'}）`
          : `已拆解 ${op.product.name} × ${qty}`);
        setOp(null);
        fetchList();
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (err: any) {
      message.error(err?.message || '操作失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: ComboListItem) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    {
      key: 'product',
      header: '成品',
      cell: (p) => (
        <>
          <div className="font-medium text-gray-900">{p.name}</div>
          <div className="text-xs text-gray-400">{(p as any).code}{p.spec ? ` / ${p.spec}` : ''}</div>
        </>
      ),
    },
    { key: 'category', header: '分类', cell: (p) => <span className="text-sm text-gray-500">{p.edges?.category?.name || '-'}</span> },
    { key: 'item_count', header: '配件数', headCls: TH_R, cellCls: `${TD} text-right`, cell: (p) => <span className="text-sm text-gray-700">{p.item_count}</span> },
    { key: 'unit_cost', header: '单件成本(估)', headCls: TH_R, cellCls: `${TD} text-right`, cell: (p) => <span className="text-sm text-gray-700">¥{format.currency(p.unit_cost)}</span> },
    { key: 'can_assemble', header: '可组装', headCls: TH_R, cellCls: `${TD} text-right`, cell: (p) => <span className="text-sm text-gray-700">{p.can_assemble ?? '-'}</span> },
    { key: 'stock', header: '成品库存', headCls: TH_R, cellCls: `${TD} text-right`, cell: (p) => <span className="text-sm text-gray-700">{p.stock ?? '-'}</span> },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (p) => (
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）
        <RowActions
          actions={[
            { key: 'edit', label: '编辑配方', icon: <Pencil className="w-4 h-4" />, onClick: () => navigate(`/combo-products/${p.id}`) },
            { key: 'assemble', label: '组装（扣配件库存成品）', icon: <Boxes className="w-4 h-4" />, onClick: () => { setOp({ type: 'assemble', product: p }); setOpQty('1'); setOpWarehouse(warehouseId); } },
            { key: 'disassemble', label: '拆解（成品出库回配件）', icon: <PackageOpen className="w-4 h-4" />, onClick: () => { setOp({ type: 'disassemble', product: p }); setOpQty('1'); setOpWarehouse(warehouseId); } },
            { key: 'detail', label: '查看配方', icon: <Eye className="w-4 h-4" />, onClick: () => openDetail(p.id) },
            { key: 'del', label: '取消组合标记', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleRemove(p) },
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'combo-product-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="组装商品"
        subtitle="商品级组装：选配件定义配方，按 N 个组装扣配件库存 → 成品入库（可销售/盘点，与普通商品一致）"
        extra={
          <button onClick={() => navigate('/combo-products/create')} className="btn-primary flex items-center gap-2">
            <Plus className="w-5 h-5" />
            <span className="hidden md:inline">新建组装商品</span>
          </button>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-3">
            <div className="relative flex-1 min-w-[160px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                placeholder="搜索成品名称/编码..."
                value={keyword}
                onChange={(e) => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
                className="form-input pl-10"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-gray-600 whitespace-nowrap">库存仓库：</label>
              <SearchSelect
                value={warehouseId}
                onChange={(v) => { setWarehouseId(v ?? ''); setPagination(prev => ({ ...prev, page: 1 })); }}
                placeholder="请选择仓库"
                options={warehouses.map(w => ({ value: w.id, label: w.name }))}
                className="w-48"
              />
              <button onClick={() => fetchList()} className="icon-btn" title="刷新">
                <RefreshCw className="w-4 h-4" />
              </button>
            </div>
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
              ) : rows.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无组装商品" description="点击右上角「新建组装商品」，选择成品并添加配件配方" /></td></tr>
              ) : (
                rows.map((p) => (
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

        <Pagination
          page={pagination.page}
          pageSize={pagination.page_size}
          total={pagination.total}
          onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
          loading={loading}
          onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
        />
      </div>

      {/* 组装/拆解弹窗 */}
      <Modal
        open={!!op}
        title={op ? (op.type === 'assemble' ? `组装：${op.product.name}` : `拆解：${op.product.name}`) : ''}
        onCancel={() => { if (!submitting) setOp(null); }}
        onOk={submitOp}
        confirmLoading={submitting}
        okText={op?.type === 'assemble' ? '确认组装' : '确认拆解'}
        cancelText="取消"
      >
        <div className="space-y-4 py-2">
          <p className="text-sm text-gray-500">
            {op?.type === 'assemble'
              ? '组装将按配方扣减配件库存，并生成成品实体库存（可销售/盘点）。'
              : '拆解将扣减成品实体库存，并按配方把配件退回仓库。'}
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">仓库 *</label>
            <SearchSelect
              value={opWarehouse}
              onChange={(v) => setOpWarehouse(v ?? '')}
              placeholder="请选择仓库"
              allowClear
              options={warehouses.map(w => ({ value: w.id, label: w.name }))}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">数量（个/件） *</label>
            <input
              type="number"
              step="any"
              min="0"
              value={opQty}
              onChange={(e) => setOpQty(e.target.value)}
              className="form-input w-full"
              placeholder="如：10"
            />
          </div>
        </div>
      </Modal>

      {/* 配方详情弹窗 */}
      <Modal
        open={!!detail}
        title={detail ? `${detail.product?.name || ''} 组装配方` : ''}
        onCancel={() => setDetail(null)}
        footer={null}
        width={640}
      >
        {detailLoading ? (
          <div className="flex items-center justify-center h-32 text-gray-400">加载中...</div>
        ) : detail ? (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm">
              <div><span className="text-gray-500">成品：</span>{(detail.product as any)?.code} {detail.product?.name}</div>
              <div><span className="text-gray-500">单件成本估算：</span><span className="font-medium">¥{format.currency(detail.unit_cost)}</span></div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">配件</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">规格</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">每 1 成品用量</th>
                    <th className="px-4 py-2 text-right text-xs font-medium text-gray-500">参考单价</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(detail.lines || []).map((l: any, idx: number) => (
                    <tr key={l.id || idx}>
                      <td className="px-4 py-2 text-sm text-gray-700">{l.component_name} <span className="text-gray-400 text-xs">({l.component_code})</span></td>
                      <td className="px-4 py-2 text-sm text-gray-500">{l.spec || '-'}</td>
                      <td className="px-4 py-2 text-sm text-right text-gray-700">{l.qty} {l.unit_name || ''}</td>
                      <td className="px-4 py-2 text-sm text-right text-gray-500">¥{format.currency(l.ref_cost)}</td>
                    </tr>
                  ))}
                  {(!detail.lines || detail.lines.length === 0) && (
                    <tr><td colSpan={4} className="px-4 py-4 text-center text-sm text-gray-400">暂无配方行</td></tr>
                  )}
                </tbody>
              </table>
            </div>
            <div className="flex justify-end">
              <button onClick={() => navigate(`/combo-products/${detail.product?.id}`)} className="btn-primary text-sm">
                编辑配方
              </button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
