import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, FileSignature, Ban } from 'lucide-react';
import { Modal, Input, Select } from 'antd';
import { message } from '@/utils/appMessage';
import {
  laborContractApi,
  employeeApi,
  LaborContract,
  Employee,
  CONTRACT_TYPE_TEXT,
  contractDisplayStatus,
} from '@/api/hr';
import { format, toLocalDateISO } from '@/utils/format';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { Pagination } from '@/components/Pagination';
import { SearchSelect } from '@/components/SearchSelect';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { confirmAction } from '@/utils/confirm';
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';

/**
 * 劳动合同（人事管理，2026-09-19）
 *
 * 状态：生效中 / 已到期 / 已终止 / 已续签（由日期与续签链推导，不落库）；
 * 30 天内到期 → 每日提醒管理层（定时任务）；续签生成新合同并保留续签链。
 */

const emptyForm: any = {
  employee_id: undefined as string | undefined,
  contract_type: 'fixed',
  start_date: format.today(),
  end_date: '',
  sign_date: '',
  probation_months: 0,
  previous_contract_id: undefined as string | undefined,
  remark: '',
};

const dateStr = (v?: string | null) => (v ? String(v).slice(0, 10) : '');

export function ContractList() {
  const { has } = usePermission();
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({
    page: 1,
    page_size: 10,
    keyword: '',
    status: '',
    expiring: '',
  });
  const [list, setList] = useState<LaborContract[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState(String(urlFilters.keyword || ''));
  const [applied, setApplied] = useState(String(urlFilters.keyword || ''));
  const [status, setStatus] = useState(String(urlFilters.status || ''));
  const [expiring, setExpiring] = useState(String(urlFilters.expiring || ''));
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [employees, setEmployees] = useState<Employee[]>([]);

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState('');
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [terminateTarget, setTerminateTarget] = useState<LaborContract | null>(null);
  const [terminateForm, setTerminateForm] = useState({ date: format.today(), reason: '' });

  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    syncUrl({ keyword: applied, status, expiring, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, status, expiring, pagination.page, pagination.page_size]);

  const fetchEmployees = useCallback(async () => {
    try {
      const res = await employeeApi.list({ page: 1, page_size: 200 });
      if (res.code === 0) setEmployees(res.data?.list ?? []);
    } catch {
      /* 下拉加载失败：表单里仍可用手工输入员工ID 的场景不存在，留空提示重开 */
    }
  }, []);

  useEffect(() => {
    fetchEmployees();
  }, [fetchEmployees]);

  const employeeOptions = useMemo(
    () =>
      employees
        .filter((e) => e.status !== 'left')
        .map((e) => ({ value: e.id, label: `${e.name}（${e.code}）`, search: `${e.code} ${e.name}` })),
    [employees],
  );

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      const res = await laborContractApi.list({
        page: pagination.page,
        page_size: pagination.page_size,
        keyword: applied || undefined,
        status: status || undefined,
        expiring_days: expiring === '30' ? 30 : undefined,
      });
      if (res.code === 0) {
        if (!isCurrent(seq)) return;
        setList(res.data?.list ?? []);
        setPagination((p) => ({ ...p, total: res.data?.total ?? 0 }));
      }
    } catch {
      /* 拦截器已提示 */
    } finally {
      if (isCurrent(seq)) setLoading(false);
    }
  }, [pagination.page, pagination.page_size, applied, status, expiring, nextSeq, isCurrent]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const openCreate = (prefill?: Partial<LaborContract>) => {
    setEditId('');
    setForm({
      ...emptyForm,
      employee_id: prefill?.employee_id,
      contract_type: prefill?.contract_type || 'fixed',
      previous_contract_id: prefill?.previous_contract_id,
      start_date: format.today(),
    });
    setOpen(true);
  };

  const openRenew = (c: LaborContract) => {
    openCreate({ employee_id: c.employee_id, contract_type: c.contract_type, previous_contract_id: c.id });
  };

  const openEdit = (c: LaborContract) => {
    setEditId(c.id);
    setForm({
      employee_id: c.employee_id,
      contract_type: c.contract_type,
      start_date: dateStr(c.start_date),
      end_date: dateStr(c.end_date),
      sign_date: dateStr(c.sign_date),
      probation_months: c.probation_months || 0,
      previous_contract_id: c.previous_contract_id || undefined,
      remark: c.remark || '',
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.employee_id) {
      message.warning('请选择员工');
      return;
    }
    if (!form.start_date) {
      message.warning('请填写合同开始日期');
      return;
    }
    if (form.contract_type !== 'open' && !form.end_date) {
      message.warning('请填写合同结束日期（无固定期限合同请把类型改为「无固定期限」）');
      return;
    }
    setSaving(true);
    try {
      const data: any = {
        contract_type: form.contract_type,
        start_date: form.start_date ? toLocalDateISO(form.start_date) : undefined,
        end_date: form.contract_type === 'open' ? null : form.end_date ? toLocalDateISO(form.end_date) : null,
        sign_date: form.sign_date ? toLocalDateISO(form.sign_date) : undefined,
        probation_months: Number(form.probation_months || 0),
        remark: form.remark.trim() || undefined,
      };
      let res;
      if (editId) {
        res = await laborContractApi.update(editId, data);
      } else {
        res = await laborContractApi.create({
          ...data,
          employee_id: form.employee_id,
          previous_contract_id: form.previous_contract_id || undefined,
        });
      }
      if (res.code === 0) {
        message.success(editId ? '已更新' : '已创建');
        setOpen(false);
        fetchList();
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (e: any) {
      message.error(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const handleTerminate = async () => {
    if (!terminateTarget) return;
    try {
      const res = await laborContractApi.terminate(terminateTarget.id, {
        date: terminateForm.date ? toLocalDateISO(terminateForm.date) : undefined,
        reason: terminateForm.reason.trim() || undefined,
      });
      if (res.code === 0) {
        message.success('合同已终止');
        setTerminateTarget(null);
        fetchList();
      } else {
        message.error(res.message || '操作失败');
      }
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  };

  const handleDelete = async (c: LaborContract) => {
    const ok = await confirmAction({
      title: `删除合同「${c.code}」？`,
      content: '仅已终止/已到期的合同可删除；删除后该记录不再出现在列表与到期提醒中。',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await laborContractApi.remove(c.id);
      if (res.code === 0) {
        message.success('已删除');
        fetchList();
      } else {
        message.error(res.message || '删除失败');
      }
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  const labelCls = 'block text-sm text-gray-600 mb-1';
  const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40';
  const TH = 'px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';

  const canDelete = (c: LaborContract) => {
    if (c.status !== 'active') return true;
    if (!c.end_date) return false;
    const end = new Date(c.end_date);
    end.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return end.getTime() < today.getTime();
  };

  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: LaborContract) => ReactNode;
  }
  const rowCols: RowCol[] = [
    { key: 'code', header: '合同编号', cell: (c) => <span className="font-mono text-xs text-gray-600">{c.code}</span> },
    { key: 'employee', header: '员工', cell: (c) => <span className="font-medium text-gray-900">{c.edges?.employee?.name || '-'}</span> },
    { key: 'contract_type', header: '类型', cell: (c) => <span className="text-gray-600">{CONTRACT_TYPE_TEXT[c.contract_type] || c.contract_type}</span> },
    { key: 'start_date', header: '开始日期', cell: (c) => <span className="text-gray-600">{dateStr(c.start_date) || '-'}</span> },
    { key: 'end_date', header: '结束日期', cell: (c) => <span className="text-gray-600">{c.end_date ? dateStr(c.end_date) : '无固定期限'}</span> },
    { key: 'probation_months', header: '试用期', cell: (c) => <span className="text-gray-600">{c.probation_months ? `${c.probation_months} 个月` : '-'}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (c) => {
        const s = contractDisplayStatus(c, list);
        return <span className={`px-2 py-0.5 rounded text-xs ${s.cls}`}>{s.text}</span>;
      },
    },
    {
      key: '__actions',
      header: '操作',
      cellCls: `${TD} whitespace-nowrap`,
      cell: (c) => (
        <RowActions
          actions={[
            ...(has('labor_contract_edit') && c.status === 'active'
              ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openEdit(c) }]
              : []),
            ...(has('labor_contract_create') && c.status === 'active'
              ? [{ key: 'renew', label: '续签', icon: <FileSignature className="w-4 h-4" />, onClick: () => openRenew(c) }]
              : []),
            ...(has('labor_contract_edit') && c.status === 'active'
              ? [
                  {
                    key: 'terminate',
                    label: '终止',
                    icon: <Ban className="w-4 h-4" />,
                    danger: true,
                    onClick: () => {
                      setTerminateForm({ date: format.today(), reason: '' });
                      setTerminateTarget(c);
                    },
                  },
                ]
              : []),
            ...(has('labor_contract_delete') && canDelete(c)
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(c) }]
              : []),
          ]}
        />
      ),
    },
  ];

  const statusFilterNote = [
    status ? `状态：${status === 'active' ? '生效中' : '已终止'}` : '',
    expiring === '30' ? '30 天内到期' : '',
  ]
    .filter(Boolean)
    .join('；');

  return (
    <div className="space-y-6">
      <PageHeader
        title="劳动合同"
        subtitle="合同起止、试用期与续签链；30 天内到期自动提醒（每日巡检），已终止合同保留历史"
        extra={
          <div className="flex items-center gap-2">
            <button onClick={fetchList} className="btn-secondary flex items-center gap-1.5">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">刷新</span>
            </button>
            {has('labor_contract_create') && (
              <button onClick={() => openCreate()} className="btn-primary flex items-center gap-2">
                <Plus className="w-5 h-5" />
                <span className="hidden md:inline">新增合同</span>
              </button>
            )}
          </div>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <Input.Search
            allowClear
            placeholder="搜索合同编号 / 员工姓名"
            defaultValue={keyword}
            style={{ maxWidth: 280 }}
            onSearch={(v) => {
              setPagination((p) => ({ ...p, page: 1 }));
              setApplied(v.trim());
            }}
            onChange={(e) => {
              if (!e.target.value) {
                setPagination((p) => ({ ...p, page: 1 }));
                setApplied('');
              }
            }}
          />
          <Select
            value={status || undefined}
            onChange={(v) => {
              setPagination((p) => ({ ...p, page: 1 }));
              setStatus(v || '');
            }}
            allowClear
            placeholder="全部状态"
            style={{ width: 130 }}
            options={[
              { value: 'active', label: '生效中' },
              { value: 'terminated', label: '已终止' },
            ]}
          />
          <Select
            value={expiring || undefined}
            onChange={(v) => {
              setPagination((p) => ({ ...p, page: 1 }));
              setExpiring(v || '');
            }}
            allowClear
            placeholder="到期筛选"
            style={{ width: 150 }}
            options={[{ value: '30', label: '30 天内到期' }]}
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {rowCols.map((c) => (
                  <th key={c.key} className={c.headCls || TH}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr>
                  <td colSpan={rowCols.length} className="px-6 py-4">
                    <TableSkeleton rows={4} />
                  </td>
                </tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={rowCols.length} className="px-6">
                    <ListEmpty
                      keyword={applied}
                      filterNote={statusFilterNote}
                      onClear={() => {
                        setKeyword('');
                        setApplied('');
                        setStatus('');
                        setExpiring('');
                        setPagination((p) => ({ ...p, page: 1 }));
                      }}
                      title="还没有劳动合同"
                      description="先在「员工档案」建档，再点右上角「新增合同」录入合同起止与试用期"
                    />
                  </td>
                </tr>
              ) : (
                list.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                    {rowCols.map((col) => (
                      <td key={col.key} className={col.cellCls || TD}>
                        {col.cell(c)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-100">
          <Pagination
            page={pagination.page}
            pageSize={pagination.page_size}
            total={pagination.total}
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))}
            loading={loading}
            onPageSizeChange={(size) => setPagination((prev) => ({ ...prev, page: 1, page_size: size }))}
          />
        </div>
      </div>

      <Modal
        title={editId ? '编辑合同' : '新增合同'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={640}
      >
        <div className="space-y-4 py-2">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>员工 *</label>
              <SearchSelect
                value={form.employee_id}
                onChange={(v: string) => setForm({ ...form, employee_id: v || undefined })}
                placeholder="请选择员工"
                options={employeeOptions}
                disabled={!!editId}
              />
            </div>
            <div>
              <label className={labelCls}>合同类型 *</label>
              <Select
                value={form.contract_type}
                onChange={(v) => setForm({ ...form, contract_type: v })}
                style={{ width: '100%' }}
                options={[
                  { value: 'fixed', label: '固定期限' },
                  { value: 'open', label: '无固定期限（结束日期留空）' },
                  { value: 'internship', label: '实习' },
                  { value: 'dispatch', label: '劳务派遣' },
                ]}
              />
            </div>
            <div>
              <label className={labelCls}>开始日期 *</label>
              <input type="date" value={form.start_date} onChange={(e) => setForm({ ...form, start_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>结束日期{form.contract_type === 'open' ? '（无固定期限不需要）' : ' *'}</label>
              <input
                type="date"
                value={form.end_date}
                onChange={(e) => setForm({ ...form, end_date: e.target.value })}
                className={`${inputCls} disabled:bg-gray-50 disabled:text-gray-400`}
                disabled={form.contract_type === 'open'}
              />
            </div>
            <div>
              <label className={labelCls}>签订日期</label>
              <input type="date" value={form.sign_date} onChange={(e) => setForm({ ...form, sign_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>试用期（月）</label>
              <input
                type="text"
                inputMode="numeric"
                value={String(form.probation_months ?? 0)}
                onChange={(e) => setForm({ ...form, probation_months: e.target.value.replace(/[^0-9]/g, '') })}
                className={inputCls}
                placeholder="0"
              />
            </div>
          </div>
          <div>
            <label className={labelCls}>备注</label>
            <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} className={inputCls} />
          </div>
          {form.previous_contract_id && (
            <div className="text-xs text-blue-600 bg-blue-50 rounded px-3 py-2">本单为「续签」：将关联并保留上一份合同记录。</div>
          )}
        </div>
      </Modal>

      <Modal
        title={`终止合同「${terminateTarget?.code || ''}」`}
        open={!!terminateTarget}
        onCancel={() => setTerminateTarget(null)}
        onOk={handleTerminate}
        okText="确认终止"
        okButtonProps={{ danger: true }}
        cancelText="取消"
        width={480}
      >
        <div className="space-y-4 py-2">
          <div>
            <label className={labelCls}>终止日期</label>
            <input
              type="date"
              value={terminateForm.date}
              onChange={(e) => setTerminateForm({ ...terminateForm, date: e.target.value })}
              className={inputCls}
            />
          </div>
          <div>
            <label className={labelCls}>终止原因（选填）</label>
            <Input.TextArea
              rows={2}
              value={terminateForm.reason}
              onChange={(e) => setTerminateForm({ ...terminateForm, reason: e.target.value })}
              placeholder="如：合同期满不再续签 / 双方协商解除"
            />
          </div>
          <div className="text-xs text-gray-400">终止后合同保留为历史记录；如需恢复请联系管理员在数据库中处理。</div>
        </div>
      </Modal>
    </div>
  );
}
