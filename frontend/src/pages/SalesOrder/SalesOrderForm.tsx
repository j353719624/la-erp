import { format } from '@/utils/format';
import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save, Plus, Trash2, AlertCircle, LayoutGrid } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { BarcodeInput } from '@/components/BarcodeInput';
import { MultiSpecPickerModal, type SpecBatchItem } from '@/components/MultiSpecPickerModal';
import { salesOrderApi, customerApi, salesContractApi } from '@/api/order';
import { productApi, warehouseApi, priceListApi, unitConversionApi } from '@/api/product';
import { userApi } from '@/api/system';
import { currencyApi } from '@/api/finance';
import { Customer, SalesOrder, SalesOrderLine } from '@/types/order';
import { EntityExtFieldsSection } from '@/components/EntityExtFieldsSection';
import { Product, Warehouse, UnitConversion } from '@/types/product';
import { User } from '@/types';
import { productSelectGroups, matchProductByScan } from '@/utils/productLabel';
import { mergeAddsIntoLines, recomputePricedLine } from '@/utils/docLines';
import { message } from '@/utils/appMessage';
import { useFormInteracted } from '@/hooks/useFormInteracted';
import { useUnsavedChanges } from '@/hooks/useUnsavedChanges';
import { useDocDefaultWarehouse } from '@/hooks/useDocDefaultWarehouse';
import { LineProductExt } from '@/components/LineProductExt';
import { useProductFieldLabels } from '@/hooks/useProductFieldLabels';
import { readDocDefault, saveDocDefault } from '@/utils/docDefaults';
import { loadOptions } from '@/utils/loadOptions';

