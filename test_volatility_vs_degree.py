#!/usr/bin/env python3
# -*- coding: utf-8 -*-

"""
Test the hypothesis: higher degree (unique partners) -> lower local volatility (more stability).

Inputs: OUT_ROOT/<YEAR>/facebook_data_transformed_new.csv
Expected columns: node, centrality (degree), volatility, community (unused here), name (optional)

Outputs (in OUT_ROOT):
- stats/degree_volatility_results.txt        (human-readable summary)
- stats/per_year_spearman.csv                (per-year nonparametric correlations)
- stats/panel_ols_fe_summary.txt             (two-way FE OLS with clustered SE)
- stats/panel_glm_poisson_summary.txt        (Poisson GLM with clustered SE)
- stats/permutation_null.csv                 (null distribution for coefficient)
"""

import argparse
import os
import re
from pathlib import Path

import numpy as np
import pandas as pd
from scipy.stats import spearmanr
import statsmodels.api as sm
import statsmodels.formula.api as smf

# -------------------------------
# Helpers
# -------------------------------

YEAR_DIR_RE = re.compile(r"^\d{4}$")

def find_year_dirs(out_root: Path):
    for p in sorted(out_root.iterdir()):
        if p.is_dir() and YEAR_DIR_RE.match(p.name):
            yield p

def load_panel(out_root: Path) -> pd.DataFrame:
    rows = []
    for ydir in find_year_dirs(out_root):
        year = int(ydir.name)
        f = ydir / "facebook_data_transformed_new.csv"
        if not f.exists() or os.path.getsize(f) == 0:
            continue
        try:
            df = pd.read_csv(f)
        except Exception:
            continue
        # required columns
        if not {"node","centrality","volatility"}.issubset(set(df.columns)):
            continue
        tmp = df[["node","centrality","volatility"]].copy()
        tmp["year"] = year
        rows.append(tmp)
    if not rows:
        return pd.DataFrame(columns=["node","centrality","volatility","year"])
    pan = pd.concat(rows, ignore_index=True)
    # clean types
    pan["node"] = pan["node"].astype(int)
    pan["year"] = pan["year"].astype(int)
    pan["centrality"] = pd.to_numeric(pan["centrality"], errors="coerce")
    pan["volatility"] = pd.to_numeric(pan["volatility"], errors="coerce")
    pan = pan.dropna(subset=["centrality","volatility","year","node"]).reset_index(drop=True)
    return pan

def zscore_within_year(df: pd.DataFrame, col: str, year_col: str = "year") -> pd.Series:
    def _z(s):
        v = s.values.astype(float)
        sd = np.nanstd(v)
        if sd == 0 or np.isnan(sd):
            return pd.Series(np.zeros_like(v), index=s.index)
        return (s - np.nanmean(v)) / sd
    return df.groupby(year_col)[col].transform(_z)

def cluster_robust_ols(formula: str, data: pd.DataFrame, cluster_col: str):
    model = smf.ols(formula=formula, data=data)
    res = model.fit(cov_type="cluster", cov_kwds={"groups": data[cluster_col]})
    return res

def cluster_robust_glm_poisson(formula: str, data: pd.DataFrame, cluster_col: str):
    model = smf.glm(formula=formula, data=data, family=sm.families.Poisson())
    res = model.fit(cov_type="cluster", cov_kwds={"groups": data[cluster_col]})
    return res

def permute_within_year(df: pd.DataFrame, col: str, year_col: str, rng: np.random.Generator) -> pd.Series:
    # returns a Series aligned to df.index with within-year shuffles of 'col'
    out = pd.Series(index=df.index, dtype=float)
    for y, sub_idx in df.groupby(year_col).groups.items():
        idx = list(sub_idx)
        vals = df.loc[idx, col].values.copy()
        rng.shuffle(vals)
        out.loc[idx] = vals
    return out

# -------------------------------
# Main analysis
# -------------------------------

