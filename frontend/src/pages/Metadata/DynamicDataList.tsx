import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Database, Search, Upload, Download, FileDown, Eye } from 'lucide-react';
import { Modal, Input, InputNumber, AutoComplete, DatePicker, Switch, Dropdown } from 'antd';
import { message } from '@/utils/appMessage';
import type { MenuProps } from 'antd';
import dayjs from 'dayjs';
import { entityApi, fieldApi, dynamicApi, layoutApi, fieldPermissionApi } from '@/api/metadata';
import { Entity, Field } from '@/types/metadata';
import { http } from '@/utils/request';
import { tableColumnLabel } from '@/utils/columnLabels';
import { pickDisplayValue } from '@/utils/fieldValue';
import { normalizeLayoutConfig } from '@/utils/layoutConfig';
import { buildDetailColumns } from '@/utils/entityLayout';
import { PageHeader } from '@/components/PageHeader';
import { RowActions } from '@/components/RowActions';
import { ImportModal } from '@/components/ImportModal';
import { RecordDetailModal } from '@/components/RecordDetailModal';
import { SearchSelect } from '@/components/SearchSelect';
import { TableSkeleton } from '@/components/TableSkeleton';
import { EmptyState } from '@/components/EmptyState';
import { ListEmpty } from '@/components/ListEmpty';
import { Pagination } from '@/components/Pagination';
import { confirmAction } from '@/utils/confirm';
import { useRequestGuard } from '@/hooks/useRequestGuard';
import { useListFiltersUrl } from '@/hooks/useListFiltersUrl';
import { useTableView } from '@/hooks/useTableView';
import { usePermission } from '@/hooks/usePermission';
import { loadOptions } from '@/utils/loadOptions';
import type { ReactNode } from 'react';

// 表单/字段池中不参与录入的元数据字段（作显示列仍可经“数据表列”添加，见 DISPLAY_SKIP）
const SKIP_COLUMNS = ['id', 'tenant_id', 'created_at', 'updated_at', 'deleted_at'];
// 列表渲染时直接跳过这些系统列（表列 created_at/updated_at 允许显示）
const DISPLAY_SKIP = ['id', 'tenant_id', 'deleted_at', 'ext', 'ext_fields'];

// 一列 = 布局配置里的一条 column：可命中元数据字段，也可只是真实数据表列（无 FieldDef）
interface ListColumn {
  code: string;
  label?: string;  // 布局里配置的显示名（可为空）
  width?: number;
  field?: Field;   // 命中字段管理定义（含权限）时为 Field
}

const templateMenuItems: MenuProps['items'] = [
  { key: 'csv', label: '下载 CSV 模板' },
  { key: 'xlsx', label: '下载 Excel 模板' },
];

const exportMenuItems: MenuProps['items'] = [
  { key: 'csv', label: '导出 CSV' },
  { key: 'xlsx', label: '导出 Excel' },
];

function renderFieldInput(field: Field, value: any, onChange: (v: any) => void, disabled = false) {
  const t = field.field_type;
  const required = field.is_required;
  if (t === 'number' || t === 'decimal') {
    return <InputNumber className="w-full" value={value} onChange={onChange} placeholder={field.name} disabled={disabled} />;
  }
  if (t === 'boolean') {
    return <Switch checked={!!value} onChange={onChange} disabled={disabled} />;
  }
  if (t === 'date') {
    return (
      <DatePicker
        className="w-full"
        value={value ? dayjs(value) : null}
        onChange={(d) => onChange(d ? d.format('YYYY-MM-DD') : undefined)}
        placeholder={field.name}
        disabled={disabled}
      />
    );
  }
  if (t === 'datetime') {
    return (
      <DatePicker
        showTime
        className="w-full"
        value={value ? dayjs(value) : null}
        onChange={(d) => onChange(d ? d.format('YYYY-MM-DD HH:mm:ss') : undefined)}
        placeholder={field.name}
        disabled={disabled}
      />
    );
  }
  // select：validation.options 仅作建议，支持「点选 + 自由输入」（2026-09-09 与业务表单 DynamicField 对齐，
  // 值不在选项内也允许保存；展示层对非选项值原样显示）
  if (t === 'select') {
    const options: any[] = field.validation?.options || [];
    const optItems = options
      .map((o) => {
        const raw = typeof o === 'object' ? String(o.value ?? '') : String(o ?? '');
        const label = typeof o === 'object' ? (String(o.label ?? '') || raw) : String(o);
        return { value: label, label, raw };
      })
      .filter((x) => x.value);
    // 回显：选项 {value,label} 时按存储值匹配展示 label；自由输入值不在选项中则原样显示
    const shown = optItems.find((x) => x.raw === String(value ?? ''))?.label ?? (value == null ? '' : String(value));
    return (
      <AutoComplete
        className="w-full"
        value={shown}
        options={optItems}
        placeholder={field.name}
        disabled={disabled}
        filterOption={(input, option) =>
          String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
        }
        onChange={(v) => onChange(typeof v === 'string' ? v : String(v ?? ''))}
        onSelect={(_, opt) => {
          if (opt && typeof opt.raw === 'string') onChange(opt.raw);
        }}
      />
    );
  }
  return <Input value={value ?? ''} onChange={(e) => onChange(e.target.value)} placeholder={field.name} disabled={disabled} />;
}

