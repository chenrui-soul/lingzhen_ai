param(
  [int]$DebugPort = 9590,
  [int]$AssignmentWaitSeconds = 45,
  [string]$RunId = ""
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$policyPath = Join-Path $projectRoot 'references\live-person-submit-fault-ground-truth.json'
$policy = Get-Content -Raw -LiteralPath $policyPath | ConvertFrom-Json -Depth 30
$sourcePath = Join-Path $projectRoot (Join-Path 'references' $policy.sourceGroundTruth)
$truth = Get-Content -Raw -LiteralPath $sourcePath | ConvertFrom-Json -Depth 30
$electronPath = (Resolve-Path (Join-Path $projectRoot 'node_modules\electron\dist\electron.exe')).Path
$logDir = Join-Path $projectRoot 'scripts\log'
$startedAt = Get-Date
if (-not $RunId) { $RunId = $startedAt.ToString('yyyyMMdd-HHmmss') }
$script:CdpId = 900
$snapshots = [System.Collections.Generic.List[object]]::new()
$faults = [System.Collections.Generic.List[object]]::new()

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Get-AppTarget {
  $targets = Invoke-RestMethod "http://127.0.0.1:$DebugPort/json/list"
  $matches = @($targets | Where-Object { $_.type -eq 'page' -and $_.title -eq '灵帧AI' })
  if ($matches.Count -ne 1) { throw "灵帧AI页面数量异常：$($matches.Count)" }
  return $matches[0]
}

function Wait-AppTarget {
  param([int]$Seconds = 60)
  $deadline = (Get-Date).AddSeconds($Seconds)
  do {
    try { return (Get-AppTarget) } catch { Start-Sleep -Milliseconds 400 }
  } while ((Get-Date) -lt $deadline)
  throw "等待灵帧AI调试页面超时：${Seconds}s"
}

function Invoke-App {
  param([Parameter(Mandatory = $true)][string]$Expression, [int]$Seconds = 90)
  $target = Wait-AppTarget -Seconds $Seconds
  $socket = [Net.WebSockets.ClientWebSocket]::new()
  try {
    $cancel = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($Seconds))
    $null = $socket.ConnectAsync([Uri]([string]$target.webSocketDebuggerUrl), $cancel.Token).GetAwaiter().GetResult()
    $script:CdpId += 1
    $requestId = $script:CdpId
    $message = @{id=$requestId;method='Runtime.evaluate';params=@{expression=$Expression;awaitPromise=$true;returnByValue=$true}} | ConvertTo-Json -Depth 40 -Compress
    $bytes = [Text.Encoding]::UTF8.GetBytes($message)
    $null = $socket.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, $cancel.Token).GetAwaiter().GetResult()
    $buffer = New-Object byte[] 1048576
    while ($true) {
      $stream = [IO.MemoryStream]::new()
      do {
        $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), $cancel.Token).GetAwaiter().GetResult()
        if ($received.MessageType -eq [Net.WebSockets.WebSocketMessageType]::Close) { throw '调试连接提前关闭' }
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
(async()=>{const ids=$idsJson;const data=await window.lingframe.workbench.bootstrap();return (data.tasks||[]).filter(task=>ids.includes(task.id)).map(task=>({id:task.id,title:task.title,state:task.state,stage:task.stage,statusText:task.statusText,accountId:task.accountId||'',accountName:task.accountName||'',assetIds:task.assetIds||[],doubaoModel:task.doubaoModel,duration:task.duration,ratio:task.ratio,executionChannel:task.executionChannel,submittedVerified:task.submittedVerified===true,recoveryState:task.recoveryState||'',failureCode:task.failureCode||'',createdAt:task.createdAt,updatedAt:task.updatedAt}))})()
"@
  return @(Invoke-App -Expression $expression)
}

function Add-Snapshot {
  param([string]$Stage, [object[]]$Tasks)
  $entry = [ordered]@{at=(Get-Date).ToString('o');stage=$Stage;tasks=@($Tasks)}
  $snapshots.Add($entry)
  $states = @($Tasks | Group-Object state | ForEach-Object { "$($_.Name)=$($_.Count)" }) -join ', '
  $accounts = @($Tasks | Where-Object accountId | Select-Object -ExpandProperty accountId -Unique).Count
  Write-Output "[$((Get-Date).ToString('HH:mm:ss'))] $Stage :: $states :: accounts=$accounts"
}

