param(
  [int]$TimeoutMinutes = 30,
  [int]$DebugPort = 9590,
  [switch]$ResumeExisting
)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$truthPath = Join-Path $projectRoot 'references\live-person-video-stress-ground-truth.json'
$logDir = Join-Path $projectRoot 'scripts\log'
$electronPath = (Resolve-Path (Join-Path $projectRoot 'node_modules\electron\dist\electron.exe')).Path
$truth = Get-Content -Raw -LiteralPath $truthPath | ConvertFrom-Json -Depth 30
$startedAt = Get-Date
$script:CdpId = 0
$snapshots = [System.Collections.Generic.List[object]]::new()
$faults = [System.Collections.Generic.List[object]]::new()
$maxGlobalActive = 0
$maxActiveByAccount = @{}

New-Item -ItemType Directory -Force -Path $logDir | Out-Null

function Get-CdpTarget {
  $targets = Invoke-RestMethod "http://127.0.0.1:$DebugPort/json/list"
  $matches = @($targets | Where-Object { $_.type -eq 'page' -and $_.title -eq '灵帧AI' })
  if ($matches.Count -ne 1) { throw "期望一个灵帧AI调试页面，实际为 $($matches.Count)" }
  return $matches[0]
}

function Wait-Cdp {
  param([int]$TimeoutSeconds = 45)
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  do {
    try { return (Get-CdpTarget) } catch { Start-Sleep -Milliseconds 500 }
  } while ((Get-Date) -lt $deadline)
  throw "等待灵帧AI调试页面超时：${TimeoutSeconds}s"
}

