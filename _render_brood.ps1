# Helper: create & check the Broodiinnox App static site on Render.
# Uses the API key stored in Tech Projects\render_api.txt (read from file, never printed).
$ErrorActionPreference = 'Stop'
$line = (Get-Content 'C:\Users\CLAUDE\Desktop\Tech Projects\render_api.txt' -Raw).Trim()
$key  = $line.Substring($line.IndexOf('=') + 1)
$headers = @{ Authorization = "Bearer $key" }

function Invoke-Render([string]$Method, [string]$Uri, [object]$Body = $null) {
  $json = if ($null -ne $Body) { $Body | ConvertTo-Json -Depth 10 } else { $null }
  $params = @{ Uri = $Uri; Headers = $headers; Method = $Method }
  if ($null -ne $json) {
    $params['ContentType'] = 'application/json'
    $params['Body'] = $json
  }
  return Invoke-RestMethod @params
}

$action = $args[0]
switch ($action) {
  'create' {
    $body = @{
      type              = 'static_site'
      name              = 'broodiinnox-app'
      repo              = 'https://github.com/afriinnox-eng/Broodiinnox-App'
      branch            = 'main'
      buildCommand      = 'npm ci && npm run build'
      staticPublishPath = 'dist'
      autoDeploy        = $true
      routes            = @(@{ type = 'rewrite'; source = '/*'; destination = '/index.html' })
      headers           = @(@{ path = '/*'; name = 'X-Frame-Options'; value = 'sameorigin' })
    }
    $svc = Invoke-Render POST 'https://api.render.com/v1/services' $body
    "created service id=$($svc.id) name=$($svc.name) url=$($svc.serviceDetails.url)"
  }
  'status' {
    $svcs = Invoke-Render GET 'https://api.render.com/v1/services?limit=100'
    $svc = ($svcs | Where-Object { $_.service.name -eq 'broodiinnox-app' } | Select-Object -First 1).service
    if (-not $svc) { 'no service named broodiinnox-app'; exit 1 }
    "service id=$($svc.id) type=$($svc.type) state=$($svc.state) url=$($svc.serviceDetails.url)"
    $deploys = Invoke-Render GET "https://api.render.com/v1/services/$($svc.id)/deploys?limit=5"
    $deploys | ForEach-Object { "  deploy id=$($_.id) status=$($_.status) createdAt=$($_.createdAt)" }
  }
  'check' {
    $url = $args[1]
    $r = Invoke-WebRequest -Uri $url -UseBasicParsing -TimeoutSec 60
    "http=$($r.StatusCode) len=$($r.Content.Length)"
    if ($r.Content -match 'Broodiinnox') { 'content: contains Broodiinnox branding' } else { 'content: Broodiinnox NOT found' }
  }
  default { 'usage: create|status|check <url>' }
}
