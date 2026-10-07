import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Save, Hash, RotateCcw, Search } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { numberingApi, type NumberingRule } from '@/api/system';
import { usePermission } from '@/hooks/usePermission';

/**
 * 单号规则（设置便利性改进 B-05，2026-09-13）
 *
 * 背景：主数据编码前缀（P/SPU/C/S/W/CAT/U/L/R）原先写死在代码里，流水用 `Count()+1`
 * → ① 客户想用自家编码体系要改代码重打包；② 删掉一条再新建会与原编码重复（撞号）。
 *
 * 现在：编码 = 前缀 + 日期段 + 流水，流水取「同前缀已用最大号 + 1」（含已删除记录，绝不撞号）。
 * ⚠️ 改规则只影响**之后新建**的记录；已存在的编码不重排（历史可追溯）。
 */

// 重置策略与日期段必须配对（流水窗口 = 日期段长度）
const RESET_OPTIONS = [
  { value: 'daily', label: '按日重置', dateFormat: '20060102', hint: '如 P + 20260913 + 00001' },
  { value: 'monthly', label: '按月重置', dateFormat: '200601', hint: '如 P + 202609 + 0001' },
  { value: 'yearly', label: '按年重置', dateFormat: '2006', hint: '如 P + 2026 + 00001' },
  { value: 'never', label: '永不重置', dateFormat: '', hint: '如 P + 000001（跨年连续）' },
] as const;

const DATE_FORMAT_LABEL: Record<string, string> = {
  '': '不含日期',
  '2006': 'yyyy',
  '200601': 'yyyyMM',
  '20060102': 'yyyyMMdd',
};

