param([string]$InputRun = 'samsung-r2', [string]$Label = 'pixel-audit-r1')
$ErrorActionPreference = 'Stop'
if ($InputRun -notmatch '^samsung-r[1-9][0-9]*$' -or $Label -notmatch '^pixel-audit-r[1-9][0-9]*$') { throw 'Invalid evidence label' }
$ocrRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$evidenceRoot = Join-Path $ocrRoot 'docs/migration-evidence/aeris-p0-ocr'
$inputRoot = Join-Path $evidenceRoot $InputRun
$outputRoot = Join-Path $evidenceRoot $Label
if (Test-Path -LiteralPath $outputRoot) { throw 'Existing evidence is protected' }
Add-Type -AssemblyName System.Drawing
Add-Type -ReferencedAssemblies System.Drawing.Common,System.Drawing.Primitives,System.Collections,System.Security.Cryptography,System.Private.Windows.GdiPlus,System.Private.Windows.Core -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Drawing;
using System.Security.Cryptography;
public static class OcrPixelAudit {
    public static Dictionary<string, object> Read(string path) {
        using (var image = new Bitmap(path)) {
            var pixels = new byte[image.Width * image.Height * 4];
            var bands = new List<int[]>();
            int[] active = null;
            bool gray = true;
            for (int y = 0; y < image.Height; ++y) {
                int left = image.Width, right = 0;
                for (int x = 0; x < image.Width; ++x) {
                    var p = image.GetPixel(x, y);
                    int offset = (y * image.Width + x) * 4;
                    pixels[offset] = p.R; pixels[offset + 1] = p.G;
                    pixels[offset + 2] = p.B; pixels[offset + 3] = p.A;
                    gray &= p.R == p.G && p.G == p.B && p.A == 255;
                    if (Math.Min(p.R, Math.Min(p.G, p.B)) < 240) { left = Math.Min(left, x); right = x + 1; }
                }
                if (right > left) {
                    if (active == null) active = new int[] { left, y, right, y + 1 };
                    else { active[0] = Math.Min(active[0], left); active[2] = Math.Max(active[2], right); active[3] = y + 1; }
                } else if (active != null) { bands.Add(active); active = null; }
            }
            if (active != null) bands.Add(active);
            string digest;
            using (var sha = SHA256.Create()) digest = BitConverter.ToString(sha.ComputeHash(pixels)).Replace("-", "").ToLowerInvariant();
            return new Dictionary<string, object> { {"width", image.Width}, {"height", image.Height},
                {"canonical_rgba_sha256", digest}, {"opaque_gray_pixels_only", gray}, {"foreground_bands", bands} };
        }
    }
}
'@
$originalPath = Join-Path $ocrRoot 'qa/aeris-finance-quality/sdk/assets/reference-original.png'
$source = [OcrPixelAudit]::Read($originalPath)
$decoded = [OcrPixelAudit]::Read((Join-Path $inputRoot 'original-six/original.png'))
$geometry = Get-Content -LiteralPath (Join-Path $inputRoot 'geometry/geometry.json') -Raw | ConvertFrom-Json
$box = $geometry.lines[0].box
$pad = $box[3] - $box[1]
$crop = @([Math]::Max(0, $box[0] - $pad), [Math]::Max(0, $box[1] - $pad), [Math]::Min($source.width, $box[2] + $pad), [Math]::Min($source.height, $box[3] + $pad))
$bands = @($source.foreground_bands | Where-Object { $_[1] -ge $crop[1] -and $_[3] -le $crop[3] })
$native = [OcrPixelAudit]::Read((Join-Path $inputRoot 'geometry/line-0-native.png'))
$gray = [OcrPixelAudit]::Read((Join-Path $inputRoot 'geometry/line-0-gray.png'))
$record = [ordered]@{
    expected_reference_hint = $false; foreground_threshold = 240
    original_png_sha256 = (Get-FileHash -LiteralPath $originalPath -Algorithm SHA256).Hash.ToLowerInvariant()
    source = $source; decoded_original = $decoded
    source_decode_reencoded_pixels_equal = ($source.width -eq $decoded.width -and $source.height -eq $decoded.height -and $source.canonical_rgba_sha256 -eq $decoded.canonical_rgba_sha256)
    detected_line_box = $box; padding = $pad; padded_crop = $crop; contained_foreground_bands = $bands
    entire_selected_band_inside_crop = ($bands.Count -eq 1 -and $bands[0][0] -ge $crop[0] -and $bands[0][2] -le $crop[2])
    grayscale_crop_pixels_unchanged = ($native.width -eq $gray.width -and $native.height -eq $gray.height -and $native.canonical_rgba_sha256 -eq $gray.canonical_rgba_sha256)
}
New-Item -ItemType Directory -Path $outputRoot | Out-Null
$record | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $outputRoot 'result.json') -Encoding utf8
$record | ConvertTo-Json -Depth 8
if ($record.original_png_sha256 -ne '46e6442173c53550e68f06bc8bbed7cb88557a751c8f244a9baa75100ff4c68f' -or
    -not $record.source_decode_reencoded_pixels_equal -or -not $record.entire_selected_band_inside_crop -or
    -not $record.grayscale_crop_pixels_unchanged -or -not $source.opaque_gray_pixels_only) { throw 'Pixel provenance check failed; raw evidence retained' }
