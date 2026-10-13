param(
    [string]$NodePath = (Get-Command node.exe -ErrorAction Stop).Source,
    [string]$OutputDirectory = (Join-Path $PSScriptRoot '../../../la-erp-recovery/授权生成器'),
    [string]$RecoveryPublicKey = (Join-Path $PSScriptRoot '../../../la-erp-recovery/keys/public.key')
)
$ErrorActionPreference = 'Stop'
$output = [IO.Path]::GetFullPath($OutputDirectory)
$compiler = Join-Path $env:WINDIR 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'
if (!(Test-Path -LiteralPath $compiler)) { throw '需要 Windows .NET Framework 4.x C# 编译器' }
New-Item -ItemType Directory -Path (Join-Path $output 'tools/desktop') -Force | Out-Null
Copy-Item -LiteralPath $NodePath -Destination (Join-Path $output 'node.exe')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'bridge.mjs') -Destination (Join-Path $output 'tools/desktop/bridge.mjs')
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '../license.mjs') -Destination (Join-Path $output 'tools/license.mjs')
if (Test-Path -LiteralPath $RecoveryPublicKey) { Copy-Item -LiteralPath $RecoveryPublicKey -Destination (Join-Path $output 'recovery-public.key') }
$executable = Join-Path $output 'LA-ERP授权生成器.exe'
& $compiler /nologo /target:winexe /optimize+ /utf8output "/out:$executable" /reference:System.Windows.Forms.dll /reference:System.Drawing.dll /reference:System.Web.Extensions.dll (Join-Path $PSScriptRoot 'LicenseGenerator.cs')
if ($LASTEXITCODE -ne 0) { throw '编译失败' }
Copy-Item -LiteralPath (Join-Path $PSScriptRoot '使用说明.txt') -Destination $output
# Preserve the runtime's third-party notices alongside the portable binary.
$nodeLicense = Join-Path (Split-Path $NodePath) 'LICENSE'
if (Test-Path -LiteralPath $nodeLicense) { Copy-Item -LiteralPath $nodeLicense -Destination (Join-Path $output 'NODE-LICENSE.txt') }
Write-Output $executable
