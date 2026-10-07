import { useState, useEffect, useRef } from 'react';
import { ArrowUpCircle, ArrowDownCircle } from 'lucide-react';
import { inventoryApi } from '@/api/inventory';
import { StockMovement } from '@/types/inventory';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { Pagination } from '@/components/Pagination';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
import { DateRangeFilter } from '@/components/DateRangeFilter';
import { BarcodeInput } from '@/components/BarcodeInput';

export function InventoryMovement() {
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/分享不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', start_date: '', end_date: '', page: 1, page_size: 20 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  // [2026-09-12] 日期区间筛选（U-02）：快捷区间 + 起止日期，条件写 URL
  const [dateRange, setDateRange] = useState({ start_date: urlFilters.start_date, end_date: urlFilters.end_date });
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  // [易用性 P1] 仅关键词“真的变化”时才回第 1 页；挂载时不能重置，否则 URL 里的 ?page=N 会被清掉
  // （用值比较而不是“首次跳过”标志：dev 环境 StrictMode 会重放 effect，标志法第二次就会误重置）
  const prevKeywordRef = useRef(keyword);
  useEffect(() => {
    if (prevKeywordRef.current === keyword) return;
    prevKeywordRef.current = keyword;
    setPagination(prev => ({ ...prev, page: 1 }));
  }, [keyword]);

  // [易用性 P1] 条件变化 → 写回 URL（用防抖后关键词，与请求口径一致）
  useEffect(() => {
    syncUrl({ keyword: debouncedKeyword, start_date: dateRange.start_date, end_date: dateRange.end_date, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedKeyword, dateRange.start_date, dateRange.end_date, pagination.page, pagination.page_size]);

  useEffect(() => {
    fetchMovement();
  }, [pagination.page, pagination.page_size, debouncedKeyword, dateRange.start_date, dateRange.end_date]);

  const fetchMovement = async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      // [2026-09-12] 日期区间（U-02）走后端筛选（end_date 含当天整天）
      const params: PaginationParams = {
        page: pagination.page,
        page_size: pagination.page_size,
        keyword: debouncedKeyword || undefined,
        start_date: dateRange.start_date || undefined,
        end_date: dateRange.end_date || undefined,
      };
      const response = await inventoryApi.movement(params);
      if (response.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setMovements(response.data?.list || []);
        setPagination(prev => ({ ...prev, total: response.data?.total || 0 }));
      }
    } catch (err) {
      console.error('Failed to fetch inventory movement:', err);
    } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  };

  // [2026-09-12] 列表列描述符（12 列）：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: StockMovement) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    {
      key: 'product_code',
      header: '商品编码',
      cell: (item) => <span className="font-medium text-gray-900">{item.product_code || item.edges?.product?.code || '-'}</span>,
    },
    {
      key: 'product_name',
      header: '商品名称',
      cell: (item) => <span className="text-gray-900">{item.product_name || item.edges?.product?.name || '-'}</span>,
    },
    {
      key: 'warehouse',
      header: '仓库',
      cell: (item) => (
        <span className="text-gray-500 text-sm">{item.warehouse_name || item.edges?.warehouse?.name || '-'}</span>
      ),
    },
    {
      key: 'type',
      header: '变动类型',
      cell: (item) => {
        const qty = signedQty(item);
        // 成本调整流水 direction=0：无数量变动，中性展示（不按入/出库着色）
        // ⚠️ direction 为 Go 零值带 omitempty，JSON 会省略 → 用 ?? 0 兜底（?? 1 会误判为非成本调整）
        const isCostAdjust = item.source_type === 'adjust_cost' || (item.direction ?? 0) === 0;
        return (
          <div className="flex items-center gap-2">
            {isCostAdjust ? (
              <span className="w-4 h-4 inline-block rounded-full border-2 border-gray-300" />
            ) : qty > 0 ? (
              <ArrowDownCircle className="w-4 h-4 text-green-500" />
            ) : (
              <ArrowUpCircle className="w-4 h-4 text-red-500" />
            )}
            <span className="text-sm text-gray-600">{getMovementTypeText(item)}</span>
          </div>
        );
      },
    },
    {
      key: 'qty',
      header: '数量',
      headCls: TH_R,
      cellCls: TD,
      cell: (item) => {
        const qty = signedQty(item);
        const isCostAdjust = item.source_type === 'adjust_cost' || (item.direction ?? 0) === 0;
        return (
          <span className="font-medium text-gray-500 text-sm">
            {isCostAdjust ? '-' : `${qty > 0 ? '+' : ''}${qty}`}
          </span>
        );
      },
    },
    {
      key: 'unit_cost',
      header: '单价',
      cell: (item) => <span className="text-gray-500 text-sm">¥{format.currency(item.unit_cost)}</span>,
    },
    {
      key: 'total_cost',
      header: '总金额',
      cell: (item) => <span className="font-medium text-gray-900">¥{format.currency(item.total_cost)}</span>,
    },
    { key: 'batch_no', header: '批次', cell: (item) => <span className="text-gray-500 text-sm">{item.batch_no || '-'}</span> },
    { key: 'serial_no', header: '序列号', cell: (item) => <span className="text-gray-500 text-sm">{item.serial_no || '-'}</span> },
    {
      key: 'balance_after',
      header: '变动后余额',
      headCls: TH_R,
      cellCls: TD,
      cell: (item) => <span className="text-gray-600 text-sm">{item.balance_after != null ? item.balance_after : '-'}</span>,
    },
    { key: 'source_no', header: '关联单号', cell: (item) => <span className="text-gray-500 text-sm">{item.source_no || '-'}</span> },
    { key: 'created_at', header: '变动时间', cell: (item) => <span className="text-gray-500 text-sm">{format.date(item.created_at)}</span> },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享（本页无操作列，全部列可勾选）
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'inventory-movement',
    columns: rowCols,
  });

  const getMovementTypeText = (item: StockMovement): string => {
    const dir = (item.direction ?? 0) >= 0 ? 'in' : 'out';
    const key = `${item.source_type || 'manual'}_${dir}`;
    const typeMap: Record<string, string> = {
      purchase_in: '采购入库',
      sales_out: '销售出库',
      sales_return_in: '退货入库',
      purchase_return_out: '采购退货出库',
      transfer_in: '调拨入库',
      transfer_out: '调拨出库',
      adjustment_in: '盘盈入库',
      adjustment_out: '盘亏出库',
      // 库存调整流水 source_type 实际为 adjust（adjust_service），兼容旧键 adjustment_*
      adjust_in: '盘盈入库',
      adjust_out: '盘亏出库',
      // 成本调整流水（direction=0，无数量变动，仅重估成本）
      adjust_cost_in: '成本调整',
      adjust_cost_out: '成本调整',
      production_picking_out: '生产领料',
      production_receipt_in: '完工入库',
      production_return_in: '退料入库',
      opening_in: '期初入库',
      manual_in: '手工入库',
      manual_out: '手工出库',
      check_in: '盘盈入库',
      check_out: '盘亏出库',
      // 外协加工：收货入库 / 带料发料出库 / 退料入库
      subcontract_receive_in: '外协收货入库',
      subcontract_issue_out: '外协发料出库',
      subcontract_return_in_in: '外协退料入库',
      // 组装（KIT/组装单）：成品入库 + 组件出库；拆解反向（assembly 源无独立码，按方向区分）
      assembly_in: '组装入库',
      assembly_out: '组装出库',
      // 借出借入（loan 单据）：借出出库挂台账 / 归还回库 / 借入入库 / 借入归还出库
      loan_out_out: '借出出库',
      loan_return_in: '借出归还',
      loan_in_in: '借入入库',
      loan_return_out_out: '借入归还',
      // 寄售（CST 单据）：发出（库存减少，挂寄售台账）/ 退回（库存增加）
      consignment_out_out: '寄售出库',
      consignment_return_in: '寄售退回',
      // 组合商品（combo 服务）：组装=配件出库+成品入库；拆解=成品出库+配件回库
      combo_assemble_in: '组装入库',
      combo_assemble_out: '组装耗用',
      combo_disassemble_in: '拆解回库',
      combo_disassemble_out: '拆解出库',
    };
    // 兜底不再裸露英文编码：未知 source_type 按方向显示通用文案（2026-09-14 实测曾显示 consignment_out出库）
    const known = typeMap[key];
    if (known) return known;
    if (!item.source_type) return dir === 'in' ? '手工入库' : '手工出库';
    return dir === 'in' ? '其他入库' : '其他出库';
  };

  // 带方向数量（出库为负，用于箭头/红绿展示）
  const signedQty = (item: StockMovement): number => {
    const q = Number(item.qty || 0);
    return (item.direction ?? 0) >= 0 ? q : -q;
  };

  return (
    <div className="space-y-6">
      <PageHeader title="库存流水" subtitle="库存变动记录" />

      <div className="card">
        <div className="p-4 border-b border-gray-100">
          <div className="flex flex-wrap items-center gap-4">
            <BarcodeInput
              className="flex-1 min-w-[160px] max-w-md"
              value={keyword}
              onChange={setKeyword}
              onDetect={setKeyword}
              placeholder="搜索或扫码：条码 / 商品编码 / 名称 / 来源单号"
            />
            <div className="ml-auto">{viewMenu}</div>
          </div>
          {/* [2026-09-12] 日期区间筛选（U-02）：快捷区间（本月/上月/本年）+ 起止日期，条件写 URL */}
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <DateRangeFilter value={dateRange} onChange={(v) => { setDateRange(v); setPagination(prev => ({ ...prev, page: 1 })); }} />
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
              ) : movements.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6">
                  {keyword.trim() || dateRange.start_date || dateRange.end_date ? (
                    <EmptyState
                      title={keyword.trim() ? `未找到匹配「${keyword.trim()}」的流水` : '没有符合当前日期条件的流水'}
                      description={`当前条件：${[
                        keyword.trim() ? `关键词「${keyword.trim()}」` : '',
                        dateRange.start_date || dateRange.end_date ? `日期 ${dateRange.start_date || '不限'} ~ ${dateRange.end_date || '不限'}` : '',
                      ].filter(Boolean).join(' + ')}。支持按条码/商品编码/名称搜索；也可用关联单号在对应单据页查询`}
                      action={<button type="button" className="btn-secondary" onClick={() => { setKeyword(''); setDateRange({ start_date: '', end_date: '' }); setPagination(prev => ({ ...prev, page: 1 })); }}>清空筛选</button>}
                    />
                  ) : (
                    <EmptyState title="暂无流水数据" description="库存变动（采购入库/销售出库/调拨/盘点等）都会自动记一条流水" />
                  )}
                </td></tr>
              ) : (
                movements.map((item) => (
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

        {!loading && movements.length > 0 && (
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
    </div>
  );
}
