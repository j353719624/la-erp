import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, Eye } from 'lucide-react';
import { Modal, Input, Select } from 'antd';
import { message } from '@/utils/appMessage';
import { employeeApi, Employee, EMPLOYEE_STATUS_TEXT, EMPLOYMENT_TYPE_TEXT } from '@/api/hr';
import { departmentApi } from '@/api/system';
import type { Department } from '@/types';
import { format, toLocalDateISO } from '@/utils/format';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { RecordDetailModal } from '@/components/RecordDetailModal';
import { Pagination } from '@/components/Pagination';
import { SearchSelect } from '@/components/SearchSelect';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { confirmAction } from '@/utils/confirm';
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';

/**
 * 员工档案（人事管理，2026-09-19）
 *
 * 公司全员的人事主数据（与「系统 → 用户管理」的登录账号分离）：
 * 工号自动生成（EMP+日期+流水）、部门/岗位、入转离、劳动合同引用保护（有合同不可删）。
 */

const emptyForm: any = {
  code: '',
  name: '',
  gender: '',
  id_card: '',
  birth_date: '',
  phone: '',
  email: '',
  address: '',
  education: '',
  department_id: undefined as string | undefined,
  position: '',
  employment_type: 'full_time',
  status: 'probation',
  hire_date: format.today(),
  probation_end_date: '',
  regular_date: '',
  base_salary: '',
  bank_name: '',
  bank_account: '',
  emergency_contact: '',
  emergency_phone: '',
  remark: '',
};

const dateStr = (v?: string | null) => (v ? String(v).slice(0, 10) : '');

