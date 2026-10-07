/**
 * 下拉/选项加载失败隔离（2026-09-14「新建入库不显示仓库列表」修复后的全站统一模式）。
 *
 * 背景：开单/表单页面常并发加载多个下拉数据源（仓库、商品、来源单、库位…）。
 * 此前用 `Promise.all` —— 任一项失败（典型：当前角色缺某模块权限 → 403）即整体 reject，
 * 导致**所有**下拉置空（即使其它接口全部成功），用户表现为「档案明明建好但下拉没有」。
 *
 * 用法：
 *   const [whRes, productRes] = await loadOptions([
 *     warehouseApi.list({ page: 1, page_size: 1000 }),
 *     productApi.list({ page: 1, page_size: 1000, status: 'active' }),
 *   ], '入库单');
 *   if (whRes?.code === 0) setWarehouses(whRes.data.list);
 *   if (productRes?.code === 0) setProducts(productRes.data.list);
 *
 * 行为：等价 `Promise.allSettled` —— 单项失败只影响自己（返回 undefined）并在控制台留痕，
 * 其余数据源正常返回。**禁止再用 `Promise.all` 加载下拉选项**（打包门禁 0.69 拦截）。
 */
export async function loadOptions<T extends readonly Promise<unknown>[]>(
  tasks: [...T],
  label = '选项',
): Promise<{ [K in keyof T]: Awaited<T[K]> | undefined }> {
  const settled = await Promise.allSettled(tasks);
  return settled.map((r, i) => {
    if (r.status === 'fulfilled') return r.value as Awaited<T[number]>;
    const reason: any = r.reason;
    console.warn(
      `[loadOptions] ${label} 第 ${i + 1} 项加载失败（可能缺模块权限，该项下拉为空，不影响其它）:`,
      reason?.message || reason,
    );
    return undefined;
  }) as { [K in keyof T]: Awaited<T[K]> | undefined };
}
