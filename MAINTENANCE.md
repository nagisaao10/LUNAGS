# LUNAGS 緊急メンテナンス手順

## 目的

Firebase Hosting の公開先をメンテナンス専用ディレクトリに切り替え、通常のHTMLページを公開せず、すべてのHosting URLでメンテナンス画面を表示します。

## 事前条件

- Firebase CLI にログイン済みであること
- リポジトリのルートでコマンドを実行すること
- `.firebaserc` の Hosting target が正しいこと
- 本番環境への操作は影響範囲を確認し、必要な承認を得てから実行すること

## メンテナンスを有効化

開発環境:

```powershell
firebase deploy --config firebase.maintenance.json --only hosting:development
```

本番環境:

```powershell
firebase deploy --config firebase.maintenance.json --only hosting:production
```

この設定では Hosting の公開ディレクトリが `maintenance/` になります。存在しないURLも rewrite により `maintenance/index.html` を表示します。

## 通常公開へ復旧

開発環境:

```powershell
firebase deploy --config firebase.json --only hosting:development
```

本番環境:

```powershell
firebase deploy --config firebase.json --only hosting:production
```

復旧前に、脆弱性の修正・依存パッケージの更新・必要な秘密情報のローテーション・動作確認を完了してください。

## 重要な制約

- これは Firebase Hosting のWebページ公開を切り替える仕組みです。Cloud Functions/API、Firestore、Authentication、Storageを自動停止しません。
- APIに脆弱性がある場合は、バックエンド側にも緊急制限を実施してください。
- メンテナンス画面はブラウザーに表示する案内であり、セキュリティ境界そのものではありません。
- Hostingの切り替えデプロイが完了するまでは、切り替え前の公開内容が配信される可能性があります。
- 復旧時に `firebase.json` を使ってデプロイすると、通常の公開先に戻ります。メンテナンス用設定ファイルは残しておいてください。
