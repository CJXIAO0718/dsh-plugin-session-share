#requires -Version 5.1
<#
.SYNOPSIS
    dsh-plugin-session-share 安装 / 卸载脚本（Windows PowerShell 5.1 兼容）。
.DESCRIPTION
    把插件条目以 insert 形式写入 DSH profile 的 cordis.patch.yml 顶层数组。
    幂等（同 id 先删后加，不产生重复行）；写入前备份；完整内容先落临时文件再替换；
    装完自动跑一次 --dump-config 自检。
.NOTES
    本文件必须以 UTF-8 with BOM 保存，否则 Windows PowerShell 5.1 会按 ANSI 解码中文而报语法错误。
.PARAMETER ProfileDir
    DSH profile 目录，默认由 $env:USERPROFILE 派生：%USERPROFILE%\.dsh\profiles\desktop。
.PARAMETER PluginDir
    插件包目录（必须含 lib\index.js），默认本脚本所在目录。
.PARAMETER DshCli
    dsh CLI（dsh.cmd / dsh.exe）的绝对路径（可选）。用于 dsh 不在 PATH、也不在常见安装位置时手动指定；
    优先级高于环境变量 DSH_CLI。
.PARAMETER Uninstall
    按 id 删除该 insert 条目（同样备份、原子替换）。
.PARAMETER WhatIf
    只打印将要写入的 YAML，不落盘、不备份。
.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1
.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -WhatIf
.EXAMPLE
    powershell -NoProfile -ExecutionPolicy Bypass -File .\install.ps1 -Uninstall
#>
param(
    [string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop'),
    [string]$PluginDir = $PSScriptRoot,
    [string]$DshCli = '',
    [switch]$Uninstall,
    [switch]$WhatIf
)

$ErrorActionPreference = 'Stop'

# 兜底：显式传 -ProfileDir '' 时也回到默认派生路径
if ([string]::IsNullOrWhiteSpace($ProfileDir)) {
    $ProfileDir = Join-Path $env:USERPROFILE '.dsh\profiles\desktop'
}

$pluginId      = 'session-share-html'
$tabChar       = [string][char]9
$crlf          = ([string][char]13) + ([string][char]10)
$lf            = [string][char]10
$stepIndex     = 0
$stepTotal     = 5

function Write-Head {
    Write-Host ''
    if ($Uninstall) { Write-Host '=== dsh-plugin-session-share 卸载 ===' -ForegroundColor Cyan }
    else            { Write-Host '=== dsh-plugin-session-share 安装 ===' -ForegroundColor Cyan }
}
function Write-Step {
    param([string]$Message)
    $script:stepIndex = $script:stepIndex + 1
    Write-Host ('[{0}/{1}] {2}' -f $script:stepIndex, $script:stepTotal, $Message)
}
function Write-Ok   { param([string]$Message) Write-Host ('      OK  ' + $Message) -ForegroundColor Green }
function Write-Note { param([string]$Message) Write-Host ('      ..  ' + $Message) }
function Write-Warn { param([string]$Message) Write-Host ('      !   ' + $Message) -ForegroundColor Yellow }
function Write-Fail { param([string]$Message) Write-Host ('      X   ' + $Message) -ForegroundColor Red; exit 1 }

function Resolve-Dir {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { $Path = (Get-Location).Path }
    if (-not [System.IO.Path]::IsPathRooted($Path)) { $Path = Join-Path (Get-Location).Path $Path }
    return [System.IO.Path]::GetFullPath($Path)
}

# 绝对路径 -> file:/// URL（正斜杠；空格与非 ASCII 按 UTF-8 百分号编码）
function ConvertTo-FileUrl {
    param([string]$Path)
    $full = [System.IO.Path]::GetFullPath($Path)
    $slashed = $full -replace '\\', '/'
    $sb = New-Object System.Text.StringBuilder
    foreach ($ch in $slashed.ToCharArray()) {
        $code = [int]$ch
        $plain = (($code -ge 48 -and $code -le 57) -or
                  ($code -ge 65 -and $code -le 90) -or
                  ($code -ge 97 -and $code -le 122) -or
                  $ch -eq '/' -or $ch -eq ':' -or $ch -eq '-' -or
                  $ch -eq '.' -or $ch -eq '_' -or $ch -eq '~')
        if ($plain) {
            [void]$sb.Append($ch)
        } else {
            $bytes = [System.Text.Encoding]::UTF8.GetBytes([string]$ch)
            for ($i = 0; $i -lt $bytes.Length; $i++) {
                [void]$sb.Append('%' + $bytes[$i].ToString('X2'))
            }
        }
    }
    $body = $sb.ToString()
    if ($body.StartsWith('//')) { return 'file:' + $body }
    if (-not $body.StartsWith('/')) { $body = '/' + $body }
    return 'file://' + $body
}

function Test-IdLine {
    param([string]$Line, [string]$Id)
    $pattern = '^\s*(?:-\s*)?id:\s*' + [regex]::Escape($Id) + '\s*(?:#.*)?$'
    return ($Line -match $pattern)
}

# 返回指定缩进层级上的所有序列项范围（用 , 返回避免 PowerShell 展开单元素集合）
function Get-ItemRanges {
    param([string[]]$Lines, [int]$Indent)
    $result = New-Object System.Collections.ArrayList
    $start = -1
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        $line = [string]$Lines[$i]
        $isItem = $false
        if ($Indent -eq 0) {
            $isItem = (($line -match '^-\s') -or ($line -eq '-'))
        } elseif ($line.Length -gt $Indent) {
            $head = $line.Substring(0, $Indent)
            if ($head.Trim().Length -eq 0) {
                $rest = $line.Substring($Indent)
                $isItem = (($rest -match '^-\s') -or ($rest -eq '-'))
            }
        }
        if ($isItem) {
            if ($start -ge 0) { [void]$result.Add([pscustomobject]@{ Start = $start; End = $i - 1 }) }
            $start = $i
        }
    }
    if ($start -ge 0) { [void]$result.Add([pscustomobject]@{ Start = $start; End = $Lines.Count - 1 }) }
    return ,$result
}

