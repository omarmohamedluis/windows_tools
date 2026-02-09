# apply_apps.ps1
# Importa el JSON y actualiza/instala solo las apps seleccionadas

$InputFile = "apps_export.json"

if (!(Test-Path $InputFile)) {
    Write-Host "❌ No se encontró $InputFile"
    exit
}

Write-Host "Ejecutando importación desde $InputFile..."
winget import `
    --import-file $InputFile `
    --ignore-unavailable `
    --ignore-versions `
    --accept-package-agreements `
    --accept-source-agreements

Write-Host ""
Write-Host "✅ Importación completada."
Write-Host ""
# Mantener la terminal abierta hasta que el usuario presione Enter
try {
    Read-Host -Prompt "Presiona Enter para cerrar la terminal..."
} catch {
    # En algunos entornos (ej. ejecución no interactiva) Read-Host puede fallar, ignoramos el error
}
