# LUNAGS Management System 実装設計書（Antigravity IDE向け最終版）

## 目的

ExcelをWebアプリへ再設計する。
PDFの「Webアプリ化設計書」（D:\Programming\Excel_HTML再現設計_開始版.pdf）およびなぎささんのご要望に基づき、`frontend/public/Home_page` にフロントエンドで動作するインタラクティブなWebアプリケーションを構築します。
各画面を個別のHTMLファイル（共通の枠組み・サイドバーを持つ）として作成し、CSSは共通の `home.css` で一元管理、JavaScriptは各HTMLファイル内に直接記述します。また、`firebase-config.js` を通じて Firebase (Firestore) にデータを保存し、各画面間でリアルタイムにデータ連携を行います。

## 作業場所

`D:\Programming\LUNAGS-management-system\frontend\public\Home_page`

## ルール

-   HTMLはhome.html, calendar.html, posts.html, tasks.html,
    statistics.html, settings.html
-   JavaScriptは各HTMLへ
    ```{=html}
    <script type="module">
    ```
    で直接記述
-   CSSは共通ファイル1つのみ
-   画像は`frontend/public/images`を使用
-   ロゴはlogo_LUNAGS.pngを使用
-   reset.cssを使用してからそのほかのSCCを使う
-   言語は日本語を使用

## ユーザー確認事項

**デザインテーマ（青色基調・黒NG）**:
　- アプリケーション全体を洗練された**青色（ロイヤルブルー、コバルトブルー、スカイブルーなど）**を基調とします。背景色やテキストに真っ黒（`#000000`）は使用せず、深みのあるダークブルー、チャコールグレー、あるいは明るく清潔感のあるスノーホワイトやペールブルーをベースにした高級感あるテーマを採用します。
**絵文字禁止**:
　- アプリケーション内での絵文字（🏠、📅、🔔など）の使用は一切禁止します。
　- ナビゲーションのアイコンや通知のベルマークなどは、すべてCSSで図形を組み合わせて作成するか、SVGをインラインで埋め込んでCSSで美しくスタイリングします。
**画面構成 (4ページ)**:
　- `home.html` (ダッシュボード / ホーム): 今日の予定、今日の達成率、予定の検索機能を搭載します。
　- `calendar.html` (カレンダー): Googleカレンダー風に「月・週・日・年」を切り替え可能で、クリックした日の予定を確認できるビューを構築します。
　- `posts.html` (ポスト / 投稿予定): 投稿スケジュールの管理を行います（カレンダーと連動）。
　- `tasks.html` (タスク): メンバーの課題・タスク管理を行います（カレンダーと連動）。
**画面遷移の連携 (ログイン・マイページとの接続)**:
　- `Login_page/login.html` でログイン後、マイページ `My_page/profile.html` に遷移します。
　- マイページの左サイドバーメニューに「LUNAGS管理ホーム」のリンクを追加し、そこから `Home_page/home.html` に移動できるようにします。
　- `Home_page` 内の全ページの共通サイドバーに「マイページ」へのナビゲーションリンクを追加し、いつでも `My_page/profile.html` に戻れるようにします。
**メンション＆通知機能 (通知センター)**:
　- 新規予定（ポストやタスク）を作成する際、担当者を選択する、または予定タイトルや詳細に `@名前` を含めることで、対象ユーザーにメンションを送れるようにします。
　- Firestore に `notifications` コレクションを新しく定義し、メンションや予定作成の通知を管理します。
　- すべての画面ヘッダーに **通知バッジ付きのベルアイコン（CSS/SVGで作成）** を設置し、リアルタイム（`onSnapshot`）で自分宛ての通知が届くと、トースト通知（ポップアップ）と通知ドロップダウンで知らせます。
**データ連携と永続化**:
　- `firebase-config.js` から Firestore 接続（`db`）をインポートし、`posts`, `tasks`, `notifications` コレクションを使用します。
　- ネットワークエラーやオフライン時は、自動的に `localStorage` およびダミーデータにフォールバックして動作が継続するようにします。

