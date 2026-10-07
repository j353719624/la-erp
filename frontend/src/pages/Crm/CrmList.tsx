import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2, Pencil, TrendingUp, Bell, Users, Target, BarChart3 } from 'lucide-react';
import { Modal, Input } from 'antd';
import { message } from '@/utils/appMessage';
import {
  crmOpportunityApi, crmActivityApi, CrmOpportunity, CrmActivity, PendingFollowup, CrmFunnel,
  CRM_STAGE_TEXT, CRM_STAGE_COLOR, CRM_ACTIVITY_TYPE_TEXT, CRM_TARGET_TYPE_TEXT, OpportunityInput,
} from '@/api/crm';
import { customerApi } from '@/api/order';
import { leadApi } from '@/api/system';
import { SearchSelect } from '@/components/SearchSelect';
import { format, toLocalDateISO } from '@/utils/format';
import { Pagination } from '@/components/Pagination';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { confirmAction } from '@/utils/confirm';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { usePermission } from '@/hooks/usePermission';
import type { ReactNode } from 'react';

/**
 * CRM（2026-09-19 第六批③）
 *
 * 三页签：
 *  - 商机：阶段漏斗（初步接触→需求确认→报价→谈判→赢单/输单）；阶段只进不退，输单需原因
 *  - 跟进记录：线索/商机/客户时间线（电话/拜访/邮件/微信）；可留下次跟进时间 → 到期出现「待跟进」
 *  - 漏斗看板：阶段分布 + 进行中管道金额 + 期间赢单与转化率
 *
 * 线索转化（转客户 + 可选建商机）在「销售线索」页操作；本页商机可关联客户/来源线索。
 */
const ACTIVE_STAGES = ['prospecting', 'qualification', 'proposal', 'negotiation'];
type TargetOption = { id: string; label: string };