function Get-DeletionSpans {
    param([string[]]$Lines, [string]$Id)
    $spans = New-Object System.Collections.ArrayList
    $top = Get-ItemRanges -Lines $Lines -Indent 0
    foreach ($r in $top) {
        $s = $r.Start
        $e = $r.End
        # 裸行形式：- id: <目标 id>
        if (Test-IdLine -Line ([string]$Lines[$s]) -Id $Id) {
            [void]$spans.Add([pscustomobject]@{ Start = $s; End = $e })
            continue
        }
        # insert 形式：- insert: 后跟缩进子项
        if ([string]$Lines[$s] -match '^-\s*insert:\s*$') {
            $childRanges = $null
            for ($ind = 2; $ind -le 8; $ind = $ind + 2) {
                $sub = @()
                for ($i = $s + 1; $i -le $e; $i++) { $sub += [string]$Lines[$i] }
                $candidate = Get-ItemRanges -Lines $sub -Indent $ind
                if ($candidate.Count -gt 0) { $childRanges = $candidate; break }
            }
            if ($null -eq $childRanges) { continue }
            $hit = 0
            foreach ($kr in $childRanges) {
                $ks = $s + 1 + $kr.Start
                $ke = $s + 1 + $kr.End
                $found = $false
                for ($i = $ks; $i -le $ke; $i++) {
                    if (Test-IdLine -Line ([string]$Lines[$i]) -Id $Id) { $found = $true; break }
                }
                if (-not $found) { continue }
                $hit = $hit + 1
                while ($ke -gt $ks -and ([string]$Lines[$ke]).Trim() -eq '') { $ke = $ke - 1 }
                [void]$spans.Add([pscustomobject]@{ Start = $ks; End = $ke })
            }
            # insert 列表里只剩目标条目时，整个 insert 条目一起删掉
            if ($hit -gt 0 -and $hit -eq $childRanges.Count) {
                [void]$spans.Add([pscustomobject]@{ Start = $s; End = $s })
            }
        }
    }
    return ,$spans
}