$preflight = Invoke-App -Expression @"
(async()=>{const data=await window.lingframe.workbench.bootstrap();const asset=(data.assets||[]).find(item=>item.id==='$($truth.referenceAsset.id)');return {projectId:data.currentProjectId,asset,accounts:(data.tasks||[]).filter(task=>!task.deletedAt&&['preparing','checking_login','uploading','configuring','submitting','generating','submission_unknown'].includes(task.state)).map(task=>({id:task.id,state:task.state,accountId:task.accountId,accountName:task.accountName}))}})()
"@
if (-not $preflight.asset -or $preflight.asset.deletedAt) { throw '真人参考图片不存在或已删除' }
if ($preflight.projectId -ne $truth.projectId) { throw "当前项目与测试项目不一致：$($preflight.projectId)" }

$inputs = @()
for ($index = 0; $index -lt [int]$policy.taskCount; $index += 1) {
  $sourcePrompt = [string]$truth.prompts[$index]
  $body = $sourcePrompt -replace '^【真人图压力测试\d+】', ''
  $titlePrefix = "【真人并行提交-$RunId-$('{0:D2}' -f ($index + 1))】"
  $prompt = "$titlePrefix$body"
  $inputs += [ordered]@{
    title = $prompt.Substring(0, [Math]::Min(60, $prompt.Length))
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
    referenceAssets = @([ordered]@{assetId=$truth.referenceAsset.id;role=$truth.referenceAsset.role;label=$truth.referenceAsset.name;description=$truth.referenceAsset.description;order=1})
    accountGroupId = 'all'
    accountId = $truth.accountCandidates[0].id
    accountName = $truth.accountCandidates[0].name
    accountSelectionMode = 'auto'
    accountCandidates = @($truth.accountCandidates)
  }
}

$inputsJson = ConvertTo-Json @($inputs) -Depth 30 -Compress
$created = @(Invoke-App -Seconds 120 -Expression "(async()=>{const inputs=$inputsJson;const output=[];for(const input of inputs)output.push(await window.lingframe.generation.create(input));return output.map(task=>({id:task.id,title:task.title,state:task.state,createdAt:task.createdAt}))})()")
if ($created.Count -ne [int]$policy.taskCount) { throw "任务创建数量错误：$($created.Count)/$($policy.taskCount)" }
$taskIds = @($created | ForEach-Object { $_.id })
if (($taskIds | Select-Object -Unique).Count -ne [int]$policy.taskCount) { throw '任务 ID 存在重复' }
Write-Output "已创建 $($created.Count) 条真人图片视频任务：$($taskIds -join ',')"

$assignmentDeadline = (Get-Date).AddSeconds($AssignmentWaitSeconds)
$faultTarget = $null
$observedAccounts = @()
do {
  $tasks = Get-Tasks -Ids $taskIds
  Add-Snapshot -Stage 'waiting-for-parallel-assignment' -Tasks $tasks
  $observedAccounts = @($tasks | Where-Object accountId | Select-Object -ExpandProperty accountId -Unique)
  $faultTarget = $tasks | Where-Object { @('preparing','checking_login','uploading','configuring','submitting','awaiting_confirmation','generating') -contains $_.state -and $_.accountId } | Select-Object -First 1
  if ($faultTarget -and $observedAccounts.Count -ge 2) { break }
  Start-Sleep -Milliseconds 700
} while ((Get-Date) -lt $assignmentDeadline)

if (-not $faultTarget) { $faultTarget = $tasks | Where-Object accountId | Select-Object -First 1 }
if (-not $faultTarget) { throw '没有找到可注入账号窗口故障的任务' }
$accountJson = @{id=$faultTarget.accountId;name=$faultTarget.accountName;platform='豆包'} | ConvertTo-Json -Compress
$closeResult = Invoke-App -Expression "(async()=>await window.lingframe.doubao.close($accountJson))()"
$faults.Add([ordered]@{type='close-account-window';at=(Get-Date).ToString('o');taskId=$faultTarget.id;accountId=$faultTarget.accountId;accountName=$faultTarget.accountName;state=$faultTarget.state;result=$closeResult})
Write-Output "已关闭豆包账号窗口：$($faultTarget.accountName) / $($faultTarget.id) / state=$($faultTarget.state)"

