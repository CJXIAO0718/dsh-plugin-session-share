#requires -Version 5.1
<#
  这是「DSH 打不开了」时的应急恢复脚本。
  双击它（或右键 -> 使用 PowerShell 运行），会把 DSH 的插件配置
  cordis.patch.yml 回滚到安装本插件之前的备份，让 DSH 能重新启动。
  它不会删除你的会话、工作区或任何数据，只会替换一个配置文件（并先备份当前文件）。

  如果双击被系统安全策略拦住：右键 -> 使用 PowerShell 运行；
  或在 PowerShell 里执行：
      powershell -NoProfile -ExecutionPolicy Bypass -File .\restore-if-broken.ps1

  参数：
    -ProfileDir   要恢复的 profile 目录，默认由 $env:USERPROFILE 派生：%USERPROFILE%\.dsh\profiles\desktop
    -ListOnly     只列出候选备份，不写任何文件
    -NoPause      结束后不等待回车（脚本/自动化调用时用）
#>
param(
    [string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop'),
    [switch]$ListOnly,
    [switch]$NoPause
)

$ErrorActionPreference = 'Stop'

# 兜底：显式传 -ProfileDir '' 时也回到默认派生路径（否则 Resolve-Dir 会退化成当前目录）
if ([string]::IsNullOrWhiteSpace($ProfileDir)) {
    $ProfileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
}

$targetName  = 'cordis.patch.yml'
$pluginId    = 'session-share-html'
$selfMadeTag = 'bak-before-restore-'
$selfMadeTag2 = 'bak-before-recovery-'

function Say  { param([string]$m) Write-Host $m }
function Ok   { param([string]$m) Write-Host ('  [OK] ' + $m) -ForegroundColor Green }
function Warn { param([string]$m) Write-Host ('  [!]  ' + $m) -ForegroundColor Yellow }
function Bad  { param([string]$m) Write-Host ('  [X]  ' + $m) -ForegroundColor Red }

function Resolve-Dir {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { $Path = (Get-Location).Path }
    if (-not [System.IO.Path]::IsPathRooted($Path)) { $Path = Join-Path (Get-Location).Path $Path }
    return [System.IO.Path]::GetFullPath($Path)
}

function Get-TextSafe {
    param([string]$Path)
    try { return [System.IO.File]::ReadAllText($Path, [System.Text.Encoding]::UTF8) } catch { return '' }
}

function Test-HasPlugin {
    param([string]$Path)
    $text = Get-TextSafe $Path
    return ($text -match ('id:\s*' + [regex]::Escape($pluginId)))
}

function New-UniqueBackup {
    param([string]$Path, [string]$Tag)
    $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $backup = $Path + '.' + $Tag + $stamp
    $n = 1
    while ([System.IO.File]::Exists($backup)) {
        $backup = $Path + '.' + $Tag + $stamp + '-' + $n
        $n = $n + 1
    }
    return $backup
}

# 复制字节到同目录临时文件，再替换目标文件；任何失败都清理临时文件，不留半截配置
function Copy-FileAtomic {
    param([string]$Source, [string]$Target)
    $dir = [System.IO.Path]::GetDirectoryName($Target)
    $tmp = Join-Path $dir ('.restore.tmp-' + [Guid]::NewGuid().ToString('N'))
    $mode = ''
    try {
        [System.IO.File]::Copy($Source, $tmp, $true)
        if ([System.IO.File]::Exists($Target)) {
            $done = $false
            try {
                [System.IO.File]::Replace($tmp, $Target, [NullString]::Value)
                $done = $true
                $mode = '原子替换'
            } catch {
                $done = $false
            }
            if (-not $done) {
                [System.IO.File]::Delete($Target)
                [System.IO.File]::Move($tmp, $Target)
                $mode = '先删后移替换'
            }
        } else {
            [System.IO.File]::Move($tmp, $Target)
            $mode = '新建文件'
        }
    } catch {
        if ([System.IO.File]::Exists($tmp)) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
        throw
    }
    return $mode
}

try {
    Say ''
    Say '=================================================='
    Say ' DSH 应急恢复：把插件配置回滚到安装前的备份'
    Say ' 不改动会话数据，只替换 cordis.patch.yml'
    Say '=================================================='

    $profileAbs = Resolve-Dir $ProfileDir
    $target = Join-Path $profileAbs $targetName

    Say ''
    Say ('配置目录：' + $profileAbs)
    if (-not [System.IO.Directory]::Exists($profileAbs)) {
        Write-Host ('  [X]  找不到这个目录，无法恢复：' + $profileAbs) -ForegroundColor Red
        Say '       如果你的 DSH 配置不在默认位置，请加参数 -ProfileDir "<你的 profile 目录>" 再运行一次。'
        if (-not $NoPause -and -not [Console]::IsInputRedirected) { [void](Read-Host '按回车键关闭') }
        exit 1
    }

    if ([System.IO.File]::Exists($target)) {
        $targetSize = (Get-Item -LiteralPath $target).Length
        $targetHas = Test-HasPlugin $target
        Say ('当前配置：' + $targetName + '（' + $targetSize + ' 字节；含 ' + $pluginId + '：' + $(if ($targetHas) { '是（这就是起不来的原因）' } else { '否' }) + '）')
    } else {
        Warn ('当前没有 ' + $targetName + '，将直接放回一份备份。')
    }

    # ---- 候选备份 ----
    $pattern = $targetName + '.bak-*'
    $all = @(Get-ChildItem -LiteralPath $profileAbs -Filter $pattern -File -ErrorAction SilentlyContinue)
    $rows = New-Object System.Collections.ArrayList
    foreach ($f in $all) {
        $isSelf = ($f.Name -like ('*' + $selfMadeTag + '*')) -or ($f.Name -like ('*' + $selfMadeTag2 + '*'))
        $has = Test-HasPlugin $f.FullName
        [void]$rows.Add([pscustomobject]@{
            File    = $f
            Name    = $f.Name
            Size    = $f.Length
            HasPlug = $has
            IsSelf  = $isSelf
            Usable  = (-not $isSelf)
            Clean   = ((-not $isSelf) -and (-not $has))
        })
    }

    Say ''
    Say ('找到 ' + $rows.Count + ' 份备份：')
    if ($rows.Count -eq 0) {
        Say '  （没有找到任何备份）'
    } else {
        foreach ($r in ($rows | Sort-Object { $_.File.LastWriteTime })) {
            $flags = @()
            if ($r.IsSelf)  { $flags += '本脚本自己产生的备份，跳过' }
            if ($r.HasPlug) { $flags += '含 ' + $pluginId }
            if ($flags.Count -eq 0) { $flags += '安装前的干净配置' }
            Say ('  - ' + $r.Name + '  ' + $r.Size + ' 字节  [' + ($flags -join '；') + ']')
        }
    }

    $usable = @($rows | Where-Object { $_.Usable })
    $clean  = @($usable | Where-Object { $_.Clean })
    $chosen = $null
    $noCleanAvailable = $false

    if ($clean.Count -gt 0) {
        $chosen = @($clean | Sort-Object { $_.File.LastWriteTime } -Descending)[0]
    } elseif ($usable.Count -gt 0) {
        $chosen = @($usable | Sort-Object { $_.File.LastWriteTime } -Descending)[0]
        $noCleanAvailable = $true
    }

    if ($null -eq $chosen) {
        Say ''
        Bad '没有可用的备份（要么没有 .bak-* 文件，要么它们都是本脚本自己产生的）。'
        Say '       下一步：用安装脚本把插件条目删掉即可让 DSH 启动：'
        Say '         powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall'
        if (-not $NoPause -and -not [Console]::IsInputRedirected) { [void](Read-Host '按回车键关闭') }
        exit 1
    }

    Say ''
    if ($noCleanAvailable) {
        Warn '没有找到“安装前”的干净备份，只能选最近的一份。恢复后 DSH 可能仍然起不来。'
        Warn '若仍起不来，请执行：powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall'
    }
    Say ('将使用：' + $chosen.Name + '（' + $chosen.Size + ' 字节；含 ' + $pluginId + '：' + $(if ($chosen.HasPlug) { '是' } else { '否' }) + '）')

    if ($ListOnly) {
        Say ''
        Say '（-ListOnly：只查看，没有修改任何文件。去掉 -ListOnly 就会用它恢复。）'
        if (-not $NoPause -and -not [Console]::IsInputRedirected) { [void](Read-Host '按回车键关闭') }
        exit 0
    }

    # ---- 先把当前文件存一份，再放回选中的备份 ----
    Say ''
    if ([System.IO.File]::Exists($target)) {
        $before = New-UniqueBackup -Path $target -Tag $selfMadeTag
        [System.IO.File]::Copy($target, $before, $false)
        Ok ('当前配置已存一份：' + [System.IO.Path]::GetFileName($before))
    }

    $mode = Copy-FileAtomic -Source $chosen.File.FullName -Target $target
    Ok ('已恢复：' + $targetName + '（' + $mode + '）')

    # 逐字节比对；不用 Get-FileHash，因为部分受限环境里 PowerShell 模块自动加载不可用
    $same = $false
    try {
        $srcBytes = [System.IO.File]::ReadAllBytes($chosen.File.FullName)
        $dstBytes = [System.IO.File]::ReadAllBytes($target)
        $same = ($srcBytes.Length -eq $dstBytes.Length)
        if ($same) {
            for ($i = 0; $i -lt $srcBytes.Length; $i++) {
                if ($srcBytes[$i] -ne $dstBytes[$i]) { $same = $false; break }
            }
        }
    } catch {
        $same = $false
    }
    if (-not $same) {
        Bad ('恢复后内容与备份不一致，请手动把这份备份复制回去：' + $chosen.File.FullName)
        if (-not $NoPause -and -not [Console]::IsInputRedirected) { [void](Read-Host '按回车键关闭') }
        exit 1
    }
    Ok '内容已与备份逐字节一致'
    $leftTmp = @(Get-ChildItem -LiteralPath $profileAbs -Filter '.restore.tmp-*' -Force -ErrorAction SilentlyContinue)
    if ($leftTmp.Count -gt 0) { Warn ('有临时文件残留：' + ($leftTmp.Name -join ', ')) }

    Say ''
    if (Test-HasPlugin $target) {
        Warn ('恢复后的配置里仍然有 ' + $pluginId + '，DSH 可能还是起不来。')
        Say '       请再执行一次：powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall'
    } else {
        Ok ('恢复后的配置里已经没有 ' + $pluginId + '。')
    }

    Say ''
    Say '搞定，接下来：'
    Say '  1) 重新启动 DSH 桌面端（先确认它已经完全退出）'
    Say '  2) 如果能正常打开，就说明配置已恢复正常'
    Say '  3) 需要再试一次插件，先看 README.zh.md 的「已知致命风险」与「安装后验证」'
    Say ''
    if (-not $NoPause -and -not [Console]::IsInputRedirected) { [void](Read-Host '按回车键关闭') }
    exit 0
} catch {
    Write-Host ''
    Write-Host ('  [X]  恢复过程中出错：' + $_.Exception.Message) -ForegroundColor Red
    Write-Host '       临时文件已清理；原配置与备份都还在，可再次运行或手动复制备份回去。'
    Write-Host '       可以改用安装脚本卸载插件：powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall'
    if (-not $NoPause -and -not [Console]::IsInputRedirected) { [void](Read-Host '按回车键关闭') }
    exit 1
}
