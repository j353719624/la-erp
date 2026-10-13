import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, RefreshCw, CheckCircle2, Eye } from 'lucide-react';
import { Modal } from 'antd';
import { message } from '@/utils/appMessage';
import {
  productDocumentApi, ProductDocument, DOC_TYPE_TEXT, DOC_STATUS_TEXT,
} from '@/api/production';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { RowActions } from '@/components/RowActions';
import { Pagination } from '@/components/Pagination';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { confirmAction } from '@/utils/confirm';
// [2026-09-18 权限细化·批 2 生产] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';

/**
 * 产品技术资料（2026-09-11）
 *
 * 生产资料管理之「技术资料」：图纸 / 作业指导书 / 工艺参数 / 检验标准，带版本与生效状态。
 * 发布生效时，同产品同类型的旧版本自动置为「已作废」，保证现场只有一份有效版本。
 */
const STATUS_CLS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  effective: 'bg-green-50 text-green-600',
  obsolete: 'bg-gray-200 text-gray-500',
};

const emptyForm = {
  product_name: '', doc_type: 'instruction', title: '', version: 'A',
  content: '', effective_date: '', author: '', remark: '', status: 'draft',
};

export function DocumentList() {
  // [2026-09-18 权限细化·批 2 生产] 新增=document_create；编辑/发布/作废=document_edit；删除=document_delete
  const { has } = usePermission();
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ page: 1, page_size: 10, keyword: '', doc_type: '', status: '' });
  const [list, setList] = useState<ProductDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState(String(urlFilters.keyword || ''));
  const [applied, setApplied] = useState(String(urlFilters.keyword || ''));
  const [docType, setDocType] = useState(String(urlFilters.doc_type || ''));
  const [status, setStatus] = useState(String(urlFilters.status || ''));
  const [onlyCurrent, setOnlyCurrent] = useState(false);
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState('');
  const [form, setForm] = useState<any>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [detail, setDetail] = useState<ProductDocument | null>(null);

  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    syncUrl({ keyword: applied, doc_type: docType, status, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied, docType, status, pagination.page, pagination.page_size]);

  const fetchList = useCallback(async () => {
    const seq = nextSeq();
    setLoading(true);
    try {
      const res = await productDocumentApi.list({
        page: pagination.page, page_size: pagination.page_size,
        keyword: applied || undefined, doc_type: docType || undefined, status: status || undefined,
        only_current: onlyCurrent ? '1' : undefined,
      });
      if (res.code === 0) {
        if (!isCurrent(seq)) return;
        setList(res.data?.list ?? []);
        setPagination((p) => ({ ...p, total: res.data?.total ?? 0 }));
      }
    } catch (e: any) {
      message.error(e?.message || '加载失败');
    } finally {
      if (isCurrent(seq)) setLoading(false);
    }
  }, [pagination.page, pagination.page_size, applied, docType, status, onlyCurrent, nextSeq, isCurrent]);

  useEffect(() => { fetchList(); }, [fetchList]);

  const openCreate = () => { setEditId(''); setForm(emptyForm); setOpen(true); };
  const openEdit = (d: ProductDocument) => {
    setEditId(d.id);
    setForm({
      product_name: d.product_name || '', doc_type: d.doc_type || 'instruction', title: d.title || '',
      version: d.version || 'A', content: d.content || '',
      effective_date: d.effective_date?.slice(0, 10) || '', author: d.author || '',
      remark: d.remark || '', status: d.status || 'draft',
    });
    setOpen(true);
  };

  const handleSave = async () => {
    if (!form.title.trim()) { message.warning('请填写资料标题'); return; }
    setSaving(true);
    try {
      const data = {
        product_name: form.product_name,
        doc_type: form.doc_type,
        title: form.title.trim(),
        version: form.version || 'A',
        content: form.content,
        effective_date: form.effective_date || undefined,
        author: form.author,
        remark: form.remark,
        status: form.status,
      };
      const res = editId ? await productDocumentApi.update(editId, data) : await productDocumentApi.create(data);
      if (res.code === 0) {
        message.success(editId ? '已更新' : '已新增');
        setOpen(false);
        fetchList();
      }
    } catch (e: any) {
      message.error(e?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const doPublish = async (d: ProductDocument) => {
    const ok = await confirmAction({
      title: `发布生效：${d.title}（${d.version}）`,
      content: '发布后同一产品同类型的其它生效版本会自动作废，保证现场只有一份有效版本。',
      okText: '发布',
    });
    if (!ok) return;
    try {
      const res = await productDocumentApi.publish(d.id);
      if (res.code === 0) { message.success('已发布生效'); fetchList(); }
    } catch (e: any) {
      message.error(e?.message || '发布失败');
    }
  };

  const doObsolete = async (d: ProductDocument) => {
    const ok = await confirmAction({ title: `作废资料「${d.title}」？`, danger: true });
    if (!ok) return;
    try {
      const res = await productDocumentApi.update(d.id, {
        product_name: d.product_name, doc_type: d.doc_type, title: d.title, version: d.version,
        content: d.content, author: d.author, remark: d.remark, status: 'obsolete',
      });
      if (res.code === 0) { message.success('已作废'); fetchList(); }
    } catch (e: any) {
      message.error(e?.message || '操作失败');
    }
  };

  const handleDelete = async (d: ProductDocument) => {
    const ok = await confirmAction({ title: `删除资料「${d.title}」？`, danger: true });
    if (!ok) return;
    try {
      const res = await productDocumentApi.remove(d.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); }
    } catch (e: any) {
      message.error(e?.message || '删除失败');
    }
  };

  const labelCls = 'block text-sm text-gray-600 mb-1';
  const inputCls = 'form-input';

  // [2026-09-12] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: ProductDocument) => ReactNode;
  }
  const TH_C = 'px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-4 py-4';
  const rowCols: RowCol[] = [
    { key: 'doc_no', header: '资料编号', cell: (d) => <span className="font-mono text-sm text-gray-900">{d.doc_no}</span> },
    {
      key: 'title',
      header: '标题',
      cell: (d) => (
        <>
          <button onClick={() => setDetail(d)} className="hover:text-blue-600 text-left text-gray-900">{d.title}</button>
          {d.content && <div className="text-xs text-gray-400 truncate max-w-[280px]">{d.content.slice(0, 40)}</div>}
        </>
      ),
    },
    { key: 'doc_type', header: '类型', cellCls: `${TD} text-gray-600 text-sm`, cell: (d) => <span>{DOC_TYPE_TEXT[d.doc_type] || d.doc_type}</span> },
    { key: 'product', header: '适用产品', cellCls: `${TD} text-gray-600 text-sm`, cell: (d) => <span>{d.product_name || '通用'}</span> },
    { key: 'version', header: '版本', cellCls: `${TD} text-gray-600 text-sm`, cell: (d) => <span>{d.version}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (d) => (
        <span className={`px-2 py-0.5 rounded text-xs ${STATUS_CLS[d.status] || ''}`}>
          {DOC_STATUS_TEXT[d.status] || d.status}
        </span>
      ),
    },
    { key: 'effective_date', header: '生效日期', cellCls: `${TD} text-gray-600 text-sm`, cell: (d) => <span>{d.effective_date ? String(d.effective_date).slice(0, 10) : '-'}</span> },
    {
      key: '__actions',
      header: '操作',
      cellCls: `${TD} whitespace-nowrap`,
      cell: (d) => (
        <RowActions
          actions={[
            { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => setDetail(d) },
            ...(has('document_edit')
              ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openEdit(d) }]
              : []),
            ...(d.status !== 'effective'
              ? (has('document_edit')
                  ? [{ key: 'publish', label: '发布生效', icon: <CheckCircle2 className="w-4 h-4" />, onClick: () => doPublish(d) }]
                  : [])
              : (has('document_edit')
                  ? [{ key: 'obsolete', label: '作废', icon: <Trash2 className="w-4 h-4" />, onClick: () => doObsolete(d) }]
                  : [])),
            ...(d.status !== 'effective' && has('document_delete')
              ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(d) }]
              : []),
          ]}
        />
      ),
    },
  ];
  // [2026-09-12] 我的视图：可见列写 URL（?cols=）可分享；操作列锁定不可隐藏
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: 'production-document-list',
    columns: rowCols,
    locked: { trailing: ['__actions'] },
  });

  return (
    <div className="space-y-6">
      <PageHeader
        title="技术资料"
        subtitle="图纸 / 作业指导书 / 工艺参数 / 检验标准（生产资料管理，含版本与生效状态）"
        extra={
          <div className="flex items-center gap-2">
            <button onClick={fetchList} className="btn-secondary flex items-center gap-1.5">
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
              <span className="hidden md:inline">刷新</span>
            </button>
            {has('document_create') && (
              <button onClick={openCreate} className="btn-primary flex items-center gap-2">
                <Plus className="w-4 h-4" />新增资料
              </button>
            )}
          </div>
        }
      />

      <div className="card p-4 flex flex-wrap items-center gap-3">
        <input
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { setPagination((p) => ({ ...p, page: 1 })); setApplied(keyword.trim()); } }}
          placeholder="搜索编号/标题/适用产品/内容"
          className="form-input w-72"
        />
        <select value={docType} onChange={(e) => { setDocType(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input w-36">
          <option value="">全部类型</option>
          {Object.entries(DOC_TYPE_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPagination((p) => ({ ...p, page: 1 })); }} className="form-input w-32">
          <option value="">全部状态</option>
          {Object.entries(DOC_STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <label className="flex items-center gap-2 text-sm text-gray-600">
          <input
            type="checkbox"
            checked={onlyCurrent}
            onChange={(e) => { setOnlyCurrent(e.target.checked); setPagination((p) => ({ ...p, page: 1 })); }}
            className="w-4 h-4 accent-blue-600"
          />
          只看生效版本
        </label>
        <div className="ml-auto">{viewMenu}</div>
      </div>

      <div className="card">
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {visibleColumns.map((c) => (
                  <th key={c.key} className={c.headCls || TH_C}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-4 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : list.length === 0 ? (
                <tr>
                  <td colSpan={visibleColumns.length} className="px-4">
                    <ListEmpty
                      keyword={applied}
                      onClear={() => { setKeyword(''); setApplied(''); setDocType(''); setStatus(''); setOnlyCurrent(false); }}
                      title="暂无技术资料"
                      description="点右上角「新增资料」上传图纸/作业指导书/工艺参数"
                    />
                  </td>
                </tr>
              ) : (
                list.map((d) => (
                  <tr key={d.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(d)}
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
            page={pagination.page} pageSize={pagination.page_size} total={pagination.total}
            onPageChange={(page) => setPagination((p) => ({ ...p, page }))} loading={loading}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
          />
        </div>
      </div>

      <Modal title={editId ? '编辑技术资料' : '新增技术资料'} open={open} onCancel={() => setOpen(false)} onOk={handleSave} confirmLoading={saving} okText="保存" cancelText="取消" width={760}>
        <div className="space-y-3 py-2">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="md:col-span-2">
              <label className={labelCls}>标题 *</label>
              <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className={inputCls} placeholder="如：注塑作业指导书" />
            </div>
            <div>
              <label className={labelCls}>类型</label>
              <select value={form.doc_type} onChange={(e) => setForm({ ...form, doc_type: e.target.value })} className={inputCls}>
                {Object.entries(DOC_TYPE_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>版本</label>
              <input value={form.version} onChange={(e) => setForm({ ...form, version: e.target.value })} className={inputCls} placeholder="A / V1.2" />
            </div>
            <div>
              <label className={labelCls}>适用产品</label>
              <input value={form.product_name} onChange={(e) => setForm({ ...form, product_name: e.target.value })} className={inputCls} placeholder="留空 = 通用" />
            </div>
            <div>
              <label className={labelCls}>编制人</label>
              <input value={form.author} onChange={(e) => setForm({ ...form, author: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>生效日期</label>
              <input type="date" value={form.effective_date} onChange={(e) => setForm({ ...form, effective_date: e.target.value })} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>状态</label>
              <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={inputCls}>
                {Object.entries(DOC_STATUS_TEXT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label className={labelCls}>内容 / 工艺参数</label>
            <textarea
              value={form.content}
              onChange={(e) => setForm({ ...form, content: e.target.value })}
              rows={3}
              className={inputCls}
              placeholder="如：注塑温度 220±5℃；保压 3s；冷却 8s"
            />
          </div>
          <div>
            <label className={labelCls}>备注</label>
            <input value={form.remark} onChange={(e) => setForm({ ...form, remark: e.target.value })} className={inputCls} />
          </div>
        </div>
      </Modal>

      <Modal title={`${detail?.title || ''}（${detail?.version || ''}）`} open={!!detail} onCancel={() => setDetail(null)} footer={null} width={680}>
        {detail && (
          <div className="space-y-3 py-2 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><span className="text-gray-400">资料编号：</span>{detail.doc_no}</div>
              <div><span className="text-gray-400">类型：</span>{DOC_TYPE_TEXT[detail.doc_type] || detail.doc_type}</div>
              <div><span className="text-gray-400">适用产品：</span>{detail.product_name || '通用'}</div>
              <div><span className="text-gray-400">状态：</span>{DOC_STATUS_TEXT[detail.status] || detail.status}</div>
              <div><span className="text-gray-400">编制人：</span>{detail.author || '-'}</div>
              <div><span className="text-gray-400">生效日期：</span>{detail.effective_date ? String(detail.effective_date).slice(0, 10) : '-'}</div>
            </div>
            {detail.content && (
              <div className="border-t border-gray-100 pt-3">
                <div className="text-xs text-gray-400 mb-1">内容 / 工艺参数</div>
                <div className="whitespace-pre-wrap text-gray-800">{detail.content}</div>
              </div>
            )}
            {detail.remark && <div className="border-t border-gray-100 pt-3 text-gray-600">备注：{detail.remark}</div>}
          </div>
        )}
      </Modal>
    </div>
  );
}
