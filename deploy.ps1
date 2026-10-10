# ========================================
# LUNAGS Deploy System
# Git add / commit / push -> Firebase deploy
# ========================================

$ErrorActionPreference = "Stop"

$script:DeploySucceeded = $false
$script:GitCompleted = $false
$script:DeployCompleted = $false
$script:FailureMessage = $null
$script:Cancelled = $false

function Write-Section {
    param([Parameter(Mandatory = $true)][string]$Title)

    Write-Host ""
    Write-Host "========================================" -ForegroundColor Cyan
    Write-Host " $Title" -ForegroundColor Cyan
    Write-Host "========================================" -ForegroundColor Cyan
}

function Invoke-GitCommand {
    param(
        [Parameter(Mandatory = $true)][string]$Name,
        [Parameter(Mandatory = $true)][scriptblock]$Command
    )

    Write-Host "$Name..." -ForegroundColor Cyan
    & $Command

    if ($LASTEXITCODE -ne 0) {
        throw "$Name に失敗しました。終了コード: $LASTEXITCODE"
    }

    Write-Host "$Name : OK" -ForegroundColor Green
}

function Invoke-FirebaseDeploy {
    param(
        [Parameter(Mandatory = $true)][string]$Target,
        [Parameter(Mandatory = $true)][string]$Project
    )

    Write-Host "Firebase Deploy..." -ForegroundColor Cyan
    Write-Host "Target : $Target" -ForegroundColor DarkGray
    Write-Host "Project: $Project" -ForegroundColor DarkGray

    $deployOutput = @(& firebase deploy --only $Target --project $Project 2>&1)
    $exitCode = $LASTEXITCODE
    $deployOutput | ForEach-Object { Write-Host $_ }

    $deployText = $deployOutput -join "`n"

    if ($exitCode -eq 0 -and $deployText -match "Deploy complete!") {
        Write-Host "Firebase Deploy : OK" -ForegroundColor Green
        $script:DeployCompleted = $true
        return
    }

    throw "Firebase Deploy に失敗しました。終了コード: $exitCode"
}

