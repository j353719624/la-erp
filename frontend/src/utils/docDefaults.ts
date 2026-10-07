import { LS } from './localKeys.ts';

/**
 * 开单默认值记忆（2026-09-12，P-02/B-03a 设置便利性改进）。
 *
 * 痛点：每次开销售/采购/出入库单都要重新选仓库（多数客户只有一个主仓），
 * 忘选时提交才报错、来回一次很烦。
 *
 * 默认仓库取值优先级（从高到低）：
 *  1. 上次使用且仍有效（在仓库列表内、未停用）——同一台电脑的重复劳动不再重复
 *  2. 系统默认仓库（仓库档案勾选「默认」is_default）
 *  3. 仓库列表第一项
 *
 * 记忆按「单据页 + 字段」分桶（如 sales-order/warehouse），互不串味；
 * 存储失败（隐私模式）静默降级为「每次都按系统默认」。
 */

/** 仓库最小结构（兼容 Warehouse 类型，仅取判断所需字段） */
export interface WarehouseLike {
  id: string;
  is_default?: boolean;
  status?: string;
}

/** 读取上次使用的开单默认值（无则返回 ''） */
export function readDocDefault(pageKey: string, field: string): string {
  try {
    return localStorage.getItem(`${LS.docDefaults}:${pageKey}:${field}`) ?? '';
  } catch {
    return '';
  }
}

/** 记住开单默认值（空值不覆盖，避免清空后丢失有效默认；写入失败静默） */
export function saveDocDefault(pageKey: string, field: string, value: string | undefined | null): void {
  if (value === undefined || value === null || value === '') return;
  try {
    localStorage.setItem(`${LS.docDefaults}:${pageKey}:${field}`, value);
  } catch {
    /* 隐私模式等场景忽略 */
  }
}

/** 默认仓库：上次使用（仍有效）→ 系统默认（is_default）→ 第一个；列表为空返回 undefined */
export function pickDefaultWarehouse<T extends WarehouseLike>(warehouses: T[], lastUsed?: string): T | undefined {
  const usable = warehouses.filter((w) => !w.status || w.status === 'active');
  const list = usable.length > 0 ? usable : warehouses;
  if (lastUsed) {
    const hit = list.find((w) => w.id === lastUsed);
    if (hit) return hit;
  }
  return list.find((w) => w.is_default) || list[0];
}
