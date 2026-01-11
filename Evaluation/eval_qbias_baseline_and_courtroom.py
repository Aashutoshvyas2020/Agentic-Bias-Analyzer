# eval_qbias_baseline_and_courtroom.py
# Full-article evaluation on Qbias (AllSides balanced news) with:
# 1) Local HF baseline model (political leaning: left/center/right)
# 2) Optional: your courtroom API (biased/neutral) -> binary proxy vs Qbias labels
#
# Install:
#   pip install -U transformers torch pandas scikit-learn tqdm requests
#
# Run baseline only (FREE):
#   python eval_qbias_baseline_and_courtroom.py --n 100
#
# Run baseline + your API (COSTS API CALLS; cached):
#   python eval_qbias_baseline_and_courtroom.py --n 100 --courtroom --courtroom_url https://news-bias-analyzer.onrender.com/analyze
#
# Notes:
# - Qbias label is left/center/right (bias_rating). We evaluate:
#   - 3-class for baseline model
#   - binary proxy: center=neutral(0), left/right=biased(1) for both baseline and your API
# - Your API returns judge.winner in {"biased","neutral"} (expected).

import argparse
import json
import os
import random
import time
from typing import Dict, List, Tuple

import pandas as pd
import requests
import torch
from tqdm import tqdm
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score, f1_score

from transformers import AutoTokenizer, AutoModelForSequenceClassification


QBIAS_CSV_RAW = "https://raw.githubusercontent.com/irgroup/Qbias/main/allsides_balanced_news_headlines-texts.csv"
CANON = ["left", "center", "right"]


def norm_label(x: str) -> str:
    s = str(x).strip().lower()
    if s.startswith("left"):
        return "left"
    if s.startswith("right"):
        return "right"
    if s.startswith("center") or s.startswith("centre") or s == "neutral":
        return "center"
    return s


def load_qbias(url: str = QBIAS_CSV_RAW) -> pd.DataFrame:
    df = pd.read_csv(url)

    # This matches what you showed:
    # ['Unnamed: 0', 'title', 'tags', 'heading', 'source', 'text', 'bias_rating']
    required = {"title", "text", "bias_rating"}
    missing = required - set(df.columns)
    if missing:
        raise RuntimeError(f"Qbias CSV missing columns: {missing}. Found: {df.columns.tolist()}")

    df = df[["title", "text", "bias_rating"]].copy()
    df.rename(columns={"bias_rating": "label"}, inplace=True)

    df["label"] = df["label"].apply(norm_label)
    df = df[df["label"].isin(CANON)].reset_index(drop=True)

    df["title"] = df["title"].fillna("").astype(str)
    df["text"] = df["text"].fillna("").astype(str)

    # Keep title separate for courtroom (headline), but also build a merged field for baselines
    df["merged_text"] = (df["title"] + "\n\n" + df["text"]).str.strip()
    df = df[df["merged_text"].str.len() > 0].reset_index(drop=True)

    return df


