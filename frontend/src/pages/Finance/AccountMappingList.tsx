import { useCallback, useEffect, useMemo, useState } from 'react';
import { Save, RotateCcw, Link2 } from 'lucide-react';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { accountApi, accountMappingApi, type AccountMappingView } from '@/api/finance';
import type { Account } from '@/types/finance';
import { loadOptions } from '@/utils/loadOptions';
// [2026-09-18 权限细化] 按钮级权限（后端为最终边界；无权者不显示入口）
import { usePermission } from '@/hooks/usePermission';

/**
 * 科目映射（设置便利性改进 B-04，2026-09-13）
 *
 * 背景：费用报销/工资/折旧借 6602、附加税/印花税借 6403、所得税借 6801、分红借 4104、
 * 增值税结转 2221.01*、默认现金/银行 1001/1002——原先全部写死在代码里，
 * 客户想细分到 6602.01 只能改代码重打包。
 *
 * 现在在这里选科目即可（表里没改的项 = 用默认科目；「恢复默认」= 清除映射）。
 * ⚠️ 应交税费明细科目（2221.xx）不在本页范围：税务报表与缴纳按 2221.* 前缀识别。
 */
export function AccountMappingList() {
  // [2026-09-18 权限细化] 保存=account_mapping_edit（本页无新增/删除）
  const { has } = usePermission();
  const [view, setView] = useState<AccountMappingView | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      // [2026-09-14] 失败隔离：单项 403/失败不影响另一项（此前 Promise.all 一拒全空）
      const [mapRes, accRes] = await loadOptions([accountMappingApi.get(), accountApi.all()], '科目映射');
      if (mapRes?.code === 0 && mapRes.data) {
        setView(mapRes.data);
        const next: Record<string, string> = {};
        for (const [key, item] of Object.entries(mapRes.data.items)) {
          next[key] = item.account_id || '';
        }
        setDraft(next);
      }
      if (accRes?.code === 0) {
        setAccounts(accRes.data?.list || []);
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '科目映射加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // 可选科目：叶子科目，按树形缩进排序（与「会计科目」页同序）
  const options = useMemo(() => {
    const childrenOf = (parentId: string | null) =>
      accounts
        .filter((a) => (a.parent_id || null) === parentId)
        .sort((a, b) => a.code.localeCompare(b.code));
    const out: { id: string; label: string }[] = [];
    const walk = (parentId: string | null, level: number) => {
      for (const acc of childrenOf(parentId)) {
        if (acc.is_leaf) {
          out.push({ id: acc.id, label: `${'　'.repeat(level)}${acc.code} - ${acc.name}` });
        }
        walk(acc.id, acc.is_leaf ? level : level + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [accounts]);

  const dirty = useMemo(() => {
    if (!view) return false;
    return Object.entries(draft).some(([key, id]) => (view.items[key]?.account_id || '') !== id);
  }, [draft, view]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await accountMappingApi.save(draft);
      if (res.code === 0 && res.data) {
        setView(res.data);
        const next: Record<string, string> = {};
        for (const [key, item] of Object.entries(res.data.items)) next[key] = item.account_id || '';
        setDraft(next);
        message.success('科目映射已保存（下次生成凭证时生效）');
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (err) {
message.error(err instanceof Error && err.message ? err.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  const resetOne = async (key: string, label: string) => {
    const ok = await confirmAction({
      title: `恢复「${label}」的默认科目？`,
      content: '恢复后该业务将使用系统默认科目（保存后生效）。',
    });
    if (!ok) return;
    setDraft((prev) => ({ ...prev, [key]: '' }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="科目映射"
        subtitle="业务自动生成的凭证用哪个科目，在这里改（不用改代码）"
        extra={
          has('account_mapping_edit') && (
            <button onClick={handleSave} disabled={saving || !dirty} className="btn-primary flex items-center gap-2">
              <Save className="w-4 h-4" />
              <span className="hidden md:inline">{saving ? '保存中...' : '保存'}</span>
            </button>
          )
        }
      />

      <div className="card p-6">
        <div className="flex items-center gap-3 text-gray-400 mb-4">
          <Link2 className="w-5 h-5" />
          <span className="text-sm">
            映射只影响<b className="text-gray-600">未来生成的凭证</b>；已生成的凭证不重算。未配置的项一律使用默认科目。
            应交税费明细科目（2221.xx）不在此处配置——税务报表与缴纳按编码前缀识别。
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">映射项</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">用途</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">当前科目</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">默认科目</th>
                  <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(view?.defs || []).map((def) => {
                  const item = view?.items[def.key];
                  const selected = draft[def.key] || '';
                  return (
                    <tr key={def.key} className="hover:bg-gray-50">
                      <td className="px-4 py-3 text-sm font-medium text-gray-800 whitespace-nowrap">{def.label}</td>
                      <td className="px-4 py-3 text-xs text-gray-500">{def.usage}</td>
                      <td className="px-4 py-3">
                        <select
                          value={selected}
                          onChange={(e) => setDraft((prev) => ({ ...prev, [def.key]: e.target.value }))}
                          className="form-select w-72"
                        >
                          <option value="">使用默认科目（{def.default_code} {def.default_name}）</option>
                          {options.map((o) => (
                            <option key={o.id} value={o.id}>{o.label}</option>
                          ))}
                        </select>
                        {item?.missing && (
                          <div className="text-xs text-amber-600 mt-1">原先配置的科目已删除，当前回退默认科目，请重新选择</div>
                        )}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-500 whitespace-nowrap">
                        {def.default_code} {def.default_name}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button
                          onClick={() => resetOne(def.key, def.label)}
                          disabled={!selected}
                          title="恢复默认科目"
                          className="inline-flex items-center gap-1 px-2 py-1 text-xs rounded border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:opacity-40"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          恢复默认
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