export function SalesOrderForm() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const isEdit = !!params.id;
  // [2026-09-12] 再来一单（P-03）：?from=<源单ID> 时复制源单到新单
  const [searchParams] = useSearchParams();
  const copyFromId = searchParams.get('from') || '';

  const [formData, setFormData] = useState<Partial<SalesOrder>>({
    customer_id: '',
    customer_name: '',
    order_date: format.today(),
    warehouse_id: '',
    salesperson_id: '',
    expected_date: '',
    currency: 'CNY',
    discount_amount: 0,
    remark: '',
    ext: {},
    lines: [],
  });

  const [customers, setCustomers] = useState<Customer[]>([]);
  // 关联销售合同下拉（按客户过滤）（2026-09-11）
  const [salesContracts, setSalesContracts] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  // [2026-09-16] 商品自定义字段中文名（行内「商品信息」小字展示用）
  const productLabels = useProductFieldLabels();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  // [2026-09-12] 开单默认仓库（P-02）：上次使用 → 仓库档案默认 → 第一个；选中后自动记住
  useDocDefaultWarehouse('sales-order', {
    isEdit,
    warehouses,
    value: formData.warehouse_id,
    onChange: (id) => setFormData((prev) => ({ ...prev, warehouse_id: id })),
  });
  const [users, setUsers] = useState<User[]>([]);
  const [currencies, setCurrencies] = useState<{ code: string; name: string }[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  // 复制的源单号（仅展示提示，不随提交发送）
  const [copyFromNo, setCopyFromNo] = useState('');
  // W-01：扫码快录输入框 + 「按规格批量添加」弹窗
  const [scanValue, setScanValue] = useState('');
  const [specPickerOpen, setSpecPickerOpen] = useState(false);
  // 商品多计量单位换算映射：productId → 辅助单位配置（P1-1）
  const [convMap, setConvMap] = useState<Record<string, UnitConversion[]>>({});
  // 选项加载结果引用（fetchOrder 换算回显时使用，规避 React state 异步更新竞态）
  const optionsProductsRef = useRef<Product[]>([]);
  // 单据变更原因（P1-2：已确认/审批单据保存时必须填写）
  const [changeReason, setChangeReason] = useState('');
  // [物理保护] 双击/连发提交锁（disabled 依赖渲染，双击在渲染前可并发双提交）
  const submittingRef = useRef(false);
  // [物理保护] 卸载安全标记：提交回调对已卸载组件不再 setState/导航（防止"取消/返回后请求仍在飞行"的竞态 UI）
  const mountedRef = useRef(true);
  // [2026-09-12 修复] StrictMode 会重放 effect（cleanup → 再执行）：必须重置为 true，
  // 否则开发环境下 mountedRef 恒为 false → 保存成功后不跳转、按钮永远停在"保存中"
  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // [易用性 P1] 录了一半误点侧边栏/刷新 → 先确认再离开（避免整单内容静默丢失）
  // [2026-09-13 审查修复] 原「内容判脏」（customer_id || warehouse_id || remark || lines.length）
  // 在编辑态回填后恒为 true——只是查看也会被拦。统一改为观察真实交互（与其余 20+ 表单一致）。
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);

  useEffect(() => {
    (async () => {
      // 先等选项就绪（换算回显依赖商品主单位判定），再拉单据明细
      await fetchOptions();
      if (isEdit) {
        await fetchOrder();
      } else if (copyFromId) {
        // [2026-09-12] 再来一单（P-03）：复制源单（客户/仓库/明细），日期重置、单号由后端重新生成
        await copyFromOrder(copyFromId);
        loadSalesContracts();
      } else {
        loadSalesContracts(); // 新建：列出全部可选合同（选客户后再按客户过滤）
      }
    })();
  }, []);

  const fetchOptions = async () => {
    try {
      // [2026-09-14] 失败隔离：单项 403/失败不影响其它下拉（此前 Promise.all 一拒全空）
      const [customerRes, productRes, whRes, userRes, curRes] = await loadOptions([
        customerApi.list({ page: 1, page_size: 1000 }),
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
        warehouseApi.list({ page: 1, page_size: 1000 }),
        userApi.list({ page: 1, page_size: 1000 }),
        currencyApi.list(),
      ], '销售订单');
      if (customerRes?.code === 0) setCustomers(customerRes.data.list);
      if (productRes?.code === 0) {
        const plist = productRes.data.list || [];
        setProducts(plist);
        optionsProductsRef.current = plist;
      }
      if (whRes?.code === 0) setWarehouses(whRes.data?.list || []);
      if (userRes?.code === 0) setUsers(userRes.data?.list || []);
      if (curRes?.code === 0) setCurrencies(Array.isArray(curRes.data) ? curRes.data : []);
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  /**
   * 再来一单（2026-09-12，P-03 设置便利性）：复制源单到新单。
   *
   * 保留：客户 / 仓库 / 业务员 / 币种 / 关联合同 / 客户 PO 号 / 明细（商品、数量、价格、税率）。
   * 重置：id（防 create 误走更新）、单号（后端重新生成）、单据日期（今天）、期望交货日期、
   *       明细行 id 与已交付/已退货进度（新单从 0 开始，避免把旧单进度带进新单）。
   */
  const copyFromOrder = async (sourceId: string) => {
    try {
      const res = await salesOrderApi.get(sourceId);
      if (res.code !== 0 || !res.data) return;
      const order = res.data as any;
      const srcLines = order.edges?.lines || order.lines || [];
      // 行统一回商品主单位：源单可能用辅助单位（qty 已是主单位口径），
      // 若沿用辅助单位会造成"5 箱变 50 箱"式数量放大（与编辑态换算回显同理）
      const lines: SalesOrderLine[] = srcLines.map((line: any) => {
        const prod = optionsProductsRef.current.find((p) => p.id === line.product_id);
        return {
          id: '',
          product_id: line.product_id,
          product_code: line.product_code || line.edges?.product?.code || '',
          product_name: line.product_name || line.edges?.product?.name || '',
          spec: line.spec || line.edges?.product?.spec || '',
          unit_id: prod?.unit_id || line.unit_id,
          unit_name: prod ? prod.edges?.unit?.name || '' : line.unit_name || line.edges?.unit?.name || '',
          // [2026-09-16] 再来一单：带回商品自定义字段（行内「商品信息」小字）
          ext_fields: line.edges?.product?.ext_fields,
          qty: Number(line.qty ?? line.quantity ?? 0),
          quantity: Number(line.qty ?? line.quantity ?? 0),
          unit_rate: 1,
          price: Number(line.price) || 0,
          discount: Number(line.discount) || 0,
          amount: Number(line.amount) || 0,
          tax_rate: Number(line.tax_rate) || 0,
          tax_amount: Number(line.tax_amount) || 0,
          remark: line.remark || '',
          is_gift: line.is_gift || false,
          delivered_qty: 0,
          returned_qty: 0,
        };
      });
      setFormData({
        ...order,
        id: undefined, // 关键：JSON 序列化会忽略 undefined，create 请求不带 id，避免误走更新
        order_no: '',
        status: 'draft',
        order_date: format.today(),
        expected_date: '',
        lines,
      } as Partial<SalesOrder>);
      setCopyFromNo(order.order_no || '');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : '复制源单失败：可在列表点「查看详情」后手工新建');
    }
  };

  const fetchOrder = async () => {
    if (!params.id) return;
    try {
      const response = await salesOrderApi.get(params.id);
      if (response.code === 0) {
        const order = response.data;
        const linesFromServer = order.edges?.lines || order.lines || [];
        const lines: SalesOrderLine[] = linesFromServer.map((line: any) => ({
          id: line.id,
          product_id: line.product_id,
          product_code: line.product_code || line.edges?.product?.code || '',
          product_name: line.product_name || line.edges?.product?.name || '',
          spec: line.spec || line.edges?.product?.spec || '',
          unit_id: line.unit_id,
          unit_name: line.unit_name || line.edges?.unit?.name || '',
          // [2026-09-16] 回填商品自定义字段（行内「商品信息」小字）
          ext_fields: line.edges?.product?.ext_fields,
          // 后端 qty 为主单位数量；先按主单位口径回显，辅助单位行在下文按 rate 换算 quantity
          qty: Number(line.qty ?? line.quantity ?? 0),
          quantity: Number(line.qty ?? line.quantity ?? 0),
          unit_rate: 1,
          price: Number(line.price) || 0,
          discount: Number(line.discount) || 0,
          delivered_qty: Number(line.delivered_qty) || 0,
          returned_qty: Number(line.returned_qty) || 0,
          amount: Number(line.amount) || 0,
          tax_rate: Number(line.tax_rate) || 0,
          tax_amount: Number(line.tax_amount) || 0,
          remark: line.remark || '',
          is_gift: !!line.is_gift,
        }));

        // 多计量单位换算回显：行的单位若为辅助单位，quantity(主单位库存口径) 必须换算回
        // 所选单位数量 quantity=qty/rate、unit_rate=rate。此前 unit_rate 被硬编码 1，
        // 导致辅助单位行回显数量放大 rate 倍（如 50 显示成 50 箱而非 5 箱）且无法还原。
        const prods = optionsProductsRef.current;
        const mainUnitIdOf = (pid: string) => prods.find(p => p.id === pid)?.unit_id || '';
        const convNeeded = lines.filter(l =>
          l.product_id && l.unit_id && mainUnitIdOf(l.product_id) && l.unit_id !== mainUnitIdOf(l.product_id));
        const convLocal: Record<string, UnitConversion[]> = {};
        if (convNeeded.length > 0) {
          const needPids = [...new Set(convNeeded.map(l => l.product_id!))];
          await Promise.allSettled(needPids.map(async (pid) => {
            try {
              const res = await unitConversionApi.list(pid);
              convLocal[pid] = res.code === 0 ? (res.data || []) : [];
            } catch {
              convLocal[pid] = [];
            }
          }));
        }
        const echoLines = lines.map(l => {
          if (!l.product_id || !l.unit_id) return l;
          const mainId = mainUnitIdOf(l.product_id);
          if (!mainId || mainId === l.unit_id) return l; // 主单位行无需换算
          const conv = (convLocal[l.product_id!] || []).find(c => c.unit_id === l.unit_id);
          const rate = conv && conv.rate > 0 ? conv.rate : 0;
          if (rate > 0 && l.quantity > 0) {
            const q = Math.round((l.quantity / rate) * 1000) / 1000;
            return { ...l, quantity: q, unit_rate: rate, unit_name: l.unit_name || conv.unit_name || '' };
          }
          return l;
        });

        setFormData({
          id: order.id,
          order_no: order.order_no,
          customer_id: order.customer_id,
          customer_name: order.customer_name || order.edges?.customer?.name || '',
          order_date: order.order_date?.split('T')[0] || format.today(),
          warehouse_id: order.warehouse_id || '',
          salesperson_id: order.salesperson_id || '',
          expected_date: order.expected_date ? order.expected_date.split('T')[0] : '',
          currency: order.currency || 'CNY',
          discount_amount: Number(order.discount_amount) || 0,
          remark: order.remark || '',
          sales_contract_id: order.sales_contract_id || '',
          customer_contract_no: order.customer_contract_no || '',
          ext: order.ext || {},
          total_amount: order.total_amount || echoLines.reduce((sum, line) => sum + (line.amount || 0), 0),
          status: order.status,
          lines: echoLines,
        });        // 合同下拉：按该订单客户过滤
        loadSalesContracts(order.customer_id);      }
    } catch (err) {
      console.error('Failed to fetch order:', err);
    }
  };

  const handleCustomerChange = (customerId: string) => {
    const customer = customers.find(c => c.id === customerId);
    setFormData(prev => ({
      ...prev,
      customer_id: customerId,
      customer_name: customer?.name || '',
    }));
    // 换客户 → 合同下拉改为该客户的合同（已选的其它客户合同清空，避免张冠李戴）
    setFormData(prev => prev.sales_contract_id ? { ...prev, sales_contract_id: '' } : prev);
    loadSalesContracts(customerId);
  };

  /** 销售合同下拉（按客户过滤；已取消合同不返回） */
  const loadSalesContracts = (customerId?: string) => {
    salesContractApi.options(customerId || undefined)
      .then((res: any) => { if (res.code === 0) setSalesContracts(res.data || []); })
      .catch(() => { /* 静默：无合同时不影响下单 */ });
  };

  const handleAddLine = () => {
    const newLine: SalesOrderLine = {
      id: '',
      product_id: '',
      product_code: '',
      product_name: '',
      spec: '',
      unit_id: '',
      unit_name: '',
      quantity: 1,
      qty: 1,
      price: 0,
      price_auto: false,
      unit_rate: 1,
      discount: 0,
      amount: 0,
      // [2026-09-12] 行税率默认取上次使用（P-02）：多数客户固定 13%/1%，不必每行手填
      tax_rate: Number(readDocDefault('sales-order', 'tax_rate')) || 0,
      tax_amount: 0,
      is_gift: false,
    };
    setFormData(prev => ({
      ...prev,
      lines: [...(prev.lines || []), newLine],
    }));
  };

  // W-01：批量添加（规格矩阵 / 扫码共用）——同商品已在明细则数量累加，不产生重复行
  const handleBatchAdd = (adds: SpecBatchItem[]) => {
    if (!adds.length) return;
    const productOf = new Map(adds.map((a) => [a.product.id, a.product]));
    const existed = new Set((formData.lines || []).map((l) => l.product_id));
    const taxRateDefault = Number(readDocDefault('sales-order', 'tax_rate')) || 0;
    const hasCustomer = !!formData.customer_id;
    const { lines, merged } = mergeAddsIntoLines(
      formData.lines || [],
      adds.map((a) => ({ productId: a.product.id, qty: a.qty })),
      (add) => {
        const p = productOf.get(add.productId)!;
        const qty = add.qty;
        const price = Number(p.sale_price) || 0;
        const amount = Math.max(0, qty * price);
        return {
          id: '',
          product_id: p.id,
          product_code: p.code,
          product_name: p.name,
          spec: p.spec,
          unit_id: p.unit_id,
          unit_name: p.edges?.unit?.name || '',
          quantity: qty,
          qty,
          price,
          // 客户价目表自动带价（与手工选商品同语义）：有客户则占位为「自动」，回价后覆盖并保持自动
          price_auto: hasCustomer,
          unit_rate: 1,
          discount: 0,
          amount,
          tax_rate: taxRateDefault,
          tax_amount: (amount * taxRateDefault) / 100,
          is_gift: false,
          // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字）
          ext_fields: p.ext_fields,
        } as SalesOrderLine;
      },
      (line, deltaQty) => recomputePricedLine(line, deltaQty),
    );
    setFormData((prev) => ({
      ...prev,
      lines,
      total_amount: lines.reduce((s, l) => s + (Number(l.amount) || 0), 0),
    }));
    message.success(`已添加 ${adds.length} 个商品${merged ? `，其中 ${merged} 个累加到已有明细行` : ''}`);
    // 价目表带价只作用于本次新增的行（合并行不动价格，避免覆盖已改的手工价）
    if (hasCustomer) {
      for (const a of adds) {
        if (!existed.has(a.product.id)) applyCustomerPrice(a.product.id, a.qty);
      }
    }
  };

  // 客户价目表取价（W-01 批量新增行；合并行/已手工改价的行不动）
  const applyCustomerPrice = (productId: string, qty: number) => {
    const custId = formData.customer_id;
    if (!custId || !productId) return;
    priceListApi
      .price({ list_type: 'customer', entity_id: custId, product_id: productId, qty: qty || 1 })
      .then((res) => {
        const found = res.code === 0 && !!res.data?.found;
        const p = found ? Number(res.data!.price) : NaN;
        setFormData((prev) => {
          const ls = [...(prev.lines || [])];
          const idx = ls.findIndex((l) => l.product_id === productId);
          if (idx < 0 || !ls[idx].price_auto) return prev; // 行被删/已手工改价 → 不覆盖
          if (!found || isNaN(p)) {
            ls[idx] = { ...ls[idx], price_auto: false };
            return { ...prev, lines: ls };
          }
          const line = ls[idx];
          const mainQty = (Number(line.quantity) || 0) * (line.unit_rate || 1);
          const amount = Math.max(0, mainQty * p - (Number(line.discount) || 0));
          ls[idx] = { ...line, price: p, qty: mainQty, amount, tax_amount: (amount * (Number(line.tax_rate) || 0)) / 100 };
          return { ...prev, lines: ls, total_amount: ls.reduce((s, l) => s + (Number(l.amount) || 0), 0) };
        });
      })
      .catch(() => { /* 取价失败保留默认售价 */ });
  };

  // W-01：扫码/输码快速添加——条码/编码精确优先；连续扫同一商品自动累加数量
  const handleScanDetect = async (code: string) => {
    const raw = code.trim();
    setScanValue('');
    if (!raw) return;
    let match = matchProductByScan(products, raw);
    if (!match.hit && match.count === 0) {
      // 本地列表（1000 上限）未命中：按关键词回源查一次，支持大目录扫码
      try {
        const res = await productApi.list({ page: 1, page_size: 20, keyword: raw, status: 'active' });
        if (res.code === 0) match = matchProductByScan(res.data?.list || [], raw);
      } catch {
        /* 回源失败按未找到提示 */
      }
    }
    if (!match.hit) {
      message.warning(match.count > 1 ? `「${raw}」匹配到 ${match.count} 个商品，请扫条码或用编码精确录入` : `未找到商品：${raw}`);
      return;
    }
    handleBatchAdd([{ product: match.hit, qty: 1 }]);
  };

  // 加载商品的多计量单位换算配置（按需缓存到 convMap）
  const loadConversions = (productId: string) => {
    if (!productId || convMap[productId]) return;
    unitConversionApi.list(productId).then(res => {
      if (res.code === 0) {
        setConvMap(prev => ({ ...prev, [productId]: res.data || [] }));
      }
    }).catch(() => {});
  };

  // 取某商品的辅助单位换算率（主单位=1）
  const rateOf = (productId: string, unitId: string): number => {
    if (!productId || !unitId) return 1;
    const prod = products.find(p => p.id === productId);
    if (prod && prod.unit_id === unitId) return 1; // 主单位
    const conv = (convMap[productId] || []).find(c => c.unit_id === unitId);
    return conv && conv.rate > 0 ? conv.rate : 1;
  };

  // 取某商品的单位显示名
  const unitNameOf = (productId: string, unitId: string): string => {
    if (!productId || !unitId) return '';
    const prod = products.find(p => p.id === productId);
    if (prod && prod.unit_id === unitId) return prod.edges?.unit?.name || '';
    const conv = (convMap[productId] || []).find(c => c.unit_id === unitId);
    return conv?.unit_name || '';
  };

  const handleLineChange = (index: number, field: string, value: any) => {
    // [2026-09-12] 记住本行税率（P-02）：下次新增行自动带出
    if (field === 'tax_rate') saveDocDefault('sales-order', 'tax_rate', String(value ?? ''));
    const newLines = [...(formData.lines || [])];
    newLines[index] = { ...newLines[index], [field]: value };
    
    if (field === 'product_id') {
      const product = products.find(p => p.id === value);
      if (product) {
        newLines[index].product_code = product.code;
        newLines[index].product_name = product.name;
        newLines[index].spec = product.spec;
        newLines[index].unit_id = product.unit_id;
        newLines[index].unit_name = product.edges?.unit?.name || '';
        newLines[index].unit_rate = 1;
        newLines[index].qty = newLines[index].quantity || 1;
        newLines[index].price = product.sale_price;
        // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字；保存后由商品边提供）
        newLines[index].ext_fields = product.ext_fields;
      }
      loadConversions(value);
      // 价目表自动带价：客户价目表优先，未命中用商品默认售价
      const custId = formData.customer_id;
      if (custId) {
        priceListApi.price({
          list_type: 'customer',
          entity_id: custId,
          product_id: value,
          qty: newLines[index].quantity || 1,
        }).then(res => {
          if (res.code === 0 && res.data?.found) {
            const p = Number(res.data.price);
            if (!isNaN(p)) {
              setFormData(prev => {
                const ls = [...(prev.lines || [])];
                if (!ls[index]) return prev;
                const q = ls[index].quantity || ls[index].qty || 0;
                const d = ls[index].discount || 0;
                const tr = ls[index].tax_rate || 0;
                ls[index].price = p;
                ls[index].price_auto = true;
                ls[index].qty = q * (ls[index].unit_rate || 1);
                ls[index].amount = Math.max(0, ls[index].qty * p - d);
                ls[index].tax_amount = (ls[index].amount * tr) / 100;
                return { ...prev, lines: ls, total_amount: ls.reduce((s, l) => s + (l.amount || 0), 0) };
              });
            }
          }
        }).catch(() => {});
      }
    }
    // 用户手工改价 → 停止该行自动带价（避免数量变化时覆盖手工价）
    if (field === 'price') {
      newLines[index].price_auto = false;
    }
    // 促销赠品：勾选赠品 → 单价强制为 0（赠送不收款），取消赠品 → 恢复自动带价
    if (field === 'is_gift') {
      newLines[index].is_gift = !!value;
      if (newLines[index].is_gift) {
        newLines[index].price = 0;
        newLines[index].price_auto = false;
      } else {
        // 取消赠品：若客户价目表可带价则恢复自动带价
        const custId = formData.customer_id;
        const rate = newLines[index].unit_rate || 1;
        if (custId && newLines[index].product_id) {
          priceListApi.price({
            list_type: 'customer',
            entity_id: custId,
            product_id: newLines[index].product_id,
            qty: (newLines[index].quantity || 0) * rate,
          }).then(res => {
            if (res.code === 0 && res.data?.found) {
              const p = Number(res.data.price);
              if (!isNaN(p)) {
                setFormData(prev => {
                  const ls = [...(prev.lines || [])];
                  if (!ls[index]) return prev;
                  ls[index].price = p;
                  ls[index].price_auto = true;
                  const q = (ls[index].quantity || 0) * (ls[index].unit_rate || 1);
                  ls[index].qty = q;
                  ls[index].amount = Math.max(0, q * p - (ls[index].discount || 0));
                  ls[index].tax_amount = (ls[index].amount * (ls[index].tax_rate || 0)) / 100;
                  return { ...prev, lines: ls, total_amount: ls.reduce((s, l) => s + (l.amount || 0), 0) };
                });
              }
            }
          }).catch(() => {});
        }
      }
    }
    // 多计量单位：切换单位 → 更新换算率与单位名（qty 由下方按 rate 折算）
    if (field === 'unit_id') {
      const prodId = newLines[index].product_id;
      newLines[index].unit_rate = rateOf(prodId, value);
      newLines[index].unit_name = unitNameOf(prodId, value);
    }
    // 数量变化且该行为自动带价 → 按新数量（主单位口径）重新取阶梯价（价目表阶梯价联动）
    if (field === 'quantity' && newLines[index].price_auto && newLines[index].product_id) {
      const custId = formData.customer_id;
      if (custId) {
        const rate = newLines[index].unit_rate || 1;
        priceListApi.price({
          list_type: 'customer',
          entity_id: custId,
          product_id: newLines[index].product_id,
          qty: (value || 0) * rate,
        }).then(res => {
          if (res.code === 0 && res.data?.found) {
            const p = Number(res.data.price);
            if (!isNaN(p)) {
              setFormData(prev => {
                const ls = [...(prev.lines || [])];
                if (!ls[index] || !ls[index].price_auto) return prev;
                const q = (ls[index].quantity || 0) * (ls[index].unit_rate || 1);
                const d = ls[index].discount || 0;
                const tr = ls[index].tax_rate || 0;
                ls[index].price = p;
                ls[index].qty = q;
                ls[index].amount = Math.max(0, q * p - d);
                ls[index].tax_amount = (ls[index].amount * tr) / 100;
                return { ...prev, lines: ls, total_amount: ls.reduce((s, l) => s + (l.amount || 0), 0) };
              });
            }
          }
        }).catch(() => {});
      }
    }

    // 通用重算：quantity=所选单位数量（用户输入），qty=主单位数量=quantity×rate；金额按主单位数量计
    const displayQty = newLines[index].quantity || 0;
    const rate = newLines[index].unit_rate || 1;
    const mainQty = displayQty * rate;
    const price = newLines[index].price || 0;
    const discount = newLines[index].discount || 0;
    const taxRate = newLines[index].tax_rate || 0;
    newLines[index].qty = mainQty;
    newLines[index].amount = Math.max(0, mainQty * price - discount);
    newLines[index].tax_amount = (newLines[index].amount * taxRate) / 100;

    setFormData(prev => ({
      ...prev,
      lines: newLines,
      total_amount: newLines.reduce((sum, line) => sum + (line.amount || 0), 0),
    }));
  };

  const handleRemoveLine = (index: number) => {
    const newLines = [...(formData.lines || [])];
    newLines.splice(index, 1);
    setFormData(prev => ({
      ...prev,
      lines: newLines,
      total_amount: newLines.reduce((sum, line) => sum + (line.amount || 0), 0),
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submittingRef.current) return; // [物理保护] 第二击直接丢弃
    setError('');
    // 客户为必填（原原生 select required；改用 antd 后此处显式校验兜底）
    if (!formData.customer_id) {
      setError('请选择客户');
      return;
    }
    // P1-2 单据变更：已确认/审批的单据保存必须填变更原因（走 change API 留审计链）
    const isConfirmedPlus = formData.status === 'confirmed' || formData.status === 'approved';
    if (isEdit && params.id && isConfirmedPlus && !changeReason.trim()) {
      setError('已确认/审批单据变更必须填写变更原因');
      return;
    }
    submittingRef.current = true;
    setLoading(true);
    try {
      // 金额统一 round 2 后提交，杜绝浮点尾差导致的"差几分"（金额=数量×单价-折扣等浮点路径）
      const r2 = (v: any) => Math.round((Number(v) || 0) * 100) / 100;
      const submitData = {
        ...formData,
        lines: (formData.lines || []).map(line => ({
          product_id: line.product_id,
          product_code: line.product_code,
          product_name: line.product_name,
          spec: line.spec,
          unit_id: line.unit_id,
          unit_name: line.unit_name,
          qty: Number(line.qty || line.quantity || 0), // 主单位数量（多计量单位已按 rate 折算）
          price: r2(line.price),
          discount: r2(line.discount || 0),
          amount: r2(line.amount),
          tax_rate: line.tax_rate,
          tax_amount: r2(line.tax_amount),
          remark: line.remark || '',
          is_gift: line.is_gift || false,
        })),
        total_amount: Math.round((formData.lines || []).reduce((s: number, l: any) => s + (Number(l.amount) || 0), 0) * 100) / 100,
      };

      let response;
      if (isEdit && params.id) {
        if (isConfirmedPlus) {
          response = await salesOrderApi.change(params.id, { ...submitData, reason: changeReason.trim() });
        } else {
          response = await salesOrderApi.update(params.id, submitData);
        }
      } else {
        response = await salesOrderApi.create(submitData);
      }
      if (response.code === 0) {
        if (mountedRef.current) navigate('/sales-orders'); // [物理保护] 卸载后不再导航
      }
    } catch (err) {
      console.error('Failed to save order:', err);
      if (mountedRef.current) setError(err.message || '保存失败'); // [物理保护] 卸载后不再 setState
    } finally {
      submittingRef.current = false;
      if (mountedRef.current) setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑销售订单' : '新建销售订单'}
        subtitle={isEdit ? '修改销售订单信息' : copyFromNo ? `复制自 ${copyFromNo}：客户/仓库/明细已带出，日期已重置为今天，保存后生成新单号` : '创建新的销售订单'}
        onBack={() => navigate('/sales-orders')}
        backDisabled={loading}
      />

      {error && (
        <div className="flex items-center gap-2 px-4 py-3 bg-red-50 border border-red-200 rounded-lg">
          <AlertCircle className="w-5 h-5 text-red-600" />
          <span className="text-red-700 text-sm">{error}</span>
        </div>
      )}

      <div className="card p-6">
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">客户 *</label>
              <SearchSelect
                required
                value={formData.customer_id}
                onChange={(v) => handleCustomerChange(v ?? '')}
                placeholder="请选择客户"
                options={customers.map((c) => ({ value: c.id, label: c.name }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">订单日期 *</label>
              <input
                type="date"
                value={formData.order_date || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, order_date: e.target.value }))}
                required
                className="form-input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">总金额</label>
              <input
                type="text"
                value={`¥${Number(formData.total_amount || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                disabled
                className="form-input bg-gray-50 text-gray-600"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">仓库</label>
              <SearchSelect
                value={formData.warehouse_id}
                onChange={(v) => setFormData(prev => ({ ...prev, warehouse_id: v ?? '' }))}
                placeholder="请选择仓库"
                options={warehouses.map((w) => ({ value: w.id, label: w.name }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">期望交货日期</label>
              <input
                type="date"
                value={formData.expected_date || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, expected_date: e.target.value }))}
                className="form-input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">业务员</label>
              <SearchSelect
                value={formData.salesperson_id}
                onChange={(v) => setFormData(prev => ({ ...prev, salesperson_id: v ?? '' }))}
                placeholder="请选择业务员"
                options={users.map((u) => ({ value: u.id, label: u.name || u.username }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">币种</label>
              <SearchSelect
                value={formData.currency || 'CNY'}
                onChange={(v) => setFormData(prev => ({ ...prev, currency: v ?? 'CNY' }))}
                placeholder="请选择币种"
                options={currencies.map((c) => ({ value: c.code, label: `${c.code} - ${c.name}` }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">整单折扣（金额）</label>
              <input
                type="text"
                inputMode="decimal"
                value={formData.discount_amount ?? ''}
                onChange={(e) => setFormData(prev => ({ ...prev, discount_amount: e.target.value }))}
                className="form-input"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">关联销售合同</label>
              <SearchSelect
                value={formData.sales_contract_id || ''}
                onChange={(v) => setFormData(prev => ({ ...prev, sales_contract_id: v ?? '' }))}
                placeholder="可不选；选择后计入合同执行进度"
                options={[
                  // 编辑态保留已选合同（即便不在当前列表中，也原样展示）
                  ...(formData.sales_contract_id && !salesContracts.some((c: any) => c.id === formData.sales_contract_id)
                    ? [{ value: formData.sales_contract_id, label: '已选合同（不在当前客户合同列表中）' }]
                    : []),
                  ...salesContracts.map((c: any) => ({
                    value: c.id,
                    label: `${c.contract_no}${c.customer_contract_no ? ` / ${c.customer_contract_no}` : ''}（¥${Number(c.total_amount || 0).toLocaleString('zh-CN')}）`,
                  })),
                ]}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">客户合同号 / PO 号</label>
              <input
                type="text"
                value={formData.customer_contract_no || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, customer_contract_no: e.target.value }))}
                placeholder="客户方单号（对账用）"
                className="form-input"
               autoCapitalize="none" autoCorrect="off" spellCheck={false}/>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">备注</label>
              <textarea
                value={formData.remark || ''}
                onChange={(e) => setFormData(prev => ({ ...prev, remark: e.target.value }))}
                rows={2}
                className="form-input"
              />
            </div>
          </div>

          {/* 表头自定义字段（布局管理 form 布局 → 元数据扩展字段） */}
          <EntityExtFieldsSection
            entityCode="sales_order"
            value={formData.ext || {}}
            disabled={loading}
            onChange={(code, v) => setFormData(prev => ({ ...prev, ext: { ...(prev.ext || {}), [code]: v } }))}
          />

          {isEdit && (formData.status === 'confirmed' || formData.status === 'approved') && (
            <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
              <label className="block text-sm font-medium text-amber-800 mb-2">
                变更原因 *（当前单据已确认/审批，保存将记录变更历史并重新锁定库存）
              </label>
              <input
                type="text"
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                placeholder="如：客户追加数量 / 修改交货数量"
                className="form-input"
              />
            </div>
          )}

          <div className="border border-gray-200 rounded-xl overflow-hidden">
            <div className="bg-gray-50 px-4 py-3 border-b border-gray-200 flex flex-wrap items-center gap-3">
              <h3 className="font-medium text-gray-700 whitespace-nowrap">订单明细</h3>
              <div className="w-full sm:max-w-xs">
                <BarcodeInput
                  value={scanValue}
                  onChange={setScanValue}
                  onDetect={handleScanDetect}
                  placeholder="扫码/输码快速添加：条码 / 编码，回车"
                />
              </div>
              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setSpecPickerOpen(true)}
                  className="btn-secondary text-sm flex items-center gap-1"
                  title="多规格商品：选款后在「颜色×尺码」网格里直接填数量，一次生成多条明细"
                >
                  <LayoutGrid className="w-4 h-4" />
                  按规格批量添加
                </button>
                <button type="button" onClick={handleAddLine} className="btn-secondary text-sm flex items-center gap-1">
                  <Plus className="w-4 h-4" />
                  添加商品
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full min-w-max">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">商品</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">规格</th>
                    <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">单位</th>
                    <th className="px-4 py-3 text-center text-xs font-medium text-gray-500">赠品</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">单价</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">数量</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">折扣</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">税率%</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">税额</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">金额</th>
                    <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {(formData.lines || []).map((line, index) => (
                    <tr key={line.id || index}>
                      <td className="px-4 py-3">
                        <SearchSelect
                          value={line.product_id}
                          onChange={(v) => handleLineChange(index, 'product_id', v ?? '')}
                          placeholder="请选择商品"
                          options={[
                            // 编辑态保留已删除/不在列表中的商品（原样展示，不可再改选别的值）
                            ...(!products.some((p) => p.id === line.product_id) && line.product_id
                              ? [{ value: line.product_id, label: `${line.product_code} - ${line.product_name || '已删除商品'}` }]
                              : []),
                            ...productSelectGroups(products),
                          ]}
                        />
                        <LineProductExt line={line} labels={productLabels} />
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-sm">{line.spec}</td>
                      <td className="px-4 py-3">
                        {(() => {
                          const prod = line.product_id ? products.find(p => p.id === line.product_id) : undefined;
                          const convs = line.product_id ? (convMap[line.product_id] || []) : [];
                          const mainUnitId = prod?.unit_id || '';
                          const hasValue = line.unit_id && (line.unit_id === mainUnitId || convs.some(c => c.unit_id === line.unit_id));
                          return (
                            <>
                              <select
                                value={line.unit_id || ''}
                                onChange={(e) => handleLineChange(index, 'unit_id', e.target.value)}
                                className="form-select"
                                disabled={!line.product_id}
                              >
                                {line.unit_id && !hasValue && (
                                  <option value={line.unit_id}>{line.unit_name || '未知单位'}</option>
                                )}
                                {prod && <option value={mainUnitId}>{prod.edges?.unit?.name || '主单位'}</option>}
                                {convs.map((c) => (
                                  <option key={c.unit_id} value={c.unit_id}>{c.unit_name} (1={c.rate})</option>
                                ))}
                              </select>
                              {line.unit_rate && line.unit_rate > 1 && (
                                <div className="text-xs text-gray-400 mt-1">= {Number(line.qty || 0)} 主单位</div>
                              )}
                            </>
                          );
                        })()}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <input
                          type="checkbox"
                          checked={!!line.is_gift}
                          onChange={(e) => handleLineChange(index, 'is_gift', e.target.checked)}
                          className="w-4 h-4 accent-blue-600"
                          title="勾选后该行为赠品（单价自动置 0）"
                        />
                        {line.is_gift && <div className="text-[10px] text-blue-500 mt-0.5">赠品</div>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={line.is_gift ? 0 : (line.price ?? '')}
                          onChange={(e) => handleLineChange(index, 'price', e.target.value)}
                          className="form-input text-right"
                          disabled={line.is_gift}
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={line.quantity != null ? line.quantity : (line.qty ?? '')}
                          onChange={(e) => handleLineChange(index, 'quantity', e.target.value)}
                          className="form-input text-right"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={line.discount ?? ''}
                          onChange={(e) => handleLineChange(index, 'discount', e.target.value)}
                          className="form-input text-right w-20"
                        />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={line.tax_rate ?? ''}
                          onChange={(e) => handleLineChange(index, 'tax_rate', e.target.value)}
                          className="form-input text-right w-20"
                        />
                      </td>
                      <td className="px-4 py-3 text-right text-gray-600">¥{formatCurrency(line.tax_amount)}</td>
                      <td className="px-4 py-3 text-right font-medium">¥{formatCurrency(line.amount)}</td>
                      <td className="px-4 py-3 text-right">
                        <button
                          type="button"
                          onClick={() => handleRemoveLine(index)}
                          aria-label={`删除第 ${index + 1} 行明细`} /* [a11y] 屏幕阅读器可读 */
                          className="icon-btn p-2 text-red-600 hover:bg-red-50 rounded-lg"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </td>
                    </tr>
                  ))}
                  {(!formData.lines || formData.lines.length === 0) && (
                    <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-500">点击上方按钮添加商品</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex justify-end gap-6 text-sm">
            <div>
              <span className="text-gray-500">税额合计：</span>
              <span className="font-medium">¥{formatCurrency((formData.lines || []).reduce((s, l) => s + (Number(l.tax_amount) || 0), 0))}</span>
            </div>
            <div>
              <span className="text-gray-500">价税合计：</span>
              <span className="font-medium">¥{formatCurrency((formData.lines || []).reduce((s, l) => s + (Number(l.amount) || 0) + (Number(l.tax_amount) || 0), 0))}</span>
            </div>
          </div>

          <div className="form-actions">
            {/* [物理保护] 保存/更新中锁定"取消"：避免"点取消导航离开但请求仍在飞行→数据已提交"的竞态 */}
            {/* [易用性 P1] 有未保存内容时先确认，防止误点丢单 */}
            <button type="button" onClick={() => { if (confirmLeave()) navigate('/sales-orders'); }} disabled={loading} className="btn-secondary">取消</button>
            <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
              <Save className="w-5 h-5" />
              {loading ? '保存中...' : (isEdit ? '更新' : '保存')}
            </button>
          </div>
        </form>
      </div>

      {/* W-01：多规格商品按款矩阵批量录入（销售订单：价格来自商品售价/客户价目表，不显示仓库库存） */}
      <MultiSpecPickerModal
        open={specPickerOpen}
        onClose={() => setSpecPickerOpen(false)}
        products={products}
        existingProductIds={(formData.lines || []).map((l) => l.product_id).filter(Boolean) as string[]}
        onConfirm={(items) => {
          handleBatchAdd(items);
          setSpecPickerOpen(false);
        }}
      />
    </div>
  );
}

function formatCurrency(value: number): string {
  return value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