function Remove-EntryFromLines {
    param([string[]]$Lines, [string]$Id)
    $work = New-Object System.Collections.Generic.List[string]
    foreach ($line in $Lines) { $work.Add([string]$line) }
    $guard = 0
    while ($guard -lt 50) {
        $guard = $guard + 1
        $spans = Get-DeletionSpans -Lines $work.ToArray() -Id $Id
        if ($spans.Count -eq 0) { break }
        $ordered = @($spans | Sort-Object -Property Start -Descending)
        foreach ($sp in $ordered) {
            $count = $sp.End - $sp.Start + 1
            if ($count -gt 0) { $work.RemoveRange($sp.Start, $count) }
        }
    }
    return ,$work
}

function Add-EntryLines {
    param($Lines, [string[]]$Block)
    $list = New-Object System.Collections.Generic.List[string]
    foreach ($line in $Lines) { $list.Add([string]$line) }
    while ($list.Count -gt 0 -and ([string]$list[$list.Count - 1]).Trim() -eq '') {
        $list.RemoveAt($list.Count - 1)
    }
    if ($list.Count -eq 0) {
        $list.Add('# Your patch layer for this dsh profile, applied after every bundle layer:')
        $list.Add('# a top-level YAML array of loader patch entries.')
    }
    foreach ($line in $Block) { $list.Add([string]$line) }
    return ,$list
}

# 写入前的"缩进 / 顶层数组 / 引号配对"基本合法性检查（不依赖任何 YAML 库）
function Test-PatchLines {
    param([string[]]$Lines)
    $problems = New-Object System.Collections.ArrayList
    if ($Lines.Count -eq 0) {
        [void]$problems.Add('内容为空')
        return ,$problems
    }
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        $line = [string]$Lines[$i]
        if ($line.Contains($tabChar)) { [void]$problems.Add(('第 {0} 行含制表符（YAML 缩进不允许 tab）' -f ($i + 1))) }
    }
    for ($i = 0; $i -lt $Lines.Count; $i++) {
        $line = [string]$Lines[$i]
        if ($line.Trim().Length -eq 0) { continue }
        if ($line -match '^\s') { continue }
        if ($line -match '^#') { continue }
        if ($line -match '^---\s*$') { continue }
        if ($line.Trim() -eq '[]') { continue }
        if (($line -match '^-\s') -or ($line -eq '-')) { continue }
        [void]$problems.Add(('第 {0} 行不是顶层数组条目：{1}' -f ($i + 1), $line))
    }
    $scannable = @()
    foreach ($line in $Lines) {
        if ([string]$line -match '^\s*#') { $scannable += '' } else { $scannable += [string]$line }
    }
    $scanText = $scannable -join $lf
    if ((([regex]::Matches($scanText, "'")).Count % 2) -ne 0) {
        [void]$problems.Add('单引号总数不是偶数（可能有行被截断或转义错误）')
    }
    if ((([regex]::Matches($scanText, '"')).Count % 2) -ne 0) {
        [void]$problems.Add('双引号总数不是偶数（可能有行被截断或转义错误）')
    }
    return ,$problems
}

# 判断一组行是否只剩空白与注释（卸载后可能变成这样）
function Test-OnlyBlankOrComment {
    param([string[]]$Lines)
    foreach ($line in $Lines) {
        $t = ([string]$line).Trim()
        if ($t.Length -eq 0) { continue }
        if ($t.StartsWith('#')) { continue }
        return $false
    }
    return $true
}

