# export_apps.ps1
# Exporta todas las apps instaladas a un JSON editable

$OutputFile = "apps_export.json"

Write-Host "Exportando lista de aplicaciones instaladas..."
winget export --output $OutputFile --include-versions

Write-Host ""
Write-Host "➡ Archivo generado: $OutputFile"
Write-Host "Edita este JSON y deja solo lo que quieras instalar/actualizar."
Write-Host "y luego ejecuta: apply_apps.ps1"
Write-host ""
# Mantener la terminal abierta hasta que el usuario presione Enter
try {
	Read-Host -Prompt "Presiona Enter para cerrar la terminal..."
} catch {
	# Ignorar errores en entornos no interactivos
}