$symbol = [Convert]::ToBase64String([IO.File]::ReadAllBytes('b-spline-gen/html/fonts/symbol.ttf'))
$webdings = [Convert]::ToBase64String([IO.File]::ReadAllBytes('b-spline-gen/html/fonts/webdings.ttf'))
$wingdings = [Convert]::ToBase64String([IO.File]::ReadAllBytes('b-spline-gen/html/fonts/wingdings.ttf'))

$js = @"
/* AUTO-GENERATED EMBEDDED FONTS DATA */
export const FONT_DATA_SYMBOL = '$symbol';
export const FONT_DATA_WEBDINGS = '$webdings';
export const FONT_DATA_WINGDINGS = '$wingdings';
"@

$js | Out-File -Encoding utf8 b-spline-gen/html/editor/fonts-config.js
Write-Host "Created editor/fonts-config.js successfully"