# 结构检查：这份内容能否被当作顶层 YAML 数组解析。
# 空文件会被解析成 null，DSH 组合 patch 时可能不认，所以要拦住。
function Test-YamlArrayShape {
    param([string[]]$Lines)
    $problems = Test-PatchLines -Lines $Lines
    if ($problems.Count -gt 0) {
        return [pscustomobject]@{ Ok = $false; Reason = (($problems | ForEach-Object { '[' + $_ + ']' }) -join ' ') }
    }
    $items = 0
    foreach ($line in $Lines) {
        $raw = [string]$line
        $t = $raw.Trim()
        if ($t.Length -eq 0) { continue }
        if ($t.StartsWith('#')) { continue }
        # 缩进行是上一个条目的子内容（config: 之类），不算顶层行
        if ($raw.Length -gt 0 -and ($raw[0] -eq ' ' -or $raw[0] -eq $tabChar[0])) { continue }
        if ($t -eq '[]') { return [pscustomobject]@{ Ok = $true; Reason = '顶层空数组 []' } }
        if ($t.StartsWith('-')) { $items = $items + 1; continue }
        return [pscustomobject]@{ Ok = $false; Reason = '存在不是数组条目的顶层行' }
    }
    if ($items -eq 0) { return [pscustomobject]@{ Ok = $false; Reason = '没有顶层数组条目（会被解析成 null）' } }
    return [pscustomobject]@{ Ok = $true; Reason = ('顶层数组，共 ' + $items + ' 项') }
}

# 先把完整内容写入同目录临时文件，再替换目标文件；失败时清理临时文件，绝不留下半截配置
function Write-FileAtomic {
    param([string]$Path, [string]$Text)
    $dir = [System.IO.Path]::GetDirectoryName($Path)
    $tmp = Join-Path $dir ('.cordis.patch.yml.tmp-' + [Guid]::NewGuid().ToString('N'))
    $enc = New-Object System.Text.UTF8Encoding($false)
    $mode = ''
    try {
        [System.IO.File]::WriteAllText($tmp, $Text, $enc)
        if ([System.IO.File]::Exists($Path)) {
            $done = $false
            try {
                [System.IO.File]::Replace($tmp, $Path, [NullString]::Value)
                $done = $true
                $mode = 'File.Replace 原子替换'
            } catch {
                $done = $false
            }
            if (-not $done) {
                # 回退路径：部分环境（含本机沙箱）禁用 ReplaceFile API，此时先删后移
                [System.IO.File]::Delete($Path)
                [System.IO.File]::Move($tmp, $Path)
                $mode = 'Delete+Move 替换（内容完整写入后才替换，备份已存在）'
            }
        } else {
            [System.IO.File]::Move($tmp, $Path)
            $mode = '新建文件'
        }
    } catch {
        if ([System.IO.File]::Exists($tmp)) { Remove-Item -LiteralPath $tmp -Force -ErrorAction SilentlyContinue }
        throw
    }
    return $mode
}

function New-Backup {
    param([string]$Path)
    $stamp = (Get-Date).ToString('yyyyMMdd-HHmmss')
    $backup = $Path + '.bak-' + $stamp
    $n = 1
    while ([System.IO.File]::Exists($backup)) {
        $backup = $Path + '.bak-' + $stamp + '-' + $n
        $n = $n + 1
    }
    [System.IO.File]::Copy($Path, $backup, $false)
    return $backup
}

# 按 -DshCli -> $env:DSH_CLI -> PATH -> 常见安装位置 依次探测 dsh CLI。
# 全都找不到时返回 $null：自检跳过即可，不影响插件安装。
function Resolve-DshCli {
    param([string]$Explicit)
    if (-not [string]::IsNullOrWhiteSpace($Explicit)) {
        if ([System.IO.File]::Exists($Explicit)) { return $Explicit }
        Write-Warn ('-DshCli 指向的文件不存在，继续探测：' + $Explicit)
    }
    if (-not [string]::IsNullOrWhiteSpace($env:DSH_CLI)) {
        if ([System.IO.File]::Exists($env:DSH_CLI)) { return $env:DSH_CLI }
        Write-Warn ('DSH_CLI 指向的文件不存在，继续探测：' + $env:DSH_CLI)
    }
    foreach ($name in @('dsh.cmd', 'dsh.exe')) {
        $found = Get-Command $name -ErrorAction SilentlyContinue
        if ($null -ne $found -and -not [string]::IsNullOrWhiteSpace($found.Source)) {
            if ([System.IO.File]::Exists($found.Source)) { return $found.Source }
        }
    }
    $roots = New-Object System.Collections.ArrayList
    if (-not [string]::IsNullOrWhiteSpace($env:LOCALAPPDATA)) {
        [void]$roots.Add((Join-Path $env:LOCALAPPDATA 'Programs\DeepSeek Harness'))
    }
    if (-not [string]::IsNullOrWhiteSpace($env:ProgramFiles)) {
        [void]$roots.Add((Join-Path $env:ProgramFiles 'DeepSeek Harness'))
    }
    $x86 = [System.Environment]::GetEnvironmentVariable('ProgramFiles(x86)')
    if (-not [string]::IsNullOrWhiteSpace($x86)) {
        [void]$roots.Add((Join-Path $x86 'DeepSeek Harness'))
    }
    foreach ($rootDir in $roots) {
        foreach ($name in @('dsh.cmd', 'dsh.exe')) {
            $candidate = Join-Path (Join-Path $rootDir 'resources\runtime\cli\bin') $name
            if ([System.IO.File]::Exists($candidate)) { return $candidate }
        }
    }
    return $null
}