function Invoke-CdpExpression {
  param(
    [Parameter(Mandatory = $true)][string]$Expression,
    [int]$TimeoutSeconds = 60
  )
  $target = Wait-Cdp -TimeoutSeconds $TimeoutSeconds
  $socket = [System.Net.WebSockets.ClientWebSocket]::new()
  try {
    $cancel = [Threading.CancellationTokenSource]::new([TimeSpan]::FromSeconds($TimeoutSeconds))
    $null = $socket.ConnectAsync([Uri]([string]$target.webSocketDebuggerUrl), $cancel.Token).GetAwaiter().GetResult()
    $script:CdpId += 1
    $requestId = $script:CdpId
    $message = @{
      id = $requestId
      method = 'Runtime.evaluate'
      params = @{
        expression = $Expression
        awaitPromise = $true
        returnByValue = $true
      }
    } | ConvertTo-Json -Depth 40 -Compress
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

function Get-TestTasks {
  param([string[]]$TaskIds)
  $idsJson = ConvertTo-Json @($TaskIds) -Compress
  $expression = @"
(async()=>{
  const ids=$idsJson;
  const data=await window.lingframe.workbench.bootstrap();
  return (data.tasks||[]).filter(task=>ids.includes(task.id)).map(task=>({
    id:task.id,title:task.title,prompt:task.prompt,state:task.state,stage:task.stage,
    statusText:task.statusText,progress:task.progress,accountId:task.accountId,
    accountName:task.accountName,submittedVerified:task.submittedVerified===true,
    conversationId:task.conversationId||'',resultAssetId:task.resultAssetId||'',
    resultAssetIds:Array.isArray(task.resultAssetIds)?task.resultAssetIds:[],
    resultUrls:Array.isArray(task.resultUrls)?task.resultUrls:[],resultVid:task.resultVid||'',
    failureCode:task.failureCode||'',failureCategory:task.failureCategory||'',
    outcomeCode:task.outcomeCode||'',retryMode:task.retryMode||'',
    recoveryState:task.recoveryState||'',userAction:task.userAction||'',
    error:task.error||'',createdAt:task.createdAt,updatedAt:task.updatedAt,
    assetIds:Array.isArray(task.assetIds)?task.assetIds:[],doubaoModel:task.doubaoModel,
    duration:task.duration,ratio:task.ratio,executionChannel:task.executionChannel
  }));
})()
"@
  return @(Invoke-CdpExpression -Expression $expression)
}

function Add-Snapshot {
  param([string]$Stage, [object[]]$Tasks)
  $counts = @{}
  foreach ($task in $Tasks) {
    $state = [string]$task.state
    if (-not $counts.ContainsKey($state)) { $counts[$state] = 0 }
    $counts[$state] += 1
  }
  $activeStates = @('queued','preparing','awaiting_login','generating','downloading','verifying','submission_unknown')
  $active = @($Tasks | Where-Object { $activeStates -contains $_.state })
  $maxGlobalActive = [Math]::Max($script:maxGlobalActive, $active.Count)
  $script:maxGlobalActive = $maxGlobalActive
  foreach ($group in ($active | Group-Object accountId)) {
    $key = if ($group.Name) { $group.Name } else { 'unassigned' }
    $prior = if ($script:maxActiveByAccount.ContainsKey($key)) { [int]$script:maxActiveByAccount[$key] } else { 0 }
    $script:maxActiveByAccount[$key] = [Math]::Max($prior, $group.Count)
  }
  $entry = [ordered]@{
    at = (Get-Date).ToString('o')
    stage = $Stage
    counts = $counts
    tasks = @($Tasks | ForEach-Object { [ordered]@{id=$_.id;state=$_.state;accountId=$_.accountId;accountName=$_.accountName;submittedVerified=$_.submittedVerified;statusText=$_.statusText;failureCode=$_.failureCode;recoveryState=$_.recoveryState} })
  }
  $snapshots.Add($entry)
  $summary = ($counts.GetEnumerator() | Sort-Object Name | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ', '
  Write-Output "[$((Get-Date).ToString('HH:mm:ss'))] $Stage :: $summary"
}

function Restart-ClientHard {
  $resolvedProject = (Resolve-Path $projectRoot).Path
  if (-not $electronPath.StartsWith($resolvedProject, [StringComparison]::OrdinalIgnoreCase)) { throw 'Electron 路径不在项目目录内' }
  $targets = @(Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq $electronPath })
  foreach ($target in $targets) { Stop-Process -Id $target.ProcessId -Force -ErrorAction SilentlyContinue }
  Start-Sleep -Seconds 2
  $started = Start-Process -FilePath $electronPath -ArgumentList '.', "--remote-debugging-port=$DebugPort", '--no-sandbox' -WorkingDirectory $projectRoot -PassThru
  $null = Wait-Cdp -TimeoutSeconds 60
  return [ordered]@{stoppedProcessCount=$targets.Count;startedProcessId=$started.Id;at=(Get-Date).ToString('o')}
}

$preflightExpression = @"
(async()=>{
  const data=await window.lingframe.workbench.bootstrap();
  const asset=(data.assets||[]).find(item=>item.id==='$($truth.referenceAsset.id)');
  const duplicate=(data.tasks||[]).filter(task=>String(task.title||'').startsWith('【真人图压力测试'));
  return {currentProjectId:data.currentProjectId,asset,existingTestTaskCount:duplicate.length,existingTestTasks:duplicate.map(task=>({id:task.id,title:task.title,state:task.state,createdAt:task.createdAt}))};
})()
"@
$preflight = Invoke-CdpExpression -Expression $preflightExpression
if (-not $preflight.asset -or $preflight.asset.deletedAt) { throw '指定真人参考图不存在或已删除' }
if ($preflight.currentProjectId -ne $truth.projectId) { throw "当前项目不是 Ground Truth 指定项目：$($preflight.currentProjectId)" }
if ([int]$preflight.existingTestTaskCount -gt 0 -and -not $ResumeExisting) { throw '已存在同名前缀的真人图压力测试任务；为避免重复消耗额度，本次拒绝再次提交' }
if ($ResumeExisting -and [int]$preflight.existingTestTaskCount -ne [int]$truth.taskCount) { throw "接管模式要求恰好存在 $($truth.taskCount) 条任务，实际为 $($preflight.existingTestTaskCount)" }

$inputs = @()
foreach ($prompt in $truth.prompts) {
  $inputs += [ordered]@{
    title = $prompt.Substring(0, [Math]::Min(36, $prompt.Length))
    prompt = $prompt
    projectId = $truth.projectId
    creationType = 'video'
    creationSource = 'home'
    executionChannel = $truth.executionChannel
    ratio = $truth.ratio
    duration = $truth.duration
    doubaoModel = $truth.model
    workflowType = $truth.workflowType
    assetIds = @($truth.referenceAsset.id)
    referenceAssets = @([ordered]@{
      assetId = $truth.referenceAsset.id
      role = $truth.referenceAsset.role
      label = $truth.referenceAsset.name
      description = $truth.referenceAsset.description
      order = 1
    })
    accountGroupId = 'all'
    accountId = $truth.accountCandidates[0].id
    accountName = $truth.accountCandidates[0].name
    accountSelectionMode = 'auto'
    accountCandidates = @($truth.accountCandidates)
  }
}

$inputsJson = ConvertTo-Json @($inputs) -Depth 30 -Compress
$submitExpression = @"
(async()=>{
  const inputs=$inputsJson;
  const created=[];
  for(const input of inputs){created.push(await window.lingframe.generation.create(input));}
  return created.map(task=>({id:task.id,title:task.title,state:task.state,createdAt:task.createdAt}));
})()
"@
$created = if ($ResumeExisting) { @($preflight.existingTestTasks) } else { @(Invoke-CdpExpression -Expression $submitExpression -TimeoutSeconds 120) }
if ($created.Count -ne [int]$truth.taskCount) { throw "创建任务数量错误：$($created.Count)/$($truth.taskCount)" }
$taskIds = @($created | ForEach-Object { $_.id })
if (($taskIds | Select-Object -Unique).Count -ne $truth.taskCount) { throw '创建结果包含重复任务 ID' }
Write-Output "已创建 $($created.Count) 条真实豆包任务：$($taskIds -join ',')"

$evidenceDeadline = (Get-Date).AddMinutes(6)
$faultTarget = $null
do {
  $tasks = Get-TestTasks -TaskIds $taskIds
  Add-Snapshot -Stage 'waiting-for-submission-evidence' -Tasks $tasks
  $faultTarget = $tasks | Where-Object { $_.state -eq 'generating' -and $_.submittedVerified -and $_.accountId } | Select-Object -First 1
  if ($faultTarget) { break }
  Start-Sleep -Seconds 5
} while ((Get-Date) -lt $evidenceDeadline)

if ($faultTarget) {
  $accountJson = ConvertTo-Json @{id=$faultTarget.accountId;name=$faultTarget.accountName;platform='豆包'} -Compress
  $closeExpression = "(async()=>await window.lingframe.doubao.close($accountJson))()"
  $closeResult = Invoke-CdpExpression -Expression $closeExpression
  $faults.Add([ordered]@{type='close-account-window';at=(Get-Date).ToString('o');taskId=$faultTarget.id;accountId=$faultTarget.accountId;accountName=$faultTarget.accountName;result=$closeResult})
  Write-Output "已注入账号窗口关闭故障：$($faultTarget.accountName) / $($faultTarget.id)"
} else {
  $faults.Add([ordered]@{type='close-account-window';at=(Get-Date).ToString('o');injected=$false;reason='6分钟内没有任务获得提交证据'})
  Write-Output '账号窗口关闭故障未注入：6分钟内没有任务获得提交证据'
}

Start-Sleep -Seconds 8
$beforeRestart = Get-TestTasks -TaskIds $taskIds
Add-Snapshot -Stage 'before-hard-restart' -Tasks $beforeRestart
$restart = Restart-ClientHard
$faults.Add([ordered]@{type='hard-client-restart';at=$restart.at;stoppedProcessCount=$restart.stoppedProcessCount;startedProcessId=$restart.startedProcessId})
Write-Output "已注入客户端强制重启故障，新主进程 PID=$($restart.startedProcessId)"

$afterRestart = Get-TestTasks -TaskIds $taskIds
Add-Snapshot -Stage 'after-hard-restart' -Tasks $afterRestart
$afterIds = @($afterRestart | ForEach-Object { $_.id })
if (($afterIds | Sort-Object) -join ',' -ne ($taskIds | Sort-Object) -join ',') { throw '客户端重启后任务 ID 集合发生变化' }

$deadline = (Get-Date).AddMinutes($TimeoutMinutes)
$finalStates = @('completed','failed','cancelled','paused','result_review_required','awaiting_verification','awaiting_login','awaiting_quota','submission_unknown')
$lastPrint = [DateTime]::MinValue
do {
  $tasks = Get-TestTasks -TaskIds $taskIds
  if (((Get-Date) - $lastPrint).TotalSeconds -ge 20) {
    Add-Snapshot -Stage 'monitoring-after-faults' -Tasks $tasks
    $lastPrint = Get-Date
  }
  $unfinished = @($tasks | Where-Object { $finalStates -notcontains $_.state })
  if ($unfinished.Count -eq 0) { break }
  Start-Sleep -Seconds 5
} while ((Get-Date) -lt $deadline)

$finalTasks = Get-TestTasks -TaskIds $taskIds
Add-Snapshot -Stage 'final' -Tasks $finalTasks
$completed = @($finalTasks | Where-Object { $_.state -eq 'completed' })
$failed = @($finalTasks | Where-Object { $_.state -eq 'failed' })
$attention = @($finalTasks | Where-Object { @('paused','result_review_required','awaiting_verification','awaiting_login','awaiting_quota','submission_unknown') -contains $_.state })
$stillRunning = @($finalTasks | Where-Object { @('completed','failed','cancelled','paused','result_review_required','awaiting_verification','awaiting_login','awaiting_quota','submission_unknown') -notcontains $_.state })

$checks = @(
  [ordered]@{name='恰好创建10条任务';ok=($finalTasks.Count -eq $truth.taskCount);actual=$finalTasks.Count},
  [ordered]@{name='任务ID在强制重启后保持不变';ok=((@($finalTasks.id|Sort-Object) -join ',') -eq (@($taskIds|Sort-Object) -join ','));actual=@($finalTasks.id)},
  [ordered]@{name='所有任务绑定指定人物参考图';ok=(@($finalTasks|Where-Object{@($_.assetIds).Count -ne 1 -or $_.assetIds[0] -ne $truth.referenceAsset.id}).Count -eq 0)},
  [ordered]@{name='所有任务参数保持Mini、10秒、9:16';ok=(@($finalTasks|Where-Object{$_.doubaoModel -ne $truth.model -or $_.duration -ne $truth.duration -or $_.ratio -ne $truth.ratio}).Count -eq 0)},
  [ordered]@{name='已完成任务都有结果素材';ok=(@($completed|Where-Object{-not $_.resultAssetId -and @($_.resultAssetIds).Count -eq 0}).Count -eq 0)},
  [ordered]@{name='失败和人工任务都有诊断或恢复状态';ok=(@(($failed+$attention)|Where-Object{-not $_.failureCode -and -not $_.outcomeCode -and -not $_.recoveryState -and -not $_.userAction -and -not $_.error}).Count -eq 0)},
  [ordered]@{name='同账号没有观测到并发执行超过1';ok=(@($maxActiveByAccount.GetEnumerator()|Where-Object{$_.Key -ne 'unassigned' -and $_.Value -gt 1}).Count -eq 0);actual=$maxActiveByAccount},
  [ordered]@{name='确实观测到多账号并行';ok=($maxGlobalActive -ge 2);actual=$maxGlobalActive},
  [ordered]@{name='账号窗口关闭故障已执行';ok=(@($faults|Where-Object{$_.type -eq 'close-account-window' -and $_.injected -ne $false}).Count -eq 1)},
  [ordered]@{name='客户端强制重启故障已执行';ok=(@($faults|Where-Object{$_.type -eq 'hard-client-restart'}).Count -eq 1)}
)

$report = [ordered]@{
  test = $truth.testName
  startedAt = $startedAt.ToString('o')
  finishedAt = (Get-Date).ToString('o')
  groundTruth = $truthPath
  taskIds = $taskIds
  totals = [ordered]@{all=$finalTasks.Count;completed=$completed.Count;failed=$failed.Count;attention=$attention.Count;stillRunning=$stillRunning.Count}
  concurrency = [ordered]@{maxGlobalActive=$maxGlobalActive;maxActiveByAccount=$maxActiveByAccount}
  faults = $faults
  checks = $checks
  passedChecks = @($checks|Where-Object{$_.ok}).Count
  failedChecks = @($checks|Where-Object{-not $_.ok}).Count
  snapshots = $snapshots
  finalTasks = $finalTasks
}

$stableLog = Join-Path $logDir 'live-person-video-stress.json'
$timestampLog = Join-Path $logDir ("live-person-video-stress-{0}.json" -f $startedAt.ToString('yyyyMMdd-HHmmss'))
$json = $report | ConvertTo-Json -Depth 50
[IO.File]::WriteAllText($stableLog, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
[IO.File]::WriteAllText($timestampLog, $json + [Environment]::NewLine, [Text.UTF8Encoding]::new($false))
Write-Output "LIVE_PERSON_VIDEO_STRESS completed=$($completed.Count) failed=$($failed.Count) attention=$($attention.Count) running=$($stillRunning.Count) checks=$($report.passedChecks)/$($checks.Count)"
Write-Output "LOG=$stableLog"
if ($report.failedChecks -gt 0 -or $stillRunning.Count -gt 0) { exit 1 }
