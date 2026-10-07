import { useEffect, useState } from 'react';
import { http } from '@/utils/request';

/**
 * 数据字典（S-05 2026-09-13）：消灭"写死下拉"的通用数据源。
 *
 * 背景：系统内置 10 类字典，但此前只有 `payment_method` 被业务消费，商品类型/线索来源/
 * 客户等级等仍在页面里写死（且商品类型存在两套编码）。这里提供统一入口：
 *   - useDictEntries(typeCode)：任意字典类型 → 字典项数组（带模块级缓存，同类型只拉一次）
 *   - dictText(entries, code)：code → 中文名（找不到回退原始 code，便于发现脏值）
 *   - dictOptions(entries, current)：下拉选项（过滤停用项；当前值若已停用仍保留，防编辑丢值）
 *   - invalidateDictCache()：字典管理页增删改后调用，业务页下次进入即拉到最新
 *
 * 用法（下拉）：<DictSelect typeCode="goods_type" value={v} onChange={setV} />
 */

export interface DictEntry {
  item_code: string;
  item_name: string;
  sort_order?: number;
  status?: string;
  remark?: string;
}

// 模块级缓存：字典是全局低频数据，页面间共享，避免重复请求
const cache = new Map<string, DictEntry[]>();
const inflight = new Map<string, Promise<DictEntry[]>>();

/** 拉取字典项（命中缓存直接返回；失败返回空数组，页面回退兜底/原始 code） */
export function fetchDictEntries(typeCode: string): Promise<DictEntry[]> {
  const cached = cache.get(typeCode);
  if (cached) return Promise.resolve(cached);
  const pending = inflight.get(typeCode);
  if (pending) return pending;
  const p = http
    .get<DictEntry[]>('/v1/dict/items', { type_code: typeCode })
    .then((res) => {
      const list = res.code === 0 && Array.isArray(res.data) ? res.data : [];
      cache.set(typeCode, list);
      return list;
    })
    .catch(() => [] as DictEntry[])
    .finally(() => {
      inflight.delete(typeCode);
    });
  inflight.set(typeCode, p);
  return p;
}

/** 清缓存：字典管理页保存后调用（不传 typeCode 则清全部） */
export function invalidateDictCache(typeCode?: string) {
  if (typeCode) cache.delete(typeCode);
  else cache.clear();
}

export function useDictEntries(typeCode: string): DictEntry[] {
  const [entries, setEntries] = useState<DictEntry[]>(() => cache.get(typeCode) ?? []);
  useEffect(() => {
    let alive = true;
    fetchDictEntries(typeCode).then((list) => {
      if (alive) setEntries(list);
    });
    return () => {
      alive = false;
    };
  }, [typeCode]);
  return entries;
}

/** code → 名称（未命中回退原始 code；空值返回空串） */
export function dictText(entries: DictEntry[], code?: string): string {
  if (!code) return '';
  const hit = entries.find((e) => e.item_code === code);
  return hit?.item_name || code;
}

/** 下拉选项：默认过滤停用项，但当前值即使停用也保留（编辑历史数据不丢值） */
export function dictOptions(entries: DictEntry[], currentValue?: string): { value: string; label: string }[] {
  return entries
    .filter((e) => e.status !== 'inactive' || e.item_code === currentValue)
    .map((e) => ({ value: e.item_code, label: e.item_name }));
}
