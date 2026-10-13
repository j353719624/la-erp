import { useState, useEffect, useRef } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Save, Plus, Trash2, AlertCircle, LayoutGrid } from 'lucide-react';
import { PageHeader } from '@/components/PageHeader';
import { SearchSelect } from '@/components/SearchSelect';
import { BarcodeInput } from '@/components/BarcodeInput';
import { MultiSpecPickerModal, type SpecBatchItem } from '@/components/MultiSpecPickerModal';
import { purchaseOrderApi, supplierApi, contractApi } from '@/api/order';
import { productApi, warehouseApi, priceListApi, unitConversionApi } from '@/api/product';
import { currencyApi } from '@/api/finance';
import { format } from '@/utils/format';
import { Supplier, PurchaseOrder, PurchaseOrderLine } from '@/types/order';
import { Product, Warehouse, UnitConversion } from '@/types/product';
import { EntityExtFieldsSection } from '@/components/EntityExtFieldsSection';
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

export function PurchaseOrderForm() {
  const navigate = useNavigate();
  const params = useParams<{ id: string }>();
  const isEdit = !!params.id;
  // [2026-09-12] 再来一单（P-03）：?from=<源单ID> 时复制源单到新单
  const [searchParams] = useSearchParams();
  const copyFromId = searchParams.get('from') || '';

  const [formData, setFormData] = useState<Partial<PurchaseOrder>>({
    supplier_id: '',
    supplier_name: '',
    contract_id: '',
    order_date: format.today(),
    warehouse_id: '',
    expected_date: '',
    currency: 'CNY',
    discount_amount: 0,
    remark: '',
    ext: {},
    lines: [],
  });

  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [contracts, setContracts] = useState<any[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  // [2026-09-16] 商品自定义字段中文名（行内「商品信息」小字展示用）
  const productLabels = useProductFieldLabels();

  // [易用性 P1] 录了一半误点侧边栏/刷新 → 先确认再离开（避免整单内容静默丢失）
  // [2026-09-13 审查修复] 原「内容判脏」编辑态回填后恒为 true（只是查看也被拦）→ 统一改交互判定
  const dirty = useFormInteracted();
  const confirmLeave = useUnsavedChanges(dirty);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  // [2026-09-12] 开单默认仓库（P-02）：上次使用 → 仓库档案默认 → 第一个；选中后自动记住
  useDocDefaultWarehouse('purchase-order', {
    isEdit,
    warehouses,
    value: formData.warehouse_id,
    onChange: (id) => setFormData((prev) => ({ ...prev, warehouse_id: id })),
  });
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

  useEffect(() => {
    (async () => {
      // 先等选项就绪（换算回显依赖商品主单位判定），再拉单据明细
      await fetchOptions();
      if (isEdit) {
        await fetchOrder();
      } else if (copyFromId) {
        // [2026-09-12] 再来一单（P-03）：复制源单（供应商/仓库/明细），日期重置、单号后端重新生成
        await copyFromOrder(copyFromId);
      }
    })();
  }, []);

  const fetchOptions = async () => {
    try {
      // [2026-09-14] 失败隔离：单项 403/失败不影响其它下拉（此前 Promise.all 一拒全空）
      const [supplierRes, productRes, whRes, curRes, ctRes] = await loadOptions([
        supplierApi.list({ page: 1, page_size: 1000 }),
        productApi.list({ page: 1, page_size: 1000, status: 'active' }),
        warehouseApi.list({ page: 1, page_size: 1000 }),
        currencyApi.list(),
        // 关联采购合同（P2 合同执行进度）
        contractApi.list({ page: 1, page_size: 1000 }),
      ], '采购订单');
      if (supplierRes?.code === 0) setSuppliers(supplierRes.data.list);
      if (productRes?.code === 0) {
        const plist = productRes.data.list || [];
        setProducts(plist);
        optionsProductsRef.current = plist;
      }
      if (whRes?.code === 0) setWarehouses(whRes.data?.list || []);
      if (curRes?.code === 0) setCurrencies(Array.isArray(curRes.data) ? curRes.data : []);
      if (ctRes?.code === 0) setContracts(ctRes.data?.list || []);
    } catch (err) {
      console.error('Failed to fetch options:', err);
    }
  };

  /**
   * 再来一单（2026-09-12，P-03 设置便利性）：复制源单到新单。
   *
   * 保留：供应商 / 仓库 / 币种 / 明细（商品、数量、价格、税率）。
   * 重置：id（防 create 误走更新）、单号（后端重新生成）、单据日期（今天）、期望到货日期、
   *       明细行 id 与已交付/已退货进度。
   */
  const copyFromOrder = async (sourceId: string) => {
    try {
      const res = await purchaseOrderApi.get(sourceId);
      if (res.code !== 0 || !res.data) return;
      const order = res.data as any;
      const srcLines = order.edges?.lines || order.lines || [];
      // 行统一回商品主单位（同销售端：避免辅助单位行的数量口径放大）
      const lines: PurchaseOrderLine[] = srcLines.map((line: any) => {
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
      } as Partial<PurchaseOrder>);
      setCopyFromNo(order.order_no || '');
    } catch (err) {
      setError(err instanceof Error && err.message ? err.message : '复制源单失败：可在列表点「查看详情」后手工新建');
    }
  };

  const fetchOrder = async () => {
    if (!params.id) return;
    try {
      const response = await purchaseOrderApi.get(params.id);
      if (response.code === 0) {
        const order = response.data;
        const linesFromServer = order.edges?.lines || order.lines || [];
        const lines: PurchaseOrderLine[] = linesFromServer.map((line: any) => ({
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
          supplier_id: order.supplier_id,
          supplier_name: order.supplier_name || order.edges?.supplier?.name || '',
          contract_id: order.contract_id || '',
          order_date: order.order_date?.split('T')[0] || format.today(),
          warehouse_id: order.warehouse_id || '',
          expected_date: order.expected_date ? order.expected_date.split('T')[0] : '',
          currency: order.currency || 'CNY',
          discount_amount: Number(order.discount_amount) || 0,
          remark: order.remark || '',
          ext: order.ext || {},
          total_amount: order.total_amount || echoLines.reduce((sum, line) => sum + (line.amount || 0), 0),
          status: order.status,
          lines: echoLines,
        });
      }
    } catch (err) {
      console.error('Failed to fetch order:', err);
    }
  };

  const handleSupplierChange = (supplierId: string) => {
    const supplier = suppliers.find(s => s.id === supplierId);
    setFormData(prev => ({
      ...prev,
      supplier_id: supplierId,
      supplier_name: supplier?.name || '',
    }));
  };

  const handleAddLine = () => {
    const newLine: PurchaseOrderLine = {
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
      // [2026-09-12] 行税率默认取上次使用（P-02）：进项税率固定（如 13%）时不必每行手填
      tax_rate: Number(readDocDefault('purchase-order', 'tax_rate')) || 0,
      tax_amount: 0,
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
    const taxRateDefault = Number(readDocDefault('purchase-order', 'tax_rate')) || 0;
    const hasSupplier = !!formData.supplier_id;
    const { lines, merged } = mergeAddsIntoLines(
      formData.lines || [],
      adds.map((a) => ({ productId: a.product.id, qty: a.qty })),
      (add) => {
        const p = productOf.get(add.productId)!;
        const qty = add.qty;
        const price = Number(p.purchase_price) || 0;
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
          // 供应商价目表自动带价（与手工选商品同语义）：有供应商则占位为「自动」，回价后覆盖并保持自动
          price_auto: hasSupplier,
          unit_rate: 1,
          discount: 0,
          amount,
          tax_rate: taxRateDefault,
          tax_amount: (amount * taxRateDefault) / 100,
          // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字）
          ext_fields: p.ext_fields,
        } as PurchaseOrderLine;
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
    if (hasSupplier) {
      for (const a of adds) {
        if (!existed.has(a.product.id)) applySupplierPrice(a.product.id, a.qty);
      }
    }
  };

  // 供应商价目表取价（W-01 批量新增行；合并行/已手工改价的行不动）
  const applySupplierPrice = (productId: string, qty: number) => {
    const suppId = formData.supplier_id;
    if (!suppId || !productId) return;
    priceListApi
      .price({ list_type: 'supplier', entity_id: suppId, product_id: productId, qty: qty || 1 })
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
      .catch(() => { /* 取价失败保留默认进价 */ });
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
    if (field === 'tax_rate') saveDocDefault('purchase-order', 'tax_rate', String(value ?? ''));
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
        newLines[index].price = product.purchase_price;
        // [2026-09-16] 商品自定义字段随行带出（行内「商品信息」小字；保存后由商品边提供）
        newLines[index].ext_fields = product.ext_fields;
      }
      loadConversions(value);
      // 价目表自动带价：供应商价目表优先，未命中用商品默认进价
      const suppId = formData.supplier_id;
      if (suppId) {
        priceListApi.price({
          list_type: 'supplier',
          entity_id: suppId,
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
    // 多计量单位：切换单位 → 更新换算率与单位名（qty 由下方按 rate 折算）
    if (field === 'unit_id') {
      const prodId = newLines[index].product_id;
      newLines[index].unit_rate = rateOf(prodId, value);
      newLines[index].unit_name = unitNameOf(prodId, value);
    }
    // 数量变化且该行为自动带价 → 按新数量（主单位口径）重新取阶梯价（价目表阶梯价联动）
    if (field === 'quantity' && newLines[index].price_auto && newLines[index].product_id) {
      const suppId = formData.supplier_id;
      if (suppId) {
        const rate = newLines[index].unit_rate || 1;
        priceListApi.price({
          list_type: 'supplier',
          entity_id: suppId,
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
    setError('');
    if (!formData.supplier_id) { setError('请选择供应商'); return; }
    // P1-2 单据变更：已确认/审批的单据保存必须填变更原因（走 change API 留审计链）
    const isConfirmedPlus = formData.status === 'confirmed' || formData.status === 'approved';
    if (isEdit && params.id && isConfirmedPlus && !changeReason.trim()) {
      setError('已确认/审批单据变更必须填写变更原因');
      return;
    }
    setLoading(true);
    try {
      // 金额统一 round 2 后提交，杜绝浮点尾差导致的"差几分"（金额=数量×单价-折扣等浮点路径）
      const r2 = (v: any) => Math.round((Number(v) || 0) * 100) / 100;
      const submitData = {
        ...formData,
        contract_id: formData.contract_id || null,
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
        })),
        total_amount: Math.round((formData.lines || []).reduce((s: number, l: any) => s + (Number(l.amount) || 0), 0) * 100) / 100,
      };

      let response;
      if (isEdit && params.id) {
        if (isConfirmedPlus) {
          response = await purchaseOrderApi.change(params.id, { ...submitData, reason: changeReason.trim() });
        } else {
          response = await purchaseOrderApi.update(params.id, submitData);
        }
      } else {
        response = await purchaseOrderApi.create(submitData);
      }
      if (response.code === 0) {
        navigate('/purchase-orders');
      }
    } catch (err) {
      console.error('Failed to save order:', err);
      setError(err.message || '保存失败');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title={isEdit ? '编辑采购订单' : '新建采购订单'}
        subtitle={isEdit ? '修改采购订单信息' : copyFromNo ? `复制自 ${copyFromNo}：供应商/仓库/明细已带出，日期已重置为今天，保存后生成新单号` : '创建新的采购订单'}
        onBack={() => { if (confirmLeave()) navigate('/purchase-orders'); }}
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
              <label className="block text-sm font-medium text-gray-700 mb-2">供应商 *</label>
              <SearchSelect
                required
                value={formData.supplier_id}
                onChange={(v) => handleSupplierChange(v ?? '')}
                placeholder="请选择供应商"
                options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">关联合同</label>
              <SearchSelect
                value={formData.contract_id}
                onChange={(v) => setFormData(prev => ({ ...prev, contract_id: v ?? '' }))}
                placeholder="不关联合同"
                options={[
                  // 编辑态保留已选合同（即使其状态已变为非可关联状态，仍原样展示）
                  ...(formData.contract_id && !contracts.some((c: any) => c.id === formData.contract_id)
                    ? [{ value: formData.contract_id, label: '已选合同' }]
                    : []),
                  ...contracts
                    .filter((c: any) => c.status === 'active' || c.status === 'draft' || (formData.contract_id && c.id === formData.contract_id))
                    .map((c: any) => ({ value: c.id, label: `${c.contract_no}（${format.currency(parseFloat(c.total_amount || '0'))}）` })),
                ]}
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
            entityCode="purchase_order"
            value={formData.ext || {}}
            disabled={loading}
            onChange={(code, v) => setFormData(prev => ({ ...prev, ext: { ...(prev.ext || {}), [code]: v } }))}
          />

          {isEdit && (formData.status === 'confirmed' || formData.status === 'approved') && (
            <div className="px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
              <label className="block text-sm font-medium text-amber-800 mb-2">
                变更原因 *（当前单据已确认/审批，保存将记录变更历史）
              </label>
              <input
                type="text"
                value={changeReason}
                onChange={(e) => setChangeReason(e.target.value)}
                placeholder="如：供应商改价 / 修改数量"
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
                      <td className="px-4 py-3 text-right">
                        <input
                          type="text"
                          inputMode="decimal"
                          value={line.price ?? ''}
                          onChange={(e) => handleLineChange(index, 'price', e.target.value)}
                          className="form-input text-right"
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
                        <button type="button" onClick={() => handleRemoveLine(index)} className="p-2 text-red-600 hover:bg-red-50 rounded-lg">
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
            <button type="button" onClick={() => { if (confirmLeave()) navigate('/purchase-orders'); }} disabled={loading} className="btn-secondary">取消</button>
            <button type="submit" disabled={loading} className="btn-primary flex items-center gap-2">
              <Save className="w-5 h-5" />
              {loading ? '保存中...' : (isEdit ? '更新' : '保存')}
            </button>
          </div>
        </form>
      </div>

      {/* W-01：多规格商品按款矩阵批量录入（采购订单：价格来自商品进价/供应商价目表） */}
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
  return (value || 0).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