export function DynamicDataList() {
  // [2026-09-18 权限细化·第4批] 动态数据（自定义实体）CRUD 跟随元数据四件套
  const { has } = usePermission();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [fields, setFields] = useState<Field[]>([]);
  const [layout, setLayout] = useState<any>(null);
  const [formLayout, setFormLayout] = useState<any>(null);
  const [fieldPerms, setFieldPerms] = useState<Record<string, string> | null>(null); // null=全部可写(super_admin)
  // [易用性 P1] 实体/关键词/页码写入 URL：切到某实体的链接可直接分享，刷新不丢当前实体
  const { initial: urlFilters, syncUrl } = useListFiltersUrl({ entity: '', keyword: '', page: 1, page_size: 10 });
  const [keyword, setKeyword] = useState(urlFilters.keyword);
  const [entityCode, setEntityCode] = useState(urlFilters.entity);
  const [list, setList] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  // [易用性] 「查看」详情弹窗：只读，展示实体全部字段（含未进列表布局的自定义字段）
  const [detail, setDetail] = useState<any | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [pagination, setPagination] = useState({ page: urlFilters.page, page_size: urlFilters.page_size, total: 0 });
  const [importOpen, setImportOpen] = useState(false);
  // 请求竞态守卫：实体快速切换/搜索/翻页时丢弃过期响应，防止 A 实体布局/数据覆盖 B 实体
  const { nextSeq, isCurrent } = useRequestGuard();

  useEffect(() => {
    entityApi.list({ page: 1, page_size: 1000 }).then(res => {
      if (res.code === 0) {
        const list = res.data?.list ?? [];
        setEntities(list);
        if (list.length > 0 && !entityCode) setEntityCode(list[0].code);
      }
    });
  }, []);

  const fetchFields = useCallback(async (code: string) => {
    const seq = nextSeq(); // [竞态守卫] 本次实体布局请求序号
    const ent = entities.find(e => e.code === code);
    if (!ent) {
      if (isCurrent(seq)) { setFields([]); setLayout(null); setFormLayout(null); setFieldPerms(null); }
      return;
    }
    // [2026-09-14] 失败隔离：单项失败不影响其它（此前 Promise.all 一拒全空；
    // 布局/权限本就允许缺失——loadOptions 统一降级为 undefined）
    const [res, layoutRes, formRes, permsRes] = await loadOptions([
      fieldApi.list(ent.id),
      // 无默认布局时后端返回错误 → 降级，不影响字段加载
      layoutApi.getDefault(ent.id, 'list'),
      // 表单级布局（form sections 分组）
      layoutApi.getDefault(ent.id, 'form'),
      // 字段级权限：super_admin 返回 {}，其余返回 {字段: read|write|none}
      fieldPermissionApi.my(ent.id),
    ], '动态数据');
    if (!isCurrent(seq)) return; // 已切换到其他实体 → 丢弃本次过期布局，防止串台
    if (res?.code === 0) setFields((res.data ?? []).filter(f => !SKIP_COLUMNS.includes(f.code)));
    // 归一化历史默认布局（顶层 columns 旧格式 → table.columns），避免布局不生效
    const listCfg = layoutRes?.code === 0 ? normalizeLayoutConfig(layoutRes.data?.config, 'list') : null;
    if (listCfg?.table?.columns?.length) {
      setLayout(listCfg);
    } else {
      setLayout(null);
    }
    const formCfg = formRes?.code === 0 ? normalizeLayoutConfig(formRes.data?.config, 'form') : null;
    setFormLayout(formRes?.code === 0 && formRes.data ? { ...formRes.data, config: formCfg } : null);
    setFieldPerms(permsRes?.code === 0 ? (permsRes.data ?? {}) : {});
  }, [entities, nextSeq, isCurrent]);

  useEffect(() => {
    if (entityCode) fetchFields(entityCode);
  }, [entityCode, fetchFields]);

  // [易用性 P1] 当前实体/关键词/页码 → 写回 URL（可把“某实体某一页”链接发给同事）
  useEffect(() => {
    syncUrl({ entity: entityCode, keyword, page: pagination.page, page_size: pagination.page_size });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entityCode, keyword, pagination.page, pagination.page_size]);

  const fetchList = useCallback(async () => {
    if (!entityCode) return;
    const seq = nextSeq(); // [竞态守卫] 本次列表请求序号
    setLoading(true);
    try {
      const params: any = { page: pagination.page, page_size: pagination.page_size };
      // 布局驱动的搜索：命中默认布局 header.searchFields 第一个字段，走后端白名单 filters
      // （后端按 JSON 字符串解析 filters，字段白名单校验防注入）
      if (keyword && layout?.header?.searchFields?.[0]) {
        params.filters = JSON.stringify([{ field: layout.header.searchFields[0], op: 'like', value: keyword }]);
      }
      const res = await dynamicApi.list(entityCode, params);
      if (res.code === 0) {
        if (!isCurrent(seq)) return; // 已有更新的请求，丢弃过期响应
        setList(res.data?.list ?? []);
        setPagination(prev => ({ ...prev, total: res.data?.total ?? 0 }));
      }
    } catch {
      // 静默
    } finally {
      if (isCurrent(seq)) setLoading(false); // 仅最新请求结束才收起 loading
    }
  }, [entityCode, pagination.page, pagination.page_size, keyword, layout, nextSeq, isCurrent]);

  useEffect(() => { fetchList(); }, [fetchList]);

  // 字段级权限：null=全部可写；否则返回字段访问级别（默认 write）
  const permLevel = (code: string): string => {
    if (!fieldPerms) return 'write';
    return fieldPerms[code] || 'write';
  };
  const isFieldHidden = (code: string) => permLevel(code) === 'none';
  const isFieldReadonly = (code: string) => permLevel(code) === 'read';

  // 布局驱动列：优先使用默认布局 table.columns（保留顺序/宽度/标签）。
  // 列既可是「字段管理」中的元数据字段，也可是真实数据表列（系统内置，如 spec/barcode/sale_price）。
  // 表列没有 FieldDef，直接按行数据渲染；此前用 fields.find 过滤会把这些列整体丢弃（加的列不显示）。
  // none 权限过滤仅对元数据字段生效；无布局时降级显示前 8 个可见字段。
  const visibleCols = useMemo<ListColumn[]>(() => {
    const cols = layout?.table?.columns;
    if (Array.isArray(cols) && cols.length > 0) {
      return cols
        .map((c: any): ListColumn => ({
          code: c.field,
          label: c.label,
          width: c.width,
          field: fields.find(f => f.code === c.field),
        }))
        .filter((x: ListColumn) => !!x.code && !DISPLAY_SKIP.includes(x.code))
        .filter((x: ListColumn) => !(x.field && isFieldHidden(x.field.code)));
    }
    return fields
      .filter((f: Field) => !isFieldHidden(f.code))
      .slice(0, 8)
      .map((f: Field): ListColumn => ({ code: f.code, field: f }));
  }, [layout, fields, fieldPerms]);

  // 列显示名回退链：布局显式显示名(非原始列码且非乱码问号) → 元数据字段中文名 → 系统表列中文名 → 原始列码
  const colDisplayLabel = (c: ListColumn) => {
    const raw = c.label;
    const explicit = raw && raw !== c.code && !raw.includes('?') ? raw : '';
    return explicit || c.field?.name || tableColumnLabel(c.code) || c.code;
  };

  // [2026-09-13] 我的视图（列勾选/排序/改名/预设/分享）：**列定义仍是布局驱动的**（布局决定有哪些列），
  // 视图只决定“我看哪几列”，且**按实体分桶**（切换实体 = 切换命名空间，互不干扰）
  interface RowCol {
    key: string;
    header: ReactNode;
    width?: number;
    cell: (row: Record<string, any>) => ReactNode;
  }
  const tableCols: RowCol[] = useMemo(
    () => [
      ...visibleCols.map((c): RowCol => ({
        key: c.code,
        header: colDisplayLabel(c),
        width: c.width,
        cell: (row) => cellText(c, pickDisplayValue(row, c.code)),
      })),
      {
        key: '__actions',
        header: '操作',
        cell: (row) => (
          <RowActions
            actions={[
              { key: 'view', label: '查看', icon: <Eye className="w-4 h-4" />, onClick: () => setDetail(row) },
              ...(has('metadata_edit')
                ? [{ key: 'edit', label: '编辑', icon: <Pencil className="w-4 h-4" />, onClick: () => openEdit(row) }]
                : []),
              // handleDelete 内部自带二次确认，此处不再重复
              ...(has('metadata_delete')
                ? [{ key: 'del', label: '删除', icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => handleDelete(row) }]
                : []),
            ]}
          />
        ),
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [visibleCols, fields, fieldPerms],
  );
  const { visibleColumns, menu: viewMenu } = useTableView({
    pageKey: `metadata-data-${entityCode || 'none'}`,
    paramNs: entityCode || 'none',
    columns: tableCols,
    locked: { trailing: ['__actions'] },
  });

  // [2026-09-11] 详情列 = 列表列（去操作列）+ **未进列表布局的字段**（none 权限字段仍隐藏）
  // 详情不应受列表布局裁剪：自定义字段没被加进布局 list 列时，查看也不该丢（用户反馈“我自定义的会员看不到”）
  const detailCols = useMemo(() => buildDetailColumns<Record<string, any>>({
    listColumns: visibleCols.map((c) => ({
      key: c.code,
      header: colDisplayLabel(c),
      cell: (row: Record<string, any>) => cellText(c, pickDisplayValue(row, c.code)),
    })),
    metaFields: fields.filter((f) => !isFieldHidden(f.code)),
    renderField: (code, row) => {
      const c = visibleCols.find((x) => x.code === code) || ({ code, field: fields.find((f) => f.code === code) } as ListColumn);
      return cellText(c, pickDisplayValue(row, code));
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [visibleCols, fields, fieldPerms]);

  // 顶部搜索字段的显示名（搜索字段必须是字段管理里的字段或核心列）
  const searchCode = layout?.header?.searchFields?.[0] as string | undefined;
  const searchLabel = searchCode
    ? fields.find(x => x.code === searchCode)?.name || tableColumnLabel(searchCode) || searchCode
    : '';

  const openCreate = () => {
    setEditing(null);
    setForm({});
    setModalOpen(true);
  };

  const openEdit = (row: any) => {
    setEditing(row);
    const next: Record<string, any> = {};
    for (const f of fields) {
      next[f.code] = row[f.code] ?? undefined;
    }
    setForm(next);
    setModalOpen(true);
  };

  const handleSave = async () => {
    try {
      if (editing) {
        const res = await dynamicApi.update(entityCode, editing.id, form);
        if (res.code !== 0) { message.error(res.message || '更新失败'); return; }
        message.success('已更新');
      } else {
        const res = await dynamicApi.create(entityCode, form);
        if (res.code !== 0) { message.error(res.message || '创建失败'); return; }
        message.success('已创建');
      }
      setModalOpen(false);
      fetchList();
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '保存失败');
    }
  };

  const handleDelete = async (row: any) => {
    if (!(await confirmAction({ title: '确定删除该条数据吗？', content: '删除后不可恢复', danger: true }))) return;
    const res = await dynamicApi.delete(entityCode, row.id);
    if (res.code === 0) { message.success('已删除'); fetchList(); }
    else message.error(res.message || '删除失败');
  };

  const saveBlob = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleDownloadTemplate = async (format: 'csv' | 'xlsx') => {
    if (!entityCode) return;
    try {
      const blob = await http.download(`/v1/export/meta-template?entity=${entityCode}&format=${format}`);
      saveBlob(blob, `${entityCode}_template.${format}`);
      message.success('模板已下载');
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '模板下载失败');
    }
  };

  const handleExport = async (format: 'csv' | 'xlsx') => {
    if (!entityCode) return;
    try {
      const blob = await http.download(`/v1/export/meta?entity=${entityCode}&format=${format}`);
      saveBlob(blob, `${entityCode}_export.${format}`);
      message.success('导出成功');
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '导出失败');
    }
  };

  const handleImportDone = () => {
    setPagination(prev => ({ ...prev, page: 1 }));
    fetchList();
  };

  const displayName = entities.find(e => e.code === entityCode)?.name || entityCode;

  // 表单级布局：按 layout.form.sections 分组渲染（title + 字段顺序），无配置时降级为全部字段；过滤 none 权限字段
  const formSections = useMemo(() => {
    const sections = formLayout?.config?.sections;
    if (!Array.isArray(sections) || sections.length === 0) return null;
    return sections
      .map((s: any) => ({
        title: s.title || '未命名分组',
        gridCols: s.gridCols || 2,
        fields: (s.fields || [])
          .map((f: any) => fields.find(fd => fd.code === f.field))
          .filter(Boolean)
          .filter((f: any) => !isFieldHidden(f.code)) as Field[],
      }))
      .filter((s: any) => s.fields.length > 0);
  }, [formLayout, fields, fieldPerms]);

  // 未出现在任何分组中的非核心字段 → 归入“其他字段”组，避免数据丢失（同时过滤 none 权限字段）
  const extraFormFields = useMemo(() => {
    if (!formSections) return fields.filter(f => !f.is_core && !isFieldHidden(f.code));
    const grouped = new Set<string>();
    formSections.forEach((s: any) => s.fields.forEach((f: Field) => grouped.add(f.code)));
    return fields.filter(f => !f.is_core && !grouped.has(f.code) && !isFieldHidden(f.code));
  }, [formSections, fields, fieldPerms]);

  return (
    <div className="space-y-6">
      <PageHeader
        title={displayName}
        subtitle="元数据动态实体数据管理（支持按字段定义导入/导出）"
        extra={
          entityCode ? (
            <div className="flex items-center gap-2 flex-wrap">
              <Dropdown menu={{ items: templateMenuItems, onClick: ({ key }) => handleDownloadTemplate(key as 'csv' | 'xlsx') }}>
                <button className="btn-secondary flex items-center gap-1.5">
                  <FileDown className="w-4 h-4" />
                  <span className="hidden md:inline">下载模板</span>
                </button>
              </Dropdown>
              {has('metadata_create') && (
                <button onClick={() => setImportOpen(true)} className="btn-secondary flex items-center gap-1.5">
                  <Upload className="w-4 h-4" />
                  <span className="hidden md:inline">导入</span>
                </button>
              )}
              <Dropdown menu={{ items: exportMenuItems, onClick: ({ key }) => handleExport(key as 'csv' | 'xlsx') }}>
                <button className="btn-secondary flex items-center gap-1.5">
                  <Download className="w-4 h-4" />
                  <span className="hidden md:inline">导出</span>
                </button>
              </Dropdown>
              {has('metadata_create') && (
                <button onClick={openCreate} className="btn-primary flex items-center gap-2">
                  <Plus className="w-5 h-5" />
                  <span className="hidden md:inline">新增数据</span>
                </button>
              )}
            </div>
          ) : undefined
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 space-y-3">
          <div className="flex items-center gap-2 max-w-md">
            <Database className="w-4 h-4 text-gray-400" />
            <SearchSelect
              value={entityCode}
              onChange={(v) => { setEntityCode(v ?? ''); setKeyword(''); setPagination(prev => ({ ...prev, page: 1 })); }}
              placeholder="请选择实体"
              options={entities.map(e => ({ value: e.code, label: `${e.name}（${e.code}）` }))}
            />
          </div>
          {layout?.header?.searchFields?.[0] && (
            <div className="relative flex-1 min-w-[160px] max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input
                type="text"
                value={keyword}
                onChange={e => { setKeyword(e.target.value); setPagination(prev => ({ ...prev, page: 1 })); }}
                placeholder={`搜索${searchLabel}...`}
                className="form-input pl-10"
              />
            </div>
          )}
          <div className="flex justify-end">{viewMenu}</div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {visibleColumns.map(c => (
                  <th key={c.key} style={c.width ? { width: c.width } : undefined} className={c.key === '__actions' ? 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider' : 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider'}>{c.header}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={visibleColumns.length} className="px-6 py-4"><TableSkeleton rows={5} /></td></tr>
              ) : list.length === 0 ? (
                <tr><td colSpan={visibleColumns.length} className="px-6"><ListEmpty keyword={keyword} onClear={() => setKeyword('')} title="暂无数据" description="选择上方实体查看其动态数据" /></td></tr>
              ) : (
                list.map(row => (
                  <tr key={row.id} className="hover:bg-gray-50 transition-colors">
                    {visibleColumns.map(c => (
                      <td key={c.key} className={c.key === '__actions' ? 'px-6 py-4 whitespace-nowrap text-right' : 'px-6 py-4 whitespace-nowrap text-gray-700 text-sm max-w-[200px] truncate'}>
                        {c.cell(row)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {!loading && list.length > 0 && (
          <Pagination
            page={pagination.page}
            pageSize={pagination.page_size}
            total={pagination.total}
            onPageChange={(page) => setPagination(prev => ({ ...prev, page }))}
            loading={loading}
            onPageSizeChange={(size) => setPagination(prev => ({ ...prev, page: 1, page_size: size }))}
          />
        )}
      </div>

      {/* [易用性] 只读详情：字段名 : 值，与列表同一套取值/中文渲染 */}
      <RecordDetailModal
        open={!!detail}
        title={`${displayName}详情`}
        record={detail}
        columns={detailCols}
        onClose={() => setDetail(null)}
      />

      <Modal
        title={editing ? '编辑数据' : '新增数据'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText="保存"
        cancelText="取消"
        width={formSections ? 760 : 640}
        destroyOnHidden
      >
        <div className="space-y-6">
          {formSections ? (
            <>
              {formSections.map((sec, i) => (
                <div key={i}>
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-100">
                    <span className="w-1 h-4 bg-blue-500 rounded-full" />
                    <span className="text-sm font-semibold text-gray-800">{sec.title}</span>
                  </div>
                  <div className={`grid gap-4 ${sec.gridCols > 2 ? 'grid-cols-1 md:grid-cols-3' : 'grid-cols-1 md:grid-cols-2'}`}>
                    {sec.fields.map(field => (
                      <div key={field.id} className={field.field_type === 'textarea' ? 'md:col-span-2 md:col-span-3' : ''}>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {field.name}{field.is_required && !isFieldReadonly(field.code) && ' *'}
                        </label>
                        {renderFieldInput(field, form[field.code], (v) => setForm(prev => ({ ...prev, [field.code]: v })), isFieldReadonly(field.code))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
              {extraFormFields.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-3 pb-2 border-b border-gray-100">
                    <span className="w-1 h-4 bg-gray-300 rounded-full" />
                    <span className="text-sm font-semibold text-gray-800">其他字段</span>
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {extraFormFields.map(field => (
                      <div key={field.id} className={field.field_type === 'textarea' ? 'md:col-span-2' : ''}>
                        <label className="block text-sm font-medium text-gray-700 mb-2">
                          {field.name}{field.is_required && !isFieldReadonly(field.code) && ' *'}
                        </label>
                        {renderFieldInput(field, form[field.code], (v) => setForm(prev => ({ ...prev, [field.code]: v })), isFieldReadonly(field.code))}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {fields.filter(f => !f.is_core && !isFieldHidden(f.code)).map(field => (
                <div key={field.id} className={field.field_type === 'textarea' ? 'md:col-span-2' : ''}>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    {field.name}{field.is_required && !isFieldReadonly(field.code) && ' *'}
                  </label>
                  {renderFieldInput(field, form[field.code], (v) => setForm(prev => ({ ...prev, [field.code]: v })), isFieldReadonly(field.code))}
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>

      {/* 动态实体导入：统一走 ImportModal（预览 → 确认），列由字段定义生成 */}
      {entityCode && (
        <ImportModal
          open={importOpen}
          title={`批量导入${displayName}（CSV / Excel）`}
          importUrl={`/v1/import/meta?entity=${entityCode}`}
          templateUrl={`/v1/export/meta-template?entity=${entityCode}&format=csv`}
          templateUrlXlsx={`/v1/export/meta-template?entity=${entityCode}&format=xlsx`}
          templateHint={fields.map((f) => `${f.name}(${f.code})`).join(', ')}
          hintExtra="建议先下载模板：列名带字段编码，预览不会写入数据。"
          onClose={() => setImportOpen(false)}
          onSuccess={handleImportDone}
        />
      )}
    </div>
  );
}

/** 带列语义的单元格文本：select 选项 label / 枚举 / 时间 / 布尔 / 空值 中文化；其余原样 */
function cellText(col: ListColumn, v: any): string {
  if (v === null || v === undefined || v === '') return '-';
  // select/multiselect：选项为 {value,label} 时优先显示 label（选项为纯字符串则显示原值）
  if (col.field && (col.field.field_type === 'select' || col.field.field_type === 'multiselect')) {
    const opts: any[] = col.field.validation?.options || [];
    if (Array.isArray(opts) && opts.length > 0 && opts.some(o => typeof o === 'object')) {
      const arr = Array.isArray(v) ? v : [v];
      const mapped = arr.map((item) => {
        const o = opts.find(x => typeof x === 'object' && String(x.value) === String(item));
        if (o && typeof o === 'object' && o.label != null) return String(o.label);
        return item;
      });
      return mapped.join('、') || '-';
    }
  }
  if (typeof v === 'boolean') return v ? '是' : '否';
  if (typeof v === 'object') return JSON.stringify(v);
  const code = (col.code || '').toLowerCase();
  // 时间列：字段类型 date/datetime 或列名以 _at/date 结尾 → 短格式
  if (col.field?.field_type === 'date' || col.field?.field_type === 'datetime' || /(_at|date)$/.test(code)) {
    const s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const d = dayjs(s);
    return d.isValid() ? d.format('YYYY-MM-DD HH:mm') : s;
  }
  // 核心枚举列 → 中文
  if (ENUM_COLUMN_CODES.has(code)) {
    const s = String(v);
    return COMMON_ENUM_TEXT[s.toLowerCase()] || s;
  }
  // decimal 类型动态字段：金额/价格惯例统一两位小数（数量类自定义字段请用 number/float 类型，避免被收敛）
  if (col.field?.field_type === 'decimal') {
    const n = Number(v);
    return isNaN(n) ? String(v) : n.toFixed(2);
  }
  return String(v);
}

// 动态数据页“核心枚举列”值 → 中文（其余自定义字段/列按原值展示，不误伤）
const ENUM_COLUMN_CODES = new Set([
  'status', 'payment_status', 'source', 'product_type', 'cost_method',
  'approval_status', 'customer_progress', 'progress', 'currency_type', 'order_status',
]);
// 全局业务枚举值 → 中文（覆盖状态机/支付/来源/类型等通用取值）
const COMMON_ENUM_TEXT: Record<string, string> = {
  draft: '草稿', confirmed: '已确认', approved: '已审核', closed: '已关闭',
  cancelled: '已取消', canceled: '已取消', completed: '已完成',
  active: '启用', inactive: '停用', enabled: '开启', disabled: '停用',
  paid: '已付', unpaid: '未付', partial: '部分付款', pending: '待处理',
  submitted: '已提交', rejected: '已驳回', in_progress: '进行中', awaiting: '待处理',
  normal: '正常', returned: '已退货', received: '已收', fulfilled: '已完成',
  manual: '人工创建', portal: '客户下单', goods: '商品', service: '服务',
  combo: '组装商品', material: '原料', semi: '半成品', product: '成品',
  fifo: '先进先出', lifo: '后进先出', avg: '平均成本', weighted: '加权平均',
};
