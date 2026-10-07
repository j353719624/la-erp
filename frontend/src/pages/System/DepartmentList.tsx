import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Plus,
  Pencil,
  Trash2,
  Building2,
  ChevronRight,
  ChevronDown,
  Search,
  Users,
  GripVertical,
  ArrowUpToLine,
} from 'lucide-react';
import { Modal, Input, Select, Tooltip } from 'antd';
import { message } from '@/utils/appMessage';
import { departmentApi, userApi } from '@/api/system';
import { Department } from '@/types';
import { PageHeader } from '@/components/PageHeader';
import { TableSkeleton } from '@/components/TableSkeleton';
import { ListEmpty } from '@/components/ListEmpty';
import { confirmAction } from '@/utils/confirm';
import { loadOptions } from '@/utils/loadOptions';
import { usePermission } from '@/hooks/usePermission';

const ROOT_KEY = '__root__';

/**
 * 部门管理（组织架构可视化，2026-09-17 改造）。
 *
 * 痛点：此前是平铺表格 + 「└」缩进 —— 看不清层级、不知道怎么加子部门、改归属全靠编辑弹窗。
 * 现在：组织架构树（所见即所得）：
 *  - 节点行内直接「＋ 子部门 / 编辑 / 删除」；
 *  - 拖动节点调整归属（拖到某部门上=成为其子部门；拖到顶部虚线区=移为顶级）；
 *  - 成环由服务端「移动归属」接口强制拦截（前端只做体验层提示）。
 */
