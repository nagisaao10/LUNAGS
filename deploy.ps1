# LUNAGS Deploy Script
# Git add/commit/push -> Firebase deploy
# 実行: .\deploy.ps1

$ErrorActionPreference = "Stop"

function Run-Step {
    param(
        [string]$Title,
        [scriptblock]$Command
    )

    Write-Host ""
    Write-Host "[$Title]" -ForegroundColor Cyan
    & $Command

    if ($LASTEXITCODE -ne 0) {
        throw "処理に失敗しました: $Title"
    }
}

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "          LUNAGS Deploy System" -ForegroundColor Cyan
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
    # Commit message
    Write-Host ""
    $commitMessage = Read-Host "Commit message"

    if ([string]::IsNullOrWhiteSpace($commitMessage)) {
        throw "Commit messageが空です。"
    }

    Run-Step "2/5 Git add" {
        git add .
    }

    Run-Step "3/5 Git commit" {
        git commit -m $commitMessage
    }

    Run-Step "4/5 Git push" {
        git push
    }
}

# Firebaseプロジェクト選択
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan
Write-Host " Firebase Deploy Target" -ForegroundColor Cyan
Write-Host "========================================"
Write-Host "[1] Development  (lunags-development)"
Write-Host "[2] Production   (lunags-production)"
Write-Host "[0] Cancel"

$target = Read-Host "Deploy target"

switch ($target) {
    "1" {
        $project = "lunags-development"
        $environment = "Development"
    }
    "2" {
        $project = "lunags-production"
        $environment = "Production"

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

Write-Host ""
Write-Host "[5/5] Firebase Deploy: $environment ($project)" -ForegroundColor Cyan

firebase deploy --project $project

if ($LASTEXITCODE -ne 0) {
    throw "Firebase Deployに失敗しました。"
}

Write-Host ""
Write-Host "========================================" -ForegroundColor Green
Write-Host "        Deploy Complete" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Git:      完了"
Write-Host "Firebase: 完了"
Write-Host "Project:  $project"
Write-Host ""
Write-Host "本番URL / Development URLをブラウザで確認してください。" -ForegroundColor Yellow
