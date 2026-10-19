!macro customInstallMode
  ; Keep the app in the current user's Programs folder without requiring admin.
  StrCpy $isForceCurrentInstall "1"
!macroend

!macro customUnInstall
  ; Only remove this app's startup values; leave all time records in AppData.
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "com.shiguang.workorb"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "拾光工作球"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "com.shiguang.workorb"
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run" "拾光工作球"
  ; Stage cleanup before the executable and installation folder are removed.
  SetOutPath $PLUGINSDIR
  File /oname=shiguang-cleanup.ps1 "${BUILD_RESOURCES_DIR}\cleanup-data.ps1"
!macroend

!macro customUninstallPage
Function un.onUninstSuccess
  ; Silent uninstall and upgrades always preserve records. The ordinary wizard
  ; asks only after the application removal section has completed.
  ${IfNot} ${Silent}
  ${AndIfNot} ${isUpdated}
    ${If} $LANGUAGE == 2052
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "拾光程序已卸载。$\r$\n$\r$\n是否同时删除当前工时记录、设置与缓存？此操作无法撤销。$\r$\n选择“否”可在重新安装后继续使用这些数据。导出的备份和迁移时留存的旧副本不会删除。" IDNO shiguang_keep_data
    ${Else}
      MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Shiguang has been uninstalled.$\r$\n$\r$\nDelete the current work records, settings and cache too? This cannot be undone.$\r$\nChoose No to keep them for a future installation. Exported backups and older migration copies are kept." IDNO shiguang_keep_data
    ${EndIf}
    nsExec::ExecToStack '"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "$PLUGINSDIR\shiguang-cleanup.ps1" -AppDataDirectory "$APPDATA\拾光"'
    Pop $0
    Pop $1
    ${If} $0 != 0
      ${If} $LANGUAGE == 2052
        MessageBox MB_OK|MB_ICONEXCLAMATION "部分数据未能删除，请检查数据文件夹：$\r$\n$APPDATA\拾光"
      ${Else}
        MessageBox MB_OK|MB_ICONEXCLAMATION "Some data could not be deleted. Please check:$\r$\n$APPDATA\拾光"
      ${EndIf}
    ${EndIf}
    shiguang_keep_data:
  ${EndIf}
FunctionEnd
!macroend
