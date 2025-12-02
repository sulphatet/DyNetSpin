# facebook_centrality_stability_analysis.py
# ----------------------------------------------------------
# 0. Imports & config
import pathlib
import pandas as pd
import numpy as np
import matplotlib.pyplot as plt
import seaborn as sns                         # only for prettier EDA plots
import statsmodels.api as sm
import statsmodels.formula.api as smf
from scipy import stats
from statsmodels.stats.multicomp import pairwise_tukeyhsd
from statsmodels.stats.multitest import multipletests
from sklearn.metrics import roc_curve, auc
from sklearn.preprocessing import OrdinalEncoder, StandardScaler
from sklearn.linear_model import LogisticRegression

plt.rcParams["figure.dpi"] = 120
sns.set_style("whitegrid")
RANDOM_STATE = 42

# ----------------------------------------------------------
# 1. Load & combine all periods
BASE_DIR = pathlib.Path("data")               # <-- adjust if needed
period_dirs = sorted([p for p in BASE_DIR.iterdir() if p.is_dir()])

def load_one_period(pdir: pathlib.Path) -> pd.DataFrame:
    df = pd.read_csv(pdir / "facebook_data_transformed_new.csv")
    df["period"] = pdir.name                 # "2000-2004" etc.
    return df

df = pd.concat([load_one_period(p) for p in period_dirs], ignore_index=True)
print(f"Loaded {df.shape[0]:,} rows from {len(period_dirs)} periods.")
df["type"] = df["type"].replace("", np.nan)   # first treat empty strings as NaN
df["type"] = df["type"].fillna("stable")       # then fill all NaNs with "stable"

# ----------------------------------------------------------
# 2. Quick data check
numeric_cols = ["centrality", "volatility", "eign", "closeness", "betwness", "density"]
print(df[numeric_cols].describe())
print("\nType value counts:")
print(df["type"].value_counts(dropna=False))

# Ensure there are no impossible centrality values
# assert df["centrality"].between(0, 1).all(), "Centrality outside [0,1]?"

# ----------------------------------------------------------
# 3. Manually encode 'type' as an **ordinal** variable with ties:
#    outandin (0)  <  outgoing & incoming (1)  <  stable (2)
type_map = {
    "outandin": 0,
    "outgoing": 1,
    "incoming": 1,
    "stable":   2
}
type_order = ["outandin", "outgoing", "incoming", "stable"]

df["type_ord"] = df["type"].map(type_map).fillna(2).astype(int)

# Quick sanity check
print(df[["type", "type_ord"]].drop_duplicates().sort_values("type_ord"))
#---------------------------------------------------------

# 4. Exploratory plots
fig, axes = plt.subplots(1, 2, figsize=(10, 4))
sns.boxplot(x="type", y="centrality", data=df, ax=axes[0], order=type_order)
axes[0].set_title("Centrality by Type (all periods)")
sns.violinplot(x="period", y="centrality", data=df, ax=axes[1])
axes[1].set_title("Centrality by Period")
plt.tight_layout()
plt.show()

# Extra visualization: distributions of centrality per type
plt.figure(figsize=(8,5))
sns.histplot(data=df, x="centrality", hue="type", element="step", stat="density", common_norm=False)
plt.title("Centrality Distributions by Type")
plt.tight_layout()
plt.show()


# ----------------------------------------------------------
# 5. Non-parametric group comparison
# Kruskal–Wallis across types (only types with enough data)

# 5.1 Find valid types
valid_types = df.groupby("type")["centrality"].count()
valid_types = valid_types[valid_types > 1].index.tolist()

print("\nTypes with enough centrality data:", valid_types)

# 5.2 Kruskal-Wallis test
kw_groups = [df.loc[df["type"] == t, "centrality"] for t in valid_types]
kw_stat, kw_p = stats.kruskal(*kw_groups)
print(f"\nKruskal-Wallis H={kw_stat:.3f}, p={kw_p:.4g}")

# 5.3 Post-hoc Mann-Whitney (only pairs with valid data)
pairs, pvals = [], []
for i, t1 in enumerate(valid_types):
    for t2 in valid_types[i+1:]:
        group1 = df.loc[df["type"] == t1, "centrality"]
        group2 = df.loc[df["type"] == t2, "centrality"]
        if group1.empty or group2.empty:
            continue  # skip invalid groups
        u, p = stats.mannwhitneyu(group1, group2, alternative="two-sided")
        pairs.append(f"{t1} vs {t2}")
        pvals.append(p)

# 5.4 Correct for multiple testing
if pairs:
    _, pvals_corr, _, _ = multipletests(pvals, method="holm")
    posthoc = pd.DataFrame({"pair": pairs, "p_corrected": pvals_corr})
    print("\nPost-hoc Dunn (Holm-adjusted):")
    print(posthoc.sort_values("p_corrected"))
else:
    print("\nNot enough valid pairs for post-hoc tests.")


# ----------------------------------------------------------
# 6. Spearman rank-correlation
rho, rho_p = stats.spearmanr(df["centrality"], df["type_ord"])
print(f"\nSpearman ρ={rho:.3f}, p={rho_p:.4g}")

# ----------------------------------------------------------
# 7. Binary logistic regression: stable (1) vs other (0)
df["is_stable"] = (df["type"] == "stable").astype(int)
logit_model = smf.logit("is_stable ~ centrality + C(period)",
                        data=df).fit()
print(logit_model.summary())

# ----------------------------------------------------------
# 8. ROC curve & optimal threshold
y_true = df["is_stable"].values
y_score = logit_model.predict(df)
fpr, tpr, thr = roc_curve(y_true, y_score)
print("AUC =", auc(fpr, tpr))

plt.figure(figsize=(4, 4))
plt.plot(fpr, tpr, lw=1.5)
plt.plot([0, 1], [0, 1], linestyle="--")
plt.xlabel("False-positive rate")
plt.ylabel("True-positive rate")
plt.title("Logit: Centrality → Stable ROC")
plt.tight_layout(); plt.show()

# ----------------------------------------------------------
# 9. Multinomial logit treating the four categories separately
#    (Reference = 'outgoing')
df["type_cat"] = pd.Categorical(df["type"], categories=type_order, ordered=False)
# Multinomial logit treating type_ord as target
multi = smf.mnlogit("type_ord ~ centrality + C(period)", data=df).fit()
print(multi.summary())

# ----------------------------------------------------------
# 10. Optional: Ordinal logit  (proportional-odds / Cumulative link)
# from mord import LogisticIT                # scikit-mord or statsmodels.miscmodels.ordinal_model
# mod_ord = smf.ologit("type_ord ~ centrality + C(period)", data=df).fit()

# ----------------------------------------------------------
# 11. Effect size: Cliff’s δ (stable vs not stable)

def cliffs_delta(a, b):
    n, m = len(a), len(b)
    greater = sum(ai > bj for ai in a for bj in b)
    smaller = sum(ai < bj for ai in a for bj in b)
    return (greater - smaller) / (n * m)

delta = cliffs_delta(df.loc[df["is_stable"] == 1, "centrality"],
                     df.loc[df["is_stable"] == 0, "centrality"])
print(f"\nCliff’s δ (stable vs rest) = {delta:.3f}")

# ----------------------------------------------------------
# 12. Save cleaned & encoded data (optional)
df.to_csv("facebook_centrality_combined_clean.csv", index=False)
print("\nAnalysis complete. Clean data saved → facebook_centrality_combined_clean.csv")
