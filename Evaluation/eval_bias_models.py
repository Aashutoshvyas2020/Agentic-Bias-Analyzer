# eval_bias_models.py
# Benchmarks political-leaning (Left/Center/Right) models on full-article datasets.
# Binary proxy: Center=neutral, Left/Right=biased.
#
# Usage:
#   pip install -U transformers datasets torch pandas scikit-learn tqdm
#   python eval_bias_models.py --n 100
#
# Notes:
# - Uses Qbias CSV (full article text + leaning labels). :contentReference[oaicite:4]{index=4}
# - Tests:
#   - matous-volf/political-leaning-politics (0=L,1=C,2=R). :contentReference[oaicite:5]{index=5}
#   - peekayitachi/roberta-political-bias (0=L,1=C,2=R). :contentReference[oaicite:6]{index=6}

import argparse
import random
import re
from typing import Dict, List, Tuple

import pandas as pd
import torch
from tqdm import tqdm
from sklearn.metrics import classification_report, confusion_matrix, accuracy_score, f1_score

from transformers import AutoTokenizer, AutoModelForSequenceClassification


QBIAS_CSV_RAW = (
    "https://raw.githubusercontent.com/irgroup/Qbias/main/allsides_balanced_news_headlines-texts.csv"
)

CANON = ["left", "center", "right"]


def norm_label(x: str) -> str:
    if x is None:
        return ""
    s = str(x).strip().lower()
    # handle plural/variants
    if s.startswith("left"):
        return "left"
    if s.startswith("right"):
        return "right"
    if s.startswith("center") or s.startswith("centre") or s == "neutral":
        return "center"
    return s


def pick_col(cols: List[str], candidates: List[str]) -> str:
    lower = {c.lower(): c for c in cols}
    for cand in candidates:
        if cand.lower() in lower:
            return lower[cand.lower()]
    return ""


def load_qbias() -> pd.DataFrame:
    df = pd.read_csv(QBIAS_CSV_RAW)

    # Hardwired column mapping for this dataset
    df = df[["title", "text", "bias_rating"]].copy()
    df.rename(columns={"bias_rating": "label"}, inplace=True)

    df["label"] = df["label"].astype(str).str.lower().str.strip()

    # Normalize
    def norm(x):
        if x.startswith("left"):
            return "left"
        if x.startswith("right"):
            return "right"
        if x.startswith("center") or x.startswith("centre"):
            return "center"
        return x

    df["label"] = df["label"].apply(norm)
    df = df[df["label"].isin(["left", "center", "right"])]

    # Merge title + text for full article input
    df["text"] = (df["title"].fillna("") + "\n\n" + df["text"].fillna("")).str.strip()
    df = df.dropna(subset=["text"]).reset_index(drop=True)

    return df


def balanced_sample(df: pd.DataFrame, n: int, seed: int) -> pd.DataFrame:
    random.seed(seed)
    per = max(1, n // 3)
    parts = []
    for lab in CANON:
        sub = df[df["label"] == lab]
        if len(sub) == 0:
            raise RuntimeError(f"No rows for label={lab}.")
        take = min(per, len(sub))
        parts.append(sub.sample(take, random_state=seed))
    out = pd.concat(parts).sample(frac=1.0, random_state=seed).reset_index(drop=True)
    return out


@torch.no_grad()
def predict_labels(
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

    # Both models we test define 0=left, 1=center, 2=right. :contentReference[oaicite:7]{index=7}
    idx2lab = {0: "left", 1: "center", 2: "right"}

    preds, confs = [], []
    for i in tqdm(range(0, len(texts), batch_size), desc=f"Running {model_id}", leave=False):
        batch = texts[i:i + batch_size]
        enc = tok(
            batch,
            truncation=True,
            max_length=max_len,
            padding=True,
            return_tensors="pt"
        ).to(device)

        logits = model(**enc).logits
        probs = torch.softmax(logits, dim=-1)
        best = torch.argmax(probs, dim=-1)

        for j in range(best.shape[0]):
            idx = int(best[j].item())
            preds.append(idx2lab.get(idx, "center"))
            confs.append(float(probs[j, idx].item()))

    return preds, confs


def to_binary(y: List[str]) -> List[int]:
    # proxy: Center=neutral(0), Left/Right=biased(1)
    return [0 if lab == "center" else 1 for lab in y]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=100)
    ap.add_argument("--seed", type=int, default=42)
    args = ap.parse_args()

    df = load_qbias()
    sample = balanced_sample(df, args.n, args.seed)

    texts = sample["text"].tolist()
    y_true = sample["label"].tolist()

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print(f"Loaded {len(sample)} articles. Device: {device}")

    models = [
        # model_id, tokenizer_id
        ("matous-volf/political-leaning-politics", "launch/POLITICS"),   # :contentReference[oaicite:8]{index=8}
        ("peekayitachi/roberta-political-bias", "peekayitachi/roberta-political-bias"),  # :contentReference[oaicite:9]{index=9}
    ]

    for model_id, tok_id in models:
        y_pred, conf = predict_labels(model_id, tok_id, texts, device=device)

        print("\n" + "=" * 80)
        print(model_id)
        print("- 3-class (left/center/right)")
        print(classification_report(y_true, y_pred, labels=CANON, digits=3))
        print("Confusion matrix [left, center, right]:")
        print(confusion_matrix(y_true, y_pred, labels=CANON))

        # Binary proxy
        yb_true = to_binary(y_true)
        yb_pred = to_binary(y_pred)
        acc = accuracy_score(yb_true, yb_pred)
        f1 = f1_score(yb_true, yb_pred)
        print("- binary proxy (center=neutral vs left/right=biased)")
        print(f"accuracy={acc:.3f}  f1={f1:.3f}")

        # Show a few mistakes
        mistakes = []
        for t, yt, yp, c in zip(texts, y_true, y_pred, conf):
            if yt != yp:
                mistakes.append((yt, yp, c, t[:180].replace("\n", " ")))
            if len(mistakes) >= 5:
                break
        if mistakes:
            print("Sample mistakes (true -> pred, confidence, snippet):")
            for yt, yp, c, snip in mistakes:
                print(f"  {yt} -> {yp}  ({c:.2f})  {snip}...")
        else:
            print("No mistakes in this sample (rare, but possible at n=100).")


if __name__ == "__main__":
    main()
