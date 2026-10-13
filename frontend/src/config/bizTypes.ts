/**
 * 审批业务类型（单据类型 biz_type）→ 中文。
 * 供审批流程管理、我的审批等多处复用（避免各页各自维护映射漂移）。
 * ⚠️ 新增类型必须三处同步：① 本清单 ② 后端 resolveBizAmount（金额条件求值，workflow_service.go）
 * ③ 回归 TestResolveBizAmountConfiguredTypes + 门禁 0.68——缺 ② 时金额条件会静默恒适用（小额免审失效）。
 */
export const BIZ_TYPE_TEXT: Record<string, string> = {
  purchase_order: '采购订单',
  sales_order: '销售订单',
  payment: '付款单',
  receipt: '收款单',
  sales_return: '销售退货',
  purchase_return: '采购退货',
};

/** Select 选项（value=业务类型码，label=中文） */
export const BIZ_TYPE_OPTIONS = Object.entries(BIZ_TYPE_TEXT).map(([value, label]) => ({ value, label }));

/** 业务类型显示名；未知/空返回空串（调用方自行决定占位） */
export function bizTypeLabel(v?: string): string {
  return (v && BIZ_TYPE_TEXT[v]) || v || '';
}
