# rm_intswitch.ps1
# A verbose removal script for VM network adapters and VM switches.
# Color scheme:
#   - Headers: Cyan
#   - Menu items and informational messages: Green
#   - User input prompts: Yellow
#   - Warnings/Errors: Red
#
# Patience is a virtue, so sit back and let this script do the heavy lifting!

# Check if the script is running in an elevated (administrator) PowerShell session.
if (-not ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltinRole]::Administrator)) {
    Write-Host "ERROR: This script must be run from an elevated PowerShell (Run as Administrator)." -ForegroundColor Red
    exit
}

# Welcome Header
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host "                 Welcome to VLANify Remove Tool                    " -ForegroundColor Cyan
Write-Host "     A script to remove VM network adapters and VM switches         " -ForegroundColor Cyan
Write-Host "===================================================================" -ForegroundColor Cyan
Write-Host ""

# Main Menu (headers in cyan, menu items in green, user prompt in yellow)
Write-Host "Select the resource to remove:" -ForegroundColor Cyan
Write-Host "1) Remove VM Network Adapter" -ForegroundColor Green
Write-Host "2) Remove VM Switch" -ForegroundColor Green
Write-Host "3) Exit" -ForegroundColor Green
Write-Host "Enter your choice (1, 2, or 3):" -ForegroundColor Yellow
$menuChoice = Read-Host

