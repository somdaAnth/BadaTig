const API_URL = window.location.protocol === "file:" ? "http://127.0.0.1:8000" : window.location.origin;
const AUTO_REFRESH_MS = 10 * 60 * 1000;
const COLORS = ["#ff6b35", "#00d4aa", "#4f8ef7", "#9b6fff", "#ffd23f", "#22c55e", "#ff4d6d"];

let dashboardData = null;
let currentFilters = { start: null, end: null, category: "" };
let revChartInst = null;
let paretoChartInst = null;
let buyerChartInst = null;

function number(value) {
  return new Intl.NumberFormat("en-US").format(Number(value || 0));
}

function money(value) {
  return "THB " + new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 }).format(Number(value || 0));
}

function compactMoney(value) {
  const n = Number(value || 0);
  if (n >= 1_000_000) return `THB ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `THB ${(n / 1_000).toFixed(1)}K`;
  return money(n);
}

function pct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "N/A";
  return `${Number(value).toFixed(1)}%`;
}

function dateLabel(value) {
  if (!value) return "-";
  return new Date(value).toLocaleDateString("th-TH", { day: "numeric", month: "short" });
}

function fullDateTime(value) {
  if (!value) return "-";
  return new Date(value).toLocaleString("th-TH", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function titleCase(text) {
  return String(text || "")
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function productLabel(row) {
  return row?.product_name || (row?.product_id ? `SKU ${row.product_id}` : "Unknown product");
}

function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function showToast(message) {
  const toast = document.createElement("div");
  toast.style.cssText = "position:fixed;top:20px;right:20px;background:#ff6b35;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;z-index:9999";
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 2200);
}

async function loadDashboardData(showNotice = false) {
  try {
    const response = await fetch(`${API_URL}/dashboard`, { cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    dashboardData = await response.json();
    hydrateFilters();
    renderDashboard();
    if (showNotice) showToast("รีเฟรชข้อมูลแล้ว");
  } catch (error) {
    console.error(error);
    showToast("โหลดข้อมูลไม่สำเร็จ กรุณาเปิด FastAPI server ที่ 127.0.0.1:8000");
  }
}

function hydrateFilters() {
  if (!dashboardData) return;
  const range = dashboardData.filters?.date_range || {};
  const startEl = document.getElementById("f-start");
  const endEl = document.getElementById("f-end");
  const catEl = document.getElementById("f-cat");

  if (!currentFilters.start) currentFilters.start = range.start || "";
  if (!currentFilters.end) currentFilters.end = range.end || "";

  startEl.value = currentFilters.start || "";
  endEl.value = currentFilters.end || "";

  const categories = safeArray(dashboardData.filters?.categories);
  catEl.innerHTML = `<option value="">ทุกหมวดหมู่</option>${categories
    .map((category) => `<option value="${category}">${titleCase(category)}</option>`)
    .join("")}`;
  catEl.value = currentFilters.category || "";
}

function getFilteredRows(rows, options = {}) {
  // Backward compat: ถ้าใส่ string เข้ามา ให้ถือเป็น dateKey
  if (typeof options === "string") options = { dateKey: options };
  const dateKey = options.dateKey || "event_date";
  const ignoreCategory = options.ignoreCategory === true;
  const ignoreDate = options.ignoreDate === true;

  return safeArray(rows).filter((row) => {
    // Date filter — ใช้ field ที่ระบุ หรือ fallback ไป date/month
    const rowDate = row[dateKey] || row.date || row.month || "";
    const dateOk = ignoreDate ||
      !rowDate ||
      ((!currentFilters.start || rowDate >= currentFilters.start) &&
       (!currentFilters.end || rowDate <= currentFilters.end));
    // Category filter — ถ้า row ไม่มี field "category" อย่า filter ออก
    const categoryOk = ignoreCategory ||
      !currentFilters.category ||
      !Object.prototype.hasOwnProperty.call(row, "category") ||
      row.category === currentFilters.category;
    return dateOk && categoryOk;
  });
}

// รวม heatmap daily (event_date × weekday × hour) ให้กลับเป็น (weekday × hour)
// หลังจาก filter ตาม date range แล้ว
function aggregateHeatmap(heatmapDaily) {
  const grouped = {};
  safeArray(heatmapDaily).forEach((row) => {
    const wd = row.weekday;
    const hr = row.hour;
    if (wd === undefined || hr === undefined) return;
    const key = `${wd}-${hr}`;
    if (!grouped[key]) grouped[key] = { weekday: wd, hour: hr, revenue: 0, orders: 0 };
    grouped[key].revenue += Number(row.revenue || 0);
    grouped[key].orders += Number(row.orders || 0);
  });
  return Object.values(grouped);
}

// รวม categories daily (event_date × category) ให้กลับเป็น (category)
// หลังจาก filter ตาม date range แล้ว
function aggregateCategories(categoriesDaily) {
  const grouped = {};
  safeArray(categoriesDaily).forEach((row) => {
    const cat = row.category;
    if (!cat) return;
    if (!grouped[cat]) grouped[cat] = { category: cat, revenue: 0, orders: 0, buyers: 0 };
    grouped[cat].revenue += Number(row.revenue || 0);
    grouped[cat].orders += Number(row.orders || 0);
    grouped[cat].buyers += Number(row.buyers || 0);
  });
  return Object.values(grouped).sort((a, b) => b.revenue - a.revenue);
}

// คำนวณ KPI ของเดือนล่าสุด vs เดือนก่อนหน้า จากข้อมูลที่ filter แล้ว
// คืน { current_month, previous_month, revenue_pct, orders_pct, buyers_pct, aov_pct,
//       current: {...}, previous: {...} }
// ถ้าไม่มีเดือนก่อนให้เทียบ → คืน null
function computeMonthDeltas(dailyRevenue) {
  const monthly = {};
  safeArray(dailyRevenue).forEach((row) => {
    const month = String(row.event_date || "").slice(0, 7); // YYYY-MM
    if (!month || month.length !== 7) return;
    if (!monthly[month]) monthly[month] = { month, revenue: 0, orders: 0, buyers: 0, days: 0 };
    monthly[month].revenue += Number(row.revenue || 0);
    monthly[month].orders += Number(row.orders || 0);
    monthly[month].buyers += Number(row.dau || row.buyers || 0);
    monthly[month].days += 1;
  });
  const months = Object.keys(monthly).sort();
  if (months.length < 2) return null;
  const last = months[months.length - 1];
  const prev = months[months.length - 2];
  const cur = monthly[last];
  const prv = monthly[prev];
  const aovCur = cur.orders ? cur.revenue / cur.orders : 0;
  const aovPrv = prv.orders ? prv.revenue / prv.orders : 0;
  const safePct = (a, b) => (b ? ((a - b) / b) * 100 : null);
  return {
    current_month: last,
    previous_month: prev,
    current: cur,
    previous: prv,
    revenue_pct: safePct(cur.revenue, prv.revenue),
    orders_pct: safePct(cur.orders, prv.orders),
    buyers_pct: safePct(cur.buyers, prv.buyers),
    aov_pct: safePct(aovCur, aovPrv),
  };
}

function buildViewModel() {
  const data = clone(dashboardData || {});
  data.revenue = data.revenue || {};
  data.products = data.products || {};
  data.customers = data.customers || {};
  data.segments = data.segments || {};
  data.categories = data.categories || {};
  data.time_behavior = data.time_behavior || {};
  data.meta = data.meta || {};
  data.dashboard = data.dashboard || { kpis: {} };
  data.funnel = data.funnel || {};

  const range = data.filters?.date_range || {};
  let dailyRevenue = getFilteredRows(data.revenue.daily || [], { dateKey: "event_date" });
  let customerDaily = getFilteredRows(data.customers.daily_active_users || [], { dateKey: "event_date" });
  const customerMix = getFilteredRows(data.customers.new_vs_returning || [], { dateKey: "event_date" });

  // === Categories: ใช้ categories_daily เพื่อให้ filter date range มีผลกับ Donut ===
  // ถ้ามี categories_daily ใน payload → filter by date แล้ว aggregate by category
  // ถ้าไม่มี → fallback ไปใช้ categories aggregate เดิม (ไม่มี date breakdown)
  const categoriesDailyRaw = safeArray(data.categories.categories_daily);
  let categories;
  if (categoriesDailyRaw.length) {
    const filteredCatDaily = getFilteredRows(categoriesDailyRaw, {
      dateKey: "event_date",
      ignoreCategory: true,
    });
    categories = aggregateCategories(filteredCatDaily);
  } else {
    categories = getFilteredRows(data.categories.categories || [], { ignoreCategory: true, ignoreDate: true });
  }

  const segmentSummary = safeArray(data.segments.segment_summary);
  const churnRisk = safeArray(data.segments.churn_risk);

  // === Heatmap: ใช้ heatmap_daily เพื่อให้ filter date range มีผล ===
  const heatmapDailyRaw = safeArray(data.time_behavior.heatmap_daily);
  let heatmap;
  if (heatmapDailyRaw.length) {
    const filteredHmDaily = getFilteredRows(heatmapDailyRaw, {
      dateKey: "event_date",
      ignoreCategory: true,
    });
    heatmap = aggregateHeatmap(filteredHmDaily);
  } else {
    heatmap = safeArray(data.time_behavior.heatmap);
  }

  const peak = data.time_behavior.peak_window || {};
  let funnel = Object.assign({}, data.funnel || {});

  // ===== Filter-aware KPIs =====
  // Daily data ของ API ไม่มี breakdown ตามหมวดหมู่ — ถ้าผู้ใช้เลือก category
  // ให้ scale ค่ารายวันด้วย share ของหมวดนั้น (proxy ที่ดีที่สุดเท่าที่ data รองรับ)
  const totalCatRevenue = categories.reduce((s, r) => s + Number(r.revenue || 0), 0);
  const selectedCat = currentFilters.category
    ? categories.find((c) => c.category === currentFilters.category)
    : null;
  const categoryShare = selectedCat && totalCatRevenue
    ? selectedCat.revenue / totalCatRevenue
    : 1;

  if (selectedCat && categoryShare !== 1) {
    dailyRevenue = dailyRevenue.map((r) => ({
      ...r,
      revenue: Number(r.revenue || 0) * categoryShare,
      orders: Number(r.orders || 0) * categoryShare,
      dau: Number(r.dau || 0) * categoryShare,
    }));
    customerDaily = customerDaily.map((r) => ({
      ...r,
      dau: Number(r.dau || 0) * categoryShare,
    }));
    heatmap = heatmap.map((r) => ({
      ...r,
      revenue: Number(r.revenue || 0) * categoryShare,
      orders: Number(r.orders || 0) * categoryShare,
    }));
    funnel = {
      ...funnel,
      view: Math.round(Number(funnel.view || 0) * categoryShare),
      cart: Math.round(Number(funnel.cart || 0) * categoryShare),
      purchase: Math.round(Number(funnel.purchase || 0) * categoryShare),
    };
  }

  // คำนวณ KPIs ใหม่จากข้อมูลที่ filter แล้ว (date range หรือ category)
  const isDateFiltered =
    (currentFilters.start && currentFilters.start !== range.start) ||
    (currentFilters.end && currentFilters.end !== range.end);
  const isCategoryFiltered = !!selectedCat;
  const isFiltered = isDateFiltered || isCategoryFiltered;

  const kpis = Object.assign({}, data.dashboard.kpis || {});

  if (isFiltered) {
    const sumRevenue = dailyRevenue.reduce((s, r) => s + Number(r.revenue || 0), 0);
    const sumOrders = dailyRevenue.reduce((s, r) => s + Number(r.orders || 0), 0);
    const avgDau = customerDaily.length
      ? customerDaily.reduce((s, r) => s + Number(r.dau || 0), 0) / customerDaily.length
      : 0;
    kpis.total_revenue = sumRevenue;
    kpis.total_orders = Math.round(sumOrders);
    kpis.average_order_value = sumOrders ? sumRevenue / sumOrders : 0;
    kpis.daily_active_users_avg = avgDau;
    if (selectedCat) {
      // ใช้ unique buyers จาก aggregate ของหมวดนั้นโดยตรง (แม่นกว่าการ scale)
      kpis.total_buyers = selectedCat.buyers;
    }
  }

  // คำนวณ returning_customers_pct จาก segment_summary (ถ้า kpis ไม่มี)
  if (!kpis.returning_customers_pct) {
    const totalSeg = segmentSummary.reduce((s, r) => s + Number(r.customers || 0), 0);
    const nonNewSeg = segmentSummary
      .filter((r) => r.segment !== "New")
      .reduce((s, r) => s + Number(r.customers || 0), 0);
    kpis.returning_customers_pct = totalSeg ? (nonNewSeg / totalSeg) * 100 : 0;
  }

  // สร้าง topByRevenue จาก categories เมื่อไม่มี product-level data
  let topByRevenue = getFilteredRows(data.products.top_by_revenue || []);
  let paretoProducts = getFilteredRows(data.products.pareto?.products || []);
  if (!topByRevenue.length && categories.length) {
    // Apply category filter ที่ระดับ products fallback (categories aggregate ไม่ได้ filter ในขั้น buildViewModel)
    const productSource = currentFilters.category
      ? categories.filter((r) => r.category === currentFilters.category)
      : categories;
    const totalCatRev = productSource.reduce((s, r) => s + Number(r.revenue || 0), 0) || 1;
    let cum = 0;
    const withCum = productSource.map((r) => {
      cum += Number(r.revenue || 0);
      return {
        ...r,
        product_name: titleCase(r.category),
        quantity: r.orders,
        cumulative_share_pct: ((cum / totalCatRev) * 100).toFixed(1),
      };
    });
    topByRevenue = withCum;
    paretoProducts = withCum;
  }

  // คำนวณ % เทียบเดือนก่อนจาก filtered dailyRevenue (ของจริง ไม่ใช่ค่า hard-code)
  const monthDeltas = computeMonthDeltas(dailyRevenue);

  return {
    meta: data.meta,
    capabilities: data.meta.capabilities || {},
    kpis,
    dailyRevenue,
    customerDaily,
    customerMix,
    categories,
    selectedCategory: currentFilters.category || null,
    isFiltered,
    topByRevenue,
    topByQuantity: [],
    paretoProducts,
    segmentSummary,
    churnRisk,
    heatmap,
    peak,
    insights: safeArray(data.insights),
    funnel,
    monthDeltas,
  };
}

// แสดง KPI sub: "▲ x.x% vs เดือนก่อน" หรือซ่อนถ้าไม่มีเดือนก่อน
function setKpiDelta(elId, deltaPct, prevMonthLabel, options = {}) {
  const el = document.getElementById(elId);
  if (!el) return;
  const inversed = options.inversed === true; // ลด = ดี (เช่น recency)
  if (deltaPct === null || deltaPct === undefined || Number.isNaN(deltaPct)) {
    el.style.display = "none";
    el.textContent = "";
    return;
  }
  const isUp = deltaPct >= 0;
  const isPositive = inversed ? !isUp : isUp;
  const arrow = isUp ? "▲" : "▼";
  const cls = isPositive ? "up" : "down";
  el.className = `kpi-sub ${cls}`;
  const prevLabel = prevMonthLabel ? `เดือน ${prevMonthLabel}` : "เดือนก่อน";
  el.textContent = `${arrow} ${pct(Math.abs(deltaPct))} vs ${prevLabel}`;
  el.style.display = "";
}

function renderDashboard() {
  const vm = buildViewModel();
  updateCopy(vm);
  renderHeader(vm);
  renderOverview(vm);
  renderProducts(vm);
  renderCustomers(vm);
  renderSignals(vm);
  renderAISeed(vm);
  renderFilterStatus(vm);
}

function renderFilterStatus(vm) {
  const el = document.getElementById("filter-status");
  if (!el) return;
  const parts = [];
  if (vm.selectedCategory) parts.push(`หมวด: ${titleCase(vm.selectedCategory)}`);
  if (currentFilters.start || currentFilters.end) {
    parts.push(`${dateLabel(currentFilters.start)} → ${dateLabel(currentFilters.end)}`);
  }
  if (parts.length && vm.isFiltered) {
    el.textContent = `● กรองอยู่: ${parts.join(" · ")}`;
    el.style.display = "inline-flex";
  } else {
    el.style.display = "none";
  }
}

function updateCopy(vm) {
  const headerLabels = document.querySelectorAll(".hstat-label");
  if (headerLabels.length >= 5) {
    // Scorecard label สะท้อนว่าเป็นค่ารวม "ในช่วง" (filter-aware) แทน "ล่าสุด"
    headerLabels[0].textContent = vm.isFiltered ? "GMV ในช่วง" : "GMV รวม";
    headerLabels[1].textContent = vm.isFiltered ? "ออเดอร์ในช่วง" : "ออเดอร์รวม";
    headerLabels[2].textContent = "ผู้ซื้อเฉลี่ย/วัน";
    headerLabels[3].textContent = vm.capabilities.traffic_events_available ? "Conversion" : "ลูกค้ากลับมาซื้อ";
    headerLabels[4].textContent = "API Status";
  }

  const funnelPanelTitles = document.querySelectorAll("#tab-funnel .panel-title");
  const funnelPanelSubs = document.querySelectorAll("#tab-funnel .panel-sub");
  if (funnelPanelTitles[0]) funnelPanelTitles[0].textContent = "สัญญาณการซื้อจาก API";
  if (funnelPanelSubs[0]) funnelPanelSubs[0].textContent = "ยอดผู้ซื้อ ออเดอร์ รายได้ และช่วงเวลาซื้อสูงสุด";
  if (funnelPanelTitles[1]) funnelPanelTitles[1].textContent = "ข้อมูลที่ยังไม่มีจาก API";
  if (funnelPanelSubs[1]) funnelPanelSubs[1].textContent = "ยอดดูสินค้าและหมวดที่ดูเยอะแต่ไม่ซื้อ";
  if (funnelPanelTitles[2]) funnelPanelTitles[2].textContent = "แนวโน้มผู้ซื้อรายวัน";
  if (funnelPanelSubs[2]) funnelPanelSubs[2].textContent = "Daily active buyers ตามข้อมูลคำสั่งซื้อ";
}

// Scorecard ที่แถบบน: ใช้ค่ารวมของช่วงที่ filter (vm.kpis ปรับให้แล้วใน buildViewModel)
// เปอร์เซ็นต์เปรียบเทียบใช้จาก monthDeltas (เดือนล่าสุด vs เดือนก่อน — จากข้อมูลที่กรอง)
function renderHeader(vm) {
  const md = vm.monthDeltas;

  // === ค่ารวมของช่วง (อยู่กับ date filter / category filter) ===
  document.getElementById("h-gmv").textContent = compactMoney(vm.kpis.total_revenue || 0);
  document.getElementById("h-orders").textContent = number(vm.kpis.total_orders || 0);
  document.getElementById("h-visitors").textContent = number(Math.round(vm.kpis.daily_active_users_avg || 0));
  document.getElementById("h-cvr").textContent = vm.capabilities.traffic_events_available
    ? pct(vm.kpis.conversion_rate_pct)
    : pct(vm.kpis.returning_customers_pct);

  // === Delta vs เดือนก่อน — มี md ก็แสดงจริง, ไม่มีก็แสดง "—" ===
  setHeaderDelta("h-gmv-ch", md ? md.revenue_pct : null, md ? md.previous_month : null);
  setHeaderDelta("h-orders-ch", md ? md.orders_pct : null, md ? md.previous_month : null);
  setHeaderDelta("h-vis-ch", md ? md.buyers_pct : null, md ? md.previous_month : null);

  // h-cvr-ch ไม่มี monthly breakdown ตรง ๆ → แสดง info text
  const cvrCh = document.getElementById("h-cvr-ch");
  if (cvrCh) {
    cvrCh.textContent = vm.capabilities.traffic_events_available
      ? "พร้อม traffic data"
      : "ไม่มี product-view data";
    cvrCh.className = "hstat-change";
    cvrCh.style.color = "var(--text3)";
  }

  document.getElementById("h-api-status").textContent = "TH / Auto refresh 10m";
  document.getElementById("h-latency").textContent = `อัปเดตล่าสุด ${fullDateTime(vm.meta.generated_at)}`;
}

// Helper: เซ็ต delta ของ scorecard (อยู่ใต้ตัวเลขใหญ่)
function setHeaderDelta(elId, deltaPct, prevMonth) {
  const el = document.getElementById(elId);
  if (!el) return;
  if (deltaPct === null || deltaPct === undefined || Number.isNaN(deltaPct)) {
    el.textContent = "— ไม่มีเดือนก่อนเทียบ";
    el.className = "hstat-change";
    el.style.color = "var(--text3)";
    return;
  }
  const isUp = deltaPct >= 0;
  const arrow = isUp ? "▲" : "▼";
  el.textContent = `${arrow} ${pct(Math.abs(deltaPct))} vs ${prevMonth || "เดือนก่อน"}`;
  el.className = `hstat-change ${isUp ? "up" : "down"}`;
  el.style.color = "";
}

function renderOverview(vm) {
  // ลำดับความสำคัญของจำนวนลูกค้า: total_buyers จาก filter > segment summary > DAU avg
  const uniqueCustomers = vm.kpis.total_buyers
    || vm.segmentSummary.reduce((sum, row) => sum + Number(row.customers || 0), 0);
  document.getElementById("kpi-gmv").textContent = compactMoney(vm.kpis.total_revenue);
  document.getElementById("kpi-orders").textContent = number(vm.kpis.total_orders);
  document.getElementById("kpi-cust").textContent = uniqueCustomers ? number(uniqueCustomers) : number(vm.kpis.daily_active_users_avg);
  document.getElementById("kpi-aov").textContent = money(vm.kpis.average_order_value);
  document.getElementById("kpi-cvr").textContent = vm.capabilities.traffic_events_available ? pct(vm.kpis.conversion_rate_pct) : "N/A";

  // === % vs เดือนก่อน — คำนวณจริงจากข้อมูลที่ filter แล้ว ===
  // ถ้ามีเดือนก่อนในช่วงที่เลือก → แสดง delta จริง, ถ้าไม่มี → ซ่อน sub-text
  const md = vm.monthDeltas;
  if (md) {
    setKpiDelta("kpi-gmv-sub", md.revenue_pct, md.previous_month);
    setKpiDelta("kpi-orders-sub", md.orders_pct, md.previous_month);
    setKpiDelta("kpi-cust-sub", md.buyers_pct, md.previous_month);
    setKpiDelta("kpi-aov-sub", md.aov_pct, md.previous_month);
    // CVR ไม่มี monthly breakdown ตรงๆ → ซ่อนไว้ (กัน hard-code)
    setKpiDelta("kpi-cvr-sub", null, null);
  } else {
    // ไม่มีเดือนก่อนใน filter → ซ่อน sub ทุกตัว
    setKpiDelta("kpi-gmv-sub", null, null);
    setKpiDelta("kpi-orders-sub", null, null);
    setKpiDelta("kpi-cust-sub", null, null);
    setKpiDelta("kpi-aov-sub", null, null);
    setKpiDelta("kpi-cvr-sub", null, null);
  }

  renderRevenueChart(vm.dailyRevenue);
  renderMiniDayBars(vm.dailyRevenue);
  renderDonut(vm.categories, vm.kpis.total_revenue, vm.selectedCategory);
  renderHeatmap(vm.heatmap);
  renderInsights(vm);
}

function destroyChart(chart) {
  if (chart) chart.destroy();
}

function renderRevenueChart(rows) {
  const ctx = document.getElementById("revChart");
  if (!ctx) return;
  destroyChart(revChartInst);
  const labels = rows.map((row) => dateLabel(row.event_date));
  const values = rows.map((row) => Number(row.revenue || 0));
  const ma7 = values.map((_, index, source) => {
    const start = Math.max(0, index - 6);
    const slice = source.slice(start, index + 1);
    return slice.length ? Math.round(slice.reduce((sum, value) => sum + value, 0) / slice.length) : 0;
  });
  revChartInst = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        { label: "Revenue", data: values, borderColor: "#ff6b35", backgroundColor: "rgba(255,107,53,0.10)", fill: true, tension: 0.35, pointRadius: 2, borderWidth: 2 },
        { label: "MA7", data: ma7, borderColor: "#00d4aa", borderDash: [5, 4], fill: false, tension: 0.35, pointRadius: 0, borderWidth: 1.5 },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#5a6075", maxTicksLimit: 8 }, grid: { color: "rgba(255,255,255,.04)" } },
        y: { ticks: { color: "#5a6075", callback: (v) => `THB ${(v / 1000).toFixed(0)}K` }, grid: { color: "rgba(255,255,255,.04)" } },
      },
    },
  });
  // อัปเดต date range labels ใต้กราฟ
  const chartDateLabels = document.querySelectorAll(".rev-chart-date-label");
  if (chartDateLabels.length >= 2 && rows.length) {
    chartDateLabels[0].textContent = dateLabel(rows[0].event_date);
    chartDateLabels[1].textContent = dateLabel(rows[rows.length - 1].event_date);
  }
}

function renderMiniDayBars(rows) {
  const container = document.getElementById("dayBars");
  const max = Math.max(...rows.map((row) => Number(row.revenue || 0)), 1);
  container.innerHTML = rows
    .map((row) => {
      const value = Number(row.revenue || 0);
      const height = Math.round((value / max) * 54) + 6;
      const alpha = (0.3 + 0.7 * (value / max)).toFixed(2);
      return `<div class="mini-bar" style="height:${height}px;background:rgba(255,107,53,${alpha})"><div class="mini-bar-tip">${dateLabel(row.event_date)}: ${compactMoney(value)}</div></div>`;
    })
    .join("");
}

function renderDonut(categories, totalRevenue, selectedCategory) {
  const svg = document.getElementById("donut-slices");
  const legend = document.getElementById("donut-legend");
  const total = categories.reduce((sum, row) => sum + Number(row.revenue || 0), 0) || 1;
  let start = -Math.PI / 2;
  let paths = "";
  let items = "";

  categories.forEach((category, index) => {
    const pctValue = (Number(category.revenue || 0) / total) * 100;
    const angle = (pctValue / 100) * 2 * Math.PI;
    const end = start + angle;
    const cx = 60;
    const cy = 60;
    const r = 48;
    const inner = 30;
    const x1 = cx + r * Math.cos(start);
    const y1 = cy + r * Math.sin(start);
    const x2 = cx + r * Math.cos(end);
    const y2 = cy + r * Math.sin(end);
    const ix1 = cx + inner * Math.cos(start);
    const iy1 = cy + inner * Math.sin(start);
    const ix2 = cx + inner * Math.cos(end);
    const iy2 = cy + inner * Math.sin(end);
    const large = angle > Math.PI ? 1 : 0;
    const color = COLORS[index % COLORS.length];
    // ถ้ามี selectedCategory ให้ highlight slice นั้น (slice อื่น opacity ต่ำลง)
    const isSelected = selectedCategory && category.category === selectedCategory;
    const isDimmed = selectedCategory && !isSelected;
    const opacity = isDimmed ? 0.2 : 0.92;
    const stroke = isSelected ? `stroke="#fff" stroke-width="1.5"` : "";
    paths += `<path d="M${ix1},${iy1}L${x1},${y1}A${r},${r},0,${large},1,${x2},${y2}L${ix2},${iy2}A${inner},${inner},0,${large},0,${ix1},${iy1}Z" fill="${color}" opacity="${opacity}" ${stroke}></path>`;
    const labelClass = isDimmed ? 'style="opacity:.45"' : (isSelected ? 'style="font-weight:700"' : "");
    items += `<div class="donut-item" ${labelClass}><div class="donut-dot" style="background:${color}"></div><span class="donut-name">${titleCase(category.category)}</span><span class="donut-val">${pct(pctValue)}</span></div>`;
    start = end;
  });

  svg.innerHTML = paths;
  legend.innerHTML = items || '<div class="insight-body">ยังไม่มีข้อมูลหมวดสินค้า</div>';

  // Donut center: ถ้าเลือกหมวด ให้โชว์รายได้ของหมวดนั้น + ชื่อหมวด ไม่งั้นโชว์ total ของทุก slice
  const donutTexts = document.querySelectorAll("#donut-svg text");
  const selectedCatRow = selectedCategory ? categories.find((c) => c.category === selectedCategory) : null;
  const centerValue = selectedCatRow ? selectedCatRow.revenue : total;
  const centerLabel = selectedCatRow ? titleCase(selectedCatRow.category) : "GMV รวม";
  if (donutTexts[0]) donutTexts[0].textContent = compactMoney(centerValue);
  if (donutTexts[1]) donutTexts[1].textContent = centerLabel;
}

function renderHeatmap(rows) {
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const thaiDays = ["จ", "อ", "พ", "พฤ", "ศ", "ส", "อา"];
  const grid = {};
  let maxOrders = 1;
  rows.forEach((row) => {
    const key = `${row.weekday}-${row.hour}`;
    grid[key] = Number(row.orders || 0);
    if (grid[key] > maxOrders) maxOrders = grid[key];
  });
  document.getElementById("hm-col-labels").innerHTML = thaiDays.map((day) => `<div class="heatmap-col-label">${day}</div>`).join("");
  document.getElementById("heatmap-grid").innerHTML = Array.from({ length: 24 }, (_, hour) => {
    const cells = dayNames
      .map((_, weekday) => {
        const value = grid[`${weekday}-${hour}`] || 0;
        const alpha = (value / maxOrders).toFixed(2);
        return `<div class="heatmap-cell" style="background:rgba(255,107,53,${Math.max(0.08, alpha)})" title="${hour}:00 ${thaiDays[weekday]} • ${number(value)} orders"></div>`;
      })
      .join("");
    return `<div class="heatmap-row"><div class="heatmap-label">${hour % 3 === 0 ? hour : ""}</div>${cells}</div>`;
  }).join("");
}

function renderInsights(vm) {
  const container = document.querySelector("#tab-overview .panel-body");
  const cards = [...vm.insights];
  if (!vm.capabilities.traffic_events_available) {
    cards.push({
      title: "ยังไม่มีข้อมูลยอดดูสินค้า",
      detail: "Kaggle dataset นี้มีข้อมูล view, cart, purchase ครบ สามารถวิเคราะห์ funnel ได้เต็ม",
      action: "ถ้าต้องการยอดดูจริง ต้องเพิ่ม traffic หรือ marketplace analytics source อีกชุด",
    });
  }
  container.innerHTML = cards
    .slice(0, 4)
    .map(
      (item, index) => `<div class="insight ${index === 1 ? "teal" : index === 2 ? "red" : index === 3 ? "blue" : ""}">
        <div class="insight-title">${item.title}</div>
        <div class="insight-body">${item.detail}<br><br>${item.action}</div>
      </div>`
    )
    .join("");
}

function renderProducts(vm) {
  const rows = vm.topByRevenue.length ? vm.topByRevenue : vm.paretoProducts;
  const barContainer = document.getElementById("top-products-bars");
  const tableBody = document.getElementById("products-tbl-body");

  if (!rows.length) {
    barContainer.innerHTML = '<div class="insight-body">ยังไม่มีข้อมูลสินค้าขายดีในไฟล์นี้</div>';
    tableBody.innerHTML = '<tr><td colspan="6">ยังไม่มีข้อมูลสินค้า</td></tr>';
    destroyChart(paretoChartInst);
    return;
  }

  const maxRevenue = Math.max(...rows.map((row) => Number(row.revenue || 0)), 1);
  barContainer.innerHTML = rows.slice(0, 7).map((row, index) => {
    const width = Math.round((Number(row.revenue || 0) / maxRevenue) * 100);
    return `<div class="seg-row">
      <div class="seg-label" style="max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${productLabel(row)}">${productLabel(row)}</div>
      <div class="seg-bar-bg"><div class="seg-bar-fill" style="width:${width}%;background:${COLORS[index % COLORS.length]}"></div></div>
      <div class="seg-val">${compactMoney(row.revenue)}</div>
    </div>`;
  }).join("");

  tableBody.innerHTML = rows.slice(0, 10).map((row, index) => {
    const cum = Number(row.cumulative_share_pct || 0);
    const tagClass = cum <= 30 ? "tag-green" : cum <= 80 ? "tag-blue" : "tag-yellow";
    const tagLabel = cum <= 30 ? "Hero SKU" : cum <= 80 ? "Core" : "Long Tail";
    return `<tr>
      <td style="color:var(--text3);font-family:var(--mono)">${index + 1}</td>
      <td style="font-size:11px">${productLabel(row)}</td>
      <td><span class="tag tag-blue">${titleCase(row.category)}</span></td>
      <td class="tbl-num">${money(row.revenue)}</td>
      <td class="tbl-num">${number(row.quantity)}</td>
      <td><span class="tag ${tagClass}">${tagLabel}</span></td>
    </tr>`;
  }).join("");

  const ctx = document.getElementById("paretoChart");
  destroyChart(paretoChartInst);
  paretoChartInst = new Chart(ctx, {
    data: {
      labels: rows.slice(0, 10).map((row) => {
        const label = productLabel(row);
        return label.length > 18 ? `${label.slice(0, 18)}...` : label;
      }),
      datasets: [
        {
          type: "bar",
          label: "Revenue",
          data: rows.slice(0, 10).map((row) => Number(row.revenue || 0)),
          backgroundColor: "rgba(255,107,53,.7)",
          borderColor: "#ff6b35",
          yAxisID: "y",
        },
        {
          type: "line",
          label: "Cumulative %",
          data: rows.slice(0, 10).map((row) => Number(row.cumulative_share_pct || 0)),
          borderColor: "#00d4aa",
          backgroundColor: "#00d4aa",
          pointRadius: 3,
          tension: 0.25,
          yAxisID: "y2",
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#5a6075" }, grid: { color: "rgba(255,255,255,.04)" } },
        y: { ticks: { color: "#5a6075", callback: (v) => `THB ${(v / 1000).toFixed(0)}K` }, grid: { color: "rgba(255,255,255,.04)" } },
        y2: { position: "right", min: 0, max: 100, ticks: { color: "#5a6075", callback: (v) => `${v}%` }, grid: { display: false } },
      },
    },
  });
}

function renderCustomers(vm) {
  const cards = document.querySelectorAll("#tab-customers .kpi");
  const totalSegments = vm.segmentSummary.reduce((sum, row) => sum + Number(row.customers || 0), 0);
  const vipLoyal = vm.segmentSummary
    .filter((r) => r.segment === "VIP" || r.segment === "Loyal")
    .reduce((sum, row) => sum + Number(row.customers || 0), 0);
  const atRisk = vm.segmentSummary
    .filter((r) => r.segment === "At Risk")
    .reduce((sum, row) => sum + Number(row.customers || 0), 0);
  const latestChurn = vm.churnRisk.length;
  const returningRate = totalSegments ? (vipLoyal / totalSegments) * 100 : (vm.kpis.returning_customers_pct || 0);
  const topSegment = vm.segmentSummary[0] || {};
  const churnRate = totalSegments ? (atRisk / totalSegments) * 100 : 0;
  // ใช้ข้อมูลจาก segment_summary แทน new_vs_returning ที่ไม่มีใน dataset
  const values = [
    [number(vipLoyal), `VIP + Loyal จาก ${number(totalSegments)} ราย`],
    [number(atRisk), `กลุ่มเสี่ยงหาย (At Risk)`],
    [pct(returningRate), topSegment.segment ? `กลุ่มเด่น: ${topSegment.segment}` : "ยังไม่มี segment"],
    [number(latestChurn), `${pct(churnRate)} ของทั้งหมด`],
  ];
  cards.forEach((card, index) => {
    const valueEl = card.querySelector(".kpi-val");
    const subEl = card.querySelector(".kpi-sub");
    if (valueEl) valueEl.textContent = values[index]?.[0] || "-";
    if (subEl) subEl.textContent = values[index]?.[1] || "-";
  });

  const maxCount = Math.max(...vm.segmentSummary.map((row) => Number(row.customers || 0)), 1);
  document.getElementById("rfm-bars").innerHTML = vm.segmentSummary.length
    ? vm.segmentSummary
        .map((row, index) => `<div class="seg-row">
          <div class="seg-label">${row.segment}</div>
          <div class="seg-bar-bg"><div class="seg-bar-fill" style="width:${Math.round((Number(row.customers || 0) / maxCount) * 100)}%;background:${COLORS[index % COLORS.length]}"></div></div>
          <div class="seg-val">${number(row.customers)} ราย</div>
        </div>`)
        .join("")
    : '<div class="insight-body">ยังไม่มีข้อมูล segment</div>';

  document.getElementById("churn-tbl-body").innerHTML = vm.churnRisk.length
    ? vm.churnRisk.map((row) => `<tr>
        <td style="font-family:var(--mono);font-size:11px">${row.user_id}</td>
        <td><span class="tag ${Number(row.recency || 0) >= 30 ? "tag-red" : "tag-yellow"}">${number(row.recency)} วัน</span></td>
        <td class="tbl-num">${number(row.frequency || 0)}</td>
        <td class="tbl-num">${money(row.monetary || 0)}</td>
        <td><span class="tag tag-orange">${row.segment || "At Risk"}</span></td>
      </tr>`)
        .join("")
    : '<tr><td colspan="5">ยังไม่มีข้อมูลลูกค้าเสี่ยงหาย</td></tr>';
}

function renderSignals(vm) {
  const funnel = vm.funnel || {};
  const topCategory = vm.categories[0];

  if (funnel.available && Number(funnel.view || 0) > 0) {
    // แสดง Funnel จริง: View → Cart → Purchase
    const funnelSteps = [
      {
        label: "ดูสินค้า (View)",
        value: funnel.view,
        color: "#4f8ef7",
        widthPct: 100,
        dropLabel: null,
      },
      {
        label: "หยิบใส่ตะกร้า (Cart)",
        value: funnel.cart,
        color: "#ffd23f",
        widthPct: Math.round((funnel.cart / funnel.view) * 100),
        dropLabel: `Drop-off ${pct(funnel.drop_off_view_to_cart_pct)} จาก View`,
      },
      {
        label: "สั่งซื้อสำเร็จ (Purchase)",
        value: funnel.purchase,
        color: "#22c55e",
        widthPct: Math.max(1, Math.round((funnel.purchase / funnel.view) * 100)),
        dropLabel: `Drop-off ${pct(funnel.drop_off_cart_to_purchase_pct)} จาก Cart`,
      },
    ];

    document.getElementById("funnel-steps").innerHTML = funnelSteps
      .map((step) => {
        const textColor = step.color === "#ffd23f" ? "#000" : "#fff";
        return `
        ${step.dropLabel ? `<div class="funnel-drop" style="padding-left:0;color:var(--red);font-size:11px;margin:-2px 0 2px">▼ ${step.dropLabel}</div>` : ""}
        <div class="funnel-step">
          <div class="funnel-bar-wrap">
            <div class="funnel-label">${step.label}</div>
            <div class="funnel-bar-bg">
              <div class="funnel-bar-fill" style="width:${step.widthPct}%;background:${step.color};color:${textColor};min-width:60px">
                ${number(step.value)}
              </div>
            </div>
            <div class="funnel-pct">${step.widthPct}%</div>
          </div>
        </div>`;
      })
      .join("");

    document.getElementById("dropoff-insights").innerHTML = `
      <div class="insight red">
        <div class="insight-title">View → Cart Drop-off: ${pct(funnel.drop_off_view_to_cart_pct)}</div>
        <div class="insight-body">จาก ${number(funnel.view)} views มีเพียง <strong>${pct(funnel.view_to_cart_pct)}</strong> ที่หยิบสินค้าใส่ตะกร้า ควรปรับ product page และ CTA ให้ดึงดูดมากขึ้น</div>
      </div>
      <div class="insight yellow">
        <div class="insight-title">Cart → Purchase Drop-off: ${pct(funnel.drop_off_cart_to_purchase_pct)}</div>
        <div class="insight-body">จาก ${number(funnel.cart)} ตะกร้า มี <strong>${pct(funnel.cart_to_purchase_pct)}</strong> ที่สั่งซื้อจริง — ควรตรวจสอบ checkout flow และลด friction</div>
      </div>
      <div class="insight teal">
        <div class="insight-title">Overall Conversion Rate: ${pct((funnel.purchase / funnel.view) * 100)}</div>
        <div class="insight-body">จาก ${number(funnel.view)} views มียอดซื้อ ${number(funnel.purchase)} ครั้ง — หมวดขายดีสุดคือ <strong>${topCategory ? titleCase(topCategory.category) : "-"}</strong></div>
      </div>
    `;
  } else {
    // Fallback เมื่อไม่มีข้อมูล funnel
    const daily = vm.dailyRevenue;
    const avgRevenue = daily.length ? daily.reduce((s, r) => s + Number(r.revenue || 0), 0) / daily.length : 0;
    const avgOrders = daily.length ? daily.reduce((s, r) => s + Number(r.orders || 0), 0) / daily.length : 0;
    const avgBuyers = vm.customerDaily.length ? vm.customerDaily.reduce((s, r) => s + Number(r.dau || 0), 0) / vm.customerDaily.length : 0;
    const peakHour = vm.peak?.hour;
    const signals = [
      { label: "Avg buyers/day", value: avgBuyers, color: "#4f8ef7" },
      { label: "Avg orders/day", value: avgOrders, color: "#00d4aa" },
      { label: "Avg revenue/day", value: avgRevenue, color: "#ff6b35", formatter: compactMoney },
      { label: peakHour !== undefined ? `Peak hour ${peakHour}:00` : "Top category", value: peakHour !== undefined ? vm.peak.orders || 0 : topCategory?.orders || 0, color: "#ffd23f" },
    ];
    const maxValue = Math.max(...signals.map((item) => Number(item.value || 0)), 1);
    document.getElementById("funnel-steps").innerHTML = signals.map((item) => {
      const pctValue = Math.round((Number(item.value || 0) / maxValue) * 100);
      const shown = item.formatter ? item.formatter(item.value) : number(item.value);
      return `<div class="funnel-step"><div class="funnel-bar-wrap"><div class="funnel-label">${item.label}</div><div class="funnel-bar-bg"><div class="funnel-bar-fill" style="width:${pctValue}%;background:${item.color};color:#000">${shown}</div></div><div class="funnel-pct">${pctValue}%</div></div></div>`;
    }).join("");
    document.getElementById("dropoff-insights").innerHTML = `
      <div class="insight red"><div class="insight-title">ยอดดูสินค้า</div><div class="insight-body">ยังไม่มีข้อมูล view events</div></div>
      <div class="insight teal"><div class="insight-title">ตอนนี้วัดอะไรได้</div><div class="insight-body">หมวดขายดีสุดคือ ${topCategory ? titleCase(topCategory.category) : "-"}</div></div>
    `;
  }

  const ctx = document.getElementById("cvrChart");
  destroyChart(buyerChartInst);
  buyerChartInst = new Chart(ctx, {
    type: "line",
    data: {
      labels: vm.customerDaily.map((row) => dateLabel(row.event_date)),
      datasets: [{ label: "Buyers", data: vm.customerDaily.map((row) => Number(row.dau || 0)), borderColor: "#9b6fff", backgroundColor: "rgba(155,111,255,.08)", fill: true, tension: 0.35, pointRadius: 2, borderWidth: 2 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { ticks: { color: "#5a6075", maxTicksLimit: 8 }, grid: { color: "rgba(255,255,255,.04)" } },
        y: { ticks: { color: "#5a6075" }, grid: { color: "rgba(255,255,255,.04)" } },
      },
    },
  });
}

function renderAISeed(vm) {
  const msgs = document.getElementById("ai-messages");
  if (!msgs || msgs.dataset.enhanced === "true") return;
  msgs.dataset.enhanced = "true";
  const topCategory = vm.categories[0] ? titleCase(vm.categories[0].category) : "-";
  const topProduct = vm.topByRevenue[0] ? productLabel(vm.topByRevenue[0]) : "-";
  const hasKey = !!getApiKey();
  const intro = hasKey
    ? `<strong style="color:var(--green)">เชื่อมต่อ Gemini เรียบร้อย ✓</strong> ลองถามอะไรก็ได้เกี่ยวกับข้อมูลครับ — ผมจะวิเคราะห์จาก KPI, หมวดสินค้า, RFM segment, funnel ให้`
    : `กรุณากรอก <strong>Gemini API Key</strong> ที่ช่องด้านบนก่อนเริ่มต้นใช้งาน 🔑`;
  msgs.innerHTML = `<div class="ai-msg">
    <div class="ai-avatar bot">✦</div>
    <div class="ai-bubble">สวัสดีครับ! ผมคือ <strong>Gemini AI</strong> ผู้ช่วยวิเคราะห์ข้อมูล E-Commerce 🛒<br><br>
    สรุปจากข้อมูลล่าสุด: หมวดขายดีสุด <strong>${topCategory}</strong>, สินค้าทำรายได้สูง <strong>${topProduct}</strong><br><br>
    ${intro}</div>
  </div>`;
}

window.switchTab = function switchTab(id, btn) {
  document.querySelectorAll(".tab-content").forEach((tab) => tab.classList.remove("active"));
  document.querySelectorAll(".nav-tab").forEach((tab) => tab.classList.remove("active"));
  document.getElementById(`tab-${id}`)?.classList.add("active");
  btn?.classList.add("active");
};

window.scrollToAI = function scrollToAI() {
  const aiButton = document.querySelectorAll(".nav-tab")[4];
  window.switchTab("ai", aiButton);
};

window.periodChanged = function periodChanged() {
  const periodEl = document.getElementById("f-period");
  const val = periodEl.value;
  const dataEnd = dashboardData?.filters?.date_range?.end || "";
  const dataStart = dashboardData?.filters?.date_range?.start || "";
  const startEl = document.getElementById("f-start");
  const endEl = document.getElementById("f-end");

  if (!val) {
    // "ทั้งหมด" — reset วันที่กลับเป็น full range ของ dataset
    startEl.value = dataStart || "";
    endEl.value = dataEnd || "";
  } else if (dataEnd) {
    const endDate = new Date(dataEnd);
    const startDate = new Date(endDate);
    startDate.setDate(startDate.getDate() - parseInt(val, 10) + 1);
    const startStr = startDate.toISOString().split("T")[0];
    // ถ้า startDate ก่อน dataset start ให้ clamp
    const clampedStart = dataStart && startStr < dataStart ? dataStart : startStr;
    startEl.value = clampedStart;
    endEl.value = dataEnd;
  }
  // Auto-apply ทันทีเมื่อเปลี่ยน period (UX ดีกว่าให้ผู้ใช้กด Apply ซ้ำ)
  applyFiltersInternal({ silent: false, fromPeriod: true });
};

// Internal apply ที่ไม่กลับไปเรียก periodChanged (ป้องกัน loop และไม่ทับค่าวันที่)
function applyFiltersInternal(opts = {}) {
  const startEl = document.getElementById("f-start");
  const endEl = document.getElementById("f-end");
  let start = startEl.value || null;
  let end = endEl.value || null;

  // Validate: ถ้า start > end ให้สลับให้
  if (start && end && start > end) {
    [start, end] = [end, start];
    startEl.value = start;
    endEl.value = end;
    showToast("สลับวันที่เริ่ม/สิ้นสุดให้แล้ว (start > end)");
  }

  currentFilters.start = start;
  currentFilters.end = end;
  currentFilters.category = document.getElementById("f-cat").value || "";

  renderDashboard();
  if (!opts.silent) showToast("กรองข้อมูลแล้ว");
}

window.applyFilters = function applyFilters() {
  applyFiltersInternal({ silent: false });
};

// เคลียร์ period dropdown เมื่อผู้ใช้แก้วันที่เอง (กันค่าค้าง)
window.dateInputChanged = function dateInputChanged() {
  const periodEl = document.getElementById("f-period");
  if (periodEl && periodEl.value) periodEl.value = "";
};

window.resetFilters = function resetFilters() {
  const range = dashboardData?.filters?.date_range || {};
  currentFilters = {
    start: range.start || null,
    end: range.end || null,
    category: "",
  };
  // reset period dropdown กลับเป็น "ทั้งหมด"
  const periodEl = document.getElementById("f-period");
  if (periodEl) periodEl.value = "";
  // reset category dropdown
  const catEl = document.getElementById("f-cat");
  if (catEl) catEl.value = "";
  hydrateFilters();
  renderDashboard();
  showToast("ล้างตัวกรองแล้ว");
};

window.refreshData = function refreshData() {
  const params = new URLSearchParams();
  if (currentFilters.start) params.set("start_date", currentFilters.start);
  if (currentFilters.end) params.set("end_date", currentFilters.end);
  const query = params.toString();
  fetch(`${API_URL}/refresh${query ? `?${query}` : ""}`, {
    method: "POST",
  })
    .then(async (response) => {
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.detail || `HTTP ${response.status}`);
      }
      return response.json();
    })
    .then(() => loadDashboardData(true))
    .catch((error) => {
      console.error(error);
      showToast(`รีเฟรช Pipeline ไม่สำเร็จ: ${error.message}`);
    });
};

window.exportData = function exportData() {
  const rows = buildViewModel().dailyRevenue;
  const filterTag = [
    currentFilters.start || "all",
    currentFilters.end || "all",
    currentFilters.category || "all-cat",
  ].join("_");
  const csvRows = [
    ["Date", "Revenue (THB)", "Orders", "Buyers"],
    ...rows.map((row) => [row.event_date, row.revenue, row.orders, row.buyers || ""]),
  ];
  const csv = csvRows.map((row) => row.join(",")).join("\n");
  const a = document.createElement("a");
  a.href = `data:text/csv;charset=utf-8,﻿${encodeURIComponent(csv)}`;
  a.download = `kaggle_ecommerce_revenue_${filterTag}.csv`;
  a.click();
};

window.sendPreset = function sendPreset(text) {
  document.getElementById("ai-input").value = text;
  window.sendAiMessage();
};

window.handleAiKey = function handleAiKey(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    window.sendAiMessage();
  }
  event.target.style.height = "36px";
  event.target.style.height = `${Math.min(event.target.scrollHeight, 100)}px`;
};

// =========================================================================
// Gemini AI integration
// API spec: https://ai.google.dev/api/generate-content
// =========================================================================
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_KEY_STORAGE = "gemini_api_key";
let aiTurns = []; // conversation history: [{ role: "user"|"model", text }]

function getApiKey() {
  try {
    return sessionStorage.getItem(GEMINI_KEY_STORAGE) || "";
  } catch (e) {
    return "";
  }
}

function getModel() {
  const sel = document.getElementById("gemini-model");
  return (sel && sel.value) || "gemini-2.0-flash";
}

function showApiKeySetup(show) {
  const setup = document.getElementById("api-key-setup");
  const selector = document.getElementById("model-selector-row");
  const dot = document.getElementById("gemini-status-dot");
  if (setup) setup.style.display = show ? "flex" : "none";
  if (selector) selector.style.display = show ? "none" : "flex";
  if (dot) {
    if (show) {
      dot.style.background = "#ffd23f";
      dot.style.boxShadow = "0 0 6px #ffd23f";
    } else {
      dot.style.background = "#22c55e";
      dot.style.boxShadow = "0 0 6px #22c55e";
    }
  }
}

window.saveApiKey = function saveApiKey() {
  const inp = document.getElementById("gemini-api-key");
  if (!inp) return;
  const val = (inp.value || "").trim();
  if (!val) {
    showToast("กรุณากรอก API Key ก่อน");
    return;
  }
  try {
    sessionStorage.setItem(GEMINI_KEY_STORAGE, val);
  } catch (e) {
    showToast("เบราว์เซอร์ไม่อนุญาต sessionStorage");
    return;
  }
  showApiKeySetup(false);
  aiTurns = [];
  showToast("บันทึก Gemini API Key แล้ว");
  appendAiMessage("bot", "เชื่อมต่อ Gemini สำเร็จ ✓ พร้อมตอบคำถามจริงแล้วครับ — ลองถามได้เลย");
};

window.clearApiKey = function clearApiKey() {
  try {
    sessionStorage.removeItem(GEMINI_KEY_STORAGE);
  } catch (e) {}
  const inp = document.getElementById("gemini-api-key");
  if (inp) inp.value = "";
  showApiKeySetup(true);
  aiTurns = [];
  showToast("ล้าง API Key แล้ว");
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str == null ? "" : str);
  return div.innerHTML;
}

// Markdown แบบเบา ๆ → HTML (ใช้กับ output ของ Gemini, escape ก่อน)
function formatGeminiText(text) {
  let safe = escapeHtml(text);
  safe = safe.replace(/`([^`]+)`/g, '<code style="background:var(--bg4);padding:1px 5px;border-radius:4px;font-family:var(--mono);font-size:11px">$1</code>');
  safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  safe = safe.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  safe = safe.replace(/\n/g, "<br>");
  safe = safe.replace(/(^|<br>)\s*[-•]\s+([^<]+?)(?=<br>|$)/g, '$1<div style="padding-left:14px;position:relative">▸ $2</div>');
  return safe;
}

function appendAiMessage(role, contentHtml) {
  const msgs = document.getElementById("ai-messages");
  if (!msgs) return;
  if (role === "user") {
    const safe = escapeHtml(contentHtml).replace(/\n/g, "<br>");
    msgs.insertAdjacentHTML("beforeend",
      `<div class="ai-msg user"><div class="ai-avatar user-av">คุณ</div><div class="ai-bubble">${safe}</div></div>`);
  } else {
    msgs.insertAdjacentHTML("beforeend",
      `<div class="ai-msg"><div class="ai-avatar bot">✦</div><div class="ai-bubble">${contentHtml}</div></div>`);
  }
  msgs.scrollTop = msgs.scrollHeight;
}

function appendAiTyping() {
  const msgs = document.getElementById("ai-messages");
  if (!msgs) return null;
  const id = "ai-typing-" + Date.now();
  msgs.insertAdjacentHTML("beforeend",
    `<div class="ai-msg" id="${id}"><div class="ai-avatar bot">✦</div><div class="ai-bubble"><div class="typing"><span></span><span></span><span></span></div></div></div>`);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}

function removeAiTyping(id) {
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.remove();
}

// สร้าง snapshot ของ dashboard ปัจจุบันเพื่อใส่ใน prompt ให้ Gemini
function buildGeminiContext() {
  const vm = buildViewModel();
  const fmt = (n) => Math.round(Number(n || 0)).toLocaleString();
  const fmt2 = (n) => Number(n || 0).toFixed(2);

  const filterLine = vm.isFiltered
    ? "กำลังกรอง: " + (currentFilters.start || "—") + " → " + (currentFilters.end || "—") +
      (currentFilters.category ? " | หมวด: " + currentFilters.category : "")
    : "ไม่มีตัวกรอง (ดูข้อมูลทั้งชุด)";

  const md = vm.monthDeltas;
  const mdLine = md
    ? "เดือน " + md.current_month + " เทียบ " + md.previous_month +
      ": รายได้ " + fmt2(md.revenue_pct) + "%, ออเดอร์ " + fmt2(md.orders_pct) + "%, ผู้ซื้อ " + fmt2(md.buyers_pct) + "%"
    : "ไม่มีเดือนก่อนหน้าให้เปรียบเทียบ";

  const topCats = (vm.categories || []).slice(0, 5)
    .map((c) => c.category + " (รายได้ " + fmt(c.revenue) + " บ., " + fmt(c.orders) + " ออเดอร์)")
    .join(", ") || "—";

  const topProds = (vm.topByRevenue || []).slice(0, 5)
    .map((p) => productLabel(p) + " (" + fmt(p.revenue) + " บ.)").join(", ") || "—";

  const segs = (vm.segmentSummary || [])
    .map((s) => s.segment + ": " + fmt(s.customers) + " ราย, รายได้ " + fmt(s.revenue) + " บ.")
    .join(" | ") || "—";

  const peak = vm.peak || {};
  const peakLine = (peak.hour !== undefined)
    ? "weekday=" + peak.weekday + ", hour=" + peak.hour + ", orders=" + fmt(peak.orders) + ", revenue=" + fmt(peak.revenue) + " บ."
    : "—";

  return [
    "=== Dashboard Snapshot ===",
    filterLine,
    "",
    "[KPI]",
    "- GMV รวม: " + fmt(vm.kpis.total_revenue) + " บาท",
    "- ออเดอร์: " + fmt(vm.kpis.total_orders),
    "- AOV: " + fmt(vm.kpis.average_order_value) + " บาท",
    "- ผู้ซื้อเฉลี่ย/วัน: " + fmt(vm.kpis.daily_active_users_avg),
    "- Conversion (cart→purchase): " + fmt2(vm.kpis.conversion_rate_pct) + "%",
    "- ลูกค้ากลับมาซื้อ: " + fmt2(vm.kpis.returning_customers_pct) + "%",
    "",
    "[Month-over-Month] " + mdLine,
    "",
    "[Top 5 Categories] " + topCats,
    "[Top 5 Products by Revenue] " + topProds,
    "",
    "[Funnel]",
    "- View: " + fmt(vm.funnel.view) + ", Cart: " + fmt(vm.funnel.cart) + ", Purchase: " + fmt(vm.funnel.purchase),
    "- View→Cart " + fmt2(vm.funnel.view_to_cart_pct) + "%, Cart→Purchase " + fmt2(vm.funnel.cart_to_purchase_pct) + "%",
    "",
    "[RFM Segments] " + segs,
    "[Churn Risk] มี " + (vm.churnRisk || []).length + " ราย",
    "[Peak Window] " + peakLine,
  ].join("\n");
}

window.sendAiMessage = async function sendAiMessage() {
  const input = document.getElementById("ai-input");
  const sendBtn = document.getElementById("ai-send-btn");
  const message = (input && input.value || "").trim();
  if (!message) return;

  const apiKey = getApiKey();
  if (!apiKey) {
    showToast("กรุณากรอก Gemini API Key ก่อน 🔑");
    showApiKeySetup(true);
    return;
  }

  appendAiMessage("user", message);
  input.value = "";
  input.style.height = "36px";

  const typingId = appendAiTyping();
  if (sendBtn) sendBtn.disabled = true;

  try {
    const model = getModel();
    const dashboardContext = buildGeminiContext();
    const systemInstruction =
      "คุณคือผู้ช่วย AI วิเคราะห์ข้อมูล E-Commerce ตอบเป็นภาษาไทยกระชับ ใช้ตัวเลขจาก Dashboard Snapshot ที่ให้มาเสมอ " +
      "ให้ insight ที่ actionable (อะไรควรทำต่อ) และใช้ markdown bullet (-) หรือ **bold** ได้ ถ้าข้อมูลไม่พอให้บอกตรง ๆ ว่าต้องเก็บอะไรเพิ่ม";

    const userContent = "[Dashboard ปัจจุบัน]\n" + dashboardContext + "\n\n[คำถาม] " + message;

    const contents = [];
    for (const t of aiTurns) {
      contents.push({ role: t.role, parts: [{ text: t.text }] });
    }
    contents.push({ role: "user", parts: [{ text: userContent }] });

    const url = GEMINI_API_BASE + "/" + encodeURIComponent(model) + ":generateContent?key=" + encodeURIComponent(apiKey);
    const body = {
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents: contents,
      generationConfig: { temperature: 0.6, maxOutputTokens: 1024, topP: 0.9 },
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      let detail = errText;
      try { detail = JSON.parse(errText) && JSON.parse(errText).error && JSON.parse(errText).error.message || errText; } catch (e) {}
      throw new Error("HTTP " + resp.status + ": " + String(detail).slice(0, 300));
    }

    const data = await resp.json();
    const reply = data && data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts && data.candidates[0].content.parts[0] && data.candidates[0].content.parts[0].text;
    if (!reply) {
      const finishReason = (data && data.candidates && data.candidates[0] && data.candidates[0].finishReason) || "unknown";
      throw new Error("Gemini ไม่ส่งคำตอบกลับ (finishReason=" + finishReason + ")");
    }

    aiTurns.push({ role: "user", text: message });
    aiTurns.push({ role: "model", text: reply });
    if (aiTurns.length > 16) aiTurns = aiTurns.slice(-16);

    removeAiTyping(typingId);
    appendAiMessage("bot", formatGeminiText(reply));
  } catch (err) {
    removeAiTyping(typingId);
    appendAiMessage(
      "bot",
      '<span style="color:var(--red)">⚠️ เรียก Gemini ไม่สำเร็จ: ' + escapeHtml(err.message) + "</span>" +
      '<br><span style="font-size:10px;color:var(--text3)">ตรวจสอบ API Key, model, และ network</span>'
    );
    console.error("[Gemini]", err);
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
};

document.addEventListener("DOMContentLoaded", () => {
  loadDashboardData();
  window.setInterval(() => loadDashboardData(false), AUTO_REFRESH_MS);
  if (getApiKey()) {
    showApiKeySetup(false);
  } else {
    showApiKeySetup(true);
  }
});).join("\n");
  const a = document.createElement("a");
  a.href = `data:text/csv;charset=utf-8,\uFEFF${encodeURIComponent(csv)}`;
  a.download = `kaggle_ecommerce_revenue_${filterTag}.csv`;
  a.click();
};

