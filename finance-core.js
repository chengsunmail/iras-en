/* ============================================================================
 *   iRAS Finance Core — shared financial calculation module  (v1.5)
 *
 *   Provides core functions: IRR / NPV / cash flow / sensitivity analysis / loan schedule.
 *   Shared by finance.html (financial-analysis page) and report.html (feasibility-report generator),
 *   to avoid duplicated logic and maintenance drift.
 *
 *   Exposed global object: window.iRASFinance
 *     - calculateCore(data, params)
 *     - calculate(data, params)           // = core + sensitivity
 *     - buildLoanSchedule(L, r, n, method)
 *     - npv(cfs, rate)
 *     - irr(cfs)
 *     - sensitivityAnalysis(data, baseParams)
 *
 *   Fix log:
 *     v1.5 Bug 2: double-counted investment in the equity cash flow (loan now covers fixedAsset only)
 *     v1.5 Bug 6: the finance / report duplicate code was merged into this module
 *     v1.5 Bug 9: sensitivityAnalysis shares are read from the actual OPEX breakdown instead of being hard-coded
 *     v1.5 Bug 13: BEP uses the whole-period average interest, not a single year-3 figure
 *     v1.5 Bug 14: salvage is split into equipment / civil works and handled separately
 * ============================================================================ */
