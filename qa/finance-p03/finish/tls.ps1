# Ephemeral local TLS only: no Windows trust store or APK signing material.
$ErrorActionPreference='Stop'
$tlsOutput=Join-Path (Get-Location) 'docs/migration-evidence/finance-p03/finish'
$tlsPrivate=Join-Path $tlsOutput 'private'
if(Test-Path -LiteralPath $tlsPrivate){throw 'Preserve prior private test runtime'}
New-Item -ItemType Directory -Path $tlsPrivate | Out-Null
$tlsPublic=Join-Path $tlsOutput 'generated-res/raw'
New-Item -ItemType Directory -Path $tlsPublic -Force | Out-Null
$tlsRsa=[Security.Cryptography.RSA]::Create(2048)
try {
 $tlsRequest=[Security.Cryptography.X509Certificates.CertificateRequest]::new('CN=localhost',$tlsRsa,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1)
 $tlsRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509BasicConstraintsExtension]::new($true,$false,0,$true))
 $tlsRequest.CertificateExtensions.Add([Security.Cryptography.X509Certificates.X509KeyUsageExtension]::new(([Security.Cryptography.X509Certificates.X509KeyUsageFlags]::DigitalSignature -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyEncipherment -bor [Security.Cryptography.X509Certificates.X509KeyUsageFlags]::KeyCertSign),$true))
 $tlsNames=[Security.Cryptography.X509Certificates.SubjectAlternativeNameBuilder]::new();$tlsNames.AddDnsName('localhost');$tlsNames.AddIpAddress([Net.IPAddress]::Parse('127.0.0.1'));$tlsRequest.CertificateExtensions.Add($tlsNames.Build())
 $tlsCertificate=$tlsRequest.CreateSelfSigned([DateTimeOffset]::UtcNow.AddMinutes(-2),[DateTimeOffset]::UtcNow.AddDays(3))
 $tlsPem=$tlsCertificate.ExportCertificatePem()
 [IO.File]::WriteAllText((Join-Path $tlsPrivate 'localhost.key'),$tlsRsa.ExportPkcs8PrivateKeyPem(),[Text.UTF8Encoding]::new($false))
 [IO.File]::WriteAllText((Join-Path $tlsPrivate 'localhost.crt'),$tlsPem,[Text.UTF8Encoding]::new($false))
 [IO.File]::WriteAllText((Join-Path $tlsPublic 'p03_device_ca.pem'),$tlsPem,[Text.UTF8Encoding]::new($false))
 @{scope='owned loopback HTTPS only';system_certificate_store_modified=$false;valid_to=$tlsCertificate.NotAfter.ToUniversalTime().ToString('o');public_ca_sha256=(Get-FileHash -LiteralPath (Join-Path $tlsPublic 'p03_device_ca.pem') -Algorithm SHA256).Hash.ToLowerInvariant();private_key_logged=$false}|ConvertTo-Json|Set-Content -LiteralPath (Join-Path $tlsOutput 'tls-public.json') -Encoding UTF8
}finally{$tlsRsa.Dispose()}
Get-Content -LiteralPath (Join-Path $tlsOutput 'tls-public.json') -Raw
