# Rebuild the browser tab icon from the supplied Afriinnox icon artwork.
#
# public/favicon.svg used to draw a generic "network / activity" glyph (three
# rising bars and a green dot) — nothing to do with the brand. The tab now
# carries the real mark: the artwork is downscaled to 96px, embedded in the SVG
# as a data URI (one request, no external reference, so it cannot 404), and set
# in a brand-blue tile with the same white chip the app's own brand tile uses.
#
# The shipped 256px asset is also published to public/ as the raster fallback and
# the apple-touch-icon, for anything that will not take an SVG favicon.
Add-Type -AssemblyName System.Drawing

$root = (Get-Location).Path
$src = Join-Path $root 'src\assets\afriinnox-icon.png'

Copy-Item $src (Join-Path $root 'public\afriinnox-icon.png') -Force

# 96px copy -> base64 -> embedded in the SVG
$bmp = [System.Drawing.Bitmap]::FromFile($src)
$size = 96
$small = New-Object System.Drawing.Bitmap($size, $size)
$g = [System.Drawing.Graphics]::FromImage($small)
$g.Clear([System.Drawing.Color]::White)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality
$g.DrawImage($bmp, 0, 0, $size, $size)
$g.Dispose()
$tmp = Join-Path $root '_favicon_icon.png'
$small.Save($tmp, [System.Drawing.Imaging.ImageFormat]::Png)
$small.Dispose()
$bmp.Dispose()
$b64 = [Convert]::ToBase64String([IO.File]::ReadAllBytes($tmp))
Remove-Item $tmp

$svg = @"
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <linearGradient id="b" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#1c3a96"/>
      <stop offset="1" stop-color="#12266a"/>
    </linearGradient>
  </defs>
  <rect width="64" height="64" rx="14" fill="url(#b)"/>
  <rect x="4" y="4" width="56" height="56" rx="11" fill="#ffffff"/>
  <image x="7" y="7" width="50" height="50" href="data:image/png;base64,$b64" preserveAspectRatio="xMidYMid meet"/>
</svg>
"@

$out = Join-Path $root 'public\favicon.svg'
[IO.File]::WriteAllText($out, $svg, (New-Object System.Text.UTF8Encoding($false)))
Write-Output ("public\favicon.svg written, {0} bytes" -f (Get-Item $out).Length)