(function (global) {
  'use strict';

  // ---------- Loan repayment schedule ----------
  function buildLoanSchedule(L, r, n, method) {
    const sch = [];
    if (L <= 0 || n <= 0) return sch;
    if (method === 'equal_payment') {
      // Equal-installment (equal payment)
      const a = r * Math.pow(1 + r, n) / (Math.pow(1 + r, n) - 1);
      const annual = L * a;
      let bal = L;
      for (let t = 1; t <= n; t++) {
        const interest = bal * r;
        const principal = annual - interest;
        bal -= principal;
        sch.push({ year: t, interest, principal, balance: Math.max(0, bal) });
      }
    } else {
      // Equal-principal
      const principalEach = L / n;
      let bal = L;
      for (let t = 1; t <= n; t++) {
        const interest = bal * r;
        bal -= principalEach;
        sch.push({ year: t, interest, principal: principalEach, balance: Math.max(0, bal) });
      }
    }
    return sch;
  }

  // ---------- NPV ----------
  function npv(cfs, rate) {
    let v = 0;
    cfs.forEach((cf, t) => { v += cf / Math.pow(1 + rate, t); });
    return v;
  }

  // ---------- IRR (Newton-Raphson with bisection fallback) ----------
  function irr(cfs) {
    let r = 0.10;
    for (let iter = 0; iter < 100; iter++) {
      let f = 0, df = 0;
      cfs.forEach((cf, t) => {
        const d = Math.pow(1 + r, t);
        f += cf / d;
        if (t > 0) df -= t * cf / Math.pow(1 + r, t + 1);
      });
      if (Math.abs(df) < 1e-12) break;
      const rNew = r - f / df;
      if (Math.abs(rNew - r) < 1e-7) return rNew;
      if (rNew < -0.99 || rNew > 10) return irrBisect(cfs);
      r = rNew;
    }
    return r;
  }
  function irrBisect(cfs) {
    let lo = -0.5, hi = 5.0;
    const f = (rr) => cfs.reduce((s, cf, t) => s + cf / Math.pow(1 + rr, t), 0);
    let flo = f(lo), fhi = f(hi);
    if (flo * fhi > 0) return NaN;
    for (let iter = 0; iter < 100; iter++) {
      const mid = (lo + hi) / 2;
      const fmid = f(mid);
      if (Math.abs(fmid) < 1e-7) return mid;
      if (flo * fmid < 0) { hi = mid; fhi = fmid; }
      else { lo = mid; flo = fmid; }
    }
    return (lo + hi) / 2;
  }

  // ---------- OPEX variable/fixed split (v1.7, fixes Bug 19) ----------
  //   Old: hardcoded variable=70%, fixed=30%
  //   New: aggregate the real shares from perStage.cost
  //         Variable (scales linearly with the production ramp): feed + oxygenation (LOX or blower power) + chemicals (methanol/NaHCO3) + ozone
  //         Semi-fixed (essentially constant 24h, weakly correlated with output): main pump + UV lamp + misc + biofilter blower + CO2 blower + heat pump
  //   Graceful degradation: old data (missing perStage.cost) falls back to the legacy 70/30
  function computeOpexSplit(d) {
    const perStage = (d && d.results && d.results.perStage) || [];
    let totalVar = 0, totalFix = 0, totalAll = 0;
    perStage.forEach(ps => {
      const c = ps.cost || {};
      // Variable (tracks feed / output)
      const varCost = (c.feedCostAvg || 0)
                    + (c.aerationCostAvg || 0)        // LOX or main blower power (varies with O2 demand)
                    + (c.methanolCostAvg || 0)
                    + (c.naHCO3CostAvg || 0)
                    + (c.ozoneCostAvg || 0);
      // Semi-fixed (constant 24h)
      const fixCost = (c.pumpCostAvg || 0)
                    + (c.uvLampCostAvg || 0)
                    + (c.miscCostAvg || 0)
                    + (c.bfBlowerCostAvg || 0)        // biofilter blower is also essentially constant; nitrification O2 demand varies little
                    + (c.co2BlowerCostAvg || 0)
                    + (c.thermalCostAvg || 0);
      totalVar += varCost;
      totalFix += fixCost;
      totalAll += (c.totalAvg || 0) - (c.depDaily || 0);   // excludes depreciation (listed separately outside)
    });
    if (totalAll > 0 && (totalVar + totalFix) > 0) {
      // Clamp to a sensible range to avoid extremes: variable 30%-90%, fixed 10%-70%
      const sum = totalVar + totalFix;
      const vFrac = Math.max(0.3, Math.min(0.9, totalVar / sum));
      return { variableShare: vFrac, fixedShare: 1 - vFrac };
    }
    return { variableShare: 0.70, fixedShare: 0.30 };   // fallback (old data)
  }

  // ---------- Main calculation ----------
  function calculateCore(data, p) {
    if (!data || !data.results || !data.results.summary || !data.results.summary.finance) return null;
    const fin = data.results.summary.finance;
    const yieldKg = data.yieldTons * 1000;

    // CAPEX split
    const capexEquip = fin.totalCapexEquip || 0;
    const capexCivil = (fin.totalCapexProject || 0) - capexEquip;
    const fixedAsset = fin.totalCapexProject || 0;
    const annualOpexFull = fin.annualOpex || 0;
    const workingCapital = annualOpexFull * p.workingCap;
    const totalInvest = fixedAsset + workingCapital;

    // Bug 2 fix: the loan covers fixed assets only
    const ownEquityFixed = fixedAsset * p.ownPct;
    const loan = fixedAsset * (1 - p.ownPct);
    const ownEquity = ownEquityFixed + workingCapital;

    const annualDep = fin.annualDep || 0;

    // Loan schedule
    const loanSchedule = buildLoanSchedule(loan, p.loanRate, p.loanYears, p.loanMethod);

    // Year-by-year cash flow
    const Y = p.years;
    const ramps = [];
    for (let t = 1; t <= Y; t++) {
      if (t === 1) ramps.push(p.ramp1);
      else if (t === 2) ramps.push(p.ramp2);
      else ramps.push(p.ramp3);
    }

    // Bug 14 fix: split salvage into equipment / civil works
    // Equipment depreciated over 8 years, 5% residual in the final year (for >8-year projects); civil works over 20 years, 20% residual
    const salvageEquip = capexEquip * 0.05;
    const salvageCivil = capexCivil * 0.20;
    const totalSalvage = salvageEquip + salvageCivil;

    // v1.7 Bug 19 fix: OPEX variable/fixed computed from the actual cost fields, no longer hardcoded 70/30
    //   air mode has a higher feed share (~75-80%) vs o2 mode (~55%); the old 70/30 overestimated fixed and underestimated variable
    const opexSplit = computeOpexSplit(data);

    const yearly = [];
    for (let t = 0; t <= Y; t++) {
      const r = t === 0 ? 0 : ramps[t - 1];
      const revenue = r * yieldKg * p.price;
      const salesTax = revenue * p.salesTax;
      const netRevenue = revenue - salesTax;

      const variableOpex = annualOpexFull * opexSplit.variableShare * r;
      const fixedOpexBase = annualOpexFull * opexSplit.fixedShare;
      const fixedOpex = t === 0 ? 0 : fixedOpexBase;
      const operatingCost = variableOpex + fixedOpex;

      const repairCost = t === 0 ? 0 : capexEquip * p.repairRate;
      const adminCost = revenue * p.adminRate;
      const laborCost = t === 0 ? 0 : p.laborCost;
      const opCostTotal = operatingCost + repairCost + adminCost + laborCost;

      const lsRow = (t >= 1 && t <= p.loanYears && loanSchedule[t - 1]) ? loanSchedule[t - 1] : null;
      const interest = lsRow ? lsRow.interest : 0;
      const loanPrincipalRepay = lsRow ? lsRow.principal : 0;

      const dep = t === 0 ? 0 : annualDep;

      const profitBefore = netRevenue - opCostTotal - dep - interest;
      const tax = Math.max(0, profitBefore) * p.taxRate;
      const profitNet = profitBefore - tax;

      // Investment and cash flow
      const investOutflow = (t === 0) ? fixedAsset : 0;
      const wcOutflow = (t === 1) ? workingCapital : 0;
      const wcRecovery = (t === Y) ? workingCapital : 0;
      const salvage = (t === Y) ? totalSalvage : 0;       // Bug 14: total salvage after the split

      const cfTotal = revenue - salesTax - opCostTotal - tax
        - investOutflow - wcOutflow + wcRecovery + salvage;

      // Bug 2: the loan covers fixedAsset only; working capital is funded entirely by equity
      const loanInflow = (t === 0) ? loan : 0;
      const cfEquity = cfTotal + loanInflow - interest - loanPrincipalRepay;

      yearly.push({
        year: t, ramp: r, revenue, salesTax, netRevenue,
        variableOpex, fixedOpex, operatingCost,
        repairCost, adminCost, laborCost, opCostTotal,
        dep, interest, loanPrincipalRepay,
        profitBefore, tax, profitNet,
        cfTotal, cfEquity,
        investOutflow, wcOutflow, wcRecovery, salvage
      });
    }

    // Cumulative cash flow and payback period
    let cumTotal = 0, cumEquity = 0, cumTotalDisc = 0, cumEquityDisc = 0;
    let paybackTotal = -1, paybackEquity = -1;
    let paybackTotalDisc = -1, paybackEquityDisc = -1;
    yearly.forEach((y, i) => {
      const d = Math.pow(1 + p.discount, -y.year);
      cumTotal += y.cfTotal;
      cumEquity += y.cfEquity;
      cumTotalDisc += y.cfTotal * d;
      cumEquityDisc += y.cfEquity * d;
      y.cumTotal = cumTotal;
      y.cumEquity = cumEquity;
      y.cumTotalDisc = cumTotalDisc;
      y.cumEquityDisc = cumEquityDisc;
      if (paybackTotal < 0 && cumTotal >= 0) {
        const prev = i > 0 ? yearly[i - 1].cumTotal : 0;
        paybackTotal = (i > 0 ? yearly[i - 1].year : 0) + (-prev) / (cumTotal - prev);
      }
      if (paybackEquity < 0 && cumEquity >= 0) {
        const prev = i > 0 ? yearly[i - 1].cumEquity : 0;
        paybackEquity = (i > 0 ? yearly[i - 1].year : 0) + (-prev) / (cumEquity - prev);
      }
      if (paybackTotalDisc < 0 && cumTotalDisc >= 0) {
        const prev = i > 0 ? yearly[i - 1].cumTotalDisc : 0;
        paybackTotalDisc = (i > 0 ? yearly[i - 1].year : 0) + (-prev) / (cumTotalDisc - prev);
      }
      if (paybackEquityDisc < 0 && cumEquityDisc >= 0) {
        const prev = i > 0 ? yearly[i - 1].cumEquityDisc : 0;
        paybackEquityDisc = (i > 0 ? yearly[i - 1].year : 0) + (-prev) / (cumEquityDisc - prev);
      }
    });

    // NPV / IRR
    const cfTotalArr = yearly.map(y => y.cfTotal);
    const cfEquityArr = yearly.map(y => y.cfEquity);
    const npvTotal = npv(cfTotalArr, p.discount);
    const npvEquity = npv(cfEquityArr, p.discount);
    const irrTotal = irr(cfTotalArr);
    const irrEquity = irr(cfEquityArr);

    // BEP — Bug 13 fix: use the whole-period average interest rather than a single year-3 point
    const satRow = yearly[Math.min(3, Y)] || yearly[yearly.length - 1];
    const marginPerKg = (yieldKg > 0 && satRow.ramp > 0) ?
      (satRow.netRevenue - satRow.variableOpex - satRow.adminCost) / (yieldKg * satRow.ramp) : 0;
    const avgInterest = loanSchedule.length > 0
      ? loanSchedule.reduce((s, x) => s + x.interest, 0) / loanSchedule.length
      : 0;
    const fixedAnnual = annualOpexFull * opexSplit.fixedShare + annualDep + avgInterest
      + capexEquip * p.repairRate + p.laborCost;
    const bepKg = marginPerKg > 0 ? fixedAnnual / marginPerKg : 0;
    const bepPct = yieldKg > 0 ? bepKg / yieldKg * 100 : 0;

    return {
      capex: {
        equip: capexEquip, civil: capexCivil,
        fixedAsset, workingCapital, totalInvest,
        ownEquity, ownEquityFixed, loan,           // expose ownEquityFixed for the UI
        salvageEquip, salvageCivil, totalSalvage    // Bug 14: salvage split for the UI
      },
      annual: {
        revenue: satRow.revenue, opex: annualOpexFull, dep: annualDep,
        repair: capexEquip * p.repairRate, labor: p.laborCost,
        avgInterest                                  // Bug 13: expose the average interest
      },
      loanSchedule,
      yearly,
      indicators: {
        npvTotal, npvEquity, irrTotal, irrEquity,
        paybackTotal, paybackEquity,
        paybackTotalDisc, paybackEquityDisc,
        bepKg, bepPct
      },
      params: p,
      yieldKg
    };
  }

  // ---------- Sensitivity analysis (Bug 9: shares read from the actual OPEX breakdown) ----------
  function sensitivityAnalysis(data, baseParams) {
    const factors = [
      { key: 'price',       label: 'Sales price ±20%',   delta: 0.20 },
      { key: 'feedCost',    label: 'Feed cost ±20%',     delta: 0.20 },
      { key: 'electricity', label: 'Electricity ±20%',   delta: 0.20 },
      { key: 'capex',       label: 'CAPEX ±20%',         delta: 0.20 },
      { key: 'yieldRate',   label: 'Output ±10%',        delta: 0.10 }
    ];
    const baseCore = calculateCore(data, baseParams);
    const baseIRR = baseCore ? baseCore.indicators.irrTotal : NaN;
    const baseNPV = baseCore ? baseCore.indicators.npvTotal : NaN;

    // Bug 9: aggregate the real feed/electricity shares of OPEX from perStage
    //   Old: hardcoded feedCost=55%, electricity=20%, ignoring species/region
    //   New: aggregate cost.feedCostAvg / pumpCostAvg + uvLampCostAvg from d.results.perStage
    //          + miscCostAvg + co2BlowerCostAvg + ozoneCostAvg + thermalCostAvg + aerationCostAvg (if air aeration)
    //   Graceful degradation: falls back to the legacy hardcoded values when data is missing
    function computeShares(d) {
      const perStage = (d.results && d.results.perStage) || [];
      let totalFeed = 0, totalElec = 0, totalOpex = 0;
      perStage.forEach(ps => {
        const c = ps.cost || {};
        const feed = c.feedCostAvg || 0;
        // Electricity = main pump + UV lamp + misc + biofilter blower + CO2 blower + ozone + heat pump (+ air-aeration main blower)
        const elec = (c.pumpCostAvg || 0) + (c.uvLampCostAvg || 0) + (c.miscCostAvg || 0)
                   + (c.bfBlowerCostAvg || 0) + (c.co2BlowerCostAvg || 0)
                   + (c.ozoneCostAvg || 0) + (c.thermalCostAvg || 0);
        // Oxygenation cost: blower power under air aeration, LOX under pure oxygen (not counted as electricity)
        // The P&ID export format cannot distinguish them, so it is simplified into "neither electricity nor feed"
        const total = (c.totalAvg || 0) - (c.depDaily || 0);  // excludes depreciation
        totalFeed += feed;
        totalElec += elec;
        totalOpex += total;
      });
      if (totalOpex > 0) {
        return {
          feedShare: Math.max(0.1, Math.min(0.85, totalFeed / totalOpex)),
          elecShare: Math.max(0.05, Math.min(0.60, totalElec / totalOpex))
        };
      }
      return { feedShare: 0.55, elecShare: 0.20 };  // fallback
    }
    const shares = computeShares(data);

    const rows = factors.map(f => {
      let dataLow = JSON.parse(JSON.stringify(data));
      let dataHigh = JSON.parse(JSON.stringify(data));
      let pLow = { ...baseParams }, pHigh = { ...baseParams };

      if (f.key === 'price') {
        pLow.price = baseParams.price * (1 - f.delta);
        pHigh.price = baseParams.price * (1 + f.delta);
      } else if (f.key === 'feedCost' || f.key === 'electricity') {
        const share = f.key === 'feedCost' ? shares.feedShare : shares.elecShare;
        const fac = data.results.summary.finance;
        dataLow.results.summary.finance = { ...fac };
        dataLow.results.summary.finance.annualOpex = fac.annualOpex * (1 - share * f.delta);
        dataHigh.results.summary.finance = { ...fac };
        dataHigh.results.summary.finance.annualOpex = fac.annualOpex * (1 + share * f.delta);
      } else if (f.key === 'capex') {
        const fac = data.results.summary.finance;
        dataLow.results.summary.finance = { ...fac };
        dataLow.results.summary.finance.totalCapexEquip = fac.totalCapexEquip * (1 - f.delta);
        dataLow.results.summary.finance.totalCapexProject = fac.totalCapexProject * (1 - f.delta);
        dataLow.results.summary.finance.annualDep = fac.annualDep * (1 - f.delta);
        dataHigh.results.summary.finance = { ...fac };
        dataHigh.results.summary.finance.totalCapexEquip = fac.totalCapexEquip * (1 + f.delta);
        dataHigh.results.summary.finance.totalCapexProject = fac.totalCapexProject * (1 + f.delta);
        dataHigh.results.summary.finance.annualDep = fac.annualDep * (1 + f.delta);
      } else if (f.key === 'yieldRate') {
        pLow.ramp3 = baseParams.ramp3 * (1 - f.delta);
        pHigh.ramp3 = baseParams.ramp3 * (1 + f.delta);
      }

      const cLow = calculateCore(dataLow, pLow);
      const cHigh = calculateCore(dataHigh, pHigh);
      const irrLow = cLow ? cLow.indicators.irrTotal : NaN;
      const irrHigh = cHigh ? cHigh.indicators.irrTotal : NaN;
      const npvLow = cLow ? cLow.indicators.npvTotal : NaN;
      const npvHigh = cHigh ? cHigh.indicators.npvTotal : NaN;
      return {
        label: f.label,
        irrLow, irrHigh, irrSwing: Math.abs(irrHigh - irrLow),
        npvLow, npvHigh, npvSwing: Math.abs(npvHigh - npvLow)
      };
    });

    rows.sort((a, b) => b.irrSwing - a.irrSwing);
    return { baseIRR, baseNPV, factors: rows, shares };
  }

  // ---------- Top-level API ----------
  function calculate(data, p) {
    const core = calculateCore(data, p);
    if (!core) return null;
    core.sensitivity = sensitivityAnalysis(data, p);
    return core;
  }

  // Expose
  global.iRASFinance = {
    calculateCore,
    calculate,
    buildLoanSchedule,
    npv,
    irr,
    sensitivityAnalysis,
    version: '1.5'
  };
})(typeof window !== 'undefined' ? window : globalThis);