function Invoke-DumpConfigSelfCheck {
    param([string]$ProfileDirAbs, [string]$Id)
    $parent = [System.IO.Path]::GetDirectoryName($ProfileDirAbs)
    $leaf = [System.IO.Path]::GetFileName($ProfileDirAbs)
    $grand = ''
    if (-not [string]::IsNullOrWhiteSpace($parent)) { $grand = [System.IO.Path]::GetFileName($parent) }
    if ($grand -ne 'profiles') {
        Write-Warn '自定义 profile 目录，跳过 --dump-config 自检（可手动执行 dsh --profile <名字> --dump-config）'
        return
    }
    $dsh = Resolve-DshCli -Explicit $DshCli
    if ($null -eq $dsh) {
        Write-Warn '未找到 dsh CLI，跳过 --dump-config 自检（不影响安装）'
        return
    }
    Write-Note ('执行自检：' + $dsh + ' --profile ' + $leaf + ' --dump-config')
    $output = ''
    $code = 0
    try {
        $output = (& $dsh --profile $leaf --dump-config 2>&1 | Out-String)
        $code = $LASTEXITCODE
    } catch {
        Write-Warn ('自检命令无法执行（桌面端运行中会被拒绝）：' + $_.Exception.Message)
        Write-Warn '非致命：cordis.patch.yml 已写入，桌面端 HMR 会自动重载。'
        return
    }
    if ($output -match [regex]::Escape($Id)) {
        Write-Ok ('--dump-config 输出包含 ' + $Id + ' => PASS')
        foreach ($line in ([regex]::Split($output, '\r?\n'))) {
            if ($line -match [regex]::Escape($Id)) { Write-Note ('  ' + $line.Trim()) }
        }
    } else {
        Write-Warn ('--dump-config 输出未包含 ' + $Id + ' => FAIL（退出码 ' + $code + '）')
        Write-Warn '常见原因：桌面端正在运行、命令被拒绝。配置本身已写入，HMR 会自动重载。'
        $shown = 0
        foreach ($line in ([regex]::Split($output, '\r?\n'))) {
            if ($shown -ge 5) { break }
            if ($line.Trim().Length -eq 0) { continue }
            Write-Note ('  | ' + $line.Trim())
            $shown = $shown + 1
        }
    }
}

