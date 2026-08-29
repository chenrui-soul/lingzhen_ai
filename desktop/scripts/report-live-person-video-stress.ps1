param([int]$DebugPort = 9590)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$truthPath = Join-Path $projectRoot 'references\live-person-video-stress-ground-truth.json'
$truth = Get-Content -Raw -LiteralPath $truthPath | ConvertFrom-Json -Depth 30
$targets = Invoke-RestMethod "http://127.0.0.1:$DebugPort/json/list"
$target = @($targets | Where-Object { $_.type -eq 'page' -and $_.title -eq '灵帧AI' })
if ($target.Count -ne 1) { throw "灵帧AI页面数量异常：$($target.Count)" }

$socket = [Net.WebSockets.ClientWebSocket]::new()
try {
  $null = $socket.ConnectAsync([Uri]([string]$target[0].webSocketDebuggerUrl), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
  $expression = @'
(async()=>{const d=await window.lingframe.workbench.bootstrap();return (d.tasks||[]).filter(t=>String(t.title||'').startsWith('【真人图压力测试')).map(t=>({id:t.id,title:t.title,state:t.state,statusText:t.statusText,accountId:t.accountId,accountName:t.accountName,submittedVerified:t.submittedVerified===true,doubaoModel:t.doubaoModel,duration:t.duration,ratio:t.ratio,assetIds:t.assetIds||[],failureCode:t.failureCode||'',failureCategory:t.failureCategory||'',outcomeCode:t.outcomeCode||'',retryMode:t.retryMode||'',userAction:t.userAction||'',error:t.error||'',conversationId:t.conversationId||'',referenceUploadVerified:t.evidence?.referenceUpload?.verified===true,createdAt:t.createdAt,updatedAt:t.updatedAt}))})()
'@
  $request = @{id=501;method='Runtime.evaluate';params=@{expression=$expression;awaitPromise=$true;returnByValue=$true}} | ConvertTo-Json -Depth 20 -Compress
  $bytes = [Text.Encoding]::UTF8.GetBytes($request)
  $null = $socket.SendAsync([ArraySegment[byte]]::new($bytes), [Net.WebSockets.WebSocketMessageType]::Text, $true, [Threading.CancellationToken]::None).GetAwaiter().GetResult()
  $buffer = New-Object byte[] 1048576
  $stream = [IO.MemoryStream]::new()
  do {
    $received = $socket.ReceiveAsync([ArraySegment[byte]]::new($buffer), [Threading.CancellationToken]::None).GetAwaiter().GetResult()
    $stream.Write($buffer, 0, $received.Count)
  } while (-not $received.EndOfMessage)
  $response = [Text.Encoding]::UTF8.GetString($stream.ToArray()) | ConvertFrom-Json -Depth 40
  $tasks = @($response.result.result.value)
} finally {
  $socket.Dispose()
}

$accountDistribution = @{}
foreach ($group in ($tasks | Group-Object accountId)) { $accountDistribution[$group.Name] = $group.Count }
$stateDistribution = @{}
foreach ($group in ($tasks | Group-Object state)) { $stateDistribution[$group.Name] = $group.Count }
$failureDistribution = @{}
foreach ($group in ($tasks | Group-Object failureCode)) { $failureDistribution[$group.Name] = $group.Count }

$checks = @(
  [ordered]@{name='恰好提交10条真实任务';ok=($tasks.Count -eq [int]$truth.taskCount);actual=$tasks.Count},
  [ordered]@{name='10条任务ID全部唯一';ok=(($tasks.id|Select-Object -Unique).Count -eq $tasks.Count)},
  [ordered]@{name='全部使用指定真人参考图';ok=(@($tasks|Where-Object{@($_.assetIds).Count -ne 1 -or $_.assetIds[0] -ne $truth.referenceAsset.id}).Count -eq 0)},
  [ordered]@{name='全部保持Mini、10秒、9:16';ok=(@($tasks|Where-Object{$_.doubaoModel -ne $truth.model -or $_.duration -ne $truth.duration -or $_.ratio -ne $truth.ratio}).Count -eq 0)},
  [ordered]@{name='自动负载均衡覆盖5个账号';ok=($accountDistribution.Keys.Count -eq 5);actual=$accountDistribution},
  [ordered]@{name='所有任务均获得明确豆包结果分类';ok=(@($tasks|Where-Object{-not $_.failureCode -and -not $_.outcomeCode}).Count -eq 0);actual=$failureDistribution}
)

$report = [ordered]@{
  test = 'live-person-video-stress'
  timestamp = (Get-Date).ToString('o')
  groundTruth = $truthPath
  total = $tasks.Count
  submittedVerified = @($tasks|Where-Object{$_.submittedVerified}).Count
  referenceUploadVerified = @($tasks|Where-Object{$_.referenceUploadVerified}).Count
  accountDistribution = $accountDistribution
  stateDistribution = $stateDistribution
  failureDistribution = $failureDistribution
  passedChecks = @($checks|Where-Object{$_.ok}).Count
  failedChecks = @($checks|Where-Object{-not $_.ok}).Count
  checks = $checks
  tasks = $tasks
}

$logDir = Join-Path $projectRoot 'scripts\log'
New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$logPath = Join-Path $logDir 'live-person-video-stress.json'
[IO.File]::WriteAllText($logPath, (($report|ConvertTo-Json -Depth 50)+[Environment]::NewLine), [Text.UTF8Encoding]::new($false))
Write-Output "LIVE_PERSON_VIDEO_STRESS_REPORT $($report.passedChecks)/$($checks.Count) tasks=$($tasks.Count) accounts=$($accountDistribution.Keys.Count) LOG=$logPath"
if ($report.failedChecks -gt 0) { exit 1 }