export function DepartmentList() {
  // [2026-09-18 权限细化] 按钮级门控：新增·＋子部门=department_create / 编辑·拖拽归属=department_edit / 删除=department_delete
  const { has } = usePermission();
  const [allDepts, setAllDepts] = useState<Department[]>([]);
  const [memberCount, setMemberCount] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [keyword, setKeyword] = useState('');
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()); // 默认全展开，记录的是「已收起」的节点

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Department | null>(null);
  const [createParent, setCreateParent] = useState<Department | null>(null); // 快捷「＋ 子部门」的目标
  const [form, setForm] = useState<Partial<Department>>({});
  // [2026-09-19 人事报表] 编制人数（字符串输入；空 = 清除编制）
  const [hcInput, setHcInput] = useState('');

  // 拖拽状态：draggingId=正在拖的部门；dropTarget=当前悬停的目标（部门 id 或 ROOT_KEY）
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const fetchList = useCallback(async () => {
    setLoading(true);
    try {
      // [2026-09-14] 失败隔离：任一接口失败不影响另一项（用户数仅用于成员徽标，403 时自动隐藏）
      const [res, usersRes] = await loadOptions(
        [departmentApi.list({ page: 1, page_size: 1000 }), userApi.list({ page: 1, page_size: 1000 } as any)],
        '部门',
      );
      if (res?.code === 0) {
        setAllDepts(res.data?.list || []);
      }
      if (usersRes?.code === 0) {
        const counts: Record<string, number> = {};
        for (const u of (usersRes.data?.list || []) as Array<{ department_id?: string | null }>) {
          if (u.department_id) counts[u.department_id] = (counts[u.department_id] || 0) + 1;
        }
        setMemberCount(counts);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchList(); }, [fetchList]);

  // id → 部门映射
  const deptMap = useMemo(() => {
    const m: Record<string, Department> = {};
    for (const d of allDepts) m[d.id] = d;
    return m;
  }, [allDepts]);

  // 组织架构树：parent → children（孤儿节点——父级已删——按顶级展示，避免数据"消失"）
  const childrenMap = useMemo(() => {
    const ids = new Set(allDepts.map((d) => d.id));
    const map = new Map<string, Department[]>();
    for (const d of allDepts) {
      const pid = d.parent_id && ids.has(d.parent_id) ? d.parent_id : ROOT_KEY;
      const arr = map.get(pid) || [];
      arr.push(d);
      map.set(pid, arr);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));
    }
    return map;
  }, [allDepts]);

  const roots = childrenMap.get(ROOT_KEY) || [];

  // 某部门的全部后代（拖拽防环：不能拖到自己的子孙下）
  const descendantIdsOf = useCallback(
    (id: string): Set<string> => {
      const out = new Set<string>();
      const walk = (pid: string) => {
        for (const d of allDepts) {
          if (d.parent_id === pid && !out.has(d.id)) {
            out.add(d.id);
            walk(d.id);
          }
        }
      };
      walk(id);
      return out;
    },
    [allDepts],
  );

  // 搜索：命中节点 + 其全部祖先保持可见（否则搜索"深层的部门"会看不到路径）
  const visibleIds = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return null;
    const visible = new Set<string>();
    for (const d of allDepts) {
      if (d.name.toLowerCase().includes(kw) || d.code.toLowerCase().includes(kw)) {
        visible.add(d.id);
        let cur = d.parent_id || null;
        while (cur && !visible.has(cur)) {
          visible.add(cur);
          cur = deptMap[cur]?.parent_id || null;
        }
      }
    }
    return visible;
  }, [allDepts, keyword, deptMap]);
  const searching = visibleIds !== null;

  const stats = useMemo(() => {
    let active = 0;
    for (const d of allDepts) if (d.status === 'active') active += 1;
    return { total: allDepts.length, active, inactive: allDepts.length - active };
  }, [allDepts]);

  const toggleCollapse = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const expandAll = () => setCollapsed(new Set());
  const collapseAll = () =>
    setCollapsed(new Set(allDepts.filter((d) => (childrenMap.get(d.id) || []).length > 0).map((d) => d.id)));

  // ── 弹窗：新增 / 编辑（新增支持「在某部门下建子部门」） ──
  const openCreate = (parent?: Department) => {
    setEditing(null);
    setCreateParent(parent || null);
    setForm({ code: '', name: '', status: 'active', remark: '', parent_id: parent?.id || null });
    setHcInput('');
    setModalOpen(true);
  };

  const openEdit = (item: Department) => {
    setEditing(item);
    setCreateParent(null);
    setForm({ ...item });
    setHcInput(item.headcount != null ? String(item.headcount) : '');
    setModalOpen(true);
  };

  // 编辑时排除自己及其所有后代（防成环——服务端同样会拦）
  const descendantIds = useMemo(
    () => (editing ? descendantIdsOf(editing.id) : new Set<string>()),
    [editing, descendantIdsOf],
  );

  const parentOptions = useMemo(
    () =>
      allDepts
        .filter((d) => d.id !== editing?.id && !descendantIds.has(d.id))
        .map((d) => ({
          value: d.id,
          label: `${d.name}（${d.code}）${d.status === 'active' ? '' : ' [停用]'}`,
        })),
    [allDepts, editing, descendantIds],
  );

  const handleSave = async () => {
    if (!form.code || !form.name) {
      message.warning('请填写部门编码和名称');
      return;
    }
    const hc = hcInput.trim() === '' ? null : Math.max(0, Math.floor(Number(hcInput)));
    if (hc !== null && Number.isNaN(hc)) { message.warning('编制人数请填写非负整数'); return; }
    try {
      if (editing) {
        // 上级变了（含清空为顶级）→ 先走「移动归属」（可把部门移到顶级；服务端防成环）
        const oldParent = editing.parent_id || null;
        const newParent = form.parent_id || null;
        if (oldParent !== newParent) {
          const moveRes = await departmentApi.move(editing.id, newParent);
          if (moveRes.code !== 0) { message.error(moveRes.message || '调整上级失败'); return; }
        }
        const res = await departmentApi.update(editing.id, {
          name: form.name,
          status: form.status,
          remark: form.remark || null,
          headcount: hc,
        });
        if (res.code !== 0) { message.error(res.message || '更新失败'); return; }
        message.success('已更新');
      } else {
        const res = await departmentApi.create({
          code: form.code,
          name: form.name,
          status: form.status,
          remark: form.remark || null,
          headcount: hc,
          parent_id: form.parent_id || null,
        });
        if (res.code !== 0) { message.error(res.message || '创建失败'); return; }
        message.success(createParent ? `已在「${createParent.name}」下创建子部门` : '已创建');
      }
      setModalOpen(false);
      fetchList();
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '保存失败');
    }
  };

  const handleDelete = async (item: Department) => {
    if (!(await confirmAction({
      title: `确定删除部门 ${item.name} 吗？`,
      content: '部门下有用户或子部门时无法删除；如只是不再使用，建议改为「停用」',
      danger: true,
    }))) return;
    try {
      const res = await departmentApi.delete(item.id);
      if (res.code === 0) { message.success('已删除'); fetchList(); }
      else message.error(res.message || '删除失败');
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '删除失败');
    }
  };

  // ── 拖拽调整归属 ──
  const canDrop = (sourceId: string, targetId: string): boolean => {
    if (sourceId === targetId) return false;
    if (targetId === ROOT_KEY) return true;
    return !descendantIdsOf(sourceId).has(targetId);
  };

  const handleDragStart = (e: React.DragEvent, d: Department) => {
    setDraggingId(d.id);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', d.id);
  };

  const handleDragOverNode = (e: React.DragEvent, targetId: string) => {
    if (!draggingId || !canDrop(draggingId, targetId)) return; // 非法目标：不 preventDefault → 显示禁止光标
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (dropTarget !== targetId) setDropTarget(targetId);
  };

  const handleDrop = async (e: React.DragEvent, targetId: string | null) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData('text/plain') || draggingId;
    setDropTarget(null);
    setDraggingId(null);
    if (!sourceId) return;
    const target = targetId === null ? null : deptMap[targetId];
    if (targetId !== null && !target) return;
    if (targetId !== null && !canDrop(sourceId, targetId)) {
      message.warning('不能移动到自身或其子部门下');
      return;
    }
    const source = deptMap[sourceId];
    if (!source) return;
    if ((source.parent_id || null) === (target?.id || null)) return; // 没变化
    const ok = await confirmAction({
      title: `将「${source.name}」移动到${target ? `「${target.name}」下` : '顶级部门'}？`,
      content: target ? '移动后该部门及其子部门的数据归属层级随之变化' : '移动后该部门成为顶级部门',
    });
    if (!ok) return;
    try {
      const res = await departmentApi.move(sourceId, target?.id || null);
      if (res.code === 0) {
        message.success('已调整归属');
        fetchList();
      } else {
        message.error(res.message || '调整归属失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '调整归属失败');
    }
  };

  const draggingName = draggingId ? deptMap[draggingId]?.name : '';

  // ── 树节点渲染 ──
  const renderNode = (d: Department, depth: number): React.ReactNode => {
    if (visibleIds && !visibleIds.has(d.id)) return null;
    const children = childrenMap.get(d.id) || [];
    const hasChildren = children.length > 0;
    const isCollapsed = collapsed.has(d.id) && !searching;
    const members = memberCount[d.id] || 0;

    return (
      <div key={d.id}>
        <div
          draggable={has('department_edit')}
          onDragStart={(e) => handleDragStart(e, d)}
          onDragEnd={() => { setDraggingId(null); setDropTarget(null); }}
          onDragOver={(e) => handleDragOverNode(e, d.id)}
          onDrop={(e) => handleDrop(e, d.id)}
          className={`group flex items-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
            dropTarget === d.id
              ? 'border-blue-400 bg-blue-50/60 ring-1 ring-blue-300'
              : 'border-transparent hover:bg-gray-50'
          } ${draggingId === d.id ? 'opacity-40' : ''}`}
        >
          {/* 层级导线：每个祖先一层左侧竖线，一眼看清归属深度 */}
          {Array.from({ length: depth }).map((_, i) => (
            <span key={i} className="w-4 self-stretch border-l border-gray-200" />
          ))}

          {hasChildren ? (
            <button
              type="button"
              onClick={() => toggleCollapse(d.id)}
              className="p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100"
              title={isCollapsed ? '展开子部门' : '收起子部门'}
            >
              {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          ) : (
            <span className="w-5" />
          )}

          <Building2 className={`w-4 h-4 flex-shrink-0 ${d.status === 'active' ? 'text-blue-500' : 'text-gray-300'}`} />
          <span
            className={`font-medium truncate ${d.status === 'active' ? 'text-gray-900' : 'text-gray-400'}`}
            title={d.name}
          >
            {d.name}
          </span>
          <span className="hidden sm:inline-block font-mono text-[11px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500 flex-shrink-0">
            {d.code}
          </span>
          {d.status !== 'active' && (
            <span className="text-[11px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-500 flex-shrink-0">停用</span>
          )}
          {members > 0 && (
            <span className="inline-flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
              <Users className="w-3 h-3" />
              {members}
            </span>
          )}
          {d.remark && (
            <Tooltip title={d.remark}>
              <span className="hidden lg:inline-block text-xs text-gray-300 truncate max-w-[160px] cursor-help">{d.remark}</span>
            </Tooltip>
          )}

          {/* 行内快捷操作：移动端常显（无 hover），桌面端悬停显示 */}
          <div className="ml-auto flex items-center gap-1 md:opacity-0 md:group-hover:opacity-100 md:focus-within:opacity-100 flex-shrink-0">
            {has('department_create') && (
              <Tooltip title="新增子部门">
                <button
                  type="button"
                  onClick={() => openCreate(d)}
                  className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
              </Tooltip>
            )}
            {has('department_edit') && (
              <Tooltip title="编辑">
                <button
                  type="button"
                  onClick={() => openEdit(d)}
                  className="p-1.5 text-gray-500 hover:bg-gray-100 rounded-lg transition-colors"
                >
                  <Pencil className="w-4 h-4" />
                </button>
              </Tooltip>
            )}
            {has('department_delete') && (
              <Tooltip title="删除">
                <button
                  type="button"
                  onClick={() => handleDelete(d)}
                  className="p-1.5 text-red-500 hover:bg-red-50 rounded-lg transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </Tooltip>
            )}
            <Tooltip title="按住拖动：调整上级（拖到某部门=成为其子部门，拖到顶部虚线区=移为顶级）">
              <span className="p-1.5 text-gray-300 hover:text-gray-500 rounded-lg cursor-grab active:cursor-grabbing">
                <GripVertical className="w-4 h-4" />
              </span>
            </Tooltip>
          </div>
        </div>

        {hasChildren && !isCollapsed && (
          <div>{children.map((c) => renderNode(c, depth + 1))}</div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="部门管理"
        subtitle="组织架构（部门级数据隔离的基础）—— 拖动即可调整上级"
        extra={
          has('department_create') && (
            <button onClick={() => openCreate()} className="btn-primary flex items-center gap-2">
              <Plus className="w-5 h-5" />
              <span className="hidden md:inline">新增部门</span>
            </button>
          )
        }
      />

      <div className="card">
        <div className="p-4 border-b border-gray-100 flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[160px] max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              placeholder="搜索部门名称或编码..."
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              className="form-input pl-10"
            />
          </div>
          <div className="flex items-center gap-2 text-xs">
            <button type="button" onClick={expandAll} className="text-blue-600 hover:underline">展开全部</button>
            <span className="text-gray-300">|</span>
            <button type="button" onClick={collapseAll} className="text-blue-600 hover:underline">收起全部</button>
          </div>
          <div className="ml-auto flex items-center gap-2 text-xs text-gray-400">
            <Building2 className="w-4 h-4" />
            <span>
              共 {stats.total} 个 · 启用 {stats.active} · 停用 {stats.inactive}
            </span>
          </div>
        </div>

        <div className="px-4 py-3 border-b border-gray-100 text-xs text-gray-400">
          给用户分配部门后，可在「公司设置 → 数据隔离」开启部门隔离；拖动部门行可调整上下级（松手前会二次确认）。
        </div>

        <div className="p-4">
          {/* 拖拽中显示的「移到顶级」投放区 */}
          {draggingId && (
            <div
              onDragOver={(e) => { e.preventDefault(); setDropTarget(ROOT_KEY); }}
              onDragLeave={() => setDropTarget((t) => (t === ROOT_KEY ? null : t))}
              onDrop={(e) => handleDrop(e, null)}
              className={`flex items-center justify-center gap-2 mb-3 py-3 rounded-lg border-2 border-dashed text-sm transition-colors ${
                dropTarget === ROOT_KEY ? 'border-blue-400 bg-blue-50 text-blue-600' : 'border-gray-300 text-gray-400'
              }`}
            >
              <ArrowUpToLine className="w-4 h-4" />
              松开鼠标：把「{draggingName}」移到顶级部门
            </div>
          )}

          {loading ? (
            <TableSkeleton rows={6} />
          ) : allDepts.length === 0 ? (
            <ListEmpty
              title="暂无部门数据"
              description="点击右上角「新增部门」创建第一个部门（例如：总部），再在其下添加子部门"
            />
          ) : roots.length === 0 || (visibleIds && visibleIds.size === 0) ? (
            <ListEmpty keyword={keyword} onClear={() => setKeyword('')} />
          ) : (
            <div>{roots.map((d) => renderNode(d, 0))}</div>
          )}
        </div>
      </div>

      <Modal
        title={editing ? '编辑部门' : createParent ? `新增子部门（上级：${createParent.name}）` : '新增部门'}
        open={modalOpen}
        onCancel={() => setModalOpen(false)}
        onOk={handleSave}
        okText="保存"
        cancelText="取消"
        destroyOnHidden
      >
        <div className="space-y-4">
          {!editing && createParent && (
            <p className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
              将创建在「{createParent.name}」之下（如需调整，可在下方「上级部门」修改）
            </p>
          )}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">部门编码 *</label>
              <Input
                value={form.code}
                disabled={!!editing}
                placeholder="如：CLOTHING / HOME"
                onChange={e => setForm(p => ({ ...p, code: e.target.value }))}
               autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">部门名称 *</label>
              <Input
                value={form.name}
                placeholder="如：服装事业部 / 家居事业部"
                onChange={e => setForm(p => ({ ...p, name: e.target.value }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">状态</label>
              <select value={form.status || 'active'} onChange={e => setForm(p => ({ ...p, status: e.target.value }))} className="form-input">
                <option value="active">启用</option>
                <option value="inactive">停用</option>
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">上级部门</label>
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="不选则为顶级部门"
                value={form.parent_id || undefined}
                onChange={(v) => setForm(p => ({ ...p, parent_id: v || null }))}
                options={parentOptions}
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">编制人数</label>
              <Input type="number" value={hcInput} onChange={(e) => setHcInput(e.target.value)} placeholder="如：10（留空 = 未设置编制）" />
              <div className="text-xs text-gray-400 mt-1">用于「人事报表 → 编制与人数」的编制对比与缺口</div>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
            <Input value={form.remark ?? ''} onChange={e => setForm(p => ({ ...p, remark: e.target.value }))} />
          </div>
        </div>
      </Modal>
    </div>
  );
}