def balanced_sample_exact(df: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    rng = random.Random(seed)

    # Ensure each class has enough
    counts = {lab: (df["label"] == lab).sum() for lab in CANON}
    min_avail = min(counts.values())
    if min_avail == 0:
        raise RuntimeError(f"Missing at least one class in data. Counts: {counts}")

    # Balanced base
    per = n // 3
    remainder = n - per * 3

    # Distribute remainder randomly across classes
    extra_classes = CANON.copy()
    rng.shuffle(extra_classes)
    extra = {lab: 0 for lab in CANON}
    for i in range(remainder):
        extra[extra_classes[i]] += 1

    parts = []
    for lab in CANON:
        need = per + extra[lab]
        sub = df[df["label"] == lab]
        if len(sub) < need:
            raise RuntimeError(f"Not enough samples for {lab}. Need {need}, have {len(sub)}.")
        parts.append(sub.sample(n=need, random_state=seed))

    out = pd.concat(parts, ignore_index=True).sample(frac=1.0, random_state=seed).reset_index(drop=True)
    if len(out) != n:
        raise RuntimeError(f"Sampling bug: expected {n}, got {len(out)}")
    return out


def to_binary(labels: List[str]) -> List[int]:
    # center=neutral(0), left/right=biased(1)
    return [0 if lab == "center" else 1 for lab in labels]


def clip_text(s: str, max_chars: int) -> str:
    s = "" if s is None else str(s)
    if max_chars and len(s) > max_chars:
        return s[:max_chars]
    return s


@torch.no_grad()
def predict_hf_model(
    model_id: str,
    tokenizer_id: str,
    texts: List[str],
    device: torch.device,
    max_len: int = 512,
    batch_size: int = 8,
) -> Tuple[List[str], List[float]]:
    tok = AutoTokenizer.from_pretrained(tokenizer_id)
    model = AutoModelForSequenceClassification.from_pretrained(model_id)
    model.to(device)
    model.eval()

    # For matous-volf/political-leaning-politics: 0=left, 1=center, 2=right
    idx2lab = {0: "left", 1: "center", 2: "right"}

    preds, confs = [], []
    for i in tqdm(range(0, len(texts), batch_size), desc=f"HF {model_id}", leave=False):
        batch = texts[i:i + batch_size]
        enc = tok(batch, truncation=True, max_length=max_len, padding=True, return_tensors="pt").to(device)

        logits = model(**enc).logits
        probs = torch.softmax(logits, dim=-1)
        best = torch.argmax(probs, dim=-1)

        for j in range(best.shape[0]):
            idx = int(best[j].item())
            preds.append(idx2lab.get(idx, "center"))
            confs.append(float(probs[j, idx].item()))

    return preds, confs


def load_cache(path: str) -> Dict[str, Dict]:
    if not path or not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def save_cache(path: str, cache: Dict[str, Dict]) -> None:
    if not path:
        return
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(cache, f, ensure_ascii=False, indent=2)
    os.replace(tmp, path)


def courtroom_predict_binary(
    courtroom_url: str,
    headlines: List[str],
    bodies: List[str],
    max_chars: int,
    sleep_s: float,
    cache_path: str,
) -> Tuple[List[int], List[int]]:
    """
    Returns: (y_pred_binary, used_cache_flags)
      y_pred_binary: 0 neutral, 1 biased
      used_cache_flags: 1 if from cache else 0
    """
    cache = load_cache(cache_path)
    preds = []
    used_cache = []

    for idx, (h, b) in enumerate(tqdm(list(zip(headlines, bodies)), desc="Courtroom API", leave=False)):
        key = f"{hash(h)}_{hash(b[:500])}"  # cheap stable-ish key
        if key in cache:
            verdict = cache[key]["verdict"]
            used_cache.append(1)
        else:
            payload = {
                "headline": clip_text(h, 300),
                "article": clip_text(b, max_chars),
            }
            r = requests.post(courtroom_url, json=payload, timeout=120)
            try:
                data = r.json()
            except Exception:
                raise RuntimeError(f"Non-JSON response from courtroom (status {r.status_code}): {r.text[:300]}")

            if r.status_code >= 400:
                raise RuntimeError(f"Courtroom error {r.status_code}: {data}")

            verdict = (data.get("judge", {}) or {}).get("winner", "")
            if verdict not in ("biased", "neutral"):
                raise RuntimeError(f"Unexpected courtroom judge.winner: {verdict}. Full: {data}")

            cache[key] = {"verdict": verdict, "ts": time.time()}
            save_cache(cache_path, cache)
            used_cache.append(0)

            if sleep_s:
                time.sleep(sleep_s)

        preds.append(1 if verdict == "biased" else 0)

    return preds, used_cache


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=100, help="Number of articles to evaluate (exact).")
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--batch_size", type=int, default=8)
    ap.add_argument("--max_chars", type=int, default=8000, help="Max chars sent to your API to avoid huge prompts.")
    ap.add_argument("--courtroom", action="store_true", help="Run your /analyze endpoint (costs money).")
    ap.add_argument("--courtroom_url", type=str, default="https://news-bias-analyzer.onrender.com/analyze")
    ap.add_argument("--sleep", type=float, default=1.5, help="Seconds between API calls (rate-limit safety).")
    ap.add_argument("--cache", type=str, default="courtroom_cache.json", help="Cache file to avoid paying twice.")
    args = ap.parse_args()

    df = load_qbias()
    sample = balanced_sample_exact(df, args.n, args.seed)

    # Gold labels
    y_true_3 = sample["label"].tolist()
    y_true_bin = to_binary(y_true_3)

    # Inputs
    headlines = sample["title"].tolist()
    bodies = sample["text"].tolist()
    merged = sample["merged_text"].tolist()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Loaded {len(sample)} articles. Device: {device}")

    # ---- Baseline HF model (LOCAL, free after download) ----
    baseline_model = "matous-volf/political-leaning-politics"
    baseline_tokenizer = "launch/POLITICS"  # this is the base tokenizer for the model

    y_pred_3, conf = predict_hf_model(
        baseline_model,
        baseline_tokenizer,
        merged,
        device=device,
        batch_size=args.batch_size,
    )

    print("\n" + "=" * 80)
    print(baseline_model)
    print("- 3-class (left/center/right)")
    print(classification_report(y_true_3, y_pred_3, labels=CANON, digits=3))
    print("Confusion matrix [left, center, right]:")
    print(confusion_matrix(y_true_3, y_pred_3, labels=CANON))

    y_pred_bin = to_binary(y_pred_3)
    acc = accuracy_score(y_true_bin, y_pred_bin)
    f1 = f1_score(y_true_bin, y_pred_bin)
    print("- binary proxy (center=neutral vs left/right=biased)")
    print(f"accuracy={acc:.3f}  f1={f1:.3f}")

    # ---- Optional: Your courtroom API (costly; cached) ----
    if args.courtroom:
        print("\n" + "=" * 80)
        print("YOUR COURTROOM API")
        print(f"URL: {args.courtroom_url}")
        print(f"Cache: {args.cache} (delete it if you want to pay again)")

        y_api_bin, used_cache = courtroom_predict_binary(
            args.courtroom_url, headlines, bodies,
            max_chars=args.max_chars,
            sleep_s=args.sleep,
            cache_path=args.cache,
        )

        api_acc = accuracy_score(y_true_bin, y_api_bin)
        api_f1 = f1_score(y_true_bin, y_api_bin)
        print("- binary proxy vs Qbias")
        print(f"accuracy={api_acc:.3f}  f1={api_f1:.3f}")
        print(f"cache hits: {sum(used_cache)}/{len(used_cache)}")

        # quick error counts
        fp = sum(1 for t, p in zip(y_true_bin, y_api_bin) if t == 0 and p == 1)  # predicted biased but gold center
        fn = sum(1 for t, p in zip(y_true_bin, y_api_bin) if t == 1 and p == 0)  # predicted neutral but gold L/R
        print(f"false positives (center -> biased): {fp}")
        print(f"false negatives (L/R -> neutral): {fn}")

    else:
        print("\n(Courtroom API skipped — add --courtroom to run it and spend API calls.)")


if __name__ == "__main__":
    main()
