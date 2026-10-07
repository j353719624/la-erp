import { useEffect, useMemo, useState } from 'react';
import { AutoComplete, Empty } from 'antd';
import { http } from '@/utils/request';

/**
 * 收/付款方式选择（可配置字典 + 可自由输入）。
 *
 * 背景（2026-09-04 收款方式专业化）：财务的收/付款方式不应是固定死的几种。
 * 本组件：
 *  - 选项数据源 = 数据字典 `payment_method`（系统设置 → 数据字典可增删维护）
 *  - 既可从下拉选择常见方式（现金/银行转账/微信/支付宝/承兑汇票…），
 *    也可直接输入任意自定义文本（如"客户扫码转入对公户"），值即文本原样保存
 *  - 网络/字典不可用时用内置常见项兜底，保证界面始终可用
 *
 * 用法：
 *   <PaymentMethodSelect value={form.receipt_type}
 *     onChange={(v) => setForm(p => ({ ...p, receipt_type: v }))} />
 */
interface DictItem {
  item_code: string;
  item_name: string;
}

const FALLBACK_NAMES = [
  '现金', '银行转账', '支票', '银行承兑汇票', '商业承兑汇票',
  '信用卡', 'POS刷卡', '支付宝', '微信支付', '收款码/聚合支付', '其他',
];

interface Props {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  style?: React.CSSProperties;
}

export function PaymentMethodSelect({
  value,
  onChange,
  placeholder = '请选择或输入收款方式',
  disabled,
  allowClear = true,
  style,
}: Props) {
  const [names, setNames] = useState<string[]>(FALLBACK_NAMES);
  // 聚焦时默认展示全部选项（便于快速改选）；用户输入后才按输入过滤
  const [showAll, setShowAll] = useState(true);

  useEffect(() => {
    let alive = true;
    http
      .get<DictItem[]>('/v1/dict/items', { type_code: 'payment_method' })
      .then((res) => {
        if (!alive || res.code !== 0) return;
        const arr = Array.isArray(res.data) ? res.data : [];
        if (arr.length > 0) {
          // 去重：字典项名 + 内置兜底；以字典为准并补充未收录的常见项
          const names = arr.map((d) => d.item_name).filter(Boolean);
          const merged: string[] = [];
          for (const n of [...names, ...FALLBACK_NAMES]) {
            if (!merged.includes(n)) merged.push(n);
          }
          setNames(merged);
        }
      })
      .catch(() => { /* 兜底项已可用 */ });
    return () => { alive = false; };
  }, []);

  const options = useMemo(
    () => names.map((n) => ({ value: n, label: n })),
    [names],
  );

  return (
    <AutoComplete
      value={value}
      options={options}
      onChange={(v) => onChange?.(v)}
      onSelect={(v) => onChange?.(String(v))}
      onSearch={(v) => { if (typeof v === 'string') setShowAll(v.trim() === ''); }}
      onFocus={() => setShowAll(true)}
      filterOption={
        showAll
          ? () => true
          : (input, option) => String(option?.value ?? '').toLowerCase().includes(input.trim().toLowerCase())
      }
      placeholder={placeholder}
      disabled={disabled}
      allowClear={allowClear}
      size="large"
      notFoundContent={<Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="输入自定义方式或清空" />}
      style={{ width: '100%', ...style }}
    />
  );
}

export default PaymentMethodSelect;
