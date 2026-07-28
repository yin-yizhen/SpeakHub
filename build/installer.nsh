; Recovers broken per-user and per-machine installations.  Valid registrations
; remain untouched so electron-builder can perform normal upgrades.

!ifndef BUILD_UNINSTALLER

!macro CleanupStaleUninstallRecord ROOT_KEY LABEL_SUFFIX
  StrCpy $3 "false"
  ReadRegStr $0 ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  StrCmp $0 "" cleanupStale_${LABEL_SUFFIX}

  Push $0
  Call ExtractUninstallerPath
  Pop $1
  IfFileExists "$1" 0 cleanupStale_${LABEL_SUFFIX}

  StrCpy $3 "true"
  Goto cleanupDone_${LABEL_SUFFIX}

cleanupStale_${LABEL_SUFFIX}:
  ; Keep InstallLocation so a repair defaults to the previous directory.
  ; Only the unusable uninstall command must be removed.
  DeleteRegKey ${ROOT_KEY} "${UNINSTALL_REGISTRY_KEY}"

cleanupDone_${LABEL_SUFFIX}:
!macroend

!macro preInit
  ; preInit runs before electron-builder selects the registry view.  SpeakHub
  ; is packaged as x64, so select the same 64-bit view used by normal installs.
  SetRegView 64

  !insertmacro CleanupStaleUninstallRecord HKCU currentUser
  !insertmacro CleanupStaleUninstallRecord HKLM allUsers

  ; A successful migration to all-users can leave a per-user InstallLocation
  ; without a per-user uninstall command.  Remove only that duplicate when the
  ; valid machine installation uses the same directory.
  StrCmp $3 "true" 0 preInitDone
  ReadRegStr $4 HKCU "${UNINSTALL_REGISTRY_KEY}" "UninstallString"
  StrCmp $4 "" 0 preInitDone
  ReadRegStr $5 HKLM "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  ReadRegStr $6 HKCU "${INSTALL_REGISTRY_KEY}" "InstallLocation"
  StrCmp $5 "" preInitDone
  StrCmp $5 $6 0 preInitDone
  DeleteRegKey HKCU "${INSTALL_REGISTRY_KEY}"

preInitDone:
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
