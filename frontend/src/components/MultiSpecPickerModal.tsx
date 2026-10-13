/**
 * 多规格商品「按款 × 规格矩阵」批量录入弹窗（W-01，2026-09-13）
 *
 * 场景（用户反馈「多规格商品操作繁琐，入库出库都非常低效」）：
 * 一款 2 维（颜色×尺码）共 6 个 SKU，旧路径要「添加商品」6 次 + 在同名下拉里逐个翻找；
 * 现在：选款 → 在 颜色×尺码 网格里直接填数量 → 一次生成多行明细（只添加填了数量的格子）。
 *
 * 用法（入库/出库等单据表单）：
 *   <MultiSpecPickerModal
 *     open={open} onClose={...} products={products}          // 表单已加载的商品全集
 *     stockWarehouseId={formData.warehouse_id}               // 出库：显示该仓库可用库存并超量标红
 *     existingProductIds={lines.map(l => l.product_id)}      // 已在明细的商品：格子标「已在明细·累加」
 *     onConfirm={(items) => handleBatchAdd(items)}           // items: [{product, qty}]，qty>0
 *   />
 *
 * 数据来源：商品列表（products，含 stock_by_warehouse / purchase_price）+ 多规格商品列表（spuApi.list，含 dims）。
 * 矩阵构建/库存取值全部走 `utils/specMatrix.ts` 纯函数（门禁脚本有断言）。
 */
import { useEffect, useMemo, useState } from 'react';
import { Modal } from 'antd';
import { RefreshCw } from 'lucide-react';
import { SearchSelect } from '@/components/SearchSelect';
import { spuApi } from '@/api/product';
import type { Product, Spu } from '@/types/product';
import { availableQtyInWarehouse, buildSpecMatrix, spuDimsSummary } from '@/utils/specMatrix';

export interface SpecBatchItem {
  product: Product;
  qty: number;
}

interface MultiSpecPickerModalProps {
  open: boolean;
  onClose: () => void;
  /** 表单已加载的商品全集（含库存分仓明细/进价/款边） */
  products: Product[];
  /** 出库场景传所选仓库 id：格子显示「可用」库存，填写超量标红（保存时以后端校验为准） */
  stockWarehouseId?: string;
  /** 已在明细中的商品 id：格子上标「已在明细·累加」 */
  existingProductIds?: string[];
  onConfirm: (items: SpecBatchItem[]) => void;
}

