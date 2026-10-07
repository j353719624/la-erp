import { useCallback, useEffect, useState } from 'react';
import { Save, Factory } from 'lucide-react';
import { Switch } from 'antd';
import { message } from '@/utils/appMessage';
import { productionApi } from '@/api/production';
import { PageHeader } from '@/components/PageHeader';
import { usePermission } from '@/hooks/usePermission';

interface ProdSettings {
  allow_over_issue: boolean;
  allow_no_workorder_pick: boolean;
  allow_return_after_complete: boolean;
}

const DEFAULT: ProdSettings = {
  allow_over_issue: false,
  allow_no_workorder_pick: false,
  allow_return_after_complete: false,
};

const ITEMS: { key: keyof ProdSettings; title: string; desc: string; hint: string }[] = [
  {
    key: 'allow_over_issue',
    title: '允许超量领料（超领）',
    desc: '生产领料可超过工单 BOM 需求剩余',
    hint: '适合电子/微元件行业：一盘料上百万个、一张工单只做几万，无法拆盘发料。开启后仍按“已领−已退”回写物料跟踪并出库流水，完工后可把余料退料收回。',
  },
  {
    key: 'allow_no_workorder_pick',
    title: '允许直接领料（不关联工单）',
    desc: '领料可不必先建工单',
    hint: '开启后，生产领料页可发起“直接领料”：不选工单、手工选商品填数量出库（仍需选仓库）。适合不想为临时领料走完整工单流程的小团队。',
  },
  {
    key: 'allow_return_after_complete',
    title: '允许工单完成后退余料（收回入库）',
    desc: '已完成工单仍可做退料单',
    hint: '开启后，工单完成/入库后仍可把剩下的物料清理退回仓库。退料仍限“累计已领−已退”范围内，不会凭空增加库存。',
  },
];

export function ProductionSettings() {
  // 写权限 = 系统设置-编辑（与后端 PUT /production-settings 的 setting_edit 一致）
  const { has } = usePermission();
  const canEdit = has('setting_edit');
  const [settings, setSettings] = useState<ProdSettings>(DEFAULT);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchSettings = useCallback(async () => {
    setLoading(true);
    try {
      const res = await productionApi.productionSettings();
      if (res.code === 0 && res.data) {
        setSettings({
          allow_over_issue: !!res.data.allow_over_issue,
          allow_no_workorder_pick: !!res.data.allow_no_workorder_pick,
          allow_return_after_complete: !!res.data.allow_return_after_complete,
        });
      }
    } catch {
      // 静默：保持默认
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchSettings(); }, [fetchSettings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const res = await productionApi.updateProductionSettings({
        allow_over_issue: settings.allow_over_issue,
        allow_no_workorder_pick: settings.allow_no_workorder_pick,
        allow_return_after_complete: settings.allow_return_after_complete,
      });
      if (res.code === 0) {
        message.success('生产设置已保存');
        await fetchSettings();
      } else {
        message.error(res.message || '保存失败');
      }
    } catch (err) {
      message.error(err instanceof Error && err.message ? err.message : '保存失败，请稍后重试');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="生产设置"
        subtitle="生产领料灵活性开关（默认关闭=严格流程，按需开启）"
        extra={
          canEdit ? (
            <button onClick={handleSave} disabled={saving || loading} className="btn-primary flex items-center gap-2">
              <Save className="w-4 h-4" />
              <span className="hidden md:inline">{saving ? '保存中...' : '保存'}</span>
            </button>
          ) : (
            <span className="text-xs text-gray-400">无「系统设置-编辑」权限，仅可查看</span>
          )
        }
      />

      <div className="card p-6">
        <div className="flex items-center gap-2 text-gray-400 mb-4">
          <Factory className="w-5 h-5" />
          <span className="text-sm">
            三项均默认关闭；关闭时保持严格的按工单 BOM 流程，开启后立即全局生效
          </span>
        </div>

        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="max-w-3xl space-y-4">
            {ITEMS.map(item => (
              <div key={item.key} className="flex items-start justify-between gap-6 p-4 rounded-xl border border-gray-200 hover:border-gray-300 transition-colors">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-800">{item.title}</span>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">{item.desc}</p>
                  <p className="text-xs text-gray-400 mt-1 leading-relaxed">{item.hint}</p>
                </div>
                <Switch
                  checked={settings[item.key]}
                  onChange={(v) => setSettings(prev => ({ ...prev, [item.key]: v }))}
                  disabled={saving || !canEdit}
                />
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