switch ($menuChoice) {
    "1" {
        # Remove VM Network Adapter
        Write-Host "`n*** Removing VM Network Adapter ***" -ForegroundColor Cyan
        $adapters = Get-VMNetworkAdapter -ManagementOS
        if (-not $adapters) {
            Write-Host "WARNING: No VM network adapters found on the Management OS." -ForegroundColor Red
            exit
        }
        Write-Host "VM Network Adapters Found:" -ForegroundColor Green
        $index = 1
        foreach ($adapter in $adapters) {
            Write-Host "$index. $($adapter.Name) - VLAN: $($adapter.AccessVlanId)" -ForegroundColor Green
            $index++
        }
        Write-Host "Enter the number of the VM network adapter you want to remove:" -ForegroundColor Yellow
        $choiceAdapter = Read-Host
        if (-not [int]::TryParse($choiceAdapter, [ref]$null)) {
            Write-Host "ERROR: Invalid input. Exiting." -ForegroundColor Red
            exit
        }
        $selectedIndex = [int]$choiceAdapter - 1
        if ($selectedIndex -lt 0 -or $selectedIndex -ge $adapters.Count) {
            Write-Host "ERROR: Invalid selection. Exiting." -ForegroundColor Red
            exit
        }
        $selectedAdapter = $adapters[$selectedIndex]
        $adapterName = $selectedAdapter.Name
        Write-Host "Are you sure you want to remove the VM network adapter '$adapterName'? (Y/N):" -ForegroundColor Yellow
        $confirm = Read-Host
        if ($confirm -match "^[Yy]") {
            try {
                Write-Host "Please wait... Removing VM network adapter '$adapterName'..." -ForegroundColor Green
                Remove-VMNetworkAdapter -ManagementOS -VMNetworkAdapterName $adapterName
                Write-Host "VM network adapter '$adapterName' has been removed successfully." -ForegroundColor Green
            }
            catch {
                Write-Host "ERROR: Failed to remove adapter '$adapterName': $($_.Exception.Message)" -ForegroundColor Red
            }
        }
        else {
            Write-Host "Removal aborted by the user." -ForegroundColor Yellow
        }
    }
    "2" {
        # Remove VM Switch
        Write-Host "`n*** Removing VM Switch ***" -ForegroundColor Cyan
        $switches = Get-VMSwitch
        if (-not $switches) {
            Write-Host "WARNING: No VM switches found on the Management OS." -ForegroundColor Red
            exit
        }
        Write-Host "VM Switches Found:" -ForegroundColor Green
        $index = 1
        foreach ($switch in $switches) {
            Write-Host "$index. $($switch.Name)" -ForegroundColor Green
            $index++
        }
        Write-Host "Enter the number of the VM switch you want to remove:" -ForegroundColor Yellow
        $choiceSwitch = Read-Host
        if (-not [int]::TryParse($choiceSwitch, [ref]$null)) {
            Write-Host "ERROR: Invalid input. Exiting." -ForegroundColor Red
            exit
        }
        $selectedIndex = [int]$choiceSwitch - 1
        if ($selectedIndex -lt 0 -or $selectedIndex -ge $switches.Count) {
            Write-Host "ERROR: Invalid selection. Exiting." -ForegroundColor Red
            exit
        }
        $selectedSwitch = $switches[$selectedIndex]
        $switchName = $selectedSwitch.Name

        Write-Host "Checking adapters connected to switch '$switchName'..." -ForegroundColor Cyan
        
        # Get host (Management OS) adapters connected to the switch.
        $hostAdapters = Get-VMNetworkAdapter -ManagementOS | Where-Object { $_.SwitchName -eq $switchName }
        # Get VM adapters connected to the switch.
        $vmAdapters = Get-VM | ForEach-Object { Get-VMNetworkAdapter -VMName $_.Name } | Where-Object { $_.SwitchName -eq $switchName }
        
        # Combine adapters into one array with a Type property.
        $allAdapters = @()
        if ($hostAdapters) {
            $allAdapters += $hostAdapters | ForEach-Object {
                [PSCustomObject]@{
                    Name       = $_.Name
                    Type       = "Host"
                    SwitchName = $_.SwitchName
                }
            }
        }
        if ($vmAdapters) {
            $allAdapters += $vmAdapters | ForEach-Object {
                [PSCustomObject]@{
                    Name       = $_.Name
                    Type       = "VM (from $($_.VMName))"
                    SwitchName = $_.SwitchName
                }
            }
        }
        
        if ($allAdapters.Count -gt 0) {
            Write-Host "The following network adapters are connected to '$switchName':" -ForegroundColor Green
            $allAdapters | Format-Table Name, Type, SwitchName -AutoSize
        }
        else {
            Write-Host "No network adapters are connected to '$switchName'." -ForegroundColor Green
        }
        
        # If there are VM adapters, warn the user.
        if ($vmAdapters -and $vmAdapters.Count -gt 0) {
            Write-Host "WARNING: Deleting the switch will leave the above VM network adapters orphaned." -ForegroundColor Red
            Write-Host "Do you want to remove these VM network adapters as well? (Y/N):" -ForegroundColor Yellow
            $removeVMAdapters = Read-Host
            if ($removeVMAdapters -match "^[Yy]") {
                foreach ($vmAdapter in $vmAdapters) {
                    try {
                        Write-Host "Please wait... Removing VM adapter '$($vmAdapter.Name)' from VM '$($vmAdapter.VMName)'..." -ForegroundColor Green
                        Remove-VMNetworkAdapter -VMName $vmAdapter.VMName -VMNetworkAdapterName $vmAdapter.Name
                        Write-Host "Removed VM adapter '$($vmAdapter.Name)' from VM '$($vmAdapter.VMName)'." -ForegroundColor Green
                    }
                    catch {
                        Write-Host "ERROR: Could not remove VM adapter '$($vmAdapter.Name)' from VM '$($vmAdapter.VMName)': $($_.Exception.Message)" -ForegroundColor Red
                    }
                }
            }
            else {
                Write-Host "Proceeding without removing VM network adapters. They will become orphaned." -ForegroundColor Yellow
            }
        }
        
        Write-Host "Are you sure you want to remove the VM switch '$switchName'? (Y/N):" -ForegroundColor Yellow
        $confirm = Read-Host
        if ($confirm -match "^[Yy]") {
            try {
                Write-Host "Please wait... Removing VM switch '$switchName'..." -ForegroundColor Green
                Remove-VMSwitch -Name $switchName
                Write-Host "VM switch '$switchName' has been removed successfully." -ForegroundColor Green
            }
            catch {
                Write-Host "ERROR: Could not remove switch '$switchName': $($_.Exception.Message)" -ForegroundColor Red
            }
        }
        else {
            Write-Host "Removal aborted by the user." -ForegroundColor Yellow
        }
    }
    "3" {
        Write-Host "Exiting rm_intswitch.ps1. Have a great day!" -ForegroundColor Green
        exit
    }
    default {
        Write-Host "ERROR: Invalid selection. Exiting." -ForegroundColor Red
        exit
    }
}

Write-Host "`nExiting rm_intswitch.ps1. Thank you and remember: patience is a virtue!" -ForegroundColor Green
