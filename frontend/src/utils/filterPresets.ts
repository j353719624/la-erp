import { LS } from './localKeys.ts';

/**
 * 我的筛选（筛选条件命名保存，2026-09-12，U-03 设置便利性改进）。
 *
 * 痛点：筛选写 URL 只在"当前这条 URL"里有效——"待审核采购单""本月未收款订单"
 * 这类常用条件每次都要重设。
 *
 * 设计（复用「我的视图」的预设分桶模式）：
 *  - 预设存本机（localStorage `${LS.filterPresets}:${pageKey}`，数组 [{name, params}]）
 *  - 「应用」= 把 params 喂回页面筛选状态 → 页面既有 syncUrl 自动写 URL
 *    （**分享 URL 不依赖本地预设**：换人换机器打开同一 URL 得到同一套筛选）
 *  - 同名保存 = 覆盖；支持重命名/删除；脏数据/隐私模式一律容错不阻断页面
 */
export interface FilterPreset {
  name: string;
  params: Record<string, string>;
}

const keyOf = (pageKey: string) => `${LS.filterPresets}:${pageKey}`;

/** 去掉空值参数（避免 URL/预设里挂一堆空键；保存预设前调用） */
export function cleanFilterParams(params: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  Object.entries(params || {}).forEach(([k, v]) => {
    if (v !== undefined && v !== null && String(v) !== '') out[k] = String(v);
  });
  return out;
}

/** 读取某页面已保存的筛选（解析失败一律当空，不阻断页面） */
export function listFilterPresets(pageKey: string): FilterPreset[] {
  try {
    const raw = localStorage.getItem(keyOf(pageKey));
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(
      (x): x is FilterPreset =>
        Boolean(x) && typeof x.name === 'string' && Boolean(x.params) && typeof x.params === 'object' && !Array.isArray(x.params),
    );
  } catch {
    return [];
  }
}

function writeFilterPresets(pageKey: string, list: FilterPreset[]): FilterPreset[] {
  try {
    localStorage.setItem(keyOf(pageKey), JSON.stringify(list));
  } catch {
    /* 隐私模式/配额满：忽略，页面仍可用（只是不持久） */
  }
  return list;
}

/**
 * 保存当前筛选（同名覆盖）。
 * 名字为空 / 无任何有效参数时不保存（避免存出"什么也不筛"的预设）。
 */
export function saveFilterPreset(pageKey: string, name: string, params: Record<string, string>): FilterPreset[] {
  const trimmed = (name || '').trim();
  const clean = cleanFilterParams(params);
  if (!trimmed || Object.keys(clean).length === 0) return listFilterPresets(pageKey);
  const list = listFilterPresets(pageKey);
  const existing = list.find((v) => v.name === trimmed);
  if (existing) {
    existing.params = clean;
    return writeFilterPresets(pageKey, list);
  }
  return writeFilterPresets(pageKey, [...list, { name: trimmed, params: clean }]);
}

/** 删除某个筛选预设 */
export function removeFilterPreset(pageKey: string, name: string): FilterPreset[] {
  return writeFilterPresets(
    pageKey,
    listFilterPresets(pageKey).filter((v) => v.name !== name),
  );
}

/** 重命名（新名为空或与其它预设重名时保持不变，由调用方提示） */
export function renameFilterPreset(pageKey: string, oldName: string, newName: string): FilterPreset[] {
  const trimmed = (newName || '').trim();
  const list = listFilterPresets(pageKey);
  const target = list.find((v) => v.name === oldName);
  if (!trimmed || !target) return list;
  if (list.some((v) => v.name !== oldName && v.name === trimmed)) return list;
  target.name = trimmed;
  return writeFilterPresets(pageKey, list);
}
