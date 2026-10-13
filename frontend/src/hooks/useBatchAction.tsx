import { useCallback, useState } from 'react';
import type { ReactNode } from 'react';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { downloadCSV } from '@/utils/export';
import { BatchActionBar, type BatchActionBarItem } from '@/components/BatchActionBar';
import type { RowSelection } from '@/hooks/useRowSelection';

/**
 * 批量操作（U-05 2026-09-13）——**逐条执行 + 失败原因汇总**。
 *
 * 为什么逐条（不是批量接口）：
 *  - 现存业务动作（确认/审核/过账/发货/完成盘点）各自带状态机校验与库存/财务联动，
 *    逐条调用既有接口 = 每条都走完整校验，且失败只影响那一条（不会"一锅端"）。
 *  - 每条失败都保留后端返回的中文原因（如"库存不足""单据状态不允许"），汇总弹窗逐条展示。
 *
 * 用法（页面 3 行）：
 * ```tsx
 * const sel = useRowSelection({ rows: list, getKey: (d) => d.id! });
 * const batch = useBatchAction({ selection: sel, label: (d) => d.order_no, actions: [...], exportSpec: {...}, onDone: fetchList });
 * // 工具条：{sel.count > 0 && <div>{batch.bar}</div>}；失败汇总弹窗：{batch.failureModal}（**不要**放进 count>0 条件里！）
 * // 勾选列：{ key: '__sel', ... } + locked.leading
 * ```
 *
 * ⚠️ 为什么 failureModal 必须单独返回（2026-09-13 实测缺陷）：工具条只在"有勾选"时渲染，
 * 批量跑完会清空选择 → 若失败弹窗挂在工具条里，会在同一帧被卸载，用户根本看不到失败原因。
 */
export interface BatchActionSpec<T> {
  key: string;
  label: string;
  icon?: ReactNode;
  danger?: boolean;
  /** 哪些勾选行适用于本动作（不传 = 全部适用） */
  eligible?: (row: T) => boolean;
  /** 逐条执行（返回统一响应 { code, message }） */
  run: (row: T) => Promise<{ code?: number; message?: string } | any>;
  /** 二次确认（破坏性/涉账动作建议传） */
  confirm?: (rows: T[]) => { title: string; content?: string; danger?: boolean };
}

export interface BatchFailure {
  label: string;
  reason: string;
}

export function useBatchAction<T>({
  selection,
  label,
  actions,
  exportSpec,
  onDone,
}: {
  selection: RowSelection<T>;
  /** 行标题（失败明细里显示，如单号） */
  label: (row: T) => string;
  actions: BatchActionSpec<T>[];
  /** 导出选中：列名 + 取值（走 utils/export 的 downloadCSV，含权限校验与公式注入防护） */
  exportSpec?: { filename: string; headers: string[]; row: (row: T) => Array<string | number | null | undefined> };
  /** 全部执行完（无论成功失败）后回调，通常传 fetchList */
  onDone?: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<BatchFailure[] | null>(null);
  const [failureTitle, setFailureTitle] = useState('');

  const runAction = useCallback(
    async (spec: BatchActionSpec<T>) => {
      if (busy) return;
      const targets = spec.eligible ? selection.selectedRows.filter(spec.eligible) : selection.selectedRows;
      if (targets.length === 0) {
        message.warning('勾选的行中没有可执行此操作的记录');
        return;
      }
      if (spec.confirm) {
        const ok = await confirmAction({
          title: spec.confirm(targets).title,
          content: spec.confirm(targets).content,
          danger: spec.confirm(targets).danger,
        });
        if (!ok) return;
      }
      setBusy(true);
      const failed: BatchFailure[] = [];
      let ok_count = 0;
      for (const row of targets) {
        try {
          const res = await spec.run(row);
          if (res && res.code === 0) ok_count += 1;
          else failed.push({ label: label(row), reason: res?.message || '操作失败' });
        } catch (e: any) {
          failed.push({ label: label(row), reason: e?.message || '请求失败' });
        }
      }
      setBusy(false);
      if (failed.length === 0) {
        selection.clear();
        message.success(`${spec.label}：成功 ${ok_count} 条`);
      } else {
        // 有失败时**保留勾选**：用户可按弹窗提示补处理后再点一次，不用重新勾选。
        message.warning(`${spec.label}：成功 ${ok_count} 条，失败 ${failed.length} 条`);
        setFailureTitle(spec.label);
        setFailures(failed);
      }
      await onDone?.();
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [busy, selection.ids, selection.selectedRows, label, onDone],
  );

  const items: BatchActionBarItem[] = actions.map((spec) => {
    const eligibleCount = spec.eligible
      ? selection.selectedRows.filter(spec.eligible).length
      : selection.selectedRows.length;
    return {
      key: spec.key,
      label: spec.label,
      icon: spec.icon,
      danger: spec.danger,
      count: eligibleCount,
      onClick: () => void runAction(spec),
    };
  });

  const bar = (
    <BatchActionBar
      count={selection.count}
      actions={items}
      busy={busy}
      onClear={selection.clear}
      onExport={exportSpec ? () => downloadCSV(exportSpec.filename, exportSpec.headers, selection.selectedRows.map(exportSpec.row)) : undefined}
    />
  );

  // 失败汇总弹窗独立于工具条返回（工具条会随选择清空卸载，弹窗不能跟着消失）
  const failureModal = (
    <Modal
      open={!!failures}
      title={`${failureTitle}：${failures?.length ?? 0} 条失败`}
      onCancel={() => setFailures(null)}
      onOk={() => setFailures(null)}
      okText="知道了"
      cancelButtonProps={{ style: { display: 'none' } }}
      width={640}
    >
      <p className="text-sm text-gray-500 mb-3">
        以下记录未执行成功（其余已成功，未做任何回滚——请按提示处理后重试这几条）：
      </p>
      <div className="max-h-80 overflow-y-auto border border-gray-100 rounded-lg">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-gray-500">
              <th className="px-3 py-2 text-left font-medium">记录</th>
              <th className="px-3 py-2 text-left font-medium">失败原因</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {(failures ?? []).map((f, i) => (
              <tr key={`${f.label}-${i}`}>
                <td className="px-3 py-2 text-gray-900 whitespace-nowrap">{f.label}</td>
                <td className="px-3 py-2 text-red-600">{f.reason}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Modal>
  );

  return { bar, failureModal, busy, runAction };
}
