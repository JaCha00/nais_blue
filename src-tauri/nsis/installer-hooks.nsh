!macro NSIS_HOOK_PREINSTALL
  ; The updater exits the tracked main process before NSIS starts. Only the
  ; untracked tagger sidecar needs a defensive cleanup before files are replaced.
  nsExec::ExecToLog 'taskkill /F /T /IM tagger-server.exe'
  Sleep 500

  ; Disable reboot flag - prevent Windows from requesting restart
  SetRebootFlag false
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; After installation, ensure no reboot is triggered
  SetRebootFlag false
!macroend
