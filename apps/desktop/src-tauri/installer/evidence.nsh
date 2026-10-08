; Clock evidence is deliberately retained even when Delete app data was selected.
; The template declares these variables before expanding the uninstall hook.
!macro NSIS_HOOK_PREUNINSTALL
  ${If} $DeleteAppDataCheckboxState = 1
  ${AndIf} $UpdateMode <> 1
  ${AndIf} $PassiveMode <> 1
  ${AndIfNot} ${Silent}
    ${If} $LANGUAGE = 1031
      MessageBox MB_OK|MB_ICONINFORMATION "Gespeicherte Stempelaktionen und Nachweise bleiben auf diesem Computer erhalten. Synchronisieren und klären Sie diese in Z8, bevor Sie App-Daten manuell entfernen."
    ${Else}
      MessageBox MB_OK|MB_ICONINFORMATION "Saved clock actions and evidence remain on this computer. Synchronize and review them in Z8 before removing app data manually."
    ${EndIf}
  ${EndIf}
  StrCpy $DeleteAppDataCheckboxState 0
  ${If} $UpdateMode <> 1
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "Z8Timer"
  ${EndIf}
!macroend