import { Modal } from 'antd';
import type { ReactNode } from 'react';

interface DetailColumn<T> {
  key: string;
  header: ReactNode;
  /** 与列表同一套单元格渲染（状态徽标/金额格式/元数据列都与列表一致，无需另写字段映射） */
  cell?: (record: T) => ReactNode;
  width?: number;
}

interface RecordDetailModalProps<T> {
  open: boolean;
  /** 弹窗标题，如「客户详情」 */
  title: string;
  record: T | null;
  /** 列表页的列描述符（通常直接传 rowCols）——第 1 列等锁定列会自动排除 */
  columns: DetailColumn<T>[];
  onClose: () => void;
  /** 不展示的列 key（默认排除勾选列/操作列） */
  excludeKeys?: string[];
  /** 额外内容（如门户账号信息） */
  extra?: ReactNode;
}

/**
 * 通用「查看」详情弹窗（2026-09-11 主数据补齐“查看”操作）。
 *
 * 设计意图：**不再为每个实体手写字段映射** —— 直接复用列表页的列描述符渲染“字段名 : 值”，
 * 于是元数据自定义列、布局列、状态徽标、金额格式天然与列表一致（少一处实现就少一处不同步）。
 */
export function RecordDetailModal<T>({
  open,
  title,
  record,
  columns,
  onClose,
  excludeKeys = ['__sel', '__actions'],
  extra,
}: RecordDetailModalProps<T>) {
  const cols = columns.filter((c) => !excludeKeys.includes(c.key));
  return (
    <Modal open={open} title={title} onCancel={onClose} footer={null} width={720} destroyOnHidden>
      {record && (
        <div className="space-y-3">
          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
            {cols.map((c) => (
              <div key={c.key} className="flex gap-2 text-sm min-w-0">
                <dt className="text-gray-500 shrink-0 w-24 truncate" title={typeof c.header === 'string' ? c.header : undefined}>
                  {c.header}
                </dt>
                <dd className="text-gray-800 min-w-0 break-words">{c.cell ? c.cell(record) : '—'}</dd>
              </div>
            ))}
          </dl>
          {extra && <div className="border-t border-gray-100 pt-3">{extra}</div>}
        </div>
      )}
    </Modal>
  );
}
