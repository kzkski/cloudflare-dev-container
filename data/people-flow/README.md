# 仙台市 人流センサー サンプルデータ

Codespace / ローカル環境ですぐ使える、仙台市中心部の BLE 人流センサー観測データです。

## ファイル一覧

| ファイル | 内容 | 期間 / 件数（目安） | サイズ |
|----------|------|---------------------|--------|
| `people-flow-2025.csv` | 時間帯別の人流観測値（2025年） | 2025-01-01 〜 2025-12-31 / 約 18.5 万行 | 約 22 MB |
| `people-flow-2026.csv` | 時間帯別の人流観測値（2026年） | 2026-01-01 〜 2026-05-27 / 約 5.3 万行 | 約 6 MB |
| `people-flow-sensor.csv` | センサー位置マスタ（28 地点） | — | 約 2.5 KB |

## スキーマ

### 観測データ（`people-flow-2025.csv` / `people-flow-2026.csv`）

| 列名 | 説明 |
|------|------|
| `dateObservedFrom` | 観測開始時刻（ISO 8601、`+09:00`） |
| `peopleCount` | 人流カウント |
| `peopleOccupancy` | 滞在・占有に関する値 |
| `peopleCount_flow_from_*` / `peopleCount_flow_to_*` | 方角別の流入・流出 |
| `identifcation` | センサー ID（※元データのスペルのまま） |
| `holidayFlg` | 休日フラグ（`1` = 休日） |

### センサーマスタ（`people-flow-sensor.csv`）

| 列名 | 説明 |
|------|------|
| `identifcation` | センサー ID（観測データと結合するキー） |
| `locationName` | 設置場所名 |
| `latitude` / `longitude` | 緯度・経度 |

センサー ID の例: `jp.sendai.Blesensor.per3600.1`（ハピナ名掛丁商店街・東）

## 使い方

リポジトリルートからの相対パス:

```text
data/people-flow/people-flow-2025.csv
data/people-flow/people-flow-2026.csv
data/people-flow/people-flow-sensor.csv
```

観測データとセンサー位置を結合する例（Python）:

```python
import pandas as pd

flow = pd.read_csv("data/people-flow/people-flow-2025.csv")
sensors = pd.read_csv("data/people-flow/people-flow-sensor.csv")
merged = flow.merge(sensors, on="identifcation", how="left")
```

OpenCode などエージェントへの指示例:

```text
data/people-flow/ の人流 CSV を読み、センサー位置と結合して定禅寺通の休日・平日の平均 peopleCount を比較して。
```