window.sendPreset = function sendPreset(text) {
  document.getElementById("ai-input").value = text;
  window.sendAiMessage();
};

window.handleAiKey = function handleAiKey(event) {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    window.sendAiMessage();
  }
  event.target.style.height = "36px";
  event.target.style.height = `${Math.min(event.target.scrollHeight, 100)}px`;
};

// =========================================================================
// Gemini AI integration
// API spec: https://ai.google.dev/api/generate-content
// =========================================================================
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_KEY_STORAGE = "gemini_api_key";
let aiTurns = []; // conversation history: [{ role: "user"|"model", text }]

function getApiKey() {
  try {
    return sessionStorage.getItem(GEMINI_KEY_STORAGE) || "";
  } catch (e) {
    return "";
  }
}

function getModel() {
  const sel = document.getElementById("gemini-model");
  return (sel && sel.value) || "gemini-2.0-flash";
}

function showApiKeySetup(show) {
  const setup = document.getElementById("api-key-setup");
  const selector = document.getElementById("model-selector-row");
  const dot = document.getElementById("gemini-status-dot");
  if (setup) setup.style.display = show ? "flex" : "none";
  if (selector) selector.style.display = show ? "none" : "flex";
  if (dot) {
    if (show) {
      dot.style.background = "#ffd23f";
      dot.style.boxShadow = "0 0 6px #ffd23f";
    } else {
      dot.style.background = "#22c55e";
      dot.style.boxShadow = "0 0 6px #22c55e";
    }
  }
}

