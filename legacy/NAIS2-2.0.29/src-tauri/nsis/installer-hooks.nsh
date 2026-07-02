!macro NSIS_HOOK_PREINSTALL
  ; Kill any running tagger-server.exe processes before installation
  ; Use /T to kill child processes as well
  nsExec::ExecToLog 'taskkill /F /T /IM tagger-server.exe'
  ; Wait a moment for processes to fully terminate
  Sleep 500
  ; Also kill the main app if running (to ensure clean install/update)
  nsExec::ExecToLog 'taskkill /F /T /IM NAIS2.exe'
  ; Wait for file handles to be released
  Sleep 1000
!macroend