## 提案する変更

以下の6つのファイルを新規作成または編集します。

---

### [Login / My_page コンポーネント]

#### [MODIFY] [profile.html](file:///d:/Programming/LUNAGS-management-system/frontend/public/My_page/profile.html)
- 左サイドバーのメニュー一覧に、「管理ホーム」リンク（`../Home_page/home.html`）を追加します。これによりマイページから管理システムへ遷移できるようになります。

---

### [Home_page コンポーネント]

#### [MODIFY] [home.html](file:///d:/Programming/LUNAGS-management-system/frontend/public/Home_page/home.html)
- **ダッシュボード（ホーム）画面**。
- 今日の予定リスト（カレンダーの予定、ポストの投稿予定を統合して本日分を抽出）を表示。
- 今日の達成率（「完了」済みの予定 / 本日の総予定数）を、美しいサークル状のプログレスバー等でビジュアル表示。
- **予定検索機能**: 全期間のポスト・タスクから、タイトルや担当者名で瞬時に串刺し検索できる検索窓と結果リスト。
- **通知受信 & トースト表示**: リアルタイムで届いた通知を画面右下にトースト表示します。

#### [NEW] [calendar.html](file:///d:/Programming/LUNAGS-management-system/frontend/public/Home_page/calendar.html)
- **カレンダー画面**。
- ヘッダーで「月」「週」「日」「年」表示をボタンで切り替え。
- 各ビュー内に、該当する日付の「ポスト（投稿）」と「タスク」をカラーバッジで表示。
- 日付や予定をクリックすると、詳細がポップアップ（モーダル）で表示され、その場で予定の確認・簡易編集（完了トグル、サムネトグルなど）ができるインタラクション。

#### [NEW] [posts.html](file:///d:/Programming/LUNAGS-management-system/frontend/public/Home_page/posts.html)
- **ポスト（投稿予定）画面**。
- 投稿予定リスト（日付、配信時間、担当者、タイトル、完了フラグ、サムネ完了フラグ）のグリッドテーブル。
- 予定の新規追加用フォーム（担当者選択、メンション宛先）。保存したデータは即座に `calendar.html` や `home.html` に反映され、担当者宛てに通知ドキュメントが追加されます。

#### [NEW] [tasks.html](file:///d:/Programming/LUNAGS-management-system/frontend/public/Home_page/tasks.html)
- **タスク（課題）画面**。
- メンバーごとの課題・やることリスト。追加ボタンで可変行に対応。
- 期限日（日付）と担当者を設定可能にし、期限日に基づいてカレンダーやダッシュボードに反映されるようにします。追加時に自動通知を行います。

#### [NEW] [home.css](file:///d:/Programming/LUNAGS-management-system/frontend/public/Home_page/home.css)
- **青色基調のデザインシステム**。
- プライマリーカラーとして鮮やかでプレミアムなブルーを使用し、黒は一切排除します。
- Googleカレンダー風のグリッドレイアウト（月表示のグリッド、週・日表示の時間軸など）。
- 通知ベル、通知ドロップダウンリスト、トーストポップアップ、モーダルポップアップのスタイル。
- アイコン類（ホーム、カレンダー、リスト、ベル、マイページなど）はすべてCSS（ボーダーや変形など）またはSVGで美しく作成し、絵文字は一切使用しません。

---

## システム

Dashboard / Calendar / Posts / Tasks / Statistics / Settings

## Firestore

users, posts, tasks, notifications

## 実装順序

共通→Sidebar→Dashboard→Calendar→Posts→Tasks→Statistics→Settings→Firestore→Notification→検索

## 最重要

Excelの見た目ではなくデータ構造のみ参考にし、LUNAGSブランドの管理画面として再設計する。