export function CrmList() {
  // [权限] 查看=crm；新增=crm_create；编辑/阶段=crm_edit；删除=crm_delete
  const { has } = usePermission();
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ tab: 'opps', keyword: '', stage: '', owner: '', page: 1, page_size: 10 });
  const [tab, setTab] = useState<'opps' | 'acts' | 'funnel'>(urlFilters.tab === 'acts' ? 'acts' : urlFilters.tab === 'funnel' ? 'funnel' : 'opps');
  const [keyword, setKeyword] = useState(String(urlFilters.keyword || ''));
  const [stage, setStage] = useState(String(urlFilters.stage || ''));
  const [owner, setOwner] = useState(String(urlFilters.owner || ''));
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [opps, setOpps] = useState<CrmOpportunity[]>([]);
  const [acts, setActs] = useState<CrmActivity[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    syncUrl({ tab, keyword, stage, owner, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, keyword, stage, owner, pagination.page, pagination.page_size]);

  const switchTab = (t: 'opps' | 'acts' | 'funnel') => { setTab(t); setStage(''); setPagination((p) => ({ ...p, page: 1 })); };
  const debouncedKeyword = useDebouncedValue(keyword, 300);
  const { nextSeq, isCurrent } = useRequestGuard();

  // 待跟进徽标（页头提醒）
  const [pending, setPending] = useState<PendingFollowup[]>([]);
  const [pendingOpen, setPendingOpen] = useState(false);
  const loadPending = useCallback(async () => {
    try {
      const res = await crmActivityApi.pending();
      if (res.code === 0) setPending(res.data ?? []);
    } catch (err) { console.warn('待跟进加载失败', err); }
  }, []);
  useEffect(() => { loadPending(); }, [loadPending]);

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      if (tab === 'opps') {
        const res = await crmOpportunityApi.list({
          page: pagination.page, page_size: pagination.page_size,
          keyword: debouncedKeyword || undefined, stage: stage || undefined, owner: owner || undefined,
        });
        if (res.code === 0) {
          if (!isCurrent(seq)) return;
          setOpps(res.data?.list ?? []);
          setPagination((prev) => ({ ...prev, total: res.data?.total ?? 0 }));
        }
      } else if (tab === 'acts') {
        const res = await crmActivityApi.list({
          page: pagination.page, page_size: pagination.page_size,
          keyword: debouncedKeyword || undefined, target_type: stage || undefined,
        });
        if (res.code === 0) {
          if (!isCurrent(seq)) return;
          setActs(res.data?.list ?? []);
          setPagination((prev) => ({ ...prev, total: res.data?.total ?? 0 }));
        }
      }
    } catch (e) {
      message.error(e instanceof Error && e.message ? e.message : '加载失败');
    } finally { if (isCurrent(seq)) setLoading(false); }
  }, [tab, pagination.page, pagination.page_size, debouncedKeyword, stage, owner, nextSeq, isCurrent]);

  useEffect(() => { if (tab !== 'funnel') fetchList(); }, [tab, fetchList]);

  // ── 漏斗 ──────────────────────────────────────────────────────────────────
  const [funnel, setFunnel] = useState<CrmFunnel | null>(null);
  const [funnelLoading, setFunnelLoading] = useState(false);
  const [funnelOwner, setFunnelOwner] = useState('');
  const loadFunnel = useCallback(async () => {
    setFunnelLoading(true);
    try {
      const res = await crmOpportunityApi.funnel({ owner: funnelOwner || undefined });
      if (res.code === 0) setFunnel(res.data ?? null);
      else message.error(res.message || '加载漏斗失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '加载漏斗失败'); } finally { setFunnelLoading(false); }
  }, [funnelOwner]);
  useEffect(() => { if (tab === 'funnel') loadFunnel(); }, [tab, loadFunnel]);

  // ── 商机新建/编辑 ─────────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<TargetOption[]>([]);
  const [leads, setLeads] = useState<TargetOption[]>([]);
  useEffect(() => {
    if (customers.length === 0) {
      customerApi.list({ page: 1, page_size: 200 }).then((res) => {
        if (res.code === 0) setCustomers((res.data?.list ?? []).map((c) => ({ id: c.id, label: `${c.name}（${c.code}）` })));
      }).catch((err) => console.warn('客户列表加载失败', err));
    }
    if (leads.length === 0) {
      leadApi.list({ page: 1, page_size: 100 }).then((res) => {
        if (res.code === 0) setLeads((res.data?.list ?? []).map((l) => ({ id: l.id, label: `${l.name}（${l.lead_no}）` })));
      }).catch((err) => console.warn('线索列表加载失败', err));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [customers.length, leads.length]);

  const [oppOpen, setOppOpen] = useState(false);
  const [oppEditId, setOppEditId] = useState('');
  const [oppSaving, setOppSaving] = useState(false);
  const [oppForm, setOppForm] = useState({ name: '', customer_id: '', customer_name: '', lead_id: '', contact_name: '', contact_phone: '', amount: '', stage: 'prospecting', probability: '', expected_close_date: '', source: '', owner: '', remark: '' });
  const openOppCreate = () => {
    setOppEditId('');
    setOppForm({ name: '', customer_id: '', customer_name: '', lead_id: '', contact_name: '', contact_phone: '', amount: '', stage: 'prospecting', probability: '', expected_close_date: '', source: '', owner: '', remark: '' });
    setOppOpen(true);
  };
  const openOppEdit = (o: CrmOpportunity) => {
    setOppEditId(o.id);
    setOppForm({
      name: o.name, customer_id: o.customer_id || '', customer_name: o.customer_name || '', lead_id: o.lead_id || '',
      contact_name: o.contact_name || '', contact_phone: o.contact_phone || '',
      amount: o.amount != null ? String(parseFloat(o.amount)) : '', stage: o.stage, probability: String(o.probability ?? ''),
      expected_close_date: o.expected_close_date ? format.date(o.expected_close_date) : '',
      source: o.source || '', owner: o.owner || '', remark: o.remark || '',
    });
    setOppOpen(true);
  };
  const submitOpp = async () => {
    if (!oppForm.name.trim()) { message.warning('请填写商机名称'); return; }
    setOppSaving(true);
    try {
      const payload: OpportunityInput = {
        name: oppForm.name.trim(),
        customer_id: oppForm.customer_id || null,
        customer_name: oppForm.customer_name,
        contact_name: oppForm.contact_name,
        contact_phone: oppForm.contact_phone,
        amount: oppForm.amount ? parseFloat(oppForm.amount) : 0,
        probability: oppForm.probability ? parseInt(oppForm.probability, 10) : undefined,
        expected_close_date: oppForm.expected_close_date ? toLocalDateISO(oppForm.expected_close_date) : null,
        source: oppForm.source, owner: oppForm.owner, remark: oppForm.remark,
      };
      if (!oppEditId) payload.stage = oppForm.stage;
      const res = oppEditId ? await crmOpportunityApi.update(oppEditId, payload) : await crmOpportunityApi.create(payload);
      if (res.code === 0) { message.success(oppEditId ? '已更新' : '已创建'); setOppOpen(false); fetchList(); }
      else message.error(res.message || '保存失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '保存失败'); } finally { setOppSaving(false); }
  };

  // ── 阶段推进 ──────────────────────────────────────────────────────────────
  const [stageOpp, setStageOpp] = useState<CrmOpportunity | null>(null);
  const [stageTarget, setStageTarget] = useState('');
  const [lostReason, setLostReason] = useState('');
  const stageOptions = stageOpp ? [...ACTIVE_STAGES.slice(ACTIVE_STAGES.indexOf(stageOpp.stage) + 1), 'won', 'lost'] : [];
  const submitStage = async () => {
    if (!stageOpp || !stageTarget) { message.warning('请选择目标阶段'); return; }
    if (stageTarget === 'lost' && !lostReason.trim()) { message.warning('输单必须填写输单原因'); return; }
    try {
      const res = await crmOpportunityApi.updateStage(stageOpp.id, { stage: stageTarget, lost_reason: lostReason });
      if (res.code === 0) { message.success('阶段已推进'); setStageOpp(null); fetchList(); }
      else message.error(res.message || '推进失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '推进失败'); }
  };
  const handleOppDelete = async (o: CrmOpportunity) => {
    if (!(await confirmAction({ title: `删除商机 ${o.code}（${o.name}）？`, danger: true }))) return;
    try {
      const res = await crmOpportunityApi.remove(o.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); } else message.error(res.message || '删除失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '删除失败'); }
  };

  // ── 跟进记录 ──────────────────────────────────────────────────────────────
  const [actOpen, setActOpen] = useState(false);
  const [actSaving, setActSaving] = useState(false);
  const [actForm, setActForm] = useState({ target_type: 'lead', target_id: '', type: 'call', content: '', activity_at: format.today(), next_follow_at: '' });
  const [actTargets, setActTargets] = useState<TargetOption[]>([]);
  const loadActTargets = useCallback(async (t: string) => {
    setActTargets([]);
    try {
      if (t === 'lead') {
        const res = await leadApi.list({ page: 1, page_size: 100 });
        if (res.code === 0) setActTargets((res.data?.list ?? []).map((l) => ({ id: l.id, label: `${l.name}（${l.lead_no}）` })));
      } else if (t === 'opportunity') {
        const res = await crmOpportunityApi.list({ page: 1, page_size: 100 });
        if (res.code === 0) setActTargets((res.data?.list ?? []).map((o) => ({ id: o.id, label: `${o.name}（${o.code}）` })));
      } else {
        const res = await customerApi.list({ page: 1, page_size: 200 });
        if (res.code === 0) setActTargets((res.data?.list ?? []).map((c) => ({ id: c.id, label: `${c.name}（${c.code}）` })));
      }
    } catch (err) { console.warn('跟进对象加载失败', err); }
  }, []);
  const openActCreate = () => {
    setActForm({ target_type: 'lead', target_id: '', type: 'call', content: '', activity_at: format.today(), next_follow_at: '' });
    setActOpen(true);
    loadActTargets('lead');
  };
  const submitAct = async () => {
    if (!actForm.target_id) { message.warning('请选择跟进对象'); return; }
    if (!actForm.content.trim()) { message.warning('请填写跟进内容'); return; }
    setActSaving(true);
    try {
      const res = await crmActivityApi.create({
        target_type: actForm.target_type, target_id: actForm.target_id, type: actForm.type,
        content: actForm.content.trim(),
        activity_at: actForm.activity_at ? toLocalDateISO(actForm.activity_at) : undefined,
        next_follow_at: actForm.next_follow_at ? toLocalDateISO(actForm.next_follow_at) : null,
      });
      if (res.code === 0) { message.success('已记录跟进'); setActOpen(false); fetchList(); loadPending(); }
      else message.error(res.message || '保存失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '保存失败'); } finally { setActSaving(false); }
  };
  const handleActDelete = async (a: CrmActivity) => {
    if (!(await confirmAction({ title: '删除该跟进记录？', danger: true }))) return;
    try {
      const res = await crmActivityApi.remove(a.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); loadPending(); } else message.error(res.message || '删除失败');
    } catch (err) { message.error(err instanceof Error && err.message ? err.message : '删除失败'); }
  };

  // ── 列 ────────────────────────────────────────────────────────────────────
  interface RowCol { key: string; header: ReactNode; headCls?: string; cellCls?: string; cell: (row: never) => ReactNode; }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  const stageBadge = (s: string) => (
    <span className={`px-2 py-0.5 rounded text-xs font-medium ${CRM_STAGE_COLOR[s] || 'bg-gray-100'}`}>{CRM_STAGE_TEXT[s] || s}</span>
  );

  const oppCols = [
    { key: 'code', header: '编号', cell: (o: CrmOpportunity) => <span className="font-medium text-gray-900">{o.code}</span> },
    { key: 'name', header: '商机名称', cell: (o: CrmOpportunity) => <span className="text-gray-900">{o.name}</span> },
    { key: 'customer', header: '客户', cell: (o: CrmOpportunity) => <span className="text-gray-700">{o.customer_name || '-'}</span> },
    { key: 'amount', header: '预计金额', headCls: TH_R, cellCls: `${TD} text-right`, cell: (o: CrmOpportunity) => <span className="text-gray-900">{format.currency(o.amount)}</span> },
    { key: 'stage', header: '阶段', cell: (o: CrmOpportunity) => stageBadge(o.stage) },
    { key: 'probability', header: '概率', headCls: TH_R, cellCls: `${TD} text-right`, cell: (o: CrmOpportunity) => <span className="text-gray-600">{o.probability}%</span> },
    { key: 'owner', header: '负责人', cell: (o: CrmOpportunity) => <span className="text-gray-500 text-sm">{o.owner || '-'}</span> },
    { key: 'expected', header: '预计成交', cell: (o: CrmOpportunity) => <span className="text-gray-500 text-sm">{o.expected_close_date ? format.date(o.expected_close_date) : '-'}</span> },
    {
      key: '__actions', header: '操作', headCls: TH_R, cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (o: CrmOpportunity) => (
        <RowActions
          actions={[
            ...(has('crm_edit') && (o.stage === 'prospecting' || o.stage === 'qualification' || o.stage === 'proposal' || o.stage === 'negotiation')
              ? [{ key: 'stage', label: '推进阶段', icon: <TrendingUp className="w-4 h-4" />, onClick: () => { setStageOpp(o); setStageTarget(''); setLostReason(''); } }] : []),
            ...(has('crm_edit') && o.stage !== 'won' && o.stage !== 'lost' ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openOppEdit(o) }] : []),
            ...(has('crm_delete') ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleOppDelete(o) }] : []),
          ]}
        />
      ),
    },
  ] as RowCol[];

  const actCols = [
    { key: 'activity_at', header: '时间', cell: (a: CrmActivity) => <span className="text-gray-500 text-sm">{format.date(a.activity_at, 'YYYY-MM-DD HH:mm')}</span> },
    { key: 'type', header: '方式', cell: (a: CrmActivity) => <span className="text-gray-700">{CRM_ACTIVITY_TYPE_TEXT[a.type] || a.type}</span> },
    { key: 'target', header: '对象', cell: (a: CrmActivity) => <span className="text-gray-900">{CRM_TARGET_TYPE_TEXT[a.target_type] || a.target_type} · {a.target_name || '-'}</span> },
    { key: 'content', header: '内容', cell: (a: CrmActivity) => <span className="text-gray-700">{a.content}</span> },
    {
      key: 'next_follow_at', header: '下次跟进',
      cell: (a: CrmActivity) => {
        if (!a.next_follow_at) return <span className="text-gray-300">-</span>;
        const due = new Date(a.next_follow_at).getTime() <= Date.now();
        return <span className={due ? 'text-amber-600 font-medium' : 'text-gray-500 text-sm'}>{format.date(a.next_follow_at)}{due ? '（已到期）' : ''}</span>;
      },
    },
    {
      key: '__actions', header: '操作', headCls: TH_R, cellCls: `${TD} text-right whitespace-nowrap`,
      cell: (a: CrmActivity) => has('crm_delete') ? <RowActions actions={[{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleActDelete(a) }]} /> : <span className="text-gray-300">-</span>,
    },
  ] as RowCol[];

  // [0.47] 同页两张表：次表必须传 paramNs（否则 ?cols= 互相裁列）
  const oppView = useTableView({ pageKey: 'crm-opportunities', columns: oppCols, paramNs: 'opps', locked: { trailing: ['__actions'] } });
  const actView = useTableView({ pageKey: 'crm-activities', columns: actCols, paramNs: 'acts', locked: { trailing: ['__actions'] } });
  const activeView = tab === 'opps' ? oppView : actView;
  const rows: never[] = (tab === 'opps' ? opps : acts) as never[];

  const filterNote = [
    stage && (tab === 'opps' ? `阶段「${CRM_STAGE_TEXT[stage] || stage}」` : `对象「${CRM_TARGET_TYPE_TEXT[stage] || stage}」`),
    owner && `负责人「${owner}」`,
  ].filter(Boolean).join(' + ') || undefined;

  const maxStageCount = Math.max(1, ...(funnel?.stages ?? []).map((s) => s.count));

  return (
    <div className="space-y-6">
      <PageHeader
        title="CRM 商机"
        subtitle="商机阶段漏斗（只进不退）· 跟进记录时间线（电话/拜访/邮件/微信 + 下次跟进提醒）· 销售漏斗看板"
        extra={
          <div className="flex items-center gap-2">
            {pending.length > 0 && (
              <button onClick={() => setPendingOpen(true)} className="btn-secondary flex items-center gap-2 text-amber-700 border-amber-200">
                <Bell className="w-5 h-5" />待跟进（{pending.length}）
              </button>
            )}
            {has('crm_create') && (
              <button onClick={tab === 'acts' ? openActCreate : openOppCreate} className="btn-primary flex items-center gap-2">
                <Plus className="w-5 h-5" /><span className="hidden md:inline">{tab === 'acts' ? '记录跟进' : '新建商机'}</span>
              </button>
            )}
          </div>
        }
      />

      <div className="card">
        <div className="border-b border-gray-100 flex">
          <button onClick={() => switchTab('opps')} className={`px-4 py-2 text-sm flex items-center gap-1.5 ${tab === 'opps' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}><Target className="w-4 h-4" />商机</button>
          <button onClick={() => switchTab('acts')} className={`px-4 py-2 text-sm flex items-center gap-1.5 ${tab === 'acts' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}><Users className="w-4 h-4" />跟进记录</button>
          <button onClick={() => switchTab('funnel')} className={`px-4 py-2 text-sm flex items-center gap-1.5 ${tab === 'funnel' ? 'bg-blue-600 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}><BarChart3 className="w-4 h-4" />漏斗看板</button>
        </div>

        {tab !== 'funnel' && (
          <>
            <div className="p-4 border-b border-gray-100 flex flex-col md:flex-row gap-3">
              <input type="text" placeholder={tab === 'opps' ? '搜索编号 / 名称 / 客户 / 负责人...' : '搜索跟进内容 / 对象...'} value={keyword} onChange={(e) => { setKeyword(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input md:max-w-xs" />
              {tab === 'opps' ? (
                <>
                  <select value={stage} onChange={(e) => { setStage(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input md:w-36">
                    <option value="">全部阶段</option>
                    {Object.entries(CRM_STAGE_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                  <input type="text" placeholder="负责人" value={owner} onChange={(e) => { setOwner(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input md:w-32" />
                </>
              ) : (
                <select value={stage} onChange={(e) => { setStage(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input md:w-32">
                  <option value="">全部对象</option>
                  {Object.entries(CRM_TARGET_TYPE_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              )}
              <div className="ml-auto flex items-center">{activeView.menu}</div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead><tr className="bg-gray-50">{activeView.visibleColumns.map((c) => <th key={c.key} className={c.headCls || TH_L}>{c.header}</th>)}</tr></thead>
                <tbody className="divide-y divide-gray-100">
                  {loading ? (
                    <tr><td colSpan={activeView.visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
                  ) : rows.length === 0 ? (
                    <tr><td colSpan={activeView.visibleColumns.length} className="px-6">
                      <ListEmpty
                        keyword={keyword}
                        filterNote={filterNote}
                        onClear={() => { setKeyword(''); setStage(''); setOwner(''); setPagination((p) => ({ ...p, page: 1 })); }}
                        title={tab === 'opps' ? '暂无商机' : '暂无跟进记录'}
                        description={tab === 'opps' ? '点击右上角「新建商机」，或从「销售线索」转化生成' : '点击右上角「记录跟进」登记电话/拜访/邮件等沟通'}
                      />
                    </td></tr>
                  ) : rows.map((r, i) => (
                    <tr key={(r as { id: string }).id || i} className="hover:bg-gray-50 transition-colors">
                      {activeView.visibleColumns.map((c) => <td key={c.key} className={c.cellCls || TD}>{c.cell(r)}</td>)}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="p-4 border-t border-gray-100">
              <Pagination
                page={pagination.page} pageSize={pagination.page_size} total={pagination.total}
                onPageChange={(page) => setPagination((p) => ({ ...p, page }))} loading={loading}
                onPageSizeChange={(size) => setPagination((prev) => ({ ...prev, page: 1, page_size: size }))}
              />
            </div>
          </>
        )}

        {tab === 'funnel' && (
          <div className="p-4 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <input type="text" placeholder="负责人（按姓名筛选）" value={funnelOwner} onChange={(e) => setFunnelOwner(e.target.value)} className="form-input w-44" />
              <button onClick={loadFunnel} className="btn-primary">刷新</button>
              <span className="text-xs text-gray-500">转化率 = 赢单数 ÷ 商机总数；赢单金额按 won_at 统计</span>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="border border-gray-100 rounded-lg p-4">
                <div className="text-xs text-gray-500">商机总数</div>
                <div className="text-2xl font-semibold text-gray-900 mt-1">{funnel?.total_count ?? '—'}</div>
              </div>
              <div className="border border-gray-100 rounded-lg p-4">
                <div className="text-xs text-gray-500">进行中管道金额</div>
                <div className="text-2xl font-semibold text-gray-900 mt-1">{funnel ? format.currency(funnel.active_amount) : '—'}</div>
              </div>
              <div className="border border-gray-100 rounded-lg p-4">
                <div className="text-xs text-gray-500">赢单金额（累计）</div>
                <div className="text-2xl font-semibold text-green-700 mt-1">{funnel ? format.currency(funnel.won_amount) : '—'}</div>
              </div>
              <div className="border border-gray-100 rounded-lg p-4">
                <div className="text-xs text-gray-500">转化率（赢单 ÷ 总数）</div>
                <div className="text-2xl font-semibold text-blue-700 mt-1">{funnel ? `${funnel.conversion_rate.toFixed(2)}%` : '—'}</div>
              </div>
            </div>
            <div className="space-y-2">
              {funnelLoading ? (
                <TableSkeleton rows={4} />
              ) : !funnel || funnel.stages.length === 0 ? (
                <div className="text-center text-sm text-gray-400 py-8">暂无商机数据</div>
              ) : funnel.stages.map((s) => (
                <div key={s.stage} className="flex items-center gap-3">
                  <span className="w-24 text-sm text-gray-600">{s.label}</span>
                  <div className="flex-1 bg-gray-100 rounded h-6 overflow-hidden">
                    <div className={`h-6 rounded ${s.stage === 'won' ? 'bg-green-500' : s.stage === 'lost' ? 'bg-red-400' : 'bg-blue-500'}`} style={{ width: `${Math.round((s.count / maxStageCount) * 100)}%` }} />
                  </div>
                  <span className="w-40 text-right text-sm text-gray-700">{s.count} 个 · {format.currency(s.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 商机 新建/编辑 */}
      <Modal title={oppEditId ? '编辑商机' : '新建商机'} open={oppOpen} onCancel={() => setOppOpen(false)} onOk={submitOpp} confirmLoading={oppSaving} okText="保存" cancelText="取消" width={680}>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">商机名称 *</label>
              <Input value={oppForm.name} onChange={(e) => setOppForm({ ...oppForm, name: e.target.value })} placeholder="如：年度采购框架" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">客户</label>
              <SearchSelect
                value={oppForm.customer_id || undefined}
                onChange={(v: unknown) => {
                  const id = typeof v === 'string' ? v : '';
                  setOppForm((f) => ({ ...f, customer_id: id, customer_name: customers.find((c) => c.id === id)?.label.split('（')[0] || '' }));
                }}
                options={customers.map((c) => ({ label: c.label, value: c.id, search: c.label }))}
                placeholder="请选择客户"
                allowClear
              /></div>
          </div>
          <div className="grid grid-cols-4 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">预计金额</label>
              <Input type="number" value={oppForm.amount} onChange={(e) => setOppForm({ ...oppForm, amount: e.target.value })} placeholder="如：100000" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">{oppEditId ? '概率（%）' : '阶段'}</label>
              {oppEditId ? (
                <Input type="number" value={oppForm.probability} onChange={(e) => setOppForm({ ...oppForm, probability: e.target.value })} placeholder="0-100" />
              ) : (
                <select value={oppForm.stage} onChange={(e) => setOppForm({ ...oppForm, stage: e.target.value })} className="form-input w-full">
                  {Object.entries(CRM_STAGE_TEXT).filter(([k]) => ACTIVE_STAGES.includes(k)).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              )}
            </div>
            <div><label className="block text-sm text-gray-600 mb-1">预计成交日</label>
              <Input type="date" value={oppForm.expected_close_date} onChange={(e) => setOppForm({ ...oppForm, expected_close_date: e.target.value })} /></div>
            <div><label className="block text-sm text-gray-600 mb-1">负责人</label>
              <Input value={oppForm.owner} onChange={(e) => setOppForm({ ...oppForm, owner: e.target.value })} placeholder="如：张三" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">联系人</label>
              <Input value={oppForm.contact_name} onChange={(e) => setOppForm({ ...oppForm, contact_name: e.target.value })} placeholder="如：王总" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">联系电话</label>
              <Input value={oppForm.contact_phone} onChange={(e) => setOppForm({ ...oppForm, contact_phone: e.target.value })} placeholder="如：13800000000" autoCapitalize="none" /></div>
            <div><label className="block text-sm text-gray-600 mb-1">来源</label>
              <Input value={oppForm.source} onChange={(e) => setOppForm({ ...oppForm, source: e.target.value })} placeholder="如：展会 / 转介绍" /></div>
          </div>
          <div><label className="block text-sm text-gray-600 mb-1">备注</label>
            <Input value={oppForm.remark} onChange={(e) => setOppForm({ ...oppForm, remark: e.target.value })} placeholder="请输入备注" /></div>
          <div className="text-xs text-gray-400">概率留空按阶段自动带出（初步接触 10 / 需求确认 30 / 报价 50 / 谈判 70）。阶段推进请用列表「推进阶段」。</div>
        </div>
      </Modal>

      {/* 阶段推进 */}
      <Modal title={stageOpp ? `推进阶段 - ${stageOpp.name}` : '推进阶段'} open={!!stageOpp} onCancel={() => setStageOpp(null)} onOk={submitStage} okText="推进" cancelText="取消" width={480}>
        {stageOpp && (
          <div className="space-y-3 py-2">
            <div className="text-sm text-gray-500">当前：{CRM_STAGE_TEXT[stageOpp.stage]}（{stageOpp.probability}%）</div>
            <div><label className="block text-sm text-gray-600 mb-1">目标阶段 *</label>
              <select value={stageTarget} onChange={(e) => setStageTarget(e.target.value)} className="form-input w-full">
                <option value="">请选择目标阶段</option>
                {stageOptions.map((s) => <option key={s} value={s}>{CRM_STAGE_TEXT[s]}</option>)}
              </select></div>
            {stageTarget === 'lost' && (
              <div><label className="block text-sm text-gray-600 mb-1">输单原因 *</label>
                <Input value={lostReason} onChange={(e) => setLostReason(e.target.value)} placeholder="如：预算取消 / 竞品价格更低" /></div>
            )}
            <div className="text-xs text-gray-400">阶段只进不退；赢单/输单后不可再修改。</div>
          </div>
        )}
      </Modal>

      {/* 记录跟进 */}
      <Modal title="记录跟进" open={actOpen} onCancel={() => setActOpen(false)} onOk={submitAct} confirmLoading={actSaving} okText="保存" cancelText="取消" width={560}>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">对象类型 *</label>
              <select value={actForm.target_type} onChange={(e) => { setActForm({ ...actForm, target_type: e.target.value, target_id: '' }); loadActTargets(e.target.value); }} className="form-input w-full">
                {Object.entries(CRM_TARGET_TYPE_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="block text-sm text-gray-600 mb-1">对象 *</label>
              <SearchSelect
                value={actForm.target_id || undefined}
                onChange={(v: unknown) => setActForm((f) => ({ ...f, target_id: typeof v === 'string' ? v : '' }))}
                options={actTargets.map((t) => ({ label: t.label, value: t.id, search: t.label }))}
                placeholder="请选择"
                allowClear
              /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm text-gray-600 mb-1">方式</label>
              <select value={actForm.type} onChange={(e) => setActForm({ ...actForm, type: e.target.value })} className="form-input w-full">
                {Object.entries(CRM_ACTIVITY_TYPE_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select></div>
            <div><label className="block text-sm text-gray-600 mb-1">跟进时间</label>
              <Input type="date" value={actForm.activity_at} onChange={(e) => setActForm({ ...actForm, activity_at: e.target.value })} /></div>
            <div><label className="block text-sm text-gray-600 mb-1">下次跟进</label>
              <Input type="date" value={actForm.next_follow_at} onChange={(e) => setActForm({ ...actForm, next_follow_at: e.target.value })} /></div>
          </div>
          <div><label className="block text-sm text-gray-600 mb-1">跟进内容 *</label>
            <Input value={actForm.content} onChange={(e) => setActForm({ ...actForm, content: e.target.value })} placeholder="如：电话沟通报价细节，对方要求下周出方案" /></div>
          <div className="text-xs text-gray-400">填写「下次跟进」后，到期未跟进会在页头「待跟进」中提醒（每日调度也会通知销售）。</div>
        </div>
      </Modal>

      {/* 待跟进清单 */}
      <Modal title={`待跟进（${pending.length}）`} open={pendingOpen} onCancel={() => setPendingOpen(false)} footer={<button onClick={() => setPendingOpen(false)} className="btn-primary">知道了</button>} width={620}>
        <div className="max-h-80 overflow-y-auto text-sm space-y-2 py-1">
          {pending.map((p) => (
            <div key={p.activity_id} className="border border-gray-100 rounded-lg p-3">
              <div className="flex items-center justify-between">
                <span className="text-gray-900 font-medium">{CRM_TARGET_TYPE_TEXT[p.target_type] || p.target_type} · {p.target_name}</span>
                <span className="text-xs text-amber-600">{p.next_follow_at ? format.date(p.next_follow_at) : ''}{p.overdue_days > 0 ? ` · 已逾期 ${p.overdue_days} 天` : ' · 今日到期'}</span>
              </div>
              <div className="text-gray-500 mt-1">上次（{CRM_ACTIVITY_TYPE_TEXT[p.last_type] || p.last_type}）：{p.last_content}</div>
            </div>
          ))}
        </div>
      </Modal>
    </div>
  );
}
