/* =========================================================================
   charts.js - all charts (Apache ECharts). Colours come from CSS variables,
   so the charts follow the light / dark theme.
   ========================================================================= */

(function () {
  const charts = {};
  const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const fmt = (v, d = 0) => DEMO.kpi.fmt(v, d);

  const TIMES = Array.from({ length: 96 }, (_, i) => `${String(Math.floor(i / 4)).padStart(2, "0")}:${String((i % 4) * 15).padStart(2, "0")}`);

  function theme() {
    return {
      ink: css("--ink"), ink2: css("--ink-2"), muted: css("--muted"), grid: css("--grid"), axis: css("--axis"),
      surface: css("--surface"), series: [1, 2, 3, 4, 5, 6].map((i) => css(`--series-${i}`)),
      seq: [css("--seq-100"), css("--seq-300"), css("--seq-450"), css("--seq-600"), css("--seq-700")]
    };
  }

  function base(th) {
    return {
      animationDuration: 300, animationDurationUpdate: 400,
      textStyle: { fontFamily: css("--font-ui"), color: th.ink2 },
      tooltip: {
        backgroundColor: th.surface, borderColor: th.grid, borderWidth: 1, textStyle: { color: th.ink, fontSize: 12 },
        extraCssText: "box-shadow:0 4px 16px rgba(0,0,0,.12);border-radius:8px;", confine: true
      }
    };
  }

  function get(id) {
    const el = document.getElementById(id);
    if (!el || typeof echarts === "undefined") return null;
    if (!charts[id] || charts[id].getDom() !== el) {
      if (charts[id]) { try { charts[id].dispose(); } catch (e) {} }
      charts[id] = echarts.init(el, null, { renderer: "canvas" });
    }
    return charts[id];
  }

  const axisX = (th) => ({
    type: "category", data: TIMES, boundaryGap: false,
    axisLine: { lineStyle: { color: th.axis } }, axisTick: { show: false },
    axisLabel: { color: th.muted, interval: 11, fontSize: 11 }
  });
  const axisY = (th, name) => ({
    type: "value", name, nameTextStyle: { color: th.muted, fontSize: 11, align: "left" },
    splitLine: { lineStyle: { color: th.grid } }, axisLabel: { color: th.muted, fontSize: 11, formatter: (v) => fmt(v) }
  });

  /* Load profile today. Raw view: one line (main incomer). KPI view: stacked by system + baseline + yesterday. */
  function load(data, mode, nowSlot) {
    const c = get("chart-load"); if (!c) return;
    const th = theme();
    const nowLine = { symbol: "none", silent: true, label: { show: false }, lineStyle: { color: th.muted, type: "dashed", width: 1 }, data: [{ xAxis: TIMES[nowSlot] }] };
    let series, legend;
    if (mode === "raw") {
      series = [{
        name: "Main incomer kW", type: "line", data: data.grid, showSymbol: false, smooth: false,
        lineStyle: { width: 2, color: th.ink2 }, itemStyle: { color: th.ink2 }, markLine: nowLine
      }];
      legend = { show: false };
    } else {
      series = DEMO.GROUPS.map((g, i) => ({
        name: g.name, type: "line", stack: "load", data: data.groups[g.id], showSymbol: false, smooth: 0.2,
        lineStyle: { width: 0 }, areaStyle: { color: th.series[i], opacity: 0.9 }, itemStyle: { color: th.series[i] },
        emphasis: { focus: "series" }, markLine: i === 0 ? nowLine : undefined
      }));
      series.push({ name: "Efficient baseline", type: "line", data: data.efficient, showSymbol: false, smooth: 0.2, z: 5,
        lineStyle: { width: 2, type: [6, 4], color: th.ink }, itemStyle: { color: th.ink } });
      series.push({ name: "Yesterday", type: "line", data: data.yesterday, showSymbol: false, smooth: 0.2, z: 4,
        lineStyle: { width: 1.5, color: th.muted, type: "dotted" }, itemStyle: { color: th.muted } });
      legend = { show: true, top: 0, left: 0, icon: "roundRect", itemWidth: 12, itemHeight: 8, textStyle: { color: th.ink2, fontSize: 11 } };
    }
    c.setOption({
      ...base(th), legend,
      grid: { left: 8, right: 16, top: mode === "raw" ? 24 : 58, bottom: 8, containLabel: true },
      tooltip: { ...base(th).tooltip, trigger: "axis", axisPointer: { type: "line", lineStyle: { color: th.muted } },
        valueFormatter: (v) => (v == null ? "-" : `${fmt(v)} kW`), order: "seriesDesc" },
      xAxis: axisX(th), yAxis: axisY(th, "kW"), series
    }, { notMerge: true });
  }

  /* Energy today by system, ranked (KPI view). One hue: the bars are ranked, not identified by colour. */
  function systems(rows) {
    const c = get("chart-systems"); if (!c) return;
    const th = theme();
    const data = rows.filter((r) => r.kwh > 0.5).sort((a, b) => a.kwh - b.kwh);
    const total = data.reduce((a, r) => a + r.kwh, 0) || 1;
    c.setOption({
      ...base(th),
      grid: { left: 8, right: 70, top: 4, bottom: 4, containLabel: true },
      tooltip: { ...base(th).tooltip, trigger: "item", formatter: (p) => `${p.name}<br><b>${fmt(p.value)} kWh</b> · ${fmt(p.value / total * 100, 1)}%` },
      xAxis: { type: "value", show: false },
      yAxis: { type: "category", data: data.map((r) => r.name), axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: th.ink2, fontSize: 11 } },
      series: [{ type: "bar", data: data.map((r) => r.kwh), barWidth: "62%", itemStyle: { color: th.series[0], borderRadius: [0, 4, 4, 0] },
        label: { show: true, position: "right", color: th.ink2, fontSize: 11, formatter: (p) => `${fmt(p.value / total * 100, 0)}%` } }]
    }, { notMerge: true });
  }

  /* Day x hour heatmap of energy, last 7 days (KPI view). */
  function heatmap(data, dayLabels) {
    const c = get("chart-heatmap"); if (!c) return;
    const th = theme();
    const max = Math.max(...data.map((d) => d[2]), 1);
    c.setOption({
      ...base(th),
      grid: { left: 8, right: 8, top: 4, bottom: 44, containLabel: true },
      tooltip: { ...base(th).tooltip, trigger: "item", formatter: (p) => `${dayLabels[p.value[1]]}, ${String(p.value[0]).padStart(2, "0")}:00-${String(p.value[0] + 1).padStart(2, "0")}:00<br><b>${fmt(p.value[2])} kWh</b>` },
      xAxis: { type: "category", data: Array.from({ length: 24 }, (_, i) => String(i).padStart(2, "0")), splitArea: { show: false },
        axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: th.muted, fontSize: 10, interval: 2 } },
      yAxis: { type: "category", data: dayLabels, inverse: true, axisLine: { show: false }, axisTick: { show: false }, axisLabel: { color: th.ink2, fontSize: 11 } },
      visualMap: { min: 0, max, calculable: false, orient: "horizontal", left: "center", bottom: 0, itemWidth: 10, itemHeight: 140,
        text: ["High", "Low"], textStyle: { color: th.muted, fontSize: 11 }, inRange: { color: th.seq } },
      series: [{ type: "heatmap", data, itemStyle: { borderColor: th.surface, borderWidth: 2, borderRadius: 3 },
        emphasis: { itemStyle: { borderColor: th.ink, borderWidth: 1 } } }]
    }, { notMerge: true });
  }

  /* Small trend in the system drawer. */
  function trend(id, data, color) {
    const c = get(id); if (!c) return;
    const th = theme();
    c.setOption({
      ...base(th),
      grid: { left: 8, right: 12, top: 16, bottom: 8, containLabel: true },
      tooltip: { ...base(th).tooltip, trigger: "axis", valueFormatter: (v) => (v == null ? "-" : `${fmt(v, 1)} kW`) },
      xAxis: axisX(th), yAxis: axisY(th, "kW"),
      series: [{ name: "Today", type: "line", data, showSymbol: false, smooth: 0.2, lineStyle: { width: 2, color: color || th.series[0] },
        areaStyle: { color: color || th.series[0], opacity: 0.12 }, itemStyle: { color: color || th.series[0] } }]
    }, { notMerge: true });
  }

  function resize() { Object.values(charts).forEach((c) => { try { c.resize(); } catch (e) {} }); }
  function dispose(id) { if (charts[id]) { charts[id].dispose(); delete charts[id]; } }

  DEMO.charts = { load, systems, heatmap, trend, resize, dispose };
})();
