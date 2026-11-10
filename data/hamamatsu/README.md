# 浜松市 避難所・雨量観測所 サンプルデータ

Codespace / ローカル環境ですぐ使える、浜松市の避難所一覧と雨量観測所の観測データです。地図表示（避難所マップ・雨量マップなど）の試作に利用できます。

## ファイル一覧

| ファイル | 内容 | 件数（目安） | サイズ |
|----------|------|--------------|--------|
| `shelters_hamamatsu.csv` | 避難所一覧（位置・収容可能人員・施設面積など） | 182 件 | 約 50 KB |
| `rain_hamamatsu.csv` | 雨量観測所ごとの降水量（観測時点のスナップショット） | 23 地点 | 約 3 KB |

## スキーマ

### 避難所（`shelters_hamamatsu.csv`）

| 列名 | 説明 |
|------|------|
| `都道府県コード又は市区町村コード` | 自治体コード（浜松市: `221390`） |
| `NO` / `管理NO` | 連番・管理番号 |
| `都道府県名` / `市区町村名` / `区` | 所在自治体（区: 中央区・浜名区・天竜区） |
| `避難所No` / `避難所名称` | 避難所の番号・名称 |
| `所在地` / `電話1` / `電話1備考` | 住所・電話番号 |
| `避難所運営協力自主防災組織` | 運営に協力する自主防災組織（対象町名） |
| `開放区` | 開放する施設区画（体育館・格技場など） |
| `敷地面積_m2` / `保有教室等の総面積_m2` | 敷地・教室等の面積 |
| `救護所` | 救護所の有無 |
| `運動場面積_m2` / `運動場面積_備考` | 運動場の面積・備考 |
| `体育館面積_m2` / `格技場面積_m2` | 体育館・格技場の面積 |
| `収容可能人員（屋内）` | 屋内の収容可能人数 |
| `緯度` / `経度` | 位置（10進数の緯度・経度） |

### 雨量観測所（`rain_hamamatsu.csv`）

| 列名 | 説明 |
|------|------|
| `id` | 観測所 ID（例: `RainfallObservatory:Hamamatsu:Nakaku`） |
| `name` | 観測所名（例: `浜松（中区）`） |
| `latitude` / `longitude` | 緯度・経度 |
| `dateObserved` | 観測時刻（ISO 8601、UTC） |
| `precipitation_10m` | 直近 10 分間の降水量 |
| `precipitation_60m` | 直近 60 分間の降水量 |

## 注意事項

- `rain_hamamatsu.csv` は **BOM 付き UTF-8** です。Python（pandas）で読む場合は `encoding="utf-8-sig"` を指定してください。
- `shelters_hamamatsu.csv` の文字コードは UTF-8 です。
- 雨量データは特定時点のスナップショットで、時系列データではありません。降水量の単位は元データに明記がないため、利用前に提供元で確認してください。

## 使い方

リポジトリルートからの相対パス:

```text
data/hamamatsu/shelters_hamamatsu.csv
data/hamamatsu/rain_hamamatsu.csv
```

読み込み例（Python）:

```python
import pandas as pd

shelters = pd.read_csv("data/hamamatsu/shelters_hamamatsu.csv")
rain = pd.read_csv("data/hamamatsu/rain_hamamatsu.csv", encoding="utf-8-sig")

# 緯度・経度を使った地図表示（国土地理院タイル + Leaflet など）に利用できます
print(shelters[["避難所名称", "緯度", "経度"]].head())
print(rain[["name", "latitude", "longitude", "precipitation_60m"]].head())
```

OpenCode などエージェントへの指示例:

```text
data/hamamatsu/ の避難所 CSV と雨量 CSV を読み、国土地理院の地図タイル上に避難所と雨量観測所をプロットする Web ページを作って。
```