def run_analysis(out_root: Path, n_permutations: int = 500, use_lagged_degree: bool = True):
    stats_dir = out_root / "stats"
    stats_dir.mkdir(parents=True, exist_ok=True)

    panel = load_panel(out_root)
    if panel.empty:
        raise SystemExit(f"No valid yearly CSVs found under {out_root}")

    # Define stability as 2 - volatility (so higher = more stable)
    # Volatility in your exporter is in {0,1,2}
    panel["stability"] = 2 - panel["volatility"]

    # Standardize degree within each year to make coefficients comparable
    panel["degree_z"] = zscore_within_year(panel, "centrality", "year")

    # Optional: lag degree by one year per node to reduce simultaneity concerns
    panel = panel.sort_values(["node","year"]).reset_index(drop=True)
    panel["degree_z_lag"] = panel.groupby("node")["degree_z"].shift(1)
    if use_lagged_degree:
        panel["deg_feat"] = panel["degree_z_lag"]
    else:
        panel["deg_feat"] = panel["degree_z"]

    # Drop first-appearance rows if lag is required
    pan_est = panel.dropna(subset=["deg_feat", "volatility"]).copy()

    # --------------------------
    # 1) Per-year Spearman (degree vs stability)
    # --------------------------
    sp_rows = []
    for y, sub in panel.groupby("year"):
        if sub.shape[0] < 5:
            continue
        rho, p = spearmanr(sub["centrality"], sub["stability"])
        sp_rows.append({"year": int(y), "n": int(sub.shape[0]), "spearman_rho": float(rho), "p_value": float(p)})
    sp_df = pd.DataFrame(sp_rows).sort_values("year")
    sp_df.to_csv(stats_dir / "per_year_spearman.csv", index=False)

    # --------------------------
    # 2) Two-way FE OLS (node FE + year FE), clustered by node
    #    volatility ~ deg_feat + C(year) + C(node)
    # --------------------------
    # Note: C(node) absorbs time-invariant person traits; C(year) absorbs period shocks.
    # Clustered SE by node handle within-node serial correlation/heteroskedasticity.
    if pan_est["node"].nunique() * pan_est["year"].nunique() > 1:
        fe_ols = cluster_robust_ols(
            "volatility ~ deg_feat + C(year) + C(node)",
            data=pan_est, cluster_col="node"
        )
        with open(stats_dir / "panel_ols_fe_summary.txt", "w") as f:
            f.write(fe_ols.summary().as_text())
        fe_coef = fe_ols.params.get("deg_feat", np.nan)
    else:
        fe_ols = None
        fe_coef = np.nan

    # --------------------------
    # 3) GLM Poisson with year FE, clustered by node
    #    volatility (0..2) ~ deg_feat + C(year)
    # --------------------------
    glm_pois = cluster_robust_glm_poisson(
        "volatility ~ deg_feat + C(year)",
        data=pan_est, cluster_col="node"
    )
    with open(stats_dir / "panel_glm_poisson_summary.txt", "w") as f:
        f.write(glm_pois.summary().as_text())
    pois_coef = glm_pois.params.get("deg_feat", np.nan)

    # --------------------------
    # 4) Permutation test (null for degree effect)
    #    We shuffle degree_z within-year, recompute deg_feat (and its lag if requested),
    #    and estimate a reduced OLS with year FE (to keep this fast & comparable).
    # --------------------------
    rng = np.random.default_rng(42)
    perm_coefs = []
    base_df = panel.copy()
    for b in range(n_permutations):
        shuffled = base_df.copy()
        shuffled["degree_z_perm"] = permute_within_year(shuffled, "degree_z", "year", rng)
        if use_lagged_degree:
            shuffled = shuffled.sort_values(["node","year"])
            shuffled["deg_feat_perm"] = shuffled.groupby("node")["degree_z_perm"].shift(1)
        else:
            shuffled["deg_feat_perm"] = shuffled["degree_z_perm"]
        red = shuffled.dropna(subset=["deg_feat_perm", "volatility"]).copy()
        try:
            # Year FE, cluster by node (no node FE to keep null generation efficient)
            res = cluster_robust_ols("volatility ~ deg_feat_perm + C(year)", data=red, cluster_col="node")
            perm_coefs.append(res.params.get("deg_feat_perm", np.nan))
        except Exception:
            perm_coefs.append(np.nan)

    perm_df = pd.DataFrame({"coef_deg_feat_perm": perm_coefs})
    perm_df.to_csv(stats_dir / "permutation_null.csv", index=False)

    # One-sided p-value: H1 expects deg_feat coefficient < 0 (higher degree -> lower volatility)
    perm_valid = perm_df["coef_deg_feat_perm"].replace([np.inf, -np.inf], np.nan).dropna()
    if len(perm_valid) > 0 and not np.isnan(pois_coef):
        # Compare GLM Poisson coefficient to permutation null for conservatism
        obs = pois_coef
        p_one_sided = ( (perm_valid <= obs).sum() + 1 ) / (len(perm_valid) + 1) if obs < 0 else ( (perm_valid >= obs).sum() + 1 ) / (len(perm_valid) + 1)
    else:
        p_one_sided = np.nan

    # --------------------------
    # Write human-readable summary
    # --------------------------
    with open(stats_dir / "degree_volatility_results.txt", "w") as f:
        f.write("# Degree–Volatility Stability Analysis\n\n")
        f.write("### Data coverage\n")
        f.write(f"Years: {sorted(panel['year'].unique().tolist())}\n")
        f.write(f"Nodes: {panel['node'].nunique()}  Observations: {len(panel)}\n\n")

        f.write("### Nonparametric (per-year Spearman, degree vs stability=2−volatility)\n")
        if not sp_df.empty:
            f.write(sp_df.to_string(index=False))
            f.write("\n\n")
        else:
            f.write("Insufficient per-year data for Spearman.\n\n")

        f.write("### Panel models\n")
        if fe_ols is not None:
            f.write("Two-way FE OLS (volatility ~ deg_feat + C(year) + C(node)), cluster by node:\n")
            f.write(f"  deg_feat coef = {fe_ols.params.get('deg_feat', np.nan):.4f}, p={fe_ols.pvalues.get('deg_feat', np.nan):.4g}\n")
        else:
            f.write("Two-way FE OLS not run (insufficient panel variation).\n")
        f.write("\n")

        f.write("GLM Poisson (volatility ~ deg_feat + C(year)), cluster by node:\n")
        f.write(f"  deg_feat coef = {pois_coef:.4f} (log-count scale)\n")
        try:
            pval = glm_pois.pvalues.get("deg_feat", np.nan)
            f.write(f"  p-value (robust) = {pval:.4g}\n")
        except Exception:
            pass
        f.write("\n")

        f.write("### Permutation (within-year degree shuffles)\n")
        f.write(f"Permutations: {len(perm_valid)}; one-sided p (against GLM coef sign) = {p_one_sided:.4g}\n")
        if not np.isnan(pois_coef):
            f.write(f"Observed GLM coef(deg_feat) = {pois_coef:.4f} (expect negative if hypothesis holds)\n")

        f.write("\n### Interpretation guide\n")
        f.write("- Negative and significant coefficients on deg_feat suggest **higher degree predicts lower volatility** (i.e., more stability).\n")
        f.write("- Spearman ρ > 0 between degree and stability supports the same at the per-year level.\n")
        f.write("- A small permutation p-value indicates the association is unlikely under a structure-preserving null.\n")

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out_root", type=str, default="data/enron_ipr",
                    help="Root directory where yearly slice folders (e.g., 1998, 1999, ...) live.")
    ap.add_argument("--permutations", type=int, default=500,
                    help="Number of permutation iterations for the null (increase for more power).")
    ap.add_argument("--no_lag", action="store_true",
                    help="Use contemporaneous degree_z instead of lagged degree_z.")
    args = ap.parse_args()

    run_analysis(
        out_root=Path(args.out_root),
        n_permutations=args.permutations,
        use_lagged_degree=(not args.no_lag)
    )

if __name__ == "__main__":
    main()
