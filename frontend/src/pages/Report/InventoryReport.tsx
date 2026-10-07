import { useState, useEffect } from 'react';
import { Download, ShoppingCart } from 'lucide-react';
import { reportApi } from '@/api/report';
import { requisitionApi } from '@/api/order';
import { format } from '@/utils/format';
import { downloadCSV } from '@/utils/export';
import { message } from '@/utils/appMessage';
import { confirmAction } from '@/utils/confirm';
import { PageHeader } from '@/components/PageHeader';
import { EmptyState } from '@/components/EmptyState';
import { markReportSeen } from '@/utils/localKeys';
import { PieChart, Pie, Cell, Legend, ResponsiveContainer } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useTableView } from '@/hooks/useTableView';
import type { ReactNode } from 'react';

export function InventoryReport() {
  const navigate = useNavigate();
  const [inventoryData, setInventoryData] = useState<any[]>([]);
  const [turnoverData, setTurnoverData] = useState<any[]>([]);
  const [dormantData, setDormantData] = useState<any[]>([]);
  const [expiryData, setExpiryData] = useState<any[]>([]);
  const [reorderData, setReorderData] = useState<any[]>([]);
  const [reorderSelected, setReorderSelected] = useState<Set<string>>(new Set());
  const [ageData, setAgeData] = useState<any[]>([]);
  const [abcData, setAbcData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'balance' | 'turnover' | 'dormant' | 'expiry' | 'reorder' | 'age' | 'abc'>('balance');

  useEffect(() => {
    fetchReport();
    fetchTurnover();
    fetchDormant();
    fetchExpiry();
    fetchReorder();
    fetchAge();
    fetchABC();
    // [易用性 P1] 看过任一经营报表即打勾仪表盘上手清单的“查看经营报表”
    markReportSeen();
  }, []);

  const fetchReport = async () => {
    setLoading(true);
    try {
      const response = await reportApi.inventoryBalance();
      if (response.code === 0) {
        setInventoryData(response.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch inventory report:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchTurnover = async () => {
    try {
      const response = await reportApi.inventoryTurnover();
      if (response.code === 0) {
        setTurnoverData(response.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch turnover:', err);
    }
  };

  const fetchDormant = async () => {
    try {
      const response = await reportApi.dormantStock({ days: 90 });
      if (response.code === 0) {
        setDormantData(response.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch dormant stock:', err);
    }
  };

  const fetchExpiry = async () => {
    try {
      const response = await reportApi.expiryAlert({ days: 90 });
      if (response.code === 0) {
        setExpiryData(response.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch expiry alert:', err);
    }
  };

  const fetchReorder = async () => {
    try {
      const response = await reportApi.reorderSuggestions();
      if (response.code === 0) {
        setReorderData(response.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch reorder suggestions:', err);
    }
  };

  const fetchAge = async () => {
    try {
      const response = await reportApi.stockAge();
      if (response.code === 0) {
        setAgeData(response.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch stock age:', err);
    }
  };

  const fetchABC = async () => {
    try {
      const response = await reportApi.stockABC();
      if (response.code === 0) {
        setAbcData(response.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch stock ABC:', err);
    }
  };

  const handleCreateRequisition = async () => {
    const rows = reorderData.filter((r) => reorderSelected.has(r.product_id));
    if (rows.length === 0) {
      message.warning('请先勾选需要补货的商品');
      return;
    }
    if (!(await confirmAction({ title: `确定为勾选的 ${rows.length} 个商品生成采购申请吗？` }))) return;
    try {
      const response = await requisitionApi.create({
        department: '库存补货',
        applicant: '系统建议',
        requisition_date: format.today(),
        remark: '由库存补货建议自动生成',
        lines: rows.map(r => ({
          product_id: r.product_id,
          product_name: r.product_name,
          product_code: r.product_code,
          qty: r.suggested_qty,
        })),
      });
      if (response.code === 0) {
        message.success(`采购申请 ${response.data?.requisition_no || ''} 已创建`);
        setReorderSelected(new Set());
      } else {
        message.error(response.message || '生成失败');
      }
    } catch (err: any) {
      console.error('Failed to create requisition:', err);
      message.error(err?.message || '生成失败，请稍后重试');
    }
  };

  const toggleReorder = (id: string) => {
    setReorderSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const handleExport = () => {
    downloadCSV('库存报表.csv',
      ['产品编码', '产品名称', '在库', '锁定', '在途', '安全库存', '库存价值', '低库存'],
      inventoryData.map((item: any) => [item.product_code, item.product_name, item.qty_available,
        item.qty_locked || 0, item.qty_in_transit || 0, item.safety_stock || 0,
        Number(item.total_value || 0).toFixed(2), item.is_low_stock ? '是' : '否'])
    );
  };

  // 后端 total_value 为 decimal 字符串，必须 Number() 求和，否则字符串拼接 → NaN
  const totalValue = inventoryData.reduce((sum, item) => sum + Number(item.total_value || 0), 0);
  const COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#06b6d4'];

  const pieData = inventoryData.slice(0, 7).map((item, index) => ({
    name: item.product_name,
    value: Number(item.total_value || 0),
    color: COLORS[index % COLORS.length],
  }));

  // [2026-09-13] 列表列描述符：表格渲染与「我的视图」（列勾选/排序/改名/预设/分享）共用同一份
  // ⚠️ 本页 7 个页签各一张表：主表（库存价值）用 ?cols=，其余必须传 paramNs（否则互相裁列）
  interface RowCol {
    key: string;
    header: ReactNode;
    headCls?: string;
    cellCls?: string;
    cell: (row: any) => ReactNode;
  }
  const TH_L = 'px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TH_R = 'px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider';
  const TD = 'px-6 py-4';
  // ① 库存价值（默认页签）
  const balanceCols: RowCol[] = [
    { key: 'product_code', header: '产品编码', cellCls: `${TD} whitespace-nowrap font-medium text-gray-900`, cell: (item) => <span>{item.product_code}</span> },
    {
      key: 'product_name',
      header: '产品名称',
      cellCls: `${TD} whitespace-nowrap text-gray-900`,
      cell: (item) => (
        <>
          {item.product_name}
          {item.is_low_stock && (
            <span className="ml-2 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-600">低库存</span>
          )}
        </>
      ),
    },
    { key: 'qty_available', header: '在库', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right text-gray-500`, cell: (item) => <span>{item.qty_available}</span> },
    { key: 'qty_locked', header: '锁定', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right text-sm text-orange-600`, cell: (item) => <span>{item.qty_locked > 0 ? item.qty_locked : '-'}</span> },
    { key: 'qty_in_transit', header: '在途', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right text-sm text-blue-600`, cell: (item) => <span>{item.qty_in_transit > 0 ? item.qty_in_transit : '-'}</span> },
    { key: 'safety_stock', header: '安全库存', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right text-gray-500`, cell: (item) => <span>{item.safety_stock || '-'}</span> },
    { key: 'total_value', header: '库存价值', headCls: TH_R, cellCls: `${TD} whitespace-nowrap text-right font-medium text-gray-900`, cell: (item) => <span>¥{format.currency(item.total_value || 0)}</span> },
  ];
  // ② 库存周转率
  const turnoverCols: RowCol[] = [
    { key: 'product_code', header: '产品编码', cellCls: `${TD} font-medium text-gray-900`, cell: (item) => <span>{item.product_code}</span> },
    { key: 'product_name', header: '产品名称', cellCls: `${TD} text-gray-900`, cell: (item) => <span>{item.product_name}</span> },
    { key: 'out_qty', header: '期间出库', headCls: TH_R, cellCls: `${TD} text-right text-gray-600`, cell: (item) => <span>{item.out_qty}</span> },
    { key: 'avg_stock', header: '平均库存', headCls: TH_R, cellCls: `${TD} text-right text-gray-600`, cell: (item) => <span>{item.avg_stock}</span> },
    { key: 'turnover', header: '周转率', headCls: TH_R, cellCls: `${TD} text-right font-medium text-gray-900`, cell: (item) => <span>{Number(item.turnover).toFixed(2)}</span> },
    { key: 'turnover_days', header: '周转天数', headCls: TH_R, cellCls: `${TD} text-right text-gray-600`, cell: (item) => <span>{item.turnover_days ? Number(item.turnover_days).toFixed(1) : '-'}</span> },
    { key: 'last_out_at', header: '最近出库', cellCls: `${TD} text-gray-500`, cell: (item) => <span>{item.last_out_at ? format.date(item.last_out_at) : '-'}</span> },
  ];
  // ③ 呆滞库存
  const dormantCols: RowCol[] = [
    { key: 'product_code', header: '产品编码', cellCls: `${TD} font-medium text-gray-900`, cell: (item) => <span>{item.product_code}</span> },
    { key: 'product_name', header: '产品名称', cellCls: `${TD} text-gray-900`, cell: (item) => <span>{item.product_name}</span> },
    { key: 'qty_available', header: '在库', headCls: TH_R, cellCls: `${TD} text-right text-gray-600`, cell: (item) => <span>{item.qty_available}</span> },
    { key: 'avg_cost', header: '成本价', headCls: TH_R, cellCls: `${TD} text-right text-gray-600`, cell: (item) => <span>¥{format.currency(item.avg_cost)}</span> },
    { key: 'total_value', header: '占用资金', headCls: TH_R, cellCls: `${TD} text-right font-medium text-red-600`, cell: (item) => <span>¥{format.currency(item.total_value || 0)}</span> },
    { key: 'dormant_days', header: '呆滞天数', headCls: TH_R, cellCls: `${TD} text-right text-gray-600`, cell: (item) => <span>{item.dormant_days}</span> },
    { key: 'last_movement_at', header: '最近变动', cellCls: `${TD} text-gray-500`, cell: (item) => <span>{item.last_movement_at ? format.date(item.last_movement_at) : '从未变动'}</span> },
  ];
  // ④ 到期预警
  const expiryCols: RowCol[] = [
    { key: 'product_code', header: '产品编码', cellCls: `${TD} font-medium text-gray-900`, cell: (item) => <span>{item.product_code}</span> },
    { key: 'product_name', header: '产品名称', cellCls: `${TD} text-gray-900`, cell: (item) => <span>{item.product_name}</span> },
    { key: 'warehouse_name', header: '仓库', cellCls: `${TD} text-gray-600`, cell: (item) => <span>{item.warehouse_name || '-'}</span> },
    { key: 'batch_no', header: '批次', cellCls: `${TD} text-gray-600`, cell: (item) => <span>{item.batch_no || '-'}</span> },
    { key: 'qty_available', header: '在库', headCls: TH_R, cellCls: `${TD} text-right text-gray-600`, cell: (item) => <span>{item.qty_available}</span> },
    { key: 'expiry_date', header: '到期日', cellCls: `${TD} text-gray-600`, cell: (item) => <span>{item.expiry_date ? format.date(item.expiry_date) : '-'}</span> },
    { key: 'days_left', header: '剩余天数', headCls: TH_R, cellCls: `${TD} text-right font-medium text-gray-900`, cell: (item) => <span>{item.days_left}</span> },
    {
      key: 'status',
      header: '状态',
      cell: (item) => (
        <span className={`inline-flex px-2 py-0.5 rounded text-xs ${item.status === 'expired' ? 'bg-red-100 text-red-600' : 'bg-orange-100 text-orange-600'}`}>
          {item.status === 'expired' ? '已过期' : '即将到期'}
        </span>
      ),
    },
  ];
  // ⑤ 补货建议（勾选列锁定）
  const reorderCols: RowCol[] = [
    {
      key: '__sel',
      header: (
        <input
          type="checkbox"
          className="w-4 h-4 accent-blue-600"
          checked={reorderData.length > 0 && reorderData.every(r => reorderSelected.has(r.product_id))}
          onChange={() => {
            if (reorderSelected.size === reorderData.length) setReorderSelected(new Set());
            else setReorderSelected(new Set(reorderData.map(r => r.product_id)));
          }}
        />
      ),
      headCls: 'px-4 py-3 w-10',
      cellCls: 'px-4 py-4',
      cell: (r) => <input type="checkbox" className="w-4 h-4 accent-blue-600" checked={reorderSelected.has(r.product_id)} onChange={() => toggleReorder(r.product_id)} />,
    },
    { key: 'product_code', header: '产品编码', cellCls: `${TD} font-medium text-gray-900`, cell: (r) => <span>{r.product_code}</span> },
    { key: 'product_name', header: '产品名称', cellCls: `${TD} text-gray-900`, cell: (r) => <span>{r.product_name}</span> },
    { key: 'safety_stock', header: '安全库存', headCls: TH_R, cellCls: `${TD} text-right text-gray-600`, cell: (r) => <span>{r.safety_stock}</span> },
    { key: 'available', header: '在库', headCls: TH_R, cellCls: `${TD} text-right text-gray-600`, cell: (r) => <span>{r.available}</span> },
    { key: 'on_order', header: '在途', headCls: TH_R, cellCls: `${TD} text-right text-gray-600`, cell: (r) => <span>{r.on_order}</span> },
    { key: 'committed', header: '已承诺未交', headCls: TH_R, cellCls: `${TD} text-right text-gray-600`, cell: (r) => <span>{r.committed}</span> },
    { key: 'suggested_qty', header: '建议补货量', headCls: TH_R, cellCls: `${TD} text-right font-bold text-red-600`, cell: (r) => <span>{r.suggested_qty}</span> },
  ];
  // ⑥ 库龄分布（5 个库龄桶列是固定表头，值按商品填充）
  const AGE_BUCKETS = ['0-30天', '31-60天', '61-90天', '91-180天', '180天以上'];
  const ageCols: RowCol[] = [
    { key: 'product_code', header: '产品编码', headCls: 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider', cellCls: 'px-4 py-3 font-medium text-gray-900', cell: (item) => <span>{item.product_code}</span> },
    { key: 'product_name', header: '产品名称', headCls: 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider', cellCls: 'px-4 py-3 text-gray-900', cell: (item) => <span>{item.product_name}</span> },
    { key: 'total_qty', header: '总数量', headCls: 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider', cellCls: 'px-4 py-3 text-right text-gray-500', cell: (item) => <span>{format.qty(Number(item.total_qty))}</span> },
    { key: 'total_amount', header: '总金额', headCls: 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider', cellCls: 'px-4 py-3 text-right text-gray-700', cell: (item) => <span>¥{format.currency(Number(item.total_amount))}</span> },
    { key: 'max_age_days', header: '最长库龄', headCls: 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider', cellCls: 'px-4 py-3 text-right text-orange-600 font-medium', cell: (item) => <span>{item.max_age_days}天</span> },
    ...AGE_BUCKETS.map((label, i) => ({
      key: `bucket_${i}`,
      header: label,
      headCls: 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider',
      cellCls: 'px-4 py-3 text-right text-sm text-gray-500',
      cell: (item: any) => {
        const b = item.buckets?.[i];
        if (!b || Number(b.qty) <= 0) return <span>-</span>;
        return <span>{`${format.qty(Number(b.qty))} / ¥${format.currency(Number(b.amount))}`}</span>;
      },
    })),
  ];
  // ⑦ ABC 分类
  const abcCols: RowCol[] = [
    { key: 'product_code', header: '产品编码', headCls: 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider', cellCls: 'px-4 py-3 font-medium text-gray-900', cell: (item) => <span>{item.product_code}</span> },
    { key: 'product_name', header: '产品名称', headCls: 'px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider', cellCls: 'px-4 py-3 text-gray-900', cell: (item) => <span>{item.product_name}</span> },
    { key: 'qty', header: '数量', headCls: 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider', cellCls: 'px-4 py-3 text-right text-gray-500', cell: (item) => <span>{format.qty(Number(item.qty))}</span> },
    { key: 'amount', header: '库存金额', headCls: 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider', cellCls: 'px-4 py-3 text-right text-gray-700', cell: (item) => <span>¥{format.currency(Number(item.amount))}</span> },
    { key: 'cum_percent', header: '累计占比', headCls: 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider', cellCls: 'px-4 py-3 text-right text-gray-500', cell: (item) => <span>{format.qty(Number(item.cum_percent), 2)}%</span> },
    {
      key: 'class',
      header: '分类',
      headCls: 'px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider',
      cellCls: 'px-4 py-3 text-right',
      cell: (item) => (
        <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-bold ${item.class === 'A' ? 'bg-red-100 text-red-600' : item.class === 'B' ? 'bg-amber-100 text-amber-600' : 'bg-gray-100 text-gray-500'}`}>
          {item.class}
        </span>
      ),
    },
  ];
  // [2026-09-13] 7 个页签 = 7 张表：主表（库存价值）用 ?cols=，其余各用命名空间
  const { visibleColumns: balanceVisible, menu: balanceMenu } = useTableView({
    pageKey: 'inventory-report-balance',
    columns: balanceCols,
    locked: { leading: ['product_code'] },
  });
  const { visibleColumns: turnoverVisible, menu: turnoverMenu } = useTableView({
    pageKey: 'inventory-report-turnover',
    paramNs: 'turnover',
    columns: turnoverCols,
    locked: { leading: ['product_code'] },
  });
  const { visibleColumns: dormantVisible, menu: dormantMenu } = useTableView({
    pageKey: 'inventory-report-dormant',
    paramNs: 'dormant',
    columns: dormantCols,
    locked: { leading: ['product_code'] },
  });
  const { visibleColumns: expiryVisible, menu: expiryMenu } = useTableView({
    pageKey: 'inventory-report-expiry',
    paramNs: 'expiry',
    columns: expiryCols,
    locked: { leading: ['product_code'] },
  });
  const { visibleColumns: reorderVisible, menu: reorderMenu } = useTableView({
    pageKey: 'inventory-report-reorder',
    paramNs: 'reorder',
    columns: reorderCols,
    locked: { leading: ['__sel'] },
  });
  const { visibleColumns: ageVisible, menu: ageMenu } = useTableView({
    pageKey: 'inventory-report-age',
    paramNs: 'age',
    columns: ageCols,
    locked: { leading: ['product_code'] },
  });
  const { visibleColumns: abcVisible, menu: abcMenu } = useTableView({
    pageKey: 'inventory-report-abc',
    paramNs: 'abc',
    columns: abcCols,
    locked: { leading: ['product_code'] },
  });
  const tabMenus: Record<string, ReactNode> = {
    balance: balanceMenu,
    turnover: turnoverMenu,
    dormant: dormantMenu,
    expiry: expiryMenu,
    reorder: reorderMenu,
    age: ageMenu,
    abc: abcMenu,
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="库存报表"
        subtitle="库存价值分析"
        extra={
          <button onClick={handleExport} className="btn-primary flex items-center gap-2">
            <Download className="w-4 h-4" />
            <span className="hidden md:inline">导出 CSV</span>
          </button>
        }
      />
      <div className="card px-6 py-3">
        <p className="text-sm text-gray-500">库存总价值</p>
        <p className="text-xl font-bold text-gray-800 break-all">¥{format.currency(totalValue)}</p>
      </div>

      {/* 标签切换 */}
      <div className="flex flex-wrap items-center gap-2">
        {([
          ['balance', '库存价值'],
          ['turnover', '周转率'],
          ['dormant', '呆滞库存'],
          ['expiry', '到期预警'],
          ['reorder', '补货建议'],
          ['age', '库龄分布'],
          ['abc', 'ABC分类'],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tab === key ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {label}
          </button>
        ))}
        {/* [2026-09-13] 视图菜单跟随当前页签（每张表一张视图） */}
        <div className="ml-auto">{tabMenus[tab]}</div>
      </div>

      {tab === 'turnover' && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">库存周转率（近30天出库 / 平均库存）</h2>
            <span className="text-xs text-gray-400">点击行可下钻查看库存流水</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  {turnoverVisible.map((c) => (
                    <th key={c.key} className={c.headCls || TH_L}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {turnoverData.length === 0 ? (
                  <tr><td colSpan={turnoverVisible.length} className="px-6 py-12 text-center text-sm text-gray-400">暂无周转数据（近30天无出库或库存为空）</td></tr>
                ) : (
                  turnoverData.map((item: any, idx: number) => (
                    <tr
                      key={idx}
                      className="hover:bg-blue-50 cursor-pointer transition-colors"
                      title={`查看「${item.product_name}」的库存流水`}
                      onClick={() => navigate(`/inventory/movement?keyword=${encodeURIComponent(item.product_code)}`)}
                    >
                      {turnoverVisible.map((c) => (
                        <td key={c.key} className={c.cellCls || TD}>
                          {c.cell(item)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'dormant' && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">呆滞库存（超90天无出入库）</h2>
            <span className="text-xs text-gray-400">点击行可下钻查看库存流水</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  {dormantVisible.map((c) => (
                    <th key={c.key} className={c.headCls || TH_L}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {dormantData.length === 0 ? (
                  <tr><td colSpan={dormantVisible.length} className="px-6 py-12 text-center text-sm text-gray-400">暂无呆滞库存</td></tr>
                ) : (
                  dormantData.map((item: any, idx: number) => (
                    <tr
                      key={idx}
                      className="hover:bg-blue-50 cursor-pointer transition-colors"
                      title={`查看「${item.product_name}」的库存流水`}
                      onClick={() => navigate(`/inventory/movement?keyword=${encodeURIComponent(item.product_code)}`)}
                    >
                      {dormantVisible.map((c) => (
                        <td key={c.key} className={c.cellCls || TD}>
                          {c.cell(item)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'expiry' && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">批次到期预警（90天内到期/已过期）</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  {expiryVisible.map((c) => (
                    <th key={c.key} className={c.headCls || TH_L}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {expiryData.length === 0 ? (
                  <tr><td colSpan={expiryVisible.length} className="px-6 py-12 text-center text-sm text-gray-400">暂无到期预警</td></tr>
                ) : (
                  expiryData.map((item: any, idx: number) => (
                    <tr key={idx} className="hover:bg-gray-50 transition-colors">
                      {expiryVisible.map((c) => (
                        <td key={c.key} className={c.cellCls || TD}>
                          {c.cell(item)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'reorder' && (
        <div className="card p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">自动补货建议（建议量=安全库存+已承诺未交−在库−在途）</h2>
            <button onClick={handleCreateRequisition} className="btn-primary flex items-center gap-2 text-sm">
              <ShoppingCart className="w-4 h-4" /> 生成采购申请({reorderSelected.size})
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  {reorderVisible.map((c) => (
                    <th key={c.key} className={c.headCls || TH_L}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {reorderData.length === 0 ? (
                  <tr><td colSpan={reorderVisible.length} className="px-6 py-12 text-center text-sm text-gray-400">暂无补货建议（库存充足或未设置安全库存）</td></tr>
                ) : (
                  reorderData.map((r: any) => (
                    <tr key={r.product_id} className="hover:bg-gray-50 transition-colors">
                      {reorderVisible.map((c) => (
                        <td key={c.key} className={c.cellCls || TD}>
                          {c.cell(r)}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'balance' && (
        <div className="space-y-6">
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">库存价值占比</h2>
          {loading ? (
            <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
          ) : (
            <div className="h-80">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={pieData}
                    cx="50%"
                    cy="50%"
                    outerRadius={100}
                    innerRadius={50}
                    paddingAngle={2}
                    dataKey="value"
                    label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                  >
                    {pieData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">库存排行</h2>
          <div className="space-y-4">
            {loading ? (
              <div className="flex items-center justify-center h-64"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" /></div>
            ) : inventoryData.slice(0, 10).map((item, index) => (
              <div key={`${item.product_id}-${item.warehouse_id}-${index}`} className="flex items-center gap-3">
                <span className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-xs font-medium text-gray-600">
                  {index + 1}
                </span>
                <div className="flex-1">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-sm font-medium text-gray-700">{item.product_name}</span>
                    <span className="text-sm font-medium text-gray-900">¥{format.currency(item.total_value || 0)}</span>
                  </div>
                  <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-blue-500 rounded-full"
                      style={{ width: `${((item.total_value || 0) / totalValue) * 100}%` }}
                    />
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="card p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800">库存明细</h2>
          <span className="text-xs text-gray-400">点击行可下钻查看库存流水</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-max">
            <thead>
              <tr className="bg-gray-50">
                {balanceVisible.map((c) => (
                  <th key={c.key} className={c.headCls || TH_L}>
                    {c.header}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={balanceVisible.length} className="px-6 py-12 text-center"><div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></td></tr>
              ) : inventoryData.length === 0 ? (
                <tr><td colSpan={balanceVisible.length} className="px-6"><EmptyState title="暂无库存数据" /></td></tr>
              ) : (
                inventoryData.map((item, idx) => (
                  <tr
                    key={`${item.product_id}-${item.warehouse_id}-${idx}`}
                    className="hover:bg-blue-50 cursor-pointer transition-colors"
                    title={`查看「${item.product_name}」的库存流水`}
                    onClick={() => navigate(`/inventory/movement?keyword=${encodeURIComponent(item.product_code)}`)}
                  >
                    {balanceVisible.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(item)}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
      </div>
      )}

      {tab === 'age' && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">库龄分布（按商品分桶，金额=数量×加权成本）</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  {ageVisible.map((c) => (
                    <th key={c.key} className={c.headCls || TH_L}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {ageData.length === 0 ? (
                  <tr><td colSpan={ageVisible.length} className="px-4 py-8 text-center text-gray-400">暂无库存数据</td></tr>
                ) : ageData.map((item) => (
                  <tr key={item.product_id} className="hover:bg-gray-50 transition-colors">
                    {ageVisible.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(item)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'abc' && (
        <div className="card p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">库存 ABC 分类（按库存金额累计占比：≤70% A、≤90% B、其余 C）</h2>
          <div className="overflow-x-auto">
            <table className="w-full min-w-max">
              <thead>
                <tr className="bg-gray-50">
                  {abcVisible.map((c) => (
                    <th key={c.key} className={c.headCls || TH_L}>
                      {c.header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {abcData.length === 0 ? (
                  <tr><td colSpan={abcVisible.length} className="px-4 py-8 text-center text-gray-400">暂无库存数据</td></tr>
                ) : abcData.map((item) => (
                  <tr key={item.product_id} className="hover:bg-gray-50 transition-colors">
                    {abcVisible.map((c) => (
                      <td key={c.key} className={c.cellCls || TD}>
                        {c.cell(item)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
