import { useCallback, useEffect, useState } from 'react';
import { Check, X, Clock } from 'lucide-react';
import { Modal, Input, Button } from 'antd';
import { message } from '@/utils/appMessage';
import { approvalRecordApi, ApprovalRecord } from '@/api/workflow';
import { useAuthStore } from '@/store/auth';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { bizTypeLabel } from '@/config/bizTypes';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';

const STATUS_TEXT: Record<string, string> = {
  pending: '待审批',
  approved: '已通过',
  rejected: '已驳回',
};

const STATUS_COLOR: Record<string, string> = {
  pending: 'bg-orange-50 text-orange-600',
  approved: 'bg-green-50 text-green-600',
  rejected: 'bg-red-50 text-red-600',
};

type TabKey = 'todo' | 'mine' | 'all';

export function ApprovalTasks() {
  const { user } = useAuthStore();
  const [tab, setTab] = useState<TabKey>('todo');
  const [list, setList] = useState<ApprovalRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionTarget, setActionTarget] = useState<ApprovalRecord | null>(null);
  const [actionType, setActionType] = useState<'approve' | 'reject'>('approve');
  const [remark, setRemark] = useState('');
  // 请求竞态守卫：页签（待我审批/我发起的/全部）快速切换时丢弃过期响应，防止列表串台
  const { nextSeq, isCurrent } = useRequestGuard();

  const meId = user?.id || user?.ID || '';

  const fetchList = useCallback(async () => {
    if (!meId) return;
    const seq = nextSeq(); // [竞态守卫] 本次请求序号
    setLoading(true);
    try {
      let res;
      if (tab === 'todo') {
        res = await approvalRecordApi.list({ approver_id: meId, status: 'pending' });
      } else if (tab === 'mine') {
        res = await approvalRecordApi.list({ initiator_id: meId });
      } else {
        res = await approvalRecordApi.list({});
      }
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setList(res.data ?? []);
      }
    } catch {
      // 静默
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  }, [tab, meId, nextSeq, isCurrent]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const openAction = (record: ApprovalRecord, type: 'approve' | 'reject') => {
    setActionTarget(record);
    setActionType(type);
    setRemark('');
  };

  const handleAction = async () => {
    if (!actionTarget) return;
    try {
      const data = { biz_type: actionTarget.biz_type, biz_id: actionTarget.biz_id, approver_id: meId, remark };
      const res = actionType === 'approve'
        ? await approvalRecordApi.approve(data)
        : await approvalRecordApi.reject(data);
      if (res.code !== 0) {
        message.error(res.message || '操作失败');
        return;
      }
      message.success(actionType === 'approve' ? '已通过' : '已驳回');
      setActionTarget(null);
      fetchList();
    } catch (err) {
message.error(err instanceof Error && err.message ? err.message : '操作失败，请稍后重试');
    }
  };

  // [2026-09-13] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: ApprovalRecord) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'biz_no', header: '单号', cellCls: `${TD} font-medium text-gray-900`, cell: (record) => <span>{record.biz_no}</span> },
    { key: 'biz_type', header: '业务类型', cellCls: `${TD} text-gray-500 text-sm`, cell: (record) => <span>{bizTypeLabel(record.biz_type)}</span> },
    { key: 'initiator_name', header: '发起人', cellCls: `${TD} text-gray-500 text-sm`, cell: (record) => <span>{record.initiator_name}</span> },
    { key: 'flow_code', header: '流程', cellCls: `${TD} text-gray-500 text-sm`, cell: (record) => <span>{record.flow_code}</span> },
    {
      key: 'current_status',
      header: '状态',
      cell: (record) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLOR[record.current_status] || 'bg-gray-100 text-gray-600'}`}>
          {STATUS_TEXT[record.current_status] || record.current_status}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (record) =>
        record.current_status === 'pending' ? (
          <div className="flex items-center justify-end gap-1">
            <button onClick={() => openAction(record, 'approve')} className="p-1.5 text-green-600 hover:bg-green-50 rounded-lg transition-colors" title="通过">
              <Check className="w-4 h-4" />
            </button>
            <button onClick={() => openAction(record, 'reject')} className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="驳回">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <span className="text-xs text-gray-400 flex items-center justify-end gap-1">
            <Clock className="w-3.5 h-3.5" /> 已处理
          </span>
        ),
    },
  ];
  // [2026-09-13] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'approval-tasks',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="我的审批"
        subtitle="跨部门审批待办中心"
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-2">
          {([
            ['todo', '待我审批'],
            ['mine', '我发起的'],
            ['all', '全部记录'],
          ] as [TabKey, string][]).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`px-3 py-1.5 rounded-lg text-sm transition-colors ${tab === key ? 'bg-blue-50 text-blue-600 font-medium' : 'text-gray-500 hover:bg-gray-50'}`}
            >
              {label}
            </button>
          ))}
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
              ) : list.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><EmptyState title="暂无审批记录" description={tab === 'todo' ? '当前没有待您审批的单据' : '暂无记录'} /></td></tr>
              ) : (
                list.map(record => (
                  <tr key={record.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(record)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <Modal
        title={actionType === 'approve' ? '通过审批' : '驳回审批'}
        open={!!actionTarget}
        onCancel={() => setActionTarget(null)}
        onOk={handleAction}
        okText={actionType === 'approve' ? '通过' : '驳回'}
        okButtonProps={{ danger: actionType === 'reject' }}
        cancelText="取消"
        destroyOnHidden
      >
        <p className="text-sm text-gray-600 mb-4">
          单号：<span className="font-medium">{actionTarget?.biz_no}</span>（{bizTypeLabel(actionTarget?.biz_type)}）
        </p>
        <Input.TextArea
          placeholder="审批意见（可选）"
          value={remark}
          onChange={e => setRemark(e.target.value)}
          rows={3}
        />
      </Modal>
    </div>
  );
}
