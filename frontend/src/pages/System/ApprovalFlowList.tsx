import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Plus, Power, Play, Trash2, Pencil, Eye } from 'lucide-react';
import { Modal, Form, Input, Select, Button, InputNumber, Checkbox } from 'antd';
import { message } from '@/utils/appMessage';
import { approvalFlowApi, ApprovalFlow, ApprovalStep } from '@/api/workflow';
import { userApi } from '@/api/system';
import { User } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { RowActions } from '@/components/RowActions';
import { RecordDetailModal } from '@/components/RecordDetailModal';
import { confirmAction } from '@/utils/confirm';
import { BIZ_TYPE_OPTIONS, bizTypeLabel } from '@/config/bizTypes';
import { CONDITION_OPS, buildCondition, conditionLabel, parseCondition } from '@/utils/approvalCondition';
import { useTableView } from '@/hooks/useTableView';
import { usePermission } from '@/hooks/usePermission';

const STATUS_TEXT: Record<string, string> = { draft: '草稿', confirmed: '已确认', approved: '已审核', pending: '待审批', rejected: '已驳回', cancelled: '已取消' };

export function ApprovalFlowList() {
  // [2026-09-18 权限细化] 按钮级门控：新增=approval_flow_create / 编辑·启用停用=approval_flow_edit / 删除=approval_flow_delete
  const { has } = usePermission();
  const [list, setList] = useState<ApprovalFlow[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<ApprovalFlow | null>(null);
  // [易用性] 「查看」只读详情（列表列 + 备注/创建时间/步骤明细）
  const [detail, setDetail] = useState<ApprovalFlow | null>(null);
  const [users, setUsers] = useState<User[]>([]);
  const [form] = Form.useForm();

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      const res = await approvalFlowApi.list();
      if (res.code === 0) setList(res.data ?? []);
    } catch {
      // 静默
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  useEffect(() => {
    userApi.list({ page: 1, page_size: 1000 }).then(res => {
      if (res.code === 0) setUsers(res.data?.list ?? []);
    }).catch((err: any) => console.warn('用户列表加载失败（可能缺 user 权限）:', err?.message || err));
  }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ steps: [{ name: '第一步', approver_type: 'user' }] });
    setModalOpen(true);
  };

  const openEdit = (flow: ApprovalFlow) => {
    setEditing(flow);
    form.resetFields();
    form.setFieldsValue({
      code: flow.code,
      name: flow.name,
      biz_type: flow.biz_type,
      remark: flow.remark,
      // [S-08] 条件字符串 ↔「运算符 + 金额」控件；无法解析的历史值存 cond_raw 保留（不因未编辑而丢失）
      // [顺带修复] 未指定审批人时后端存零 UUID，编辑回填会显示 00000000-... → 归一去重显示占位符
      steps: flow.edges?.steps?.map(s => {
        const c = parseCondition(s.condition);
        const isZeroUuid = !s.approver_id || s.approver_id === '00000000-0000-0000-0000-000000000000';
        return {
          ...s,
          approver_id: isZeroUuid ? undefined : s.approver_id,
          cond_op: c.op || undefined,
          cond_value: c.value,
          cond_raw: c.op ? '' : (s.condition || ''),
        };
      }) ?? [],
    });
    setModalOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    // [审查修复 2026-09-14] 选了运算符却没填金额：不能静默按「无条件」保存（buildCondition 返回 ''，
    // 用户以为配了条件、审批路径却与预期不符；后端只拦「非法格式」，拦不住这种「前端先降级为空」）。
    const rawSteps = (values.steps ?? []) as Array<{ cond_op?: string; cond_value?: number | null }>;
    for (let i = 0; i < rawSteps.length; i++) {
      const s = rawSteps[i];
      if (s.cond_op && (s.cond_value === undefined || s.cond_value === null)) {
        message.error(`第 ${i + 1} 步已选审批条件但未填金额；不需要条件请清空运算符`);
        return;
      }
    }
    const steps = (values.steps ?? []).map((s: Partial<ApprovalStep> & { cond_op?: string; cond_value?: number; cond_raw?: string }, i: number) => ({
      name: s.name || `步骤${i + 1}`,
      approver_type: s.approver_type || 'user',
      approver_id: s.approver_id,
      approver_name: s.approver_name,
      action_type: s.action_type || '',
      timeout_hours: s.timeout_hours || 0,
      is_optional: s.is_optional || false,
      // [S-08] 选中运算符 → 按控件组装；未选但有历史原文（无法解析的脏数据）→ 原样保留；否则视为无条件
      condition: s.cond_op ? buildCondition(s.cond_op, s.cond_value) : (s.cond_raw || ''),
    }));
    try {
      if (editing) {
        const res = await approvalFlowApi.update(editing.id, { name: values.name, remark: values.remark, steps });
        if (res.code !== 0) { message.error(res.message || '保存失败'); return; }
        message.success('流程已更新');
      } else {
        const res = await approvalFlowApi.create({ code: values.code, name: values.name, biz_type: values.biz_type, remark: values.remark, steps });
        if (res.code !== 0) { message.error(res.message || '创建失败'); return; }
        message.success('流程已创建');
      }
      setModalOpen(false);
      fetchList();
    } catch {
      // 校验失败
    }
  };

  const handleActivate = async (flow: ApprovalFlow) => {
    const res = await approvalFlowApi.activate(flow.id);
    if (res.code === 0) { message.success('已激活'); fetchList(); }
    else message.error(res.message || '操作失败');
  };

  const handleDeactivate = async (flow: ApprovalFlow) => {
    const res = await approvalFlowApi.deactivate(flow.id);
    if (res.code === 0) { message.success('已停用'); fetchList(); }
    else message.error(res.message || '操作失败');
  };

  const handleDelete = async (flow: ApprovalFlow) => {
    if (!(await confirmAction({ title: `确定删除流程 ${flow.name} 吗？`, content: '删除后不可恢复', danger: true }))) return;
    const res = await approvalFlowApi.delete(flow.id);
    if (res.code === 0) { message.success('已删除'); fetchList(); }
    else message.error(res.message || '删除失败');
  };

  // [易用性] 列描述符：列表表格与「查看」详情共用同一份（避免两处字段映射不同步）
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (f: ApprovalFlow) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4 whitespace-nowrap';
  const rowCols: RowCol[] = [
    { key: 'name', header: '流程名称', headCls: TH_L, cellCls: `${TD} font-medium text-gray-900`, cell: (f) => f.name },
    { key: 'code', header: '编码', headCls: TH_L, cellCls: `${TD} text-gray-500 text-sm font-mono`, cell: (f) => f.code },
    { key: 'biz_type', header: '业务类型', headCls: TH_L, cellCls: `${TD} text-gray-500 text-sm`, cell: (f) => bizTypeLabel(f.biz_type) },
    { key: 'steps', header: '步骤', headCls: TH_L, cellCls: `${TD} text-gray-500 text-sm`, cell: (f) => `${f.edges?.steps?.length ?? 0} 步` },
    {
      key: 'is_active',
      header: '状态',
      headCls: TH_L,
      cellCls: TD,
      cell: (f) => (
        <span className={`px-2 py-1 rounded-full text-xs font-medium ${f.is_active ? 'bg-green-50 text-green-600' : 'bg-gray-100 text-gray-500'}`}>
          {f.is_active ? '已启用' : '已停用'}
        </span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right`,
      cell: (f) => (
        <RowActions
          actions={[
            // [2026-09-18 权限细化] 编辑·启用停用=approval_flow_edit；删除=approval_flow_delete
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => setDetail(f) },
            ...(has('approval_flow_edit')
              ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openEdit(f) }]
              : []),
            ...(has('approval_flow_edit')
              ? [
                  f.is_active
                    ? { key: 'toggle', label: '停用', icon: <Power className="w-4 h-4" />, onClick: () => handleDeactivate(f) }
                    : { key: 'toggle', label: '启用', icon: <Play className="w-4 h-4" />, onClick: () => handleActivate(f) },
                ]
              : []),
            ...(has('approval_flow_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(f) }]
              : []),
          ]}
        />
      ),
    },
  ];

  // [易用性] 详情补充列：未进列表但详情应可见（详情不受列表裁剪）
  const detailCols: RowCol[] = [
    ...rowCols,
    { key: 'remark', header: '备注', headCls: TH_L, cellCls: `${TD} text-gray-500 text-sm`, cell: (f) => f.remark || '-' },
    { key: 'created_at', header: '创建时间', headCls: TH_L, cellCls: `${TD} text-gray-500 text-sm`, cell: (f) => (f.created_at ? String(f.created_at).replace('T', ' ').slice(0, 16) : '-') },
  ];

  // [易用性] 步骤明细（详情弹窗底部）：审批人与动作在列表里看不到，但看流程图时最需要
  const stepsExtra = (f: ApprovalFlow) => {
    const steps = (f.edges?.steps ?? []).slice().sort((a, b) => (a.step_no || 0) - (b.step_no || 0));
    if (steps.length === 0) return <div className="text-sm text-gray-500">未配置审批步骤</div>;
    const ACTION: Record<string, string> = { approve: '通过', reject: '驳回', return: '退回' };
    return (
      <div>
        <div className="text-xs font-medium text-gray-500 mb-2">审批步骤（{steps.length} 步）</div>
        <ol className="space-y-1">
          {steps.map((s, i) => (
            <li key={s.id || i} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-gray-700">
              <span className="w-5 text-gray-400">{i + 1}</span>
              <span className="font-medium">{s.name || `步骤${i + 1}`}</span>
              <span className="text-gray-500">
                {s.approver_type === 'any'
                  ? '任意有权限者'
                  : users.find((u) => u.id === s.approver_id)?.name || users.find((u) => u.id === s.approver_id)?.username || s.approver_name || '指定审批人'}
              </span>
              {s.condition && (
                <span className="text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded text-xs" title="满足该金额条件时该步才需要审批">
                  {conditionLabel(s.condition)}
                </span>
              )}
              {s.action_type && <span className="text-gray-500">{ACTION[s.action_type] || s.action_type}</span>}
              {!!s.timeout_hours && <span className="text-gray-400">{s.timeout_hours}h 超时</span>}
              {s.is_optional && <span className="text-gray-400">可选</span>}
            </li>
          ))}
        </ol>
      </div>
    );
  };

  // [2026-09-13] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'approval-flow-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="审批流程"
        subtitle="跨部门审批流配置"
        extra={
          has('approval_flow_create') && (
            <button onClick={openCreate} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新增流程</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex items-center justify-end">{viewMenu}</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {visibleColumns.map((c) => <th key={c.key} className={c.headCls}>{c.header}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><EmptyState title="暂无审批流程" description="新增流程后，单据可提交审批" /></td></tr>
              ) : (
                list.map(flow => (
                  <tr key={flow.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => <td key={c.key} className={c.cellCls}>{c.cell(flow)}</td>)}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* [易用性] 只读详情：字段名 : 值 + 底部审批步骤明细 */}
      <RecordDetailModal
        open={!!detail}
        title={detail ? `审批流程详情 · ${detail.name}` : '审批流程详情'}
        record={detail}
        columns={detailCols}
        extra={detail ? stepsExtra(detail) : null}
        onClose={() => setDetail(null)}
      />

      <Modal
        title={editing ? '编辑审批流程' : '新增审批流程'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText="保存"
        cancelText="取消"
        width={680}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {!editing && (
              <Form.Item name="code" label="流程编码" rules={[{ required: true, message: '请输入编码' }]}>
                <Input placeholder="如：PURCHASE_ORDER" autoCapitalize="none" autoCorrect="off" spellCheck={false} />
              </Form.Item>
            )}
            <Form.Item name="name" label="流程名称" rules={[{ required: true, message: '请输入名称' }]}>
              <Input placeholder="如：采购订单审批" />
            </Form.Item>
            {!editing && (
              <Form.Item name="biz_type" label="业务类型" rules={[{ required: true, message: '请选择业务类型' }]}>
                <Select options={BIZ_TYPE_OPTIONS} placeholder="请选择业务类型" />
              </Form.Item>
            )}
            <Form.Item name="remark" label="备注">
              <Input placeholder="可选" />
            </Form.Item>
          </div>

          <Form.Item label="审批步骤" required>
            <Form.List name="steps">
              {(fields, { add, remove }) => (
                <div className="space-y-2">
                  {fields.map((field, index) => (
                    <div key={field.key} className="flex flex-wrap items-start gap-2 p-3 bg-gray-50 rounded-lg">
                      <span className="mt-2 text-sm text-gray-400 flex-shrink-0 w-6">{index + 1}</span>
                      <Form.Item name={[field.name, 'name']} className="flex-1 mb-0">
                        <Input placeholder="步骤名称" />
                      </Form.Item>
                      <Form.Item name={[field.name, 'approver_type']} className="w-32 mb-0">
                        <Select
                          options={[
                            { value: 'user', label: '指定审批人' },
                            { value: 'any', label: '任意有权限者' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item noStyle shouldUpdate>
                        {() => {
                          // 不能在此处使用 hook（Form.useWatch），改为读取当前值（shouldUpdate 保证随字段变化重渲染）
                          const values = form.getFieldsValue(true);
                          const type = values.steps?.[field.name]?.approver_type || 'user';
                          if (type === 'any') {
                            return <div className="w-48" />;
                          }
                          return (
                            <Form.Item name={[field.name, 'approver_id']} className="w-48 mb-0">
                              <Select
                                showSearch
                                optionFilterProp="label"
                                placeholder="请选择审批人"
                                options={users.map(u => ({ value: u.id, label: `${u.name || u.username}` }))}
                              />
                            </Form.Item>
                          );
                        }}
                      </Form.Item>
                      {/* [S-08] 金额阈值条件：仅当单据总额满足时该步才需要审批（留空 = 无条件） */}
                      <Form.Item name={[field.name, 'cond_op']} className="w-32 mb-0">
                        <Select
                          allowClear
                          placeholder="审批条件"
                          title="仅当单据总额满足条件时该步才需要审批；留空 = 无条件"
                          options={CONDITION_OPS.map(o => ({ value: o.value, label: o.label }))}
                        />
                      </Form.Item>
                      <Form.Item noStyle shouldUpdate>
                        {() => {
                          const values = form.getFieldsValue(true);
                          if (!values.steps?.[field.name]?.cond_op) return <div className="w-24" />;
                          return (
                            <Form.Item name={[field.name, 'cond_value']} className="w-28 mb-0">
                              <InputNumber min={0} placeholder="金额" style={{ width: '100%' }} />
                            </Form.Item>
                          );
                        }}
                      </Form.Item>
                      <Form.Item name={[field.name, 'action_type']} className="w-24 mb-0">
                        <Select
                          allowClear
                          placeholder="动作"
                          options={[
                            { value: 'approve', label: '通过' },
                            { value: 'reject', label: '驳回' },
                            { value: 'return', label: '退回' },
                          ]}
                        />
                      </Form.Item>
                      <Form.Item name={[field.name, 'timeout_hours']} className="w-20 mb-0">
                        <InputNumber min={0} placeholder="超时h" style={{ width: '100%' }} />
                      </Form.Item>
                      <Form.Item name={[field.name, 'is_optional']} valuePropName="checked" className="mb-0 mt-1">
                        <Checkbox>可选</Checkbox>
                      </Form.Item>
                      <button type="button" onClick={() => remove(field.name)} className="p-2 text-red-400 hover:text-red-600 mt-1">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                  <Button type="dashed" block icon={<Plus className="w-4 h-4" />} onClick={() => add({ name: `步骤${fields.length + 1}`, approver_type: 'user' })}>
                    添加步骤
                  </Button>
                  <p className="text-xs text-gray-400">审批条件为金额阈值（如「金额 ≥ 10000」）：仅当单据总额满足时该步才需要审批；金额不支持的单据类型按「无条件」处理。留空 = 该步始终需要审批。</p>
                </div>
              )}
            </Form.List>
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
