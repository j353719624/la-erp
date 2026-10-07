import { useEffect, useRef } from 'react';
import { pickDefaultWarehouse, readDocDefault, saveDocDefault, WarehouseLike } from '@/utils/docDefaults';

/**
 * 开单默认仓库 hook（2026-09-12，P-02/B-03a 设置便利性改进）。
 *
 * 行为：
 *  - 新建单据且仓库未选时，自动带出：上次使用（仍有效）→ 系统默认（仓库档案 is_default）→ 第一个；
 *  - 用户选中仓库后记住，下次开同类单据自动带出（仅新建生效，编辑既有单据不污染默认）；
 *  - 仓库列表为空 / 已选值时不动表单（不覆盖用户已经改过的选择）。
 *
 * 用法（表单内 1 行）：
 *   useDocDefaultWarehouse('sales-order', {
 *     isEdit,
 *     warehouses,
 *     value: formData.warehouse_id,
 *     onChange: (id) => setFormData((prev) => ({ ...prev, warehouse_id: id })),
 *   });
 */
export function useDocDefaultWarehouse<T extends WarehouseLike>(
  pageKey: string,
  opts: {
    isEdit: boolean;
    warehouses: T[];
    value?: string;
    onChange: (id: string) => void;
  },
): void {
  const { isEdit, warehouses, value, onChange } = opts;
  // 上次使用值只在挂载时读一次（后续保存由本 hook 自己写，避免回读竞争）
  const lastUsedRef = useRef<string>(readDocDefault(pageKey, 'warehouse'));

  useEffect(() => {
    if (isEdit || value || warehouses.length === 0) return;
    const def = pickDefaultWarehouse(warehouses, lastUsedRef.current);
    if (def) onChange(def.id);
  }, [isEdit, warehouses, value, onChange]);

  useEffect(() => {
    if (!isEdit && value) saveDocDefault(pageKey, 'warehouse', value);
  }, [isEdit, value]);
}
