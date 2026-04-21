$symbol = [Convert]::ToBase64String([IO.File]::ReadAllBytes('b-spline-gen/html/fonts/symbol.ttf'))
$webdings = [Convert]::ToBase64String([IO.File]::ReadAllBytes('b-spline-gen/html/fonts/webdings.ttf'))
$wingdings = [Convert]::ToBase64String([IO.File]::ReadAllBytes('b-spline-gen/html/fonts/wingdings.ttf'))

# JS Config
$js = @"
/* AUTO-GENERATED EMBEDDED FONTS DATA */
export const FONT_DATA_SYMBOL = '$symbol';
export const FONT_DATA_WEBDINGS = '$webdings';
export const FONT_DATA_WINGDINGS = '$wingdings';
"@
$js | Out-File -Encoding utf8 b-spline-gen/html/editor/fonts-config.js

# CSS Config
$css = @"
@font-face {
    font-family: 'CAD_SYMBOL';
    src: url('data:font/ttf;base64,$symbol') format('truetype');
    font-weight: 400;
    font-style: normal;
}
@font-face {
    font-family: 'CAD_WEBDINGS';
    src: url('data:font/ttf;base64,$webdings') format('truetype');
    font-weight: 400;
    font-style: normal;
}
@font-face {
    font-family: 'CAD_WINGDINGS';
    src: url('data:font/ttf;base64,$wingdings') format('truetype');
    font-weight: 400;
    font-style: normal;
}
"@
$css | Out-File -Encoding utf8 b-spline-gen/html/fonts-embedded.css

Write-Host "Created CAD_ prefix fonts successfully"