Start-Sleep -Milliseconds 800
$beforeRestart = Get-Tasks -Ids $taskIds
Add-Snapshot -Stage 'after-account-window-close' -Tasks $beforeRestart

if (-not $electronPath.StartsWith($projectRoot, [StringComparison]::OrdinalIgnoreCase)) { throw 'Electron 路径不在项目目录内' }
$processes = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $electronPath })
foreach ($process in $processes) { Stop-Process -Id $process.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Seconds 2
$started = Start-Process -FilePath $electronPath -ArgumentList '.', "--remote-debugging-port=$DebugPort", '--no-sandbox' -WorkingDirectory $projectRoot -PassThru
$null = Wait-AppTarget -Seconds 60
$faults.Add([ordered]@{type='hard-client-restart';at=(Get-Date).ToString('o');stoppedProcessCount=$processes.Count;startedProcessId=$started.Id})
Write-Output "已强制重启客户端：PID=$($started.Id)"

$afterRestart = Get-Tasks -Ids $taskIds
Add-Snapshot -Stage 'after-hard-restart-submit-only-stop' -Tasks $afterRestart
$afterIds = @($afterRestart | ForEach-Object id)
$accountCount = @($beforeRestart | Where-Object accountId | Select-Object -ExpandProperty accountId -Unique).Count
$checks = @(
  [ordered]@{name='恰好创建10条唯一任务';ok=($afterRestart.Count -eq [int]$policy.taskCount -and ($afterIds|Select-Object -Unique).Count -eq [int]$policy.taskCount);actual=$afterRestart.Count},
  [ordered]@{name='全部绑定指定真人参考图片';ok=(@($afterRestart|Where-Object{@($_.assetIds).Count -ne 1 -or $_.assetIds[0] -ne $truth.referenceAsset.id}).Count -eq 0)},
  [ordered]@{name='全部保持Mini、10秒、9:16';ok=(@($afterRestart|Where-Object{$_.doubaoModel -ne $truth.model -or $_.duration -ne $truth.duration -or $_.ratio -ne $truth.ratio}).Count -eq 0)},
  [ordered]@{name='故障前至少分配到2个账号';ok=($accountCount -ge 2);actual=$accountCount},
  [ordered]@{name='账号窗口关闭故障已执行';ok=(@($faults|Where-Object{$_.type -eq 'close-account-window'}).Count -eq 1)},
  [ordered]@{name='客户端强制重启故障已执行';ok=(@($faults|Where-Object{$_.type -eq 'hard-client-restart'}).Count -eq 1)},
  [ordered]@{name='重启前后任务ID保持不变';ok=((@($afterIds|Sort-Object)-join ',') -eq (@($taskIds|Sort-Object)-join ','))},
  [ordered]@{name='测试按提交边界结束且未等待结果';ok=$true;actual='after-hard-restart-submit-only-stop'}
)

$report = [ordered]@{
  test = $policy.testName
  runId = $RunId
  startedAt = $startedAt.ToString('o')
  finishedAt = (Get-Date).ToString('o')
  completionBoundary = $policy.completionBoundary
  policyGroundTruth = $policyPath
  sourceGroundTruth = $sourcePath
  taskIds = $taskIds
  referenceAsset = $truth.referenceAsset
  parameters = [ordered]@{model=$truth.model;duration=$truth.duration;ratio=$truth.ratio}
  faults = $faults
  checks = $checks
  passed = @($checks|Where-Object{$_.ok}).Count
  failed = @($checks|Where-Object{-not $_.ok}).Count
  snapshots = $snapshots
  finalSnapshot = $afterRestart
  clientProcessId = $started.Id
}

$stableLog = Join-Path $logDir 'live-person-submit-fault.json'
$timestampLog = Join-Path $logDir ("live-person-submit-fault-{0}.json" -f $RunId)
$json = $report | ConvertTo-Json -Depth 50
[IO.File]::WriteAllText($stableLog, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($timestampLog, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Output "LIVE_PERSON_SUBMIT_FAULT tasks=$($afterRestart.Count) accounts=$accountCount checks=$($report.passed)/$($checks.Count) PID=$($started.Id)"
Write-Output "LOG=$stableLog"
if ($report.failed -gt 0) { exit 1 }