window.saveApiKey = function saveApiKey() {
  const inp = document.getElementById("gemini-api-key");
  if (!inp) return;
  const val = (inp.value || "").trim();
  if (!val) {
    showToast("กรุณากรอก API Key ก่อน");
    return;
  }
  try {
    sessionStorage.setItem(GEMINI_KEY_STORAGE, val);
  } catch (e) {
    showToast("เบราว์เซอร์ไม่อนุญาต sessionStorage");
    return;
  }
  showApiKeySetup(false);
  aiTurns = []; // เริ่มประวัติใหม่เมื่อเปลี่ยน key
  showToast("บันทึก Gemini API Key แล้ว ✓");
  appendAiMessage("bot", "🔑 เชื่อมต่อ Gemini สำเร็จ ตอนนี้พร้อมตอบคำถามจริงแล้วครับ — ลองถามได้เลย");
};

window.clearApiKey = function clearApiKey() {
  try {
    sessionStorage.removeItem(GEMINI_KEY_STORAGE);
  } catch (e) {}
  const inp = document.getElementById("gemini-api-key");
  if (inp) inp.value = "";
  showApiKeySetup(true);
  aiTurns = [];
  showToast("ล้าง API Key แล้ว");
};

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = String(str == null ? "" : str);
  return div.innerHTML;
}

