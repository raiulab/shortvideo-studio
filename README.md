# Shortvideo Studio

## 日本語

複数のAIメディアAPIを横断して、画像合成、動画生成、プロバイダー比較、リップシンク、動画延長、ダウンロード、費用上限を管理するローカル優先の制作ツールです。

公開版には再利用可能なアプリケーションだけを収録しています。キャラクター設定、参照画像、生成メディア、リクエスト履歴、費用台帳は実行時データとして扱い、意図的に除外しています。

### 機能

- キャラクターと参照画像の管理
- Seedreamによる画像合成
- Vidu、Runway、Seedance、Veo、Omni、Hedraのアダプター
- 複数プロバイダーへの比較生成
- Text-to-Video、Image-to-Video、開始・終了フレーム、Reference-to-Video
- リップシンクと、対応プロバイダーによる動画延長
- FFmpegを使ったローカル結合と最終フレーム抽出
- 送信前の費用見積もりと1回・1日・月単位の上限
- 削除・キャンセル操作を備えたローカル履歴
- Geminiによる英語動画プロンプト案の作成

プロバイダーの提供状況、モデル名、料金、API仕様は変更されます。各アダプターを使う前に、該当プロバイダーの最新ドキュメントと利用条件を確認してください。

### クイックスタート

Node.js 22以上が必要です。FFmpegとFFprobeは任意ですが、ローカル動画結合と最終フレーム抽出には必要です。

```bash
cp .env.example .env
# 使用するプロバイダーのキーだけを設定
npm run dev
```

<http://127.0.0.1:4173>を開きます。キーが設定されていないプロバイダーは画面上で利用できません。

### テスト

```bash
npm test
```

テストでは外部リクエストをモック化しており、プロバイダーのクレジットを消費しません。

### 実行時データ

次のGit管理外ディレクトリが、ローカルで作成・更新されます。

- `characters/`：非公開のプロフィールと参照画像
- `data/`：生成履歴、予算設定、費用台帳
- `projects/inputs/`：アップロードした開始・終了フレーム
- `projects/compositions/`：合成画像
- `projects/outputs/`：生成動画
- `public/uploads/`：ブラウザ配信用の一時アップロード

これらをコミットしないでください。空のワークスペースから始め、必要な権利を持つ素材だけを追加してください。

### セキュリティと費用制御

- API認証情報はサーバー側の`.env`からのみ読み込みます。
- アップロード容量を制限し、プロバイダーエラーを共通形式に変換します。
- プロバイダーが実額を返さない場合、費用表示は概算です。
- プロバイダーを有効にする前に、保守的な上限を設定してください。
- このアプリは信頼できるローカル環境向けであり、認証付き公開SaaSサーバーではありません。

### ライセンス

コードはMIT Licenseで提供します。プロバイダー名は互換性の説明だけを目的として使用しています。メディア、アップロード素材、生成物、第三者サービスには、それぞれの権利と利用条件が適用されます。

---

## English

A local-first studio for orchestrating image composition, image-to-video generation, provider
comparison, lip sync, extension, download, and cost guardrails across multiple AI media APIs.

This public edition contains only the reusable application. Character profiles, reference images,
generated media, request history, and cost ledgers are runtime data and are intentionally excluded.

## Features

- Character and reference-image management
- Seedream image composition
- Vidu, Runway, Seedance, Veo, Omni, and Hedra adapters
- Side-by-side multi-provider generation
- Text-to-video, image-to-video, start/end frames, and reference-to-video flows
- Lip sync and supported provider-native video extension
- Local concatenation and final-frame extraction with FFmpeg
- Preflight cost estimates and per-request, daily, and monthly limits
- Persistent local history with deletion and cancellation controls
- Gemini-assisted English video prompt ideas

Provider availability, model names, pricing, and API behavior change over time. Review each
provider's current documentation and terms before using the corresponding adapter.

## Quick start

Requirements: Node.js 22 or later. FFmpeg and FFprobe are optional but required for local
concatenation and final-frame extraction.

```bash
cp .env.example .env
# Add only the keys for providers you intend to use.
npm run dev
```

Open <http://127.0.0.1:4173>. Providers without a configured key remain unavailable in the UI.

## Tests

```bash
npm test
```

The tests mock remote requests and do not spend provider credits.

## Runtime data

The following ignored locations are created or populated locally:

- `characters/`: private profiles and reference images
- `data/`: generation history, budget settings, and cost ledgers
- `projects/inputs/`: uploaded start and end frames
- `projects/compositions/`: composed images
- `projects/outputs/`: generated videos
- `public/uploads/`: temporary browser-served uploads

Do not commit these directories. Start with an empty workspace and add only content for which you
hold the required rights.

## Security and cost controls

- API credentials are read only from the server-side `.env` file.
- Uploaded data is size-limited and provider errors are normalized.
- Cost figures are estimates unless a provider returns an actual amount.
- Set conservative limits before enabling a provider.
- Bind the app to a trusted local environment; it is not an authenticated public SaaS server.

## License

Code is licensed under the MIT License. Provider names are used only to describe compatibility.
Media, uploaded assets, generated outputs, and third-party services retain their respective rights
and terms.
