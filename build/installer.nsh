; Recovers only a broken prior per-user installation.  A normal installation
; keeps its registry entry so electron-builder can still perform upgrades.

!ifndef BUILD_UNINSTALLER

!macro preInit
  ; Run before electron-builder reads the previous InstallLocation.
  ReadRegStr $0 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  StrCmp $0 "" inspectUninstallRecord
  IfFileExists "$0\${UNINSTALL_FILENAME}" staleUninstallDone

  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"
  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"
  Goto staleUninstallDone

inspectUninstallRecord:
  ReadRegStr $0 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  StrCmp $0 "" staleUninstallDone

  Push $0
  Call ExtractUninstallerPath
  Pop $1
  IfFileExists "$1" staleUninstallDone

  DeleteRegKey HKCU "${UNINSTALL_REGISTRY_KEY}"

staleUninstallDone:
!macroend

; Electron-builder stores the uninstall command as:
; "C:\path\Uninstall SpeakHub.exe" /currentuser
; Return just the executable path so NSIS can test whether it still exists.
Function ExtractUninstallerPath
  Exch $0
  StrCpy $1 $0 1
  StrCmp $1 "$\"" 0 unquotedPath

  StrCpy $2 1
quotedPathLoop:
  StrCpy $3 $0 1 $2
  StrCmp $3 "" unquotedPath
  StrCmp $3 "$\"" quotedPathFound
  IntOp $2 $2 + 1
  Goto quotedPathLoop

quotedPathFound:
  StrCpy $0 $0 $2 1

unquotedPath:
  Push $0
FunctionEnd

!endif
