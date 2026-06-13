/* ============================================================================
 *  iRAS carbonate equilibrium core  (v1.9 — Phases 1-3)
 *
 *  Steady-state carbonate speciation for RAS design.
 *  Forward (default): total alkalinity (held by NaHCO3 dosing to a setpoint)
 *    + aqueous CO2 (set by respiration + nitrification production and stripper
 *    removal) => pH is the emergent third variable.
 *  Inverse (solveAlk): target pH + aqueous CO2 => the alkalinity setpoint
 *    required to hold that pH (direct/algebraic, no iteration).
 *
 *  Equilibrium constants ported VERBATIM from PyCO2SYS 1.8.3 (opt_k_carbonic = 14):
 *    K1,K2  Millero (2010), Mar.Freshw.Res. 61:139-142      [SWS scale, S=0-50]
 *    K0     Weiss (1974)                                     [CO2 solubility]
 *    KW     Millero (1979)                                   [SWS]
 *    KB     Dickson (1990b), Total -> SWS via SWStoTOT
 *    TB     Uppstrom (1974); TS Morris-Riley (1966); TF Riley (1965)
 *    KS     Dickson (1990a) free; KF Dickson-Riley (1979) free
 *    fH     Takahashi et al. (1982)                          [SWS <-> NBS]
 *    NH3 Ka Clegg & Whitfield (1995), GCA 59(12):2403, eq.18 [Total -> SWS]
 *    Ca     Riley & Tongudai (1967);  Ksp(calcite) Mucci (1983, 1 atm)  [for omega]
 *
 *  pH SCALE: internal solve is on the SWS scale; the PRIMARY reported pH is the
 *    FREE / concentration scale (pH_free = pH_sws - log10(SWStoFREE); free > sws
 *    in seawater). At S=0 free = SWS = the freshwater NBS-probe reading, so the
 *    free scale avoids the fH artifact that makes "NBS" read ~0.15 high at S=0.
 *    pH_sws and pH_nbs are also returned for reference. (A sign error in this
 *    free<->sws conversion — invisible at S=0 and to internal round-trips, only
 *    caught against PyCO2SYS on the free scale — was fixed in v1.9.)
 *
 *  UNITS: concentrations are mol/kg-SW (match PyCO2SYS); the RAS engine wrapper
 *    converts mg/L <-> mol/kg via a simple salinity density (rho = 1 + 8e-4*S).
 *
 *  API (global.iRASCarbonate):
 *    solve(TA, CO2aq, Tc, S)        forward -> {pH(=free), pH_free, pH_sws, pH_nbs,
 *                                    H_sws, CO2aq, HCO3, CO3, DIC, omega_calcite, ...}
 *    solveAlk(pH_free, CO2aq, Tc, S) inverse -> required total alkalinity (mol/kg)
 *    nh3Fraction(H_sws, Tc, S)      un-ionised NH3 fraction Ka/(Ka+H), SWS
 *    bufferBeta(TA, CO2aq, Tc, S)   Van Slyke buffer intensity (mg/L CaCO3 per pH)
 *    Ca_RT67(S) / Ksp_calcite_M83(Tc,S)   calcite saturation inputs
 *
 *  VALIDATION vs PyCO2SYS (opt_k_carbonic=14, S=0-35, T=12-28):
 *    forward pH (free & NBS) max|dpH| = 1e-5; inverse TA = 0.083 umol/kg;
 *    omega_calcite 0.006%; NH3 fraction 1.5e-16.
 * ========================================================================== */
