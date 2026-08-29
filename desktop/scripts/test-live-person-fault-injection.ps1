param(
  [int]$DebugPort = 9590,
  [int]$TimeoutMinutes = 8
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$truth = Get-Content -Raw -LiteralPath (Join-Path $projectRoot 'references\live-person-video-stress-ground-truth.json') | ConvertFrom-Json -Depth 30
$electronPath = (Resolve-Path (Join-Path $projectRoot 'node_modules\electron\dist\electron.exe')).Path
$logPath = Join-Path $projectRoot 'scripts\log\live-person-fault-injection.json'
$script:cdpId = 100
$snapshots = [System.Collections.Generic.List[object]]::new()

function Get-AppTarget {
  $targets = Invoke-RestMethod "http://127.0.0.1:$DebugPort/json/list"
  $matches = @($targets | Where-Object { $_.type -eq 'page' -and $_.title -eq '灵帧AI' })
  if ($matches.Count -ne 1) { throw "灵帧AI页面数量异常：$($matches.Count)" }
  return $matches[0]
}

function Wait-AppTarget {
  param([int]$Seconds = 45)
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    try { return (Get-AppTarget) } catch { Start-Sleep -Milliseconds 400 }
  } while ((Get-Date) -lt $deadline)
  throw '等待客户端调试页面超时'
}

function Invoke-App {
  param([Parameter(Mandatory = $true)][string]$Expression, [int]$Seconds = 60)
  $target = Wait-AppTarget -Seconds $Seconds
  $socket = [Net.WebSockets.ClientWebSocket]::new()
  try {
    $cancel = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($Seconds))
    $null = $socket.ConnectAsync([Uri]([string]$target.webSocketDebuggerUrl), $cancel.Token).GetAwaiter().GetResult()
    $script:cdpId += 1
    $requestId = $script:cdpId
    $request = @{id=$requestId;method='Runtime.evaluate';params=@{expression=$Expression;awaitPromise=$true;returnByValue=$true}} | ConvertTo-Json -Depth 40 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($request)
    $null = $socket.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, $cancel.Token).GetAwaiter().GetResult()
    $buffer = New-Object byte[] 1048576
    while ($true) {
      $stream = [IO.MemoryStream]::new()
      do {
        $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $cancel.Token).GetAwaiter().GetResult()
        $stream.Write($buffer, 0, $received.Count)
      } while (-not $received.EndOfMessage)
      $response = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json -Depth 50
      if ($response.id -ne $requestId) { continue }
      if ($response.result.exceptionDetails) { throw "页面执行异常：$($response.result.exceptionDetails.text)" }
      return $response.result.result.value
    }
  } finally {
    $socket.Dispose()
  }
}

function Get-Tasks {
  param([string[]]$Ids)
  $idsJson = ConvertTo-Json @($Ids) -Compress
  $expression = @"
(async()=>{const ids=$idsJson;const d=await window.lingframe.workbench.bootstrap();return (d.tasks||[]).filter(t=>ids.includes(t.id)).map(t=>({id:t.id,title:t.title,state:t.state,statusText:t.statusText,accountId:t.accountId,accountName:t.accountName,submittedVerified:t.submittedVerified===true,conversationId:t.conversationId||'',failureCode:t.failureCode||'',failureCategory:t.failureCategory||'',outcomeCode:t.outcomeCode||'',retryMode:t.retryMode||'',recoveryState:t.recoveryState||'',userAction:t.userAction||'',error:t.error||'',createdAt:t.createdAt,updatedAt:t.updatedAt,assetIds:t.assetIds||[]}))})()
"@
  return @(Invoke-App -Expression $expression)
}

function Add-Snapshot {
  param([string]$Stage, [object[]]$Tasks)
  $entry = [ordered]@{at=(Get-Date).ToString('o');stage=$Stage;tasks=$Tasks}
  $snapshots.Add($entry)
  $summary = ($Tasks | ForEach-Object { "$($_.id.Substring(0,6)):$($_.state):$($_.accountName)" }) -join ' | '
  Write-Output "[$((Get-Date).ToString('HH:mm:ss'))] $Stage $summary"
}

$prefix = '【真人图故障探针'
$preflight = Invoke-App -Expression "(async()=>{const d=await window.lingframe.workbench.bootstrap();const matches=(d.tasks||[]).filter(t=>String(t.title||'').startsWith('$prefix'));return {count:matches.length}})()"
if ([int]$preflight.count -gt 0) { throw '故障探针任务已存在，为避免重复提交而停止' }

$inputs = @()
for ($index = 0; $index -lt 2; $index += 1) {
  $prompt = [string]$truth.prompts[$index]
  $prompt = $prompt -replace '【真人图压力测试0[12]】', "【真人图故障探针0$($index + 1)】"
  $inputs += [ordered]@{
    title = $prompt.Substring(0, [Math]::Min(36, $prompt.Length))
    prompt = $prompt
    projectId = $truth.projectId
    creationType = 'video'
    creationSource = 'home'
    executionChannel = 'doubao'
    ratio = $truth.ratio
    duration = $truth.duration
    doubaoModel = $truth.model
    workflowType = 'image-to-video'
    assetIds = @($truth.referenceAsset.id)
    referenceAssets = @([ordered]@{assetId=$truth.referenceAsset.id;role='character';label=$truth.referenceAsset.name;description=$truth.referenceAsset.description;order=1})
    accountGroupId = 'all'
    accountId = $truth.accountCandidates[0].id
    accountName = $truth.accountCandidates[0].name
    accountSelectionMode = 'auto'
    accountCandidates = @($truth.accountCandidates)
  }
}