try {
    # LUNAGSルートから実行することを保証
    $scriptPath = $MyInvocation.MyCommand.Path
    if ([string]::IsNullOrWhiteSpace($scriptPath)) {
        throw "deploy.ps1 のファイルパスを取得できません。ファイルから実行してください。"
    }

    $repoRoot = Split-Path -Parent $scriptPath
    Set-Location $repoRoot

    Write-Section "LUNAGS Deploy System"
    Write-Host "Repository: $repoRoot"

    # 必須ファイル・コマンド確認
    if (-not (Test-Path ".git")) {
        throw "Gitリポジトリではありません。"
    }
    if (-not (Test-Path "firebase.json")) {
        throw "firebase.json が見つかりません。"
    }
    if (-not (Test-Path ".firebaserc")) {
        throw ".firebaserc が見つかりません。"
    }
    if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
        throw "Firebase CLIが見つかりません。"
    }
    if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
        throw "Gitが見つかりません。"
    }

    # ========================================
    # 最初に実行設定をまとめて選択
    # ========================================
    Write-Section "Deploy Configuration"

    # Git設定
    Write-Host "[Git Settings]" -ForegroundColor Cyan
    Write-Host "[1] Git add / commit / push"
    Write-Host "[0] なし（Gitをスキップ）"
    $gitChoice = Read-Host "Git"

    $commitMessage = ""
    switch ($gitChoice) {
        "1" {
            $gitStatusBefore = @(git status --porcelain)
            if ($LASTEXITCODE -ne 0) {
                throw "Git status に失敗しました。"
            }

            if ($gitStatusBefore.Count -eq 0) {
                Write-Host "Gitにコミットする変更はありません。" -ForegroundColor Yellow
                $gitChoice = "0"
            }
            else {
                Write-Host ""
                git status --short
                if ($LASTEXITCODE -ne 0) {
                    throw "Git status --short に失敗しました。"
                }

                $commitMessage = Read-Host "Commit message"
                if ([string]::IsNullOrWhiteSpace($commitMessage)) {
                    throw "Commit messageが空です。"
                }
            }
        }
        "0" {
            Write-Host "Git処理をスキップします。" -ForegroundColor Yellow
        }
        default {
            throw "Git設定の選択が無効です。1または0を選択してください。"
        }
    }

    # 環境設定
    Write-Host ""
    Write-Host "[Environment]" -ForegroundColor Cyan
    Write-Host "[1] Development (lunags / lunags-42343)"
    Write-Host "[2] Production  (lunags / lunags-59cc1)"
    Write-Host "[0] なし（Deployしない）"
    $environmentChoice = Read-Host "Environment"

    if ($environmentChoice -notin @("0", "1", "2")) {
        throw "環境設定の選択が無効です。0、1、2のいずれかを選択してください。"
    }

    # Environmentで0を選んだ場合はDeployなしとして扱い、
    # Deploy Typeの選択を飛ばしてConfiguration Summaryへ進む
    $skipDeployTypeSelection = ($environmentChoice -eq "0")

    $project = "lunags"
    $hostingTarget = $null
    $hostingSite = $null
    $environmentName = $null
    $environmentUrl = $null

    switch ($environmentChoice) {
        "0" {
            $hostingTarget = $null
            $hostingSite = "なし"
            $environmentName = "なし（Deployしない）"
            $environmentUrl = "なし"
        }
        "1" {
            $hostingTarget = "development"
            $hostingSite = "lunags-42343"
            $environmentName = "Development"
            $environmentUrl = "https://dev.lunags.jp"
        }
        "2" {
            $hostingTarget = "production"
            $hostingSite = "lunags-59cc1"
            $environmentName = "Production"
            $environmentUrl = "https://lunags.jp"
        }
    }

    # Environmentで0を選んだ場合はDeploy Typeを表示せずに進む
    $firebaseTarget = $null
    if (-not $skipDeployTypeSelection) {
        Write-Host ""
        Write-Host "[Deploy Type]" -ForegroundColor Cyan
        Write-Host "[1] Hosting"
        Write-Host "[2] Functions"
        Write-Host "[3] Hosting + Functions"
        Write-Host "[4] All（選択環境のHosting + Functions）"
        $deployChoice = Read-Host "Deploy type"

        if ($deployChoice -notin @("1", "2", "3", "4")) {
            throw "Deploy設定の選択が無効です。1～4を選択してください。"
        }

        switch ($deployChoice) {
            "1" { $firebaseTarget = "hosting:$hostingTarget" }
            "2" { $firebaseTarget = "functions" }
            "3" { $firebaseTarget = "hosting:$hostingTarget,functions" }
            "4" { $firebaseTarget = "hosting:$hostingTarget,functions" }
        }
    }
    else {
        $deployChoice = "0"
    }

    # ========================================
    # 設定内容の最終確認
    # ========================================
    Write-Section "Configuration Summary"
    Write-Host "Git         : $(if ($gitChoice -eq '1') { 'Commit / Push' } else { 'なし（スキップ）' })"
    if ($gitChoice -eq "1") {
        Write-Host "Commit msg  : $commitMessage"
    }
    Write-Host "Environment : $environmentName"
    Write-Host "Project     : $project"
    Write-Host "Hosting     : $hostingSite"
    Write-Host "Deploy      : $(if ($null -eq $firebaseTarget) { 'なし（スキップ）' } else { $firebaseTarget })"
    Write-Host "URL         : $environmentUrl"
    Write-Host ""
    Write-Host "[1] OK：この設定で開始" -ForegroundColor Green
    Write-Host "[0] 終了：実行せずに終了" -ForegroundColor Yellow

    $start = Read-Host "実行しますか？"
    if ($start -eq "0") {
        $script:Cancelled = $true
        Write-Host "処理を開始せず終了します。" -ForegroundColor Yellow
    }
    elseif ($start -ne "1") {
        throw "確認の入力が無効です。1で開始、0で終了してください。"
    }

    # Productionの追加確認
    if (-not $script:Cancelled -and $environmentName -eq "Production" -and $null -ne $firebaseTarget) {
        Write-Host ""
        Write-Host "WARNING: ProductionへDeployします。" -ForegroundColor Red
        Write-Host "Hosting: $hostingSite" -ForegroundColor Yellow
        Write-Host "URL: $environmentUrl" -ForegroundColor Yellow

        $confirm = Read-Host "本当にProductionへDeployしますか？ (YES)"
        if ($confirm -cne "YES") {
            $script:Cancelled = $true
            Write-Host "Production Deployを中止しました。" -ForegroundColor Yellow
        }
    }

    # ========================================
    # 選択確定後に処理を実行
    # ========================================
    if (-not $script:Cancelled) {
        # Git処理
        if ($gitChoice -eq "1") {
            Write-Section "Git"

            $gitStatus = @(git status --porcelain)
            if ($LASTEXITCODE -ne 0) {
                throw "Git status に失敗しました。"
            }

            if ($gitStatus.Count -eq 0) {
                Write-Host "Gitにコミットする変更はありません。" -ForegroundColor Yellow
            }
            else {
                git status --short
                if ($LASTEXITCODE -ne 0) {
                    throw "Git status --short に失敗しました。"
                }

                if ([string]::IsNullOrWhiteSpace($commitMessage)) {
                    throw "Commit messageが設定されていません。"
                }

                Invoke-GitCommand -Name "Git add" -Command { git add . }
                Invoke-GitCommand -Name "Git commit" -Command { git commit -m $commitMessage }
                Invoke-GitCommand -Name "Git push" -Command { git push }

                $script:GitCompleted = $true
            }
        }
        else {
            Write-Host "Git処理をスキップしました。" -ForegroundColor Yellow
        }

        # Firebase Deploy
        if ($null -ne $firebaseTarget) {
            if ($deployChoice -in @("2", "3", "4")) {
                $env:FUNCTIONS_DISCOVERY_TIMEOUT = "120"
                Write-Host "Functions Discovery Timeout: 120 seconds" -ForegroundColor DarkGray
            }

            Write-Section "Firebase Deploy"
            Invoke-FirebaseDeploy -Target $firebaseTarget -Project $project
        }
        else {
            Write-Host "Firebase Deployをスキップしました。" -ForegroundColor Yellow
        }

        $script:DeploySucceeded = $true
    }
}
catch {
    $script:FailureMessage = $_.Exception.Message
}

# ========================================
# 最終結果
# ========================================
Write-Host ""
Write-Host "========================================" -ForegroundColor Cyan

if ($script:Cancelled) {
    Write-Host " CANCELLED: 処理を実行せず終了しました " -ForegroundColor Yellow
}
elseif ($script:DeploySucceeded) {
    Write-Host " SUCCESS: 処理が完了しました " -ForegroundColor Green
    Write-Host "Git         : $(if ($gitChoice -eq '0') { 'SKIP' } elseif ($script:GitCompleted) { 'OK' } else { '変更なし' })"
    Write-Host "Firebase    : $(if ($script:DeployCompleted) { 'OK' } else { 'SKIP' })"
    Write-Host "Environment : $environmentName"
    Write-Host "Project     : $project"
    Write-Host "Hosting     : $hostingSite"
    Write-Host "URL         : $environmentUrl" -ForegroundColor Yellow
}
else {
    Write-Host " ERROR: 処理に失敗しました " -ForegroundColor Red
    Write-Host "内容: $script:FailureMessage" -ForegroundColor Red
    Write-Host "========================================" -ForegroundColor Cyan
    exit 1
}

Write-Host "========================================" -ForegroundColor Cyan