try {
    Write-Head

    # ---------- [1] 路径与前置校验 ----------
    Write-Step '解析路径并校验插件文件'
    $pluginDirAbs  = Resolve-Dir $PluginDir
    $profileDirAbs = Resolve-Dir $ProfileDir
    $targetFile    = Join-Path $profileDirAbs 'cordis.patch.yml'
    $entryFile     = Join-Path (Join-Path $pluginDirAbs 'lib') 'index.js'

    Write-Note ('PluginDir  : ' + $pluginDirAbs)
    Write-Note ('ProfileDir : ' + $profileDirAbs)
    Write-Note ('目标文件   : ' + $targetFile)

    if (-not [System.IO.Directory]::Exists($profileDirAbs)) {
        Write-Fail ('profile 目录不存在：' + $profileDirAbs)
    }
    if ($Uninstall) {
        Write-Note '卸载模式：不校验插件入口文件（插件目录可能已被删除）'
    } elseif (-not [System.IO.File]::Exists($entryFile)) {
        if ($WhatIf) {
            Write-Warn ('入口文件不存在（-WhatIf 下只提示，不阻断，因为不会真的写入）：' + $entryFile)
        } else {
            Write-Fail ('入口文件不存在，已中止以免写坏配置：' + $entryFile)
        }
    } else {
        Write-Ok ('入口文件存在：' + $entryFile)
    }

    # ---------- [2] 读取现有配置 ----------
    Write-Step '读取现有 cordis.patch.yml'
    $exists = [System.IO.File]::Exists($targetFile)
    $raw = ''
    if ($exists) {
        $raw = [System.IO.File]::ReadAllText($targetFile, [System.Text.Encoding]::UTF8)
        $useCrlf = $raw.Contains($crlf)
        Write-Ok ('已读取 ' + $raw.Length + ' 个字符（换行风格：' + $(if ($useCrlf) { 'CRLF' } else { 'LF' }) + '）')
    } else {
        $useCrlf = $true
        Write-Warn '文件不存在，将新建一个顶层数组'
    }
    $lines = @()
    if ($exists) {
        $trimmed = New-Object System.Collections.Generic.List[string]
        foreach ($line in [regex]::Split($raw, '\r?\n')) { $trimmed.Add([string]$line) }
        while ($trimmed.Count -gt 0 -and ([string]$trimmed[$trimmed.Count - 1]).Trim() -eq '') {
            $trimmed.RemoveAt($trimmed.Count - 1)
        }
        $lines = $trimmed.ToArray()
    }
    $before = New-Object System.Collections.ArrayList
    if ($exists) { $before = Get-DeletionSpans -Lines $lines -Id $pluginId }
    Write-Note ('现有同 id 条目块数：' + $before.Count)

    # ---------- [3] 生成条目 ----------
    $fileUrl = ConvertTo-FileUrl $entryFile
    $block = @()
    if ($Uninstall) {
        Write-Step ('定位待移除条目（id: ' + $pluginId + '）')
    } else {
        Write-Step '生成插件条目（file:/// URL 指向 lib\index.js）'
        $block = @(
            '- insert:',
            ('    - id: ' + $pluginId),
            ("      name: '" + $fileUrl + "'"),
            '      config: {}'
        )
        Write-Note ('name = ' + $fileUrl)
    }

    if ($Uninstall) {
        $next = Remove-EntryFromLines -Lines $lines -Id $pluginId
        if (Test-OnlyBlankOrComment -Lines $next.ToArray()) {
            $emptyDoc = New-Object System.Collections.Generic.List[string]
            $emptyDoc.Add('# Your patch layer for this dsh profile, applied after every bundle layer:')
            $emptyDoc.Add('# a top-level YAML array of loader patch entries.')
            $emptyDoc.Add('[]')
            $next = $emptyDoc
            Write-Note '卸载后没有剩余条目：写回标准头注释 + []（保证仍是合法的 YAML 数组）'
        }
    } else {
        $withoutEntry = Remove-EntryFromLines -Lines $lines -Id $pluginId
        $next = Add-EntryLines -Lines $withoutEntry.ToArray() -Block $block
    }

    # ---------- [4] 合法性检查 + 备份 + 写入 ----------
    Write-Step '合法性检查、备份与写入'
    $problems = Test-PatchLines -Lines $next.ToArray()
    if ($problems.Count -gt 0) {
        Write-Fail ('YAML 基本合法性检查未通过，未写入任何内容：' + (($problems | ForEach-Object { '[' + $_ + ']' }) -join ' '))
    }
    Write-Ok '缩进 / 顶层数组 / 引号配对检查通过'

    $newText = ($next.ToArray() -join $(if ($useCrlf) { $crlf } else { $lf })) + $(if ($useCrlf) { $crlf } else { $lf })

    if ($WhatIf) {
        Write-Warn '-WhatIf：不落盘、不备份，以下是将要写入的完整内容'
        Write-Host ''
        Write-Host $newText
        Write-Host ''
        $script:stepIndex = $script:stepTotal
        Write-Host ('[{0}/{1}] 结束（-WhatIf，未修改任何文件）' -f $script:stepTotal, $script:stepTotal) -ForegroundColor Cyan
        exit 0
    }

    $backup = ''
    if ($exists) {
        $backup = New-Backup $targetFile
        Write-Ok ('已备份：' + $backup)
    } else {
        Write-Warn '无原文件，未生成备份'
    }

    $writeMode = Write-FileAtomic -Path $targetFile -Text $newText
    Write-Ok ('已写入：' + $targetFile + '（' + $writeMode + '）')

    # ---------- [5] 回读 + 自检 ----------
    Write-Step '回读校验与 --dump-config 自检'
    $afterRaw = [System.IO.File]::ReadAllText($targetFile, [System.Text.Encoding]::UTF8)
    $afterLines = [regex]::Split($afterRaw, '\r?\n')
    $idCount = ([regex]::Matches($afterRaw, 'id:\s*' + [regex]::Escape($pluginId))).Count
    Write-Note ('文件中 id: ' + $pluginId + ' 出现次数：' + $idCount)
    $shape = Test-YamlArrayShape -Lines $afterLines
    if ($shape.Ok) { Write-Ok ('可解析为数组 = true（' + $shape.Reason + '）') }
    else { Write-Fail ('可解析为数组 = false（' + $shape.Reason + '）') }

    if ($Uninstall) {
        if ($idCount -eq 0) { Write-Ok '条目已移除' }
        else { Write-Fail ('卸载后仍存在 ' + $idCount + ' 处条目，请检查 ' + $targetFile) }
    } else {
        if ($idCount -eq 1) { Write-Ok '条目唯一（幂等成立）' }
        else { Write-Fail ('条目出现 ' + $idCount + ' 次，应为 1 次') }
        $idx = -1
        for ($i = 0; $i -lt $afterLines.Count; $i++) {
            if (Test-IdLine -Line $afterLines[$i] -Id $pluginId) { $idx = $i; break }
        }
        if ($idx -ge 1) {
            Write-Note '最终条目：'
            $from = $idx - 1
            $to = $idx + 2
            if ($to -ge $afterLines.Count) { $to = $afterLines.Count - 1 }
            for ($i = $from; $i -le $to; $i++) {
                Write-Host ('        ' + ($i + 1).ToString().PadLeft(3) + '| ' + $afterLines[$i])
            }
        }
    }

    Invoke-DumpConfigSelfCheck -ProfileDirAbs $profileDirAbs -Id $pluginId

    Write-Host ''
    if ($Uninstall) {
        Write-Host '完成：插件条目已移除。' -ForegroundColor Cyan
        if ($backup) {
            Write-Host '回滚：Copy-Item -LiteralPath "' -NoNewline
            Write-Host ($backup + '" -Destination "' + $targetFile + '" -Force') -NoNewline
            Write-Host ''
        }
    } else {
        Write-Host '完成：插件已写入 profile 配置。' -ForegroundColor Cyan
        Write-Host '确认 phase=active：'
        Write-Host '  1) 回到 DSH 桌面端 -> 设置 -> 插件（Plugin / plugin_manager）页'
        Write-Host ('  2) 找到 id = ' + $pluginId + '，确认 phase 显示 active')
        Write-Host ('  3) 或执行：dsh --profile ' + [System.IO.Path]::GetFileName($profileDirAbs) + ' --dump-config 后查找 ' + $pluginId)
        Write-Host '  4) 桌面端 HMR 会自动重载，不需要重启'
        if ($backup) {
            Write-Host ('回滚：Copy-Item -LiteralPath "' + $backup + '" -Destination "' + $targetFile + '" -Force')
        }
    }
    Write-Host ''
    # 自检失败属于非致命，成功路径统一返回 0
    exit 0
} catch {
    Write-Host ('      X   未预期的错误：' + $_.Exception.Message) -ForegroundColor Red
    Write-Host '      临时文件已清理，原文件保持不变；如已生成 .bak 备份，可直接用它回滚。' -ForegroundColor Yellow
    exit 1
}
