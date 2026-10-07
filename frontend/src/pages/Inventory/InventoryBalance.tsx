import { useState, useEffect } from 'react';
import { Search, Package, Download, Lock, Unlock } from 'lucide-react';
import { Modal, InputNumber } from 'antd';
import { message } from '@/utils/appMessage';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
import { exportCsv } from '@/utils/exportCsv';
import { inventoryApi } from '@/api/inventory';
import { InventoryBalance } from '@/types/inventory';
import { format } from '@/utils/format';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { Pagination } from '@/components/Pagination';

export function InventoryBalancePage() {
  const [balances, setBalances] = useState<InventoryBalance[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 20 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);
  const [lockModal, setLockModal] = useState<{ item: InventoryBalance; mode: 'lock' | 'unlock' } | null>(null);
  const [lockQty, setLockQty] = useState<number>(1);
  const [lockLoading, setLockLoading] = useState(false);
  // 请求竞态守卫：快速切换搜索/翻页时丢弃过期响应（此前无守卫 → 旧响应可覆盖新结果）
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    setPagination(prev => ({ ...prev, page: 1 }));
  }, [keyword]);

  useEffect(() => {
    fetchBalance();
  }, [keyword, pagination.page]);

  // [2026-09-12] 列表列描述符（14 列）：表格渲染与「我的视图」共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: InventoryBalance) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_C = 'px-6 py-3 text-center text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'product_code', header: '商品编码', cell: (item) => <span className="font-medium text-gray-900">{item.product_code || item.edges?.product?.code || '-'}</span> },
    { key: 'product_name', header: '商品名称', cell: (item) => <span className="text-gray-900">{item.product_name || item.edges?.product?.name || '-'}</span> },
    { key: 'warehouse', header: '仓库', cell: (item) => <span className="text-gray-500 text-sm">{item.warehouse_name || item.edges?.warehouse?.name || '-'}</span> },
    { key: 'location', header: '库位', cell: (item) => <span className="text-gray-500 text-sm">{item.location_name || '-'}</span> },
    { key: 'rack', header: '货架', cell: (item) => <span className="text-gray-500 text-sm">{item.rack_name || '-'}</span> },
    { key: 'qty_available', header: '在库', cell: (item) => <span className="font-medium text-gray-900">{item.qty_available}</span> },
    { key: 'qty_locked', header: '锁定', cell: (item) => <span className="text-sm text-orange-600">{item.qty_locked > 0 ? item.qty_locked : '-'}</span> },
    { key: 'qty_in_transit', header: '在途', cell: (item) => <span className="text-sm text-blue-600">{item.qty_in_transit > 0 ? item.qty_in_transit : '-'}</span> },
    { key: 'avg_cost', header: '成本价', cell: (item) => <span className="text-gray-500 text-sm">¥{format.currency(item.avg_cost)}</span> },
    { key: 'total_value', header: '总价值', cell: (item) => <span className="font-medium text-gray-900">¥{format.currency((item.qty_available || 0) * (item.avg_cost || 0))}</span> },
    { key: 'batch_no', header: '批次号', cell: (item) => <span className="text-gray-500 text-sm">{item.batch_no || '-'}</span> },
    { key: 'last_in_at', header: '最近入库', cell: (item) => <span className="text-gray-500 text-sm">{item.last_in_at ? format.date(item.last_in_at) : '-'}</span> },
    { key: 'last_out_at', header: '最近出库', cell: (item) => <span className="text-gray-500 text-sm">{item.last_out_at ? format.date(item.last_out_at) : '-'}</span> },
    {
      key: '__actions',
      header: '预留/锁定',
      headCls: TH_C,
      cellCls: 'px-6 py-4',
      cell: (item) => (
        <div className="flex items-center justify-center gap-1">
          <button onClick={() => openLockModal(item, 'lock')} disabled={(item.qty_available || 0) <= 0} className="icon-btn text-blue-600 disabled:opacity-40 disabled:cursor-not-allowed" title="锁定库存">
            <Lock className="w-4 h-4" />
          </button>
          <button onClick={() => openLockModal(item, 'unlock')} disabled={(item.qty_locked || 0) <= 0} className="icon-btn text-green-600 disabled:opacity-40 disabled:cursor-not-allowed" title="解锁库存">
            <Unlock className="w-4 h-4" />
          </button>
        </div>
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；预留/锁定列为操作列（锁定不可隐藏）
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'inventory-balance',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  const fetchBalance = async () => {
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      const response = await inventoryApi.balance({
        page: pagination.page,
        page_size: pagination.page_size,
        keyword,
      });
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        const data = response.data?.list || [];
        const total = response.data?.total || 0;
        setBalances(data);
        setPagination(prev => ({ ...prev, total }));
      }
    } catch (err) {
      console.error('Failed to fetch inventory balance:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  };

  // 注意：仅汇总「当前页」行（翻页/搜索时数字随页变化）；全量口径见报表中心→库存余额报表
  const totalValue = balances.reduce((sum, item) => sum + (item.qty_available || 0) * (item.avg_cost || 0), 0);

  const openLockModal = (item: InventoryBalance, mode: 'lock' | 'unlock') => {
    setLockQty(mode === 'lock' ? 1 : item.qty_locked || 1);
    setLockModal({ item, mode });
  };

  const handleLockConfirm = async () => {
    if (!lockModal) return;
    if (!lockQty || lockQty <= 0) { message.warning('请输入大于 0 的数量'); return; }
    setLockLoading(true);
    try {
      const res = lockModal.mode === 'lock'
        ? await inventoryApi.lock(lockModal.item.id, lockQty)
        : await inventoryApi.unlock(lockModal.item.id, lockQty);
      if (res.code === 0) {
        message.success(lockModal.mode === 'lock' ? '库存已锁定' : '库存已解锁');
        setLockModal(null);
        fetchBalance();
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (err: any) {
      message.error(err?.message || '操作失败，请稍后重试');
    } finally {
      setLockLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="库存余额"
        subtitle="实时库存数量和价值"
        extra={
          <div className="flex items-center gap-3">
            <button
              onClick={() => exportCsv(`库存余额_${format.today()}.csv`,
                ['商品编码', '商品名称', '仓库', '库位', '货架', '在库', '锁定', '在途', '成本价', '总价值', '批次号'],
                balances.map(b => [b.product_code, b.product_name, b.warehouse_name, b.location_name, b.rack_name, b.qty_available, b.qty_locked, b.qty_in_transit, Number(b.avg_cost).toFixed(2), Number((b.qty_available || 0) * (b.avg_cost || 0)).toFixed(2), b.batch_no]))}
              className="btn-secondary flex items-center gap-2"
            >
              <Download className="w-4 h-4" />
              <span className="hidden md:inline">导出 CSV</span>
            </button>
            <div className="card px-4 md:px-6 py-3 flex items-center gap-3">
              <Package className="w-6 h-6 text-blue-600" />
              <div>
                <p className="text-sm text-gray-500">本页库存价值</p>
                <p className="text-xl font-bold text-gray-800">¥{format.currency(totalValue)}</p>
              </div>
            </div>
          </div>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-4">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索商品名称或编码..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
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
              ) : balances.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无库存数据" /></td></tr>
              ) : (
                balances.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-50">
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

        {!loading && balances.length > 0 && (
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

      <Modal
        open={!!lockModal}
        title={lockModal?.mode === 'lock' ? '锁定库存' : '解锁库存'}
        onCancel={() => setLockModal(null)}
        onOk={handleLockConfirm}
        confirmLoading={lockLoading}
        okText={lockModal?.mode === 'lock' ? '锁定' : '解锁'}
        cancelText="取消"
      >
        {lockModal && (
          <div className="space-y-3 py-2">
            <p className="text-sm text-gray-600">
              商品：<span className="font-medium text-gray-900">{lockModal.item.product_name}</span>
              <span className="text-gray-400">（{lockModal.item.product_code}）</span>
            </p>
            <div className="flex items-center gap-3 text-sm text-gray-600">
              <span>在库：{lockModal.item.qty_available}</span>
              <span className="text-orange-600">锁定：{lockModal.item.qty_locked || 0}</span>
            </div>
            <div className="flex items-center gap-3">
              <label className="text-sm text-gray-700 whitespace-nowrap">数量</label>
              <InputNumber
                className="w-full"
                min={1}
                value={lockQty}
                onChange={(v) => setLockQty(Number(v) || 0)}
              />
            </div>
            {lockModal.mode === 'unlock' && (
              <p className="text-xs text-gray-400">解锁后数量将回到在库可用。</p>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
}