$inputsJson = ConvertTo-Json $inputs -Depth 30 -Compress
$created = @(Invoke-App -Seconds 120 -Expression "(async()=>{const inputs=$inputsJson;const result=[];for(const input of inputs)result.push(await window.lingframe.generation.create(input));return result.map(t=>({id:t.id,title:t.title,state:t.state}))})()")
if ($created.Count -ne 2) { throw "故障探针创建数量错误：$($created.Count)" }
$ids = @($created.id)
Write-Output "故障探针已提交：$($ids -join ',')"

$active = $null
$activeDeadline = (Get-Date).AddSeconds(15)
do {
  $tasks = Get-Tasks -Ids $ids
  Add-Snapshot -Stage 'before-account-window-fault' -Tasks $tasks
  $active = $tasks | Where-Object { @('preparing','awaiting_login','generating') -contains $_.state -and $_.accountId } | Select-Object -First 1
  if ($active) { break }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $activeDeadline)

if (-not $active) { $active = $tasks | Where-Object { $_.accountId } | Select-Object -First 1 }
$account = @{id=$active.accountId;name=$active.accountName;platform='豆包'} | ConvertTo-Json -Compress
$closeResult = Invoke-App -Expression "(async()=>await window.lingframe.doubao.close($account))()"
Write-Output "已关闭账号窗口：$($active.accountName)"
Start-Sleep -Seconds 1
$beforeRestart = Get-Tasks -Ids $ids
Add-Snapshot -Stage 'after-account-window-fault' -Tasks $beforeRestart

if (-not $electronPath.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Electron 路径越界' }
$processes = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $electronPath })
foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
$started = Start-Process -FilePath $electronPath -ArgumentList '.', "--remote-debugging-port=$DebugPort", '--no-sandbox' -WorkingDirectory $projectRoot -PassThru
$null = Wait-AppTarget -Seconds 60
Write-Output "已强制重启客户端：PID=$($started.Id)"

$afterRestart = Get-Tasks -Ids $ids
Add-Snapshot -Stage 'after-hard-restart' -Tasks $afterRestart
if ((@($afterRestart.id | Sort-Object) -join ',') -ne (@($ids | Sort-Object) -join ',')) { throw '重启后故障探针任务 ID 不完整' }

$terminal = @('completed','failed','cancelled','paused','result_review_required','awaiting_verification','awaiting_login','awaiting_quota','submission_unknown')
$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
do {
  $tasks = Get-Tasks -Ids $ids
  $unfinished = @($tasks | Where-Object { $terminal -notcontains $_.state })
  if ($unfinished.Count -eq 0) { break }
  Start-Sleep -Seconds 5
} while ((Get-Date) -lt $deadline)

$final = Get-Tasks -Ids $ids
Add-Snapshot -Stage 'final' -Tasks $final
$checks = @(
  [ordered]@{name='创建2条故障探针';ok=($final.Count -eq 2)},
  [ordered]@{name='关闭账号窗口后任务记录仍存在';ok=($beforeRestart.Count -eq 2)},
  [ordered]@{name='强制重启后任务ID保持不变';ok=((@($afterRestart.id|Sort-Object)-join ',') -eq (@($ids|Sort-Object)-join ','))},
  [ordered]@{name='重启后任务保留账号归属';ok=(@($afterRestart|Where-Object{-not $_.accountId}).Count -eq 0)},
  [ordered]@{name='最终失败或人工状态保留诊断';ok=(@($final|Where-Object{$_.state -ne 'completed' -and -not $_.failureCode -and -not $_.outcomeCode -and -not $_.recoveryState -and -not $_.userAction -and -not $_.error}).Count -eq 0)}
)

$report = [ordered]@{
  test = 'live-person-fault-injection'
  finishedAt = (Get-Date).ToString('o')
  taskIds = $ids
  faultAccount = [ordered]@{id=$active.accountId;name=$active.accountName;taskId=$active.id;closeResult=$closeResult}
  restart = [ordered]@{stoppedProcessCount=$processes.Count;startedProcessId=$started.Id}
  checks = $checks
  passed = @($checks|Where-Object{$_.ok}).Count
  failed = @($checks|Where-Object{-not $_.ok}).Count
  snapshots = $snapshots
  finalTasks = $final
}

New-Item -ItemType Directory -Force -Path (Split-Path -Parent $logPath) | Out-Null
[IO.File]::WriteAllText($logPath, (($report | ConvertTo-Json -Depth 50) + [Environment]::NewLine), [Text.UTF8Encoding]::new($false))
Write-Output "LIVE_PERSON_FAULT_INJECTION $($report.passed)/$($checks.Count) LOG=$logPath"
if ($report.failed -gt 0) { exit 1 }
