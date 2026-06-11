# Generates the raster brand assets (apple-touch-icon.png, og.png) in the
# GRIDIRON palette. Run once after changing the brand; outputs land in public/.
Add-Type -AssemblyName System.Drawing

$ink = [System.Drawing.Color]::FromArgb(10, 10, 10)
$ink2 = [System.Drawing.Color]::FromArgb(20, 20, 18)
$lime = [System.Drawing.Color]::FromArgb(166, 226, 46)
$bone = [System.Drawing.Color]::FromArgb(232, 226, 212)
$boneDim = [System.Drawing.Color]::FromArgb(138, 132, 120)
$publicDir = Join-Path $PSScriptRoot '..\public'

# --- apple-touch-icon: 180x180 version of the favicon mark ---
$bmp = New-Object System.Drawing.Bitmap(180, 180)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear($ink)
$limePen = New-Object System.Drawing.Pen($lime, 12)
$g.DrawRectangle($limePen, 12, 12, 156, 156)
$font = New-Object System.Drawing.Font('Arial Black', 62, [System.Drawing.FontStyle]::Bold)
$limeBrush = New-Object System.Drawing.SolidBrush($lime)
$boneBrush = New-Object System.Drawing.SolidBrush($bone)
$fmt = New-Object System.Drawing.StringFormat
$fmt.Alignment = 'Center'
$g.DrawString('FA', $font, $limeBrush, 90, 36, $fmt)
$g.FillRectangle($boneBrush, 36, 134, 108, 10)
$bmp.Save((Join-Path $publicDir 'apple-touch-icon.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()

# --- og.png: 1200x630 share card ---
$bmp = New-Object System.Drawing.Bitmap(1200, 630)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.SmoothingMode = 'AntiAlias'
$g.TextRenderingHint = 'AntiAliasGridFit'
$g.Clear($ink)

# Faint yard-line grid
$gridPen = New-Object System.Drawing.Pen($ink2, 2)
for ($x = 0; $x -le 1200; $x += 60) { $g.DrawLine($gridPen, $x, 0, $x, 630) }
for ($y = 0; $y -le 630; $y += 60) { $g.DrawLine($gridPen, 0, $y, 1200, $y) }

# Lime frame
$framePen = New-Object System.Drawing.Pen($lime, 8)
$g.DrawRectangle($framePen, 24, 24, 1152, 582)

# Kicker
$kickerFont = New-Object System.Drawing.Font('Consolas', 22, [System.Drawing.FontStyle]::Bold)
$limeBrush = New-Object System.Drawing.SolidBrush($lime)
$g.DrawString('* FREE / OPEN SOURCE / NO ACCOUNTS', $kickerFont, $limeBrush, 80, 100)

# Headline
$titleFont = New-Object System.Drawing.Font('Arial Black', 78, [System.Drawing.FontStyle]::Bold)
$boneBrush = New-Object System.Drawing.SolidBrush($bone)
$g.DrawString('FANTASY', $titleFont, $boneBrush, 70, 150)
$g.DrawString('FOOTBALL', $titleFont, $boneBrush, 70, 260)
$g.DrawString('ANALYZER', $titleFont, $limeBrush, 70, 370)

# Sub line
$subFont = New-Object System.Drawing.Font('Consolas', 24)
$dimBrush = New-Object System.Drawing.SolidBrush($boneDim)
$g.DrawString('Draft room - grades - trades - waivers - luck - awards', $subFont, $dimBrush, 80, 510)

# Bone rule above sub line
$boneSolid = New-Object System.Drawing.SolidBrush($bone)
$g.FillRectangle($boneSolid, 80, 495, 1040, 4)

$bmp.Save((Join-Path $publicDir 'og.png'), [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $bmp.Dispose()
Write-Output 'Wrote public/apple-touch-icon.png and public/og.png'
