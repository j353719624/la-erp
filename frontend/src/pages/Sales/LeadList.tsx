import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, UserCheck, TrendingUp } from 'lucide-react';
import { Modal, Input } from 'antd';
import { message } from '@/utils/appMessage';
import { leadApi } from '@/api/system';
import { format } from '@/utils/format';
import { PaginationParams } from '@/types';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { confirmAction } from '@/utils/confirm';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { usePermission } from '@/hooks/usePermission';

import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { useDictEntries, dictText } from '@/hooks/useDictItems';
import { DictSelect } from '@/components/DictSelect';
import type { ReactNode } from 'react';
const STATUS_TEXT: Record<string, string> = { new: '新线索', contacted: '已联系', qualified: '已合格', won: '已赢单', lost: '已流失' };
const STATUS_COLOR: Record<string, string> = {
  new: 'bg-blue-50 text-blue-600', contacted: 'bg-yellow-50 text-yellow-600',
  qualified: 'bg-orange-50 text-orange-600', won: 'bg-green-50 text-green-600', lost: 'bg-red-50 text-red-600',
};

interface Lead { id: string; lead_no: string; name: string; company: string; phone: string; email: string; source: string; status: string; owner: string; remark?: string; }

export function LeadList() {
  const { has } = usePermission();
  const [list, setList] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  // [易用性 P1] 筛选与页码写入 URL（刷新/返回/发链接不丢条件）
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ keyword: '', page: 1, page_size: 10 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  const [status, setStatus] = useState('');
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  // [易用性 P1] 条件变化 → 写回 URL（与默认值相同则从地址栏移除，保持链接干净）
  useEffect(() => {
    syncUrl({ keyword, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keyword, pagination.page, pagination.page_size]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>({ name: '', company: '', phone: '', email: '', source: 'website', owner: '' });
  const [saving, setSaving] = useState(false);
  // [S-05 2026-09-13] 来源渠道改字典驱动（lead_source）：数据字典里新增渠道，这里下拉即时可选
  const leadSourceDict = useDictEntries('lead_source');

  // [FIX-Rev] P1：搜索 300ms 防抖 + 请求竞态守卫（丢弃过期响应）
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  const fetchList = useCallback(async () => {
    const seq = nextSeq(); // [FIX-Rev] 本次请求序号
    setLoading(true);
    try {
      const params: PaginationParams = { page: pagination.page, page_size: pagination.page_size };
      const res = await leadApi.list({ ...params, status: status || undefined, owner: debouncedKeyword || undefined });
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // [FIX-Rev] 已有更新的请求，丢弃过期响应
        setList(res.data?.list ?? []); setPagination(p => ({ ...p, total: res.data?.total ?? 0 }));
      }
    } catch { /* */ } finally {
      if (isCurrent(seq)) setLoading(false); // [FIX-Rev] 仅最新请求结束才收起 loading
    }
  }, [pagination.page, pagination.page_size, status, debouncedKeyword]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const handleCreate = async () => {
    if (!form.name.trim()) { message.warning('请填写联系人'); return; }
    setSaving(true);
    try {
      const res = await leadApi.create(form);
      if (res.code === 0) { message.success('线索已创建'); setOpen(false); setForm({ name: '', company: '', phone: '', email: '', source: 'website', owner: '' }); fetchList(); } else { message.error(res.message || '创建失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '创建失败'); } finally { setSaving(false); }
  };

  const nextStatus = (s: string) => ({ new: 'contacted', contacted: 'qualified', qualified: 'won' }[s] || '');

  const advance = async (l: Lead) => {
    const target = nextStatus(l.status);
    if (!target) return;
    if (!(await confirmAction({ title: `线索 ${l.lead_no} 流转为「${STATUS_TEXT[target]}」？` }))) return;
    const res = await leadApi.status(l.id, target);
    if (res.code === 0) { message.success('已流转'); fetchList(); } else { message.error(res.message || '流转失败'); }
  };

  const lose = async (l: Lead) => {
    if (!(await confirmAction({ title: `标记线索 ${l.lead_no} 为流失？`, danger: true }))) return;
    const res = await leadApi.status(l.id, 'lost');
    if (res.code === 0) { message.success('已标记流失'); fetchList(); } else { message.error(res.message || '操作失败'); }
  };

  // [2026-09-19 第六批③] 转化升级：可关联已有客户 / 同时建商机（重复转化与同名客户由服务端拦截）
  const [convertLead, setConvertLead] = useState<Lead | null>(null);
  const [convertForm, setConvertForm] = useState({ create_opportunity: false, opportunity_name: '', amount: '', owner: '' });
  const [converting, setConverting] = useState(false);
  const convert = (l: Lead) => {
    setConvertForm({ create_opportunity: false, opportunity_name: `${l.company || l.name} 商机`, amount: '', owner: l.owner || '' });
    setConvertLead(l);
  };
  const submitConvert = async () => {
    if (!convertLead) return;
    setConverting(true);
    try {
      const res = await leadApi.convert(convertLead.id, {
        create_opportunity: convertForm.create_opportunity,
        opportunity_name: convertForm.opportunity_name,
        amount: convertForm.amount ? parseFloat(convertForm.amount) : 0,
        owner: convertForm.owner,
      });
      if (res.code === 0) {
        const opp = res.data?.opportunity;
        message.success(`已转为客户 ${res.data?.customer?.code}${opp ? `，并创建商机 ${opp.code}` : ''}`);
        setConvertLead(null);
        fetchList();
      } else { message.error(res.message || '转换失败'); }
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '转换失败'); } finally { setConverting(false); }
  };

  const del = async (l: Lead) => {
    if (!(await confirmAction({ title: `删除线索 ${l.lead_no}？`, danger: true }))) return;
    const res = await leadApi.remove(l.id);
    if (res.code === 0) { message.success('已删除'); fetchList(); } else { message.error(res.message || '删除失败'); }
  };

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: Lead) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const rowCols: RowCol[] = [
    { key: 'lead_no', header: '线索号', cell: (l) => <span className="font-medium text-gray-900">{l.lead_no}</span> },
    { key: 'name', header: '联系人', cell: (l) => <span className="text-gray-900">{l.name}</span> },
    { key: 'company', header: '公司', cell: (l) => <span className="text-gray-600 text-sm">{l.company || '-'}</span> },
    { key: 'phone', header: '电话', cell: (l) => <span className="text-gray-600 text-sm">{l.phone || '-'}</span> },
    { key: 'source', header: '来源', cell: (l) => <span className="text-gray-500 text-sm">{dictText(leadSourceDict, l.source) || '-'}</span> },
    { key: 'owner', header: '负责人', cell: (l) => <span className="text-gray-600 text-sm">{l.owner || '-'}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (l) => (
        <span className={`px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLOR[l.status] || ''}`}>{STATUS_TEXT[l.status] || l.status}</span>
      ),
    },
    {
      key: '__actions',
      header: '操作',
      headCls: TH_R,
      cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (l) => (
        // [易用性] 行操作统一折叠（窄屏/横屏：主操作 + ⋮ 更多）
        <RowActions
          actions={[
            ...(nextStatus(l.status) ? [{ key: 'advance', label: '推进', icon: <TrendingUp className="w-4 h-4" />, onClick: () => advance(l) }] : []),
            ...((l.status === 'qualified' || l.status === 'won') && has('crm_create') ? [{ key: 'convert', label: '转客户', icon: <UserCheck className="w-4 h-4" />, onClick: () => convert(l) }] : []),
            ...(l.status !== 'won' && l.status !== 'lost'
              ? [{ key: 'lose', label: '标记流失', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => lose(l) }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'lead-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="销售线索"
        subtitle="线索跟进：联系 → 合格 → 赢单转客户"
        extra={
          <button onClick={() => setOpen(true)} className="btn-primary flex items-center gap-2">
            <Plus className="w-5 h-5" /><span className="hidden md:inline">新增线索</span>
          </button>
        }
      />
      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
          <input type="text" placeholder="搜索负责人..." value={keyword} onChange={(e) => { setKeyword(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} className="form-input md:max-w-xs" />
          <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination(p => ({ ...p, page: 1 })); }} className="form-input md:w-40">
            <option value="">全部状态</option>
            {Object.entries(STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <div className="ml-auto flex items-center">{viewMenu}</div>
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
              {loading ? (<tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>)
                : list.length === 0 ? (<tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无线索" /></td></tr>)
                : list.map((l) => (
                  <tr key={l.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(l)}
                      </td>
                    ))}
                  </tr>
                ))}
            </tbody>
          </table>
        </div>
        <div className="p-4 border-t border-gray-100">
          <Pagination page={pagination.page} pageSize={pagination.page_size} total={pagination.total} onPageChange={(page) => setPagination(p => ({ ...p, page }))} loading={loading} onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))} />
        </div>
      </div>

      <Modal title="新增线索" open={open} onCancel={() => setOpen(false)} onOk={handleCreate} confirmLoading={saving} okText="创建" cancelText="取消">
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="联系人 *" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Input placeholder="公司" value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Input placeholder="电话" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <Input placeholder="邮箱" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })}  autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DictSelect
              typeCode="lead_source"
              value={form.source}
              onChange={(v) => setForm({ ...form, source: v ?? '' })}
              allowClear={false}
              placeholder="请选择来源"
              className="w-full"
            />
            <Input placeholder="负责人" value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} />
          </div>
        </div>
      </Modal>

      {/* [2026-09-19 第六批③] 线索转化：转客户（可同时建商机）；重复转化 / 同名客户由服务端拦截 */}
      <Modal
        title={convertLead ? `线索转化 - ${convertLead.lead_no}（${convertLead.company || convertLead.name}）` : '线索转化'}
        open={!!convertLead}
        onCancel={() => setConvertLead(null)}
        onOk={submitConvert}
        confirmLoading={converting}
        okText="确认转化"
        cancelText="取消"
        width={520}
      >
        <div className="space-y-3 py-2">
          <div className="text-sm text-gray-500">将自动创建客户档案（编码走编号中心）；若已存在同名/同电话客户，会提示改走关联已有客户。</div>
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={convertForm.create_opportunity} onChange={(e) => setConvertForm({ ...convertForm, create_opportunity: e.target.checked })} />
            同时创建商机（进入「CRM 商机 → 需求确认」）
          </label>
          {convertForm.create_opportunity && (
            <div className="grid grid-cols-3 gap-3">
              <div className="col-span-2"><label className="block text-sm text-gray-600 mb-1">商机名称</label>
                <Input value={convertForm.opportunity_name} onChange={(e) => setConvertForm({ ...convertForm, opportunity_name: e.target.value })} placeholder="如：年度采购框架" /></div>
              <div><label className="block text-sm text-gray-600 mb-1">预计金额</label>
                <Input type="number" value={convertForm.amount} onChange={(e) => setConvertForm({ ...convertForm, amount: e.target.value })} placeholder="如：100000" /></div>
            </div>
          )}
          <div><label className="block text-sm text-gray-600 mb-1">负责人</label>
            <Input value={convertForm.owner} onChange={(e) => setConvertForm({ ...convertForm, owner: e.target.value })} placeholder="如：张三" /></div>
        </div>
      </Modal>
    </div>
  );
}
