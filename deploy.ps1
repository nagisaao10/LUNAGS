# LUNAGS Deploy Script
# Git add/commit/push -> Firebase deploy
# 実行: .\deploy.ps1

$ErrorActionPreference = "Stop"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host " LUNAGS Deploy System" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan

# LUNAGSルートから実行することを保証
$repoRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $repoRoot

Write-Host ""
Write-Host "Repository: $repoRoot"

# Gitリポジトリ確認
if (-not (Test-Path ".git")) {
    throw "Gitリポジトリではありません。"
}

# Firebase設定確認
if (-not (Test-Path "firebase.json")) {
    throw "firebase.json が見つかりません。"
}

if (-not (Test-Path ".firebaserc")) {
    throw ".firebaserc が見つかりません。"
}

# Firebase Deploy実行関数
function Invoke-FirebaseDeploy {
    param (
        [string]$Target,
        [string]$Project
    )

    Write-Host ""
    Write-Host "Firebase Deploy: $Target" -ForegroundColor Cyan

    & firebase deploy --only $Target --project $Project
    $exitCode = $LASTEXITCODE

    if ($exitCode -ne 0) {
        throw "Firebase $Target Deployに失敗しました。終了コード: $exitCode"
    }

    Write-Host ""
    Write-Host "Firebase $Target Deploy 完了" -ForegroundColor Green
}

# Gitの変更確認
Write-Host ""
Write-Host "[1/5] Git変更を確認" -ForegroundColor Cyan
git status --short

$status = git status --porcelain

if (-not $status) {
    Write-Host ""
    Write-Host "Gitにコミットする変更がありません。" -ForegroundColor Yellow
    Write-Host "Firebase Deployだけ実行することもできます。"

    $deployOnly = Read-Host "Deployだけ実行しますか？ (Y/N)"

    if ($deployOnly -notmatch "^[Yy]$") {
        Write-Host "処理を中止しました。" -ForegroundColor Yellow
        exit 0
    }
}
else {
    Write-Host ""
    $commitMessage = Read-Host "Commit message"

    if ([string]::IsNullOrWhiteSpace($commitMessage)) {
        throw "Commit messageが空です。"
    }

    Write-Host ""
    Write-Host "[2/5] Git add" -ForegroundColor Cyan
    git add .

    if ($LASTEXITCODE -ne 0) {
        throw "Git addに失敗しました。"
    }

    Write-Host ""
    Write-Host "[3/5] Git commit" -ForegroundColor Cyan
    git commit -m $commitMessage

    if ($LASTEXITCODE -ne 0) {
        throw "Git commitに失敗しました。"
    }

    Write-Host ""
    Write-Host "[4/5] Git push" -ForegroundColor Cyan
    git push

    if ($LASTEXITCODE -ne 0) {
        throw "Git pushに失敗しました。"
    }
}

# Firebaseプロジェクト選択
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Firebase Deploy Target" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "[1] Development  (lunags-development)" -ForegroundColor Yellow
Write-Host "[2] Production   (lunags-production)" -ForegroundColor Red
Write-Host "[0] Cancel"

$target = Read-Host "Deploy target"

switch ($target) {
    "1" {
        $project = "lunags-development"
    }

    "2" {
        $project = "lunags-production"

        Write-Host ""
        Write-Host "WARNING: ProductionへDeployします。" -ForegroundColor Red
        $confirm = Read-Host "本当にProductionへDeployしますか？ (YES)"

        if ($confirm -cne "YES") {
            Write-Host "Production Deployを中止しました。" -ForegroundColor Yellow
            exit 0
        }
    }

    "0" {
        Write-Host "Deployを中止しました。" -ForegroundColor Yellow
        exit 0
    }

    default {
        throw "無効な選択です。"
    }
}

# Firebase Deploy対象選択
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Firebase Deploy Type" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "[1] Hosting"
Write-Host "[2] Functions"
Write-Host "[3] 全体 (Hosting + Functions)"
Write-Host "[0] Cancel"

$deployType = Read-Host "Deploy type"

switch ($deployType) {
    "1" {
        Invoke-FirebaseDeploy -Target "hosting" -Project $project
    }

    "2" {
        $env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"

        Write-Host ""
        Write-Host "Functions Discovery Timeout: 120 seconds" -ForegroundColor DarkGray

        Invoke-FirebaseDeploy -Target "functions" -Project $project
    }

    "3" {
        Invoke-FirebaseDeploy -Target "hosting" -Project $project

        $env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"

        Write-Host ""
        Write-Host "Functions Discovery Timeout: 120 seconds" -ForegroundColor DarkGray

        Invoke-FirebaseDeploy -Target "functions" -Project $project
    }

    "0" {
        Write-Host "Deployを中止しました。" -ForegroundColor Yellow
        exit 0
    }

    default {
        throw "無効な選択です。"
    }
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host " Deploy Complete" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""

Write-Host "Git:      完了"
Write-Host "Firebase: 完了"
Write-Host "Project:  $project"
Write-Host "Target:   $deployType"
Write-Host ""

Write-Host "Production URL / Development URLをブラウザで確認してください。" -ForegroundColor Yellow