(function (global) {
  'use strict';
  const ln = Math.log, exp = Math.exp, log10 = Math.log10, sqrt = Math.sqrt, pow = Math.pow;

  // ---- salt totals (mol/kg-SW) ----
  function ionicStrength(S) { return 19.924 * S / (1000 - 1.005 * S); }        // DOE94
  function boronTotal(S)   { return 0.0004157 * S / 35; }                       // Uppström 1974
  function sulfateTotal(S) { return (0.14 / 96.062) * S / 1.80655; }            // Morris-Riley 1966
  function fluorideTotal(S){ return (0.000067 / 18.998) * S / 1.80655; }        // Riley 1965

  // ---- equilibrium constants (TempK, S) ----
  function K0_W74(T, S) {                                                       // Weiss 1974, mol/kg/atm
    const t = T / 100;
    return exp(-60.2409 + 93.4517 / t + 23.3585 * ln(t)
      + S * (0.023517 - 0.023656 * t + 0.0047036 * t * t));
  }
  function K1K2_M10(T, S) {                                                     // Millero 2010, SWS
    const pK10 = -126.34048 + 6320.813 / T + 19.568224 * ln(T);
    const A1 = 13.4038 * pow(S, 0.5) + 0.03206 * S - 5.242e-5 * S * S;
    const B1 = -530.659 * pow(S, 0.5) - 5.8210 * S;
    const C1 = -2.0664 * pow(S, 0.5);
    const pK1 = pK10 + A1 + B1 / T + C1 * ln(T);
    const pK20 = -90.18333 + 5143.692 / T + 14.613358 * ln(T);
    const A2 = 21.3728 * pow(S, 0.5) + 0.1218 * S - 3.688e-4 * S * S;
    const B2 = -788.289 * pow(S, 0.5) - 19.189 * S;
    const C2 = -3.374 * pow(S, 0.5);
    const pK2 = pK20 + A2 + B2 / T + C2 * ln(T);
    return [pow(10, -pK1), pow(10, -pK2)];
  }
  function KW_M79(T, S) {                                                       // Millero 1979, SWS
    return exp(148.9802 - 13847.26 / T - 23.6521 * ln(T)
      + (-79.2447 + 3298.72 / T + 12.0408 * ln(T)) * sqrt(S) - 0.019813 * S);
  }
  function KB_TOT_D90b(T, S) {                                                  // Dickson 1990b, Total
    const sq = sqrt(S);
    const top = -8966.9 - 2890.53 * sq - 77.942 * S + 1.728 * sq * S - 0.0996 * S * S;
    const lnKB = top / T + 148.0248 + 137.1942 * sq + 1.62142 * S
      + (-24.4344 - 25.085 * sq - 0.2474 * S) * ln(T) + 0.053105 * sq * T;
    return exp(lnKB);
  }
  function KS_FREE_D90a(T, S) {                                                 // Dickson 1990a, free
    const I = ionicStrength(S), L = ln(T);
    const lnKS = -4276.1 / T + 141.328 - 23.093 * L
      + (-13856 / T + 324.57 - 47.986 * L) * sqrt(I)
      + (35474 / T - 771.54 + 114.723 * L) * I
      + (-2698 / T) * sqrt(I) * I + (1776 / T) * I * I;
    return exp(lnKS) * (1 - 0.001005 * S);
  }
  function KF_FREE_DR79(T, S) {                                                 // Dickson-Riley 1979, free
    const I = ionicStrength(S);
    return exp(1590.2 / T - 12.641 + 1.525 * sqrt(I)) * (1 - 0.001005 * S);
  }
  function fH_TWB82(T, S) {                                                     // Takahashi 1982, SWS<->NBS
    return 1.2948 - 0.002036 * T + (0.0004607 - 0.000001475 * T) * S * S;
  }
  function Ka_NH3_CW95_TOT(T, S) {                                              // Clegg-Whitfield 1995, Total, S=0-40
    let pK = 9.244605 - 2729.33 * (1 / 298.15 - 1 / T);
    pK += (0.04203362 - 11.24742 / T) * pow(S, 0.25);
    pK += (-13.6416 + 1.176949 * sqrt(T) - 0.02860785 * T + 545.4834 / T) * pow(S, 0.5);
    pK += (-0.1462507 + 0.0090226468 * sqrt(T) - 0.0001471361 * T + 10.5425 / T) * pow(S, 1.5);
    pK += (0.004669309 - 0.0001691742 * sqrt(T) - 0.5677934 / T) * S * S;
    pK += (-2.354039e-05 + 0.009698623 / T) * pow(S, 2.5);
    return pow(10, -pK) * (1 - 0.001005 * S);                                   // Total scale, mol/kg-SW
  }
  // SWS-scale NH3 Ka (for use with [H+]_SWS): Total -> SWS via SWStoTOT0
  function Ka_NH3_SWS(T, S) {
    if (S <= 0) return Ka_NH3_CW95_TOT(T, S);   // free=tot=sws at S=0
    const TS = sulfateTotal(S), KS = KS_FREE_D90a(T, S);
    const TF = fluorideTotal(S), KF = KF_FREE_DR79(T, S);
    const SWStoTOT0 = (1 + TS / KS) / (1 + TS / KS + TF / KF);
    return Ka_NH3_CW95_TOT(T, S) / SWStoTOT0;
  }

  // SWS-scale KB: convert Total -> SWS via SWStoTOT0 = (1+TS/KS)/(1+TS/KS+TF/KF)
  function KB_SWS(T, S) {
    if (S <= 0) return 0;                       // no borate in freshwater
    const TS = sulfateTotal(S), KS = KS_FREE_D90a(T, S);
    const TF = fluorideTotal(S), KF = KF_FREE_DR79(T, S);
    const SWStoTOT0 = (1 + TS / KS) / (1 + TS / KS + TF / KF);
    return KB_TOT_D90b(T, S) / SWStoTOT0;
  }

  /* ---- core solver: (total alkalinity, aqueous CO2) -> pH ----
   * TA, CO2aq in mol/kg-SW; T in degC; S in psu.
   * Solves on SWS scale, returns pH on NBS scale + speciation. */
  function solve(TA, CO2aq, Tc, S) {
    const T = Tc + 273.15;
    const [K1, K2] = K1K2_M10(T, S);
    const KW = KW_M79(T, S);
    const KB = KB_SWS(T, S), TB = boronTotal(S);
    const fH = fH_TWB82(T, S);

    // TA(H) on SWS scale; bisection on pH_SWS in [2,12]
    const taOf = (H) =>
      K1 * CO2aq / H + 2 * K1 * K2 * CO2aq / (H * H)   // HCO3 + 2 CO3
      + (KB > 0 ? KB * TB / (KB + H) : 0)              // B(OH)4-
      + KW / H - H - TA;                               // OH- - H+ - TA
    let lo = pow(10, -12), hi = pow(10, -2), Hm = 0;   // [H+] range (pH 2..12)
    // taOf is monotonic decreasing in H over the bracket
    for (let i = 0; i < 100; i++) {
      Hm = sqrt(lo * hi);                              // geometric bisection (H spans orders of magnitude)
      const f = taOf(Hm);
      if (f > 0) lo = Hm; else hi = Hm;
    }
    const H_sws = Hm;
    const pH_sws = -log10(H_sws);
    const pH_nbs = pH_sws - log10(fH);
    // free scale: at S=0 free=SWS; at seawater pH_free = pH_sws + log10(SWStoFREE)
    let SWStoFREE = 1;
    if (S > 0) {
      const TS = sulfateTotal(S), KS = KS_FREE_D90a(T, S);
      const TF = fluorideTotal(S), KF = KF_FREE_DR79(T, S);
      SWStoFREE = 1 / (1 + TS / KS + TF / KF);
    }
    const pH_free = pH_sws - log10(SWStoFREE);   // [H+]_free = [H+]_sws*SWStoFREE (<1) => pH_free > pH_sws

    const HCO3 = K1 * CO2aq / H_sws;
    const CO3 = K1 * K2 * CO2aq / (H_sws * H_sws);
    const DIC = CO2aq + HCO3 + CO3;
    const omega = (S > 0) ? (Ca_RT67(S) * CO3 / Ksp_calcite_M83(T, S)) : null;  // calcite saturation (marine)
    return {
      pH: pH_free, pH_free, pH_sws, pH_nbs, H_sws, fH,
      CO2aq, HCO3, CO3, DIC, omega_calcite: omega,
      K1, K2, KW, KB, KH: K0_W74(T, S)
    };
  }

  // calcium (Riley-Tongudai 1967) and calcite solubility (Mucci 1983, 1 atm) for saturation index
  function Ca_RT67(S) { return 0.02128 / 40.087 * S / 1.80655; }                // mol/kg-SW
  function Ksp_calcite_M83(Tc, S) {                                             // (mol/kg-SW)^2, 1 atm
    const T = (typeof Tc === 'number' && Tc < 200) ? Tc + 273.15 : Tc;         // accept degC or K
    let lg = -171.9065 - 0.077993 * T + 2839.319 / T + 71.595 * log10(T)
      + (-0.77712 + 0.0028426 * T + 178.34 / T) * sqrt(S)
      - 0.07711 * S + 0.0041249 * sqrt(S) * S;
    return pow(10, lg);
  }

  // Van Slyke buffer intensity (operational): mg/L CaCO3 alkalinity change per unit pH, at fixed CO2(aq).
  //   higher = stiffer (more dosing needed to move pH = more stable against acid loads). Finite difference.
  function bufferBeta(TA, CO2aq, Tc, S) {
    const d = 1e-4;                                  // +0.1 mmol/kg alkalinity perturbation
    const p0 = solve(TA, CO2aq, Tc, S).pH;
    const p1 = solve(TA + d, CO2aq, Tc, S).pH;
    const dpH = p1 - p0;
    if (!isFinite(dpH) || Math.abs(dpH) < 1e-9) return null;
    return (d / dpH) * 50043;                         // mol/kg per pH -> mg/L CaCO3 per pH
  }


  // ---- inverse: target pH (free scale) + aqueous CO2 -> required total alkalinity (mol/kg-SW) ----
  //   Direct/algebraic (no iteration): [H+] is fixed by the target pH, so each carbonate/borate/water
  //   term is explicit and TA is their sum. Returns <=0 when the target pH is unreachable on the low
  //   side even at zero alkalinity (i.e. the CO2 alone already gives a higher pH).
  function solveAlk(pH_free, CO2aq, Tc, S) {
    const T = Tc + 273.15;
    const [K1, K2] = K1K2_M10(T, S);
    const KW = KW_M79(T, S);
    const KB = KB_SWS(T, S), TB = boronTotal(S);
    let SWStoFREE = 1;
    if (S > 0) {
      const TS = sulfateTotal(S), KS = KS_FREE_D90a(T, S);
      const TF = fluorideTotal(S), KF = KF_FREE_DR79(T, S);
      SWStoFREE = 1 / (1 + TS / KS + TF / KF);
    }
    const pH_sws = pH_free + log10(SWStoFREE);   // inverse of pH_free = pH_sws - log10(SWStoFREE)
    const H = pow(10, -pH_sws);
    return K1 * CO2aq / H + 2 * K1 * K2 * CO2aq / (H * H)
      + (KB > 0 ? KB * TB / (KB + H) : 0) + KW / H - H;       // mol/kg-SW
  }

  // un-ionized ammonia fraction f = [NH3]/TAN = Ka/(Ka+[H+]_SWS), using SWS Ka & H
  function nh3Fraction(H_sws, Tc, S) {
    const Ka = Ka_NH3_SWS(Tc + 273.15, S);   // CW95, SWS scale; physical fraction is scale-invariant
    return Ka / (Ka + H_sws);
  }

  const api = {
    solve, solveAlk, nh3Fraction, bufferBeta, Ca_RT67, Ksp_calcite_M83,
    K0_W74, K1K2_M10, KW_M79, KB_SWS, KB_TOT_D90b, KS_FREE_D90a, KF_FREE_DR79,
    fH_TWB82, Ka_NH3_CW95_TOT, Ka_NH3_SWS, boronTotal, sulfateTotal, fluorideTotal, ionicStrength
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  global.iRASCarbonate = api;
})(typeof window !== 'undefined' ? window : globalThis);