// Markdown แบบเบา ๆ → HTML (ใช้กับ output ของ Gemini เท่านั้น, escape ก่อนแล้ว)
function formatGeminiText(text) {
  let safe = escapeHtml(text);
  // โค้ด `inline`
  safe = safe.replace(/`([^`]+)`/g, '<code style="background:var(--bg4);padding:1px 5px;border-radius:4px;font-family:var(--mono);font-size:11px">$1</code>');
  // **bold**
  safe = safe.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  // *italic* (ทำหลัง bold เพื่อกัน conflict)
  safe = safe.replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
  // bullet "- item" → <li>
  safe = safe.replace(/(^|<br>)\s*[-•]\s+(.+?)(?=<br>|$)/g, '$1<div style="padding-left:14px;position:relative">▸ $2</div>');
  // newlines
  safe = safe.replace(/\n/g, "<br>");
  return safe;
}

function appendAiMessage(role, contentHtml) {
  const msgs = document.getElementById("ai-messages");
  if (!msgs) return;
  if (role === "user") {
    const safe = escapeHtml(contentHtml).replace(/\n/g, "<br>");
    msgs.insertAdjacentHTML("beforeend",
      `<div class="ai-msg user"><div class="ai-avatar user-av">คุณ</div><div class="ai-bubble">${safe}</div></div>`);
  } else {
    msgs.insertAdjacentHTML("beforeend",
      `<div class="ai-msg"><div class="ai-avatar bot">✦</div><div class="ai-bubble">${contentHtml}</div></div>`);
  }
  msgs.scrollTop = msgs.scrollHeight;
}

function appendAiTyping() {
  const msgs = document.getElementById("ai-messages");
  if (!msgs) return null;
  const id = "ai-typing-" + Date.now();
  msgs.insertAdjacentHTML("beforeend",
    `<div class="ai-msg" id="${id}"><div class="ai-avatar bot">✦</div><div class="ai-bubble"><div class="typing"><span></span><span></span><span></span></div></div></div>`);
  msgs.scrollTop = msgs.scrollHeight;
  return id;
}

function removeAiTyping(id) {
  if (!id) return;
  const el = document.getElementById(id);
  if (el) el.remove();
}

// สร้าง snapshot ของ dashboard ปัจจุบันเพื่อใส่ใน prompt ให้ Gemini
function buildGeminiContext() {
  const vm = buildViewModel();
  const fmt = (n) => Math.round(Number(n || 0)).toLocaleString();
  const fmt2 = (n) => Number(n || 0).toFixed(2);

  const filterLine = vm.isFiltered
    ? `กำลังกรอง: ${currentFilters.start || "—"} → ${currentFilters.end || "—"}` +
      (currentFilters.category ? ` | หมวด: ${currentFilters.category}` : "")
    : "ไม่มีตัวกรอง (ดูข้อมูลทั้งชุด)";

  const md = vm.monthDeltas;
  const mdLine = md
    ? `เดือน ${md.current_month} เทียบ ${md.previous_month}: รายได้ ${fmt2(md.revenue_pct)}%, ออเดอร์ ${fmt2(md.orders_pct)}%, ผู้ซื้อ ${fmt2(md.buyers_pct)}%`
    : "ไม่มีเดือนก่อนหน้าให้เปรียบเทียบ";

  const topCats = (vm.categories || []).slice(0, 5)
    .map((c) => `${c.category} (รายได้ ${fmt(c.revenue)} บ., ${fmt(c.orders)} ออเดอร์)`)
    .join(", ") || "—";

  const topProds = (vm.topByRevenue || []).slice(0, 5)
    .map((p) => `${productLabel(p)} (${fmt(p.revenue)} บ.)`).join(", ") || "—";

  const segs = (vm.segmentSummary || [])
    .map((s) => `${s.segment}: ${fmt(s.customers)} ราย, รายได้ ${fmt(s.revenue)} บ.`)
    .join(" | ") || "—";

  const peak = vm.peak || {};
  const peakLine = (peak.hour !== undefined)
    ? `ช่วง peak: weekday=${peak.weekday}, hour=${peak.hour}, orders=${fmt(peak.orders)}, revenue=${fmt(peak.revenue)} บ.`
    : "—";

  return [
    `=== Dashboard Snapshot ===`,
    filterLine,
    ``,
    `[KPI]`,
    `- GMV รวม: ${fmt(vm.kpis.total_revenue)} บาท`,
    `- ออเดอร์: ${fmt(vm.kpis.total_orders)}`,
    `- AOV: ${fmt(vm.kpis.average_order_value)} บาท`,
    `- ผู้ซื้อเฉลี่ย/วัน: ${fmt(vm.kpis.daily_active_users_avg)}`,
    `- Conversion (cart→purchase): ${fmt2(vm.kpis.conversion_rate_pct)}%`,
    `- ลูกค้ากลับมาซื้อ: ${fmt2(vm.kpis.returning_customers_pct)}%`,
    ``,
    `[Month-over-Month] ${mdLine}`,
    ``,
    `[Top 5 Categories] ${topCats}`,
    `[Top 5 Products by Revenue] ${topProds}`,
    ``,
    `[Funnel]`,
    `- View: ${fmt(vm.funnel.view)}, Cart: ${fmt(vm.funnel.cart)}, Purchase: ${fmt(vm.funnel.purchase)}`,
    `- View→Cart ${fmt2(vm.funnel.view_to_cart_pct)}%, Cart→Purchase ${fmt2(vm.funnel.cart_to_purchase_pct)}%`,
    ``,
    `[RFM Segments] ${segs}`,
    `[Churn Risk] มี ${(vm.churnRisk || []).length} ราย`,
    `[Peak Window] ${peakLine}`,
  ].join("\n");
}

window.sendAiMessage = async function sendAiMessage() {
  const input = document.getElementById("ai-input");
  const sendBtn = document.getElementById("ai-send-btn");
  const message = (input?.value || "").trim();
  if (!message) return;

  const apiKey = getApiKey();
  if (!apiKey) {
    showToast("กรุณากรอก Gemini API Key ก่อน 🔑");
    showApiKeySetup(true);
    return;
  }

  // แสดงข้อความผู้ใช้ + clear input
  appendAiMessage("user", message);
  input.value = "";
  input.style.height = "36px";

  const typingId = appendAiTyping();
  if (sendBtn) sendBtn.disabled = true;

  try {
    const model = getModel();
    const dashboardContext = buildGeminiContext();
    const systemInstruction =
      "คุณคือผู้ช่วย AI วิเคราะห์ข้อมูล E-Commerce ตอบเป็นภาษาไทยกระชับ ใช้ตัวเลขจาก Dashboard Snapshot ที่ให้มาเสมอ " +
      "ให้ insight ที่ actionable (อะไรควรทำต่อ) และใช้ markdown bullet หรือ bold ได้ ถ้าข้อมูลไม่พอให้บอกตรง ๆ ว่าต้องเก็บอะไรเพิ่ม";

    // ใส่ snapshot ปัจจุบันเป็นข้อความนำในแต่ละ turn (เผื่อ filter เปลี่ยนระหว่าง chat)
    const userContent = `[Dashboard ปัจจุบัน]\n${dashboardContext}\n\n[คำถาม] ${message}`;

    // สร้าง contents array (รวมประวัติเดิม)
    const contents = [];
    for (const t of aiTurns) {
      contents.push({ role: t.role, parts: [{ text: t.text }] });
    }
    contents.push({ role: "user", parts: [{ text: userContent }] });

    const url = `${GEMINI_API_BASE}/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const body = {
      system_instruction: { parts: [{ text: systemInstruction }] },
      contents,
      generationConfig: { temperature: 0.6, maxOutputTokens: 1024, topP: 0.9 },
      safetySettings: [],
    };

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errText = await resp.text();
      let detail = errText;
      try { detail = JSON.parse(errText)?.error?.message || errText; } catch (e) {}
      throw new Error(`HTTP ${resp.status}: ${detail.slice(0, 300)}`);
    }

    const data = await resp.json();
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!reply) {
      const finishReason = data?.candidates?.[0]?.finishReason || "unknown";
      throw new Error(`Gemini ไม่ส่งคำตอบกลับ (finishReason=${finishReason})`);
    }

    // จดประวัติสำหรับ multi-turn (เก็บเฉพาะ message สั้น ไม่รวม dashboard snapshot — กัน prompt บวม)
    aiTurns.push({ role: "user", text: message });
    aiTurns.push({ role: "model", text: reply });
    if (aiTurns.length > 16) aiTurns = aiTurns.slice(-16);

    removeAiTyping(typingId);
    appendAiMessage("bot", formatGeminiText(reply));
  } catch (err) {
    removeAiTyping(typingId);
    appendAiMessage(
      "bot",
      `<span style="color:var(--red)">⚠️ เรียก Gemini ไม่สำเร็จ: ${escapeHtml(err.message)}</span>` +
      `<br><span style="font-size:10px;color:var(--text3)">ตรวจสอบ API Key, model, และ network/CORS</span>`
    );
    console.error("[Gemini]", err);
  } finally {
    if (sendBtn) sendBtn.disabled = false;
  }
};

document.addEventListener("DOMContentLoaded", () => {
  loadDashboardData();
  window.setInterval(() => loadDashboardData(false), AUTO_REFRESH_MS);
  // Restore Gemini API key state ถ้าผู้ใช้เคยใส่ไว้
  if (getApiKey()) {
    showApiKeySetup(false);
  } else {
    showApiKeySetup(true);
  }
});