export function MultiSpecPickerModal({
  open,
  onClose,
  products,
  stockWarehouseId,
  existingProductIds,
  onConfirm,
}: MultiSpecPickerModalProps) {
  const [spus, setSpus] = useState<Spu[]>([]);
  const [spuLoading, setSpuLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [spuId, setSpuId] = useState('');
  const [qtyMap, setQtyMap] = useState<Record<string, string>>({});

  const loadSpus = async () => {
    setSpuLoading(true);
    setLoadError('');
    try {
      const res = await spuApi.list({ page: 1, page_size: 1000 });
      if (res.code === 0) setSpus((res.data?.list || []).filter((s) => s.status !== 'inactive'));
      setLoaded(true);
    } catch (err) {
      console.error('Failed to load spus:', err);
      // 在弹窗内展示错误 + 重试（不用 toast：弹窗还开着时 toast 会消失，留下误导性的「暂无」空态）
      setLoadError(err instanceof Error && err.message ? err.message : '多规格商品加载失败');
    } finally {
      setSpuLoading(false);
    }
  };

  // 首次打开时拉取多规格商品列表；之后用弹窗里的刷新按钮（避免每次开关都打接口）
  useEffect(() => {
    if (!open || loaded) return;
    void loadSpus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, loaded]);

  const spu = useMemo(() => spus.find((s) => s.id === spuId) ?? null, [spus, spuId]);
  const skus = useMemo(() => (spuId ? products.filter((p) => p.spu_id === spuId) : []), [products, spuId]);
  const matrix = useMemo(() => (spu ? buildSpecMatrix(spu.dims || [], skus) : null), [spu, skus]);
  const existing = useMemo(() => new Set(existingProductIds || []), [existingProductIds]);

  const entries = useMemo(() => {
    const out: SpecBatchItem[] = [];
    for (const p of skus) {
      const q = Number(qtyMap[p.id] ?? '');
      if (Number.isFinite(q) && q > 0) out.push({ product: p, qty: q });
    }
    return out;
  }, [skus, qtyMap]);

  const stockOf = (p: Product): number => {
    if (stockWarehouseId) return availableQtyInWarehouse(p, stockWarehouseId);
    const n = Number(p.stock_qty ?? 0);
    return Number.isFinite(n) ? n : 0;
  };

  const cellInput = (p: Product) => {
    const q = Number(qtyMap[p.id] ?? '');
    const stock = stockOf(p);
    const over = Boolean(stockWarehouseId) && Number.isFinite(q) && q > stock;
    return (
      <div className="flex flex-col items-center gap-0.5 py-0.5">
        <input
          type="text"
          inputMode="decimal"
          value={qtyMap[p.id] ?? ''}
          title={`${p.code}${p.spec ? ` · ${p.spec}` : ''}`}
          onChange={(e) => setQtyMap((prev) => ({ ...prev, [p.id]: e.target.value }))}
          placeholder="0"
          className={`form-input text-center ${over ? 'border-red-400' : ''}`}
          style={{ width: 72, padding: '4px 6px' }}
        />
        <span
          className={`text-[10px] ${over ? 'text-red-600' : 'text-gray-400'}`}
          title={stockWarehouseId ? '所选仓库可用库存' : '当前总在库'}
        >
          {stockWarehouseId ? '可用' : '在库'} {stock}
        </span>
        {existing.has(p.id) && <span className="text-[10px] text-amber-600">已在明细·累加</span>}
      </div>
    );
  };

  const handleConfirm = () => {
    if (!entries.length) return;
    onConfirm(entries);
    setQtyMap({});
  };

  const spuOptions = spus.map((s) => ({
    value: s.id,
    label: `${s.code} · ${s.name}`,
    search: `${s.code} ${s.name} ${spuDimsSummary(s.dims)}`,
  }));

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width={880}
      title={
        <span>
          按规格批量添加
          <span className="ml-2 text-xs font-normal text-gray-400">选款 → 规格矩阵填数量 → 一次生成多条明细</span>
        </span>
      }
    >
      <div className="max-h-[68vh] space-y-4 overflow-y-auto pr-1">
        <div className="flex items-center gap-2">
          <div className="min-w-0 flex-1">
            <SearchSelect
              value={spuId}
              onChange={(v) => setSpuId(v ?? '')}
              allowClear
              placeholder="搜索多规格商品：款号 / 款名 / 规格值"
              options={spuOptions}
            />
          </div>
          <button
            type="button"
            className="btn-secondary p-2"
            title="刷新多规格商品列表"
            onClick={() => void loadSpus()}
            disabled={spuLoading}
          >
            <RefreshCw className={`h-4 w-4 ${spuLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {!spuLoading && loadError && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span>多规格商品加载失败：{loadError}</span>
            <button type="button" className="btn-secondary text-sm" onClick={() => void loadSpus()}>
              重试
            </button>
          </div>
        )}

        {!spuLoading && !loadError && spus.length === 0 && (
          <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-6 text-center text-sm text-gray-500">
            暂无多规格商品（款）。先到「商品 → 多规格商品」建档（如 颜色/尺码 维度）并「生成 SKU」，之后即可在这里按规格批量录入。
          </div>
        )}

        {spu && (
          <>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
              <span>规格：{spuDimsSummary(spu.dims) || '无（单 SKU）'}</span>
              <span>SKU：{skus.length} 个</span>
              <span className="text-gray-400">库存列 = {stockWarehouseId ? '所选仓库可用' : '当前总在库'}</span>
            </div>

            {skus.length === 0 && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
                该款下未找到 SKU 商品：可能尚未「生成 SKU」，或 SKU 超出本次加载的商品列表范围。
              </div>
            )}

            {spu.sku_count != null && skus.length > 0 && skus.length < spu.sku_count && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-700">
                该款共 {spu.sku_count} 个 SKU，本次仅加载到 {skus.length} 个（超出商品列表加载上限或跨部门隔离）——
                未显示的规格请用「添加商品」或扫码逐条录入。
              </div>
            )}

            {matrix && matrix.mode === 'matrix' && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr>
                      <th className="whitespace-nowrap border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs font-medium text-gray-500">
                        {matrix.colLabel ? `${matrix.rowLabel} \\ ${matrix.colLabel}` : matrix.rowLabel}
                      </th>
                      {matrix.colValues.map((cv, ci) => (
                        <th key={ci} className="border border-gray-200 bg-gray-50 px-2 py-1.5 text-xs font-medium text-gray-600">
                          {cv || '数量'}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.rows.map((row) => (
                      <tr key={row.label}>
                        <th
                          scope="row"
                          className="whitespace-nowrap border border-gray-200 bg-gray-50/60 px-2 py-1 text-xs font-medium text-gray-700"
                        >
                          {row.label}
                        </th>
                        {row.cells.map((sku, ci) => (
                          <td key={ci} className="border border-gray-200 px-1 py-1 align-middle">
                            {sku ? cellInput(sku) : <span className="text-xs text-gray-300">—</span>}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {matrix && matrix.leftover.length > 0 && (
              <div>
                <div className="mb-1.5 text-xs font-medium text-gray-500">
                  {matrix.mode === 'matrix' ? '其他规格（未并入矩阵）' : '规格明细'}
                </div>
                <div className="flex flex-wrap gap-2">
                  {matrix.leftover.map((p) => (
                    <div key={p.id} className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-2 py-1.5">
                      <span className="max-w-[220px] truncate text-xs text-gray-700" title={`${p.name} ${p.spec || ''}（${p.code}）`}>
                        {p.spec || '默认'}（{p.code}）
                      </span>
                      {cellInput(p)}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
          <div className="text-xs text-gray-500">
            填 0 或留空不添加；重复添加同一商品自动累加到已有明细行
            {stockWarehouseId ? '；「可用」= 所选仓库可用库存' : ''}
          </div>
          <div className="flex items-center gap-2">
            <button type="button" className="btn-secondary text-sm" onClick={() => setQtyMap({})} disabled={!entries.length}>
              清空数量
            </button>
            <button type="button" className="btn-primary text-sm" disabled={!entries.length} onClick={handleConfirm}>
              添加 {entries.length || ''} 条明细
            </button>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export default MultiSpecPickerModal;