export function EmployeeList() {
  const { has } = usePermission();
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ page: 1, page_size: 10, keyword: '', status: '' });
  const [list, setList] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState(String(urlFilters.keyword || ''));
  const [applied, setApplied] = useState(String(urlFilters.keyword || ''));
  const [status, setStatus] = useState(String(urlFilters.status || ''));
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [depts, setDepts] = useState<Department[]>([]);

  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<Employee | null>(null);
  const [editId, setEditId] = useState('');
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);

  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    syncUrl({ keyword: applied, status, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, status, pagination.page, pagination.page_size]);

  useEffect(() => {
    departmentApi
      .listAll()
      .then((res) => {
        if (res.code === 0) setDepts(res.data ?? []);
      })
      .catch(() => {
        /* 部门列表加载失败不阻塞员工列表（下拉降级为空，仍可保存） */
      });
  }, []);

  const deptName = useMemo(() => {
    const m = new Map<string, string>();
    depts.forEach((d) => m.set(d.id, d.name));
    return m;
  }, [depts]);

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      const res = await employeeApi.list({
        page: pagination.page,
        page_size: pagination.page_size,
        keyword: applied || undefined,
        status: status || undefined,
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
  }, [pagination.page, pagination.page_size, applied, status, nextSeq, isCurrent]);

  useEffect(() => {
    fetchList();
  }, [fetchList]);

  const openCreate = () => {
    setEditId('');
    setForm({ ...emptyForm });
    setOpen(true);
  };

  const openEdit = (e: Employee) => {
    setEditId(e.id);
    setForm({
      code: e.code || '',
      name: e.name || '',
      gender: e.gender || '',
      id_card: e.id_card || '',
      birth_date: dateStr(e.birth_date),
      phone: e.phone || '',
      email: e.email || '',
      address: e.address || '',
      education: e.education || '',
      department_id: e.department_id || undefined,
      position: e.position || '',
      employment_type: e.employment_type || 'full_time',
      status: e.status || 'probation',
      hire_date: dateStr(e.hire_date),
      probation_end_date: dateStr(e.probation_end_date),
      regular_date: dateStr(e.regular_date),
      base_salary: e.base_salary != null ? String(Number(e.base_salary)) : '',
      bank_name: e.bank_name || '',
      bank_account: e.bank_account || '',
      emergency_contact: e.emergency_contact || '',
      emergency_phone: e.emergency_phone || '',
      remark: e.remark || '',
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      message.warning('请填写员工姓名');
      return;
    }
    setSaving(true);
    try {
      const data: any = {
        name: form.name.trim(),
        gender: form.gender || undefined,
        id_card: form.id_card.trim() || undefined,
        birth_date: toLocalDateISO(form.birth_date),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        address: form.address.trim() || undefined,
        education: form.education.trim() || undefined,
        department_id: form.department_id || null,
        position: form.position.trim() || undefined,
        employment_type: form.employment_type,
        status: form.status,
        hire_date: toLocalDateISO(form.hire_date),
        probation_end_date: toLocalDateISO(form.probation_end_date),
        regular_date: toLocalDateISO(form.regular_date),
        base_salary: form.base_salary === '' ? undefined : Number(form.base_salary),
        bank_name: form.bank_name.trim() || undefined,
        bank_account: form.bank_account.trim() || undefined,
        emergency_contact: form.emergency_contact.trim() || undefined,
        emergency_phone: form.emergency_phone.trim() || undefined,
        remark: form.remark.trim() || undefined,
      };
      if (!editId) data.code = form.code.trim() || undefined; // 留空=自动生成工号
      const res = editId ? await employeeApi.update(editId, data) : await employeeApi.create(data);
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

  const handleDelete = async (e: Employee) => {
    const ok = await confirmAction({
      title: `删除员工「${e.name}」？`,
      content: '历史劳动合同需要保留；如员工已离职，建议将状态改为「离职」保留档案。',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await employeeApi.remove(e.id);
      if (res.code === 0) {
        message.success('已删除');
        fetchList();
      } else {
        message.error(res.message || '删除失败');
      }
    } catch (err: any) {
      message.error(err?.message || '删除失败');
    }
  };

  const labelCls = 'block text-sm text-gray-600 mb-1';
  const inputCls = 'w-full rounded-lg border border-gray-200 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500/40';
  const TH = 'px-6 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';

  const statusBadge = (s?: string) => {
    const map: Record<string, string> = {
      probation: 'bg-amber-50 text-amber-600',
      active: 'bg-green-50 text-green-600',
      left: 'bg-gray-100 text-gray-500',
    };
    return (
      <span className={`px-2 py-0.5 rounded text-xs ${map[s || ''] || 'bg-gray-100 text-gray-500'}`}>
        {EMPLOYEE_STATUS_TEXT[s || ''] || s || '-'}
      </span>
    );
  };

  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Employee) => ReactNode;
  }
  const rowCols: RowCol[] = [
    { key: 'code', header: '工号', cell: (e) => <span className="font-mono text-xs text-gray-600">{e.code}</span> },
    { key: 'name', header: '姓名', cell: (e) => <span className="font-medium text-gray-900">{e.name}</span> },
    { key: 'gender', header: '性别', cell: (e) => <span className="text-gray-600">{e.gender === 'male' ? '男' : e.gender === 'female' ? '女' : '-'}</span> },
    { key: 'department', header: '部门', cell: (e) => <span className="text-gray-700">{e.department_id ? deptName.get(e.department_id) || '-' : '-'}</span> },
    { key: 'position', header: '岗位', cell: (e) => <span className="text-gray-600">{e.position || '-'}</span> },
    { key: 'employment_type', header: '用工性质', cell: (e) => <span className="text-gray-600">{EMPLOYMENT_TYPE_TEXT[e.employment_type || ''] || e.employment_type || '-'}</span> },
    { key: 'status', header: '状态', cell: (e) => statusBadge(e.status) },
    { key: 'hire_date', header: '入职日期', cell: (e) => <span className="text-gray-600">{dateStr(e.hire_date) || '-'}</span> },
    { key: 'phone', header: '手机号', cell: (e) => <span className="text-gray-600">{e.phone || '-'}</span> },
    {
      key: '__actions',
      header: '操作',
      cellCls: `${TD} whitespace-nowrap`,
      cell: (e) => (
        <RowActions
          actions={[
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => setDetail(e) },
            ...(has('employee_edit')
              ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openEdit(e) }]
              : []),
            ...(has('employee_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(e) }]
              : []),
          ]}
        />
      ),
    },
  ];

  // 「查看」详情列（2026-09-19 便利性）：列表列 + 其余档案字段（身份证/银行卡/紧急联系人等未上列，只读完整展示）
  const detailCols: RowCol[] = [
    ...rowCols.filter((c) => c.key !== '__actions'),
    { key: 'id_card', header: '身份证号', cell: (e) => <span className="font-mono text-xs text-gray-600">{e.id_card || '-'}</span> },
    { key: 'birth_date', header: '出生日期', cell: (e) => <span className="text-gray-600">{dateStr(e.birth_date) || '-'}</span> },
    { key: 'email', header: '邮箱', cell: (e) => <span className="text-gray-600">{e.email || '-'}</span> },
    { key: 'address', header: '住址', cell: (e) => <span className="text-gray-600">{e.address || '-'}</span> },
    { key: 'education', header: '学历', cell: (e) => <span className="text-gray-600">{e.education || '-'}</span> },
    { key: 'probation_end_date', header: '试用期结束', cell: (e) => <span className="text-gray-600">{dateStr(e.probation_end_date) || '-'}</span> },
    { key: 'regular_date', header: '转正日期', cell: (e) => <span className="text-gray-600">{dateStr(e.regular_date) || '-'}</span> },
    { key: 'base_salary', header: '基本工资', cell: (e) => <span className="text-gray-600">{e.base_salary != null && e.base_salary !== '' ? format.currency(e.base_salary) : '-'}</span> },
    { key: 'bank_name', header: '开户行', cell: (e) => <span className="text-gray-600">{e.bank_name || '-'}</span> },
    { key: 'bank_account', header: '银行账号', cell: (e) => <span className="font-mono text-xs text-gray-600">{e.bank_account || '-'}</span> },
    { key: 'emergency_contact', header: '紧急联系人', cell: (e) => <span className="text-gray-600">{e.emergency_contact || '-'}</span> },
    { key: 'emergency_phone', header: '紧急联系电话', cell: (e) => <span className="text-gray-600">{e.emergency_phone || '-'}</span> },
    { key: 'remark', header: '备注', cell: (e) => <span className="text-gray-600">{e.remark || '-'}</span> },
  ];

  const statusFilterNote = status ? `状态：${EMPLOYEE_STATUS_TEXT[status] || status}` : '';

  return (
    <div className="space-y-6">
      <PageHeader
        title="员工档案"
        subtitle="公司全员人事主数据（工号自动生成）；工资与报销后续从这里选人，避免名字口径不一致"
        extra={
          <div className="flex items-center gap-2">
            <button onClick={fetchList} className="btn-secondary flex items-center gap-1.5">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">刷新</span>
            </button>
            {has('employee_create') && (
              <button onClick={openCreate} className="btn-primary flex items-center gap-2">
                <Plus className="w-5 h-5" />
                <span className="hidden md:inline">新增员工</span>
              </button>
            )}
          </div>
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <Input.Search
            allowClear
            placeholder="搜索姓名 / 工号 / 手机 / 岗位"
            defaultValue={keyword}
            style={{ maxWidth: 300 }}
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
            style={{ width: 140 }}
            options={[
              { value: 'probation', label: '试用' },
              { value: 'active', label: '在职' },
              { value: 'left', label: '离职' },
            ]}
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
                        setPagination((p) => ({ ...p, page: 1 }));
                      }}
                      title="还没有员工档案"
                      description="点右上角「新增员工」开始建档（工号留空自动生成），之后再给员工录劳动合同"
                    />
                  </td>
                </tr>
              ) : (
                list.map((e) => (
                  <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                    {rowCols.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(e)}
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
        title={editId ? '编辑员工' : '新增员工'}
        open={open}
        onCancel={() => setOpen(false)}
        onOk={handleSave}
        confirmLoading={saving}
        okText="保存"
        cancelText="取消"
        width={760}
      >
        <div className="space-y-4 py-2 max-h-[65vh] overflow-y-auto pr-1">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label className={labelCls}>姓名 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} className={inputCls} placeholder="如：张三" />
            </div>
            <div>
              <label className={labelCls}>工号</label>
              <input
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                className={`${inputCls} font-mono disabled:bg-gray-50 disabled:text-gray-400`}
                placeholder={editId ? '' : '留空自动生成（如 EMP20260919001）'}
                disabled={!!editId}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div>
              <label className={labelCls}>性别</label>
              <Select
                value={form.gender || undefined}
                onChange={(v) => setForm({ ...form, gender: v || '' })}
                allowClear
                placeholder="请选择"
                style={{ width: '100%' }}
                options={[
                  { value: 'male', label: '男' },
                  { value: 'female', label: '女' },
                ]}
              />
            </div>
            <div>
              <label className={labelCls}>手机号</label>
              <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} className={inputCls} placeholder="如：13800138000" />
            </div>
            <div>
              <label className={labelCls}>身份证号</label>
              <input
                value={form.id_card}
                onChange={(e) => setForm({ ...form, id_card: e.target.value })}
                className={inputCls}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div>
              <label className={labelCls}>出生日期</label>
              <input type="date" value={form.birth_date} onChange={(e) => setForm({ ...form, birth_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>部门</label>
              <SearchSelect
                value={form.department_id}
                onChange={(v: string) => setForm({ ...form, department_id: v || undefined })}
                placeholder="请选择部门"
                allowClear
                options={depts.map((d) => ({ value: d.id, label: d.name, search: d.code }))}
              />
            </div>
            <div>
              <label className={labelCls}>岗位</label>
              <input value={form.position} onChange={(e) => setForm({ ...form, position: e.target.value })} className={inputCls} placeholder="如：会计 / 焊工 / 销售员" />
            </div>
            <div>
              <label className={labelCls}>用工性质</label>
              <Select
                value={form.employment_type}
                onChange={(v) => setForm({ ...form, employment_type: v })}
                style={{ width: '100%' }}
                options={[
                  { value: 'full_time', label: '全职' },
                  { value: 'part_time', label: '兼职' },
                  { value: 'internship', label: '实习' },
                  { value: 'labor', label: '劳务' },
                ]}
              />
            </div>
            <div>
              <label className={labelCls}>状态</label>
              <Select
                value={form.status}
                onChange={(v) => setForm({ ...form, status: v })}
                style={{ width: '100%' }}
                options={[
                  { value: 'probation', label: '试用' },
                  { value: 'active', label: '在职' },
                  { value: 'left', label: '离职（保存时自动填离职日期）' },
                ]}
              />
            </div>
            <div>
              <label className={labelCls}>入职日期</label>
              <input type="date" value={form.hire_date} onChange={(e) => setForm({ ...form, hire_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>试用期至</label>
              <input type="date" value={form.probation_end_date} onChange={(e) => setForm({ ...form, probation_end_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>转正日期</label>
              <input type="date" value={form.regular_date} onChange={(e) => setForm({ ...form, regular_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>基本工资（元/月）</label>
              <input type="text" inputMode="decimal" value={form.base_salary} onChange={(e) => setForm({ ...form, base_salary: e.target.value })} className={inputCls} placeholder="如：6000" />
            </div>
            <div>
              <label className={labelCls}>学历</label>
              <input value={form.education} onChange={(e) => setForm({ ...form, education: e.target.value })} className={inputCls} placeholder="如：本科 / 大专" />
            </div>
            <div>
              <label className={labelCls}>开户银行</label>
              <input value={form.bank_name} onChange={(e) => setForm({ ...form, bank_name: e.target.value })} className={inputCls} placeholder="工资卡开户行" />
            </div>
            <div>
              <label className={labelCls}>工资卡账号</label>
              <input
                value={form.bank_account}
                onChange={(e) => setForm({ ...form, bank_account: e.target.value })}
                className={inputCls}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>
            <div>
              <label className={labelCls}>紧急联系人</label>
              <input value={form.emergency_contact} onChange={(e) => setForm({ ...form, emergency_contact: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>紧急联系电话</label>
              <input value={form.emergency_phone} onChange={(e) => setForm({ ...form, emergency_phone: e.target.value })} className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>备注</label>
            <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} className={inputCls} />
          </div>
          <div className="text-xs text-gray-400">
            提示：「员工档案」是人事主数据；登录账号在「系统 → 用户管理」单独维护，两者互不影响。
          </div>
        </div>
      </Modal>

      <RecordDetailModal
        open={!!detail}
        title="员工档案详情"
        record={detail}
        columns={detailCols}
        onClose={() => setDetail(null)}
      />
    </div>
  );
}
