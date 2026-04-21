$symbol = [Convert]::ToBase64String([IO.File]::ReadAllBytes('b-spline-gen/html/fonts/symbol.ttf'))
$webdings = [Convert]::ToBase64String([IO.File]::ReadAllBytes('b-spline-gen/html/fonts/webdings.ttf'))
$wingdings = [Convert]::ToBase64String([IO.File]::ReadAllBytes('b-spline-gen/html/fonts/wingdings.ttf'))

$css = @"
@font-face {
    font-family: 'LocalSymbol';
    src: url('data:font/ttf;base64,$symbol') format('truetype');
}
@font-face {
    font-family: 'LocalWebdings';
    src: url('data:font/ttf;base64,$webdings') format('truetype');
}
@font-face {
    font-family: 'LocalWingdings';
    src: url('data:font/ttf;base64,$wingdings') format('truetype');
}
"@

$css | Out-File -Encoding utf8 b-spline-gen/html/fonts-embedded.css
Write-Host "Created fonts-embedded.css successfully"