export function NumberingRules() {
  // [2026-09-18 权限细化] 按钮级门控：保存·恢复默认=numbering_edit
  const { has } = usePermission();
  const [rules, setRules] = useState<NumberingRule[]>([]);
  const [draft, setDraft] = useState<NumberingRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [keyword, setKeyword] = useState('');
  // 下一号预览：按「可见行」分批惰加载（55 个对象全量算一次冷启动要秒级，见 PreviewManyForRules 注释）
  const [previews, setPreviews] = useState<Record<string, string>>({});
  const previewTableRef = useRef<HTMLTableElement | null>(null);
  const queueRef = useRef<Set<string>>(new Set());
  const requestedRef = useRef<Set<string>>(new Set()); // 已请求过的对象（防重复请求/请求风暴）
  const observedRef = useRef<Set<string>>(new Set()); // 已挂观察器的对象
  const timerRef = useRef<number | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);

  const flushQueue = useCallback(async () => {
    // 一次最多 20 个（后端 MaxPreviewBatch 限制），超出则分片串行发送
    while (queueRef.current.size > 0) {
      const batch = Array.from(queueRef.current).slice(0, 20);
      batch.forEach((biz) => queueRef.current.delete(biz));
      try {
        const res = await numberingApi.preview(batch);
        if (res.code === 0 && res.data) setPreviews((prev) => ({ ...prev, ...res.data }));
      } catch {
        /* 预览失败不阻断页面（下一号仅为参考） */
      }
    }
  }, []);

  const scheduleFlush = useCallback(() => {
    if (timerRef.current !== null) return;
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      flushQueue();
    }, 120);
  }, [flushQueue]);

  useEffect(() => {
    observerRef.current = new IntersectionObserver(
      (entries) => {
        let queued = false;
        for (const e of entries) {
          if (!e.isIntersecting) continue;
          const biz = (e.target as HTMLElement).dataset.biz;
          // 只观察一次；已请求过的对象不再入队（避免每次渲染重复请求）
          observerRef.current?.unobserve(e.target);
          if (!biz || requestedRef.current.has(biz)) continue;
          requestedRef.current.add(biz);
          queueRef.current.add(biz);
          queued = true;
        }
        if (queued) scheduleFlush();
      },
      { rootMargin: '200px 0px' },
    );
    return () => {
      observerRef.current?.disconnect();
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, [scheduleFlush]);

  const fetchRules = useCallback(async () => {
    setLoading(true);
    try {
      const res = await numberingApi.list();
      if (res.code === 0 && res.data) {
        setRules(res.data);
        setDraft(res.data.map((r) => ({ ...r })));
        setPreviews({});
        requestedRef.current = new Set();
        observedRef.current = new Set();
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '单号规则加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchRules(); }, [fetchRules]);

  // 按名称/前缀/对象标识过滤（列表顺序与后端一致）
  const visible = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    return draft
      .map((r, index) => ({ r, index }))
      .filter(({ r }) =>
        !kw || r.label.toLowerCase().includes(kw) || r.prefix.toLowerCase().includes(kw) || r.biz_type.includes(kw),
      );
  }, [draft, keyword]);

  // 行渲染后统一挂观察器（用 data-biz 查询，避免 ref 回调每次渲染被重新挂载 → 请求风暴）
  useEffect(() => {
    const table = previewTableRef.current;
    const io = observerRef.current;
    if (!table || !io) return;
    table.querySelectorAll<HTMLTableRowElement>('tbody tr[data-biz]').forEach((tr) => {
      const biz = tr.dataset.biz;
      if (!biz || observedRef.current.has(biz)) return;
      observedRef.current.add(biz);
      io.observe(tr);
    });
  }, [visible]);

  const dirty = useMemo(
    () =>
      draft.some((d, i) => {
        const o = rules[i];
        return o && (o.prefix !== d.prefix || o.seq_digits !== d.seq_digits || o.reset !== d.reset);
      }),
    [draft, rules],
  );

  const update = (index: number, patch: Partial<NumberingRule>) => {
    setDraft((prev) => prev.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await numberingApi.save(draft);
      if (res.code === 0 && res.data) {
        setRules(res.data);
        setDraft(res.data.map((r) => ({ ...r })));
        setPreviews({}); // 规则变了 → 下一号重算（可见行会自动重新入队）
        requestedRef.current = new Set();
        observedRef.current = new Set();
        message.success('单号规则已保存（下次新建时生效）');
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '保存失败，请检查前缀/流水位数是否合法');
    } finally {
      setSaving(false);
    }
  };

  const resetOne = async (index: number, label: string) => {
    const ok = await confirmAction({
      title: `恢复「${label}」的默认规则？`,
      content: '恢复后该对象回到系统默认格式（如主数据 5 位流水、单据 4 位流水），保存后对新建记录生效。',
    });
    if (!ok) return;
    const cur = draft[index];
    update(index, {
      prefix: cur.default_prefix,
      date_format: cur.default_date_format,
      seq_digits: cur.default_seq_digits,
      reset: cur.default_reset,
    });
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="单号规则"
        subtitle="编码前缀、日期段、流水位数可配置（改后只影响新建记录）"
        extra={
          has('numbering_edit') && (
            <button onClick={handleSave} disabled={saving || !dirty} className="btn-primary flex items-center gap-2">
              <Save className="w-4 h-4" />
              <span className="hidden md:inline">{saving ? '保存中...' : '保存'}</span>
            </button>
          )
        }
      />

      <div className="card p-6">
        <div className="flex items-center gap-3 text-gray-400 mb-4">
          <Hash className="w-5 h-5" />
          <span className="text-sm">
            编号 = <b className="text-gray-600">前缀 + 日期段 + 流水</b>；流水取「同前缀已用最大号 + 1」——
            删除记录不会导致重复编号。未自定义的对象使用系统默认格式。
          </span>
        </div>

        <div className="flex items-center gap-3 mb-4">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              type="search"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="搜索对象 / 前缀（如 销售、SO）"
              className="form-input pl-8 w-64"
            />
          </div>
          <span className="text-xs text-gray-400">
            共 {draft.length} 个业务对象{keyword.trim() ? `，匹配 ${visible.length} 个` : ''}
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table ref={previewTableRef} className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">业务对象</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">单号前缀</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">日期格式</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">流水位数</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">重置策略</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">预览下一号</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {visible.map(({ r, index: i }) => (
                  <tr key={r.biz_type} data-biz={r.biz_type} className="hover:bg-gray-50">
                    <td className="px-4 py-3 text-sm font-medium text-gray-800 whitespace-nowrap">
                      {r.label}
                      {!r.is_default && <span className="ml-2 text-xs text-blue-600">已自定义</span>}
                    </td>
                    <td className="px-4 py-3">
                      <input
                        type="text"
                        value={r.prefix}
                        maxLength={10}
                        onChange={(e) => update(i, { prefix: e.target.value.toUpperCase() })}
                        className="form-input w-24"
                      />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">
                      {DATE_FORMAT_LABEL[r.date_format] ?? r.date_format}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={r.seq_digits}
                        onChange={(e) => update(i, { seq_digits: Number(e.target.value) })}
                        className="form-select w-20"
                      >
                        {[3, 4, 5, 6, 7, 8].map((n) => (
                          <option key={n} value={n}>{n} 位</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={r.reset}
                        onChange={(e) => {
                          const opt = RESET_OPTIONS.find((o) => o.value === e.target.value);
                          update(i, { reset: e.target.value as NumberingRule['reset'], date_format: (opt?.dateFormat ?? '') as NumberingRule['date_format'] });
                        }}
                        className="form-select w-32"
                      >
                        {RESET_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>{o.label}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 font-mono whitespace-nowrap">
                      {r.sample}
                      {previews[r.biz_type] ? (
                        <span className="text-gray-400 ml-2">（下一个：{previews[r.biz_type]}）</span>
                      ) : (
                        <span className="text-gray-300 ml-2">（下一个：…）</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {has('numbering_edit') && (
                        <button
                          onClick={() => resetOne(i, r.label)}
                          disabled={r.is_default}
                          title="恢复默认规则"
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          恢复默认
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs text-amber-600 mt-3">
          提示：流水位数改小后若当日已用号接近上限（如改 3 位、当天已到 999），新号会自动进位变长（不报错）。
          前缀建议用纯字母，便于人工识别与打印对齐。
        </p>
      </div>
    </div>
  );
}
