!include "nsDialogs.nsh"
!include "FileFunc.nsh"
!include "LogicLib.nsh"
!include "MUI2.nsh"

!undef APP_FILENAME
!define APP_FILENAME "AgentBrowser"

!ifndef BUILD_UNINSTALLER
Var directoryInput
Var directoryBrowse

# Replace the stock directory page so Browse immediately shows the final path.
!macro customWelcomePage
  !undef allowToChangeInstallationDirectory
!macroend

!macro customPageAfterChangeDir
  Page custom AgentDirectoryCreate AgentDirectoryLeave
!macroend

Function NormalizeAgentDirectory
  # Trim separators before checking the final component (including existing installs).
  trimSeparator:
    StrCpy $0 $INSTDIR 1 -1
    StrCmp $0 "\" 0 trimmed
    StrCpy $INSTDIR $INSTDIR -1
    Goto trimSeparator
  trimmed:
  ${GetFileName} "$INSTDIR" $0
  ${If} $0 != "AgentBrowser"
    StrCpy $INSTDIR "$INSTDIR\AgentBrowser"
  ${EndIf}
FunctionEnd

Function AgentDirectoryCreate
  !insertmacro MUI_HEADER_TEXT "安装位置" "选择 AgentBrowser 的安装位置"
  Call NormalizeAgentDirectory
  nsDialogs::Create 1018
  Pop $0
  ${If} $0 == error
    Abort
  ${EndIf}
  ${NSD_CreateLabel} 0 10u 100% 24u "安装文件夹"
  Pop $0
  ${NSD_CreateDirRequest} 0 40u 78% 14u "$INSTDIR"
  Pop $directoryInput
  ${NSD_CreateBrowseButton} 80% 39u 20% 16u "浏览…"
  Pop $directoryBrowse
  ${NSD_OnClick} $directoryBrowse AgentDirectoryBrowse
  nsDialogs::Show
FunctionEnd

Function AgentDirectoryBrowse
  Pop $0
  ${NSD_GetText} $directoryInput $INSTDIR
  nsDialogs::SelectFolderDialog "选择安装位置" "$INSTDIR"
  Pop $0
  ${If} $0 != error
    StrCpy $INSTDIR $0
    Call NormalizeAgentDirectory
    ${NSD_SetText} $directoryInput $INSTDIR
  ${EndIf}
FunctionEnd

Function AgentDirectoryLeave
  ${NSD_GetText} $directoryInput $INSTDIR
  ${If} $INSTDIR == ""
    Abort
  ${EndIf}
  ${GetRoot} "$INSTDIR" $0
  ${If} $0 == ""
    MessageBox MB_OK "请选择完整的安装路径"
    Abort
  ${EndIf}
  Call NormalizeAgentDirectory
  ${NSD_SetText} $directoryInput $INSTDIR
FunctionEnd
!endif

# Keep task resources and any other user-added files during uninstall/update.
!macro customRemoveFiles
  SetOutPath $TEMP
  Delete "$INSTDIR\${UNINSTALL_FILENAME}"
  Delete "$INSTDIR\AgentBrowser.exe"
  Delete "$INSTDIR\chrome_100_percent.pak"
  Delete "$INSTDIR\chrome_200_percent.pak"
  Delete "$INSTDIR\d3dcompiler_47.dll"
  Delete "$INSTDIR\dxcompiler.dll"
  Delete "$INSTDIR\dxil.dll"
  Delete "$INSTDIR\ffmpeg.dll"
  Delete "$INSTDIR\icudtl.dat"
  Delete "$INSTDIR\LICENSE.electron.txt"
  Delete "$INSTDIR\LICENSES.chromium.html"
  Delete "$INSTDIR\resources.pak"
  Delete "$INSTDIR\snapshot_blob.bin"
  Delete "$INSTDIR\v8_context_snapshot.bin"
  Delete "$INSTDIR\version"
  Delete "$INSTDIR\vk_swiftshader_icd.json"
  Delete "$INSTDIR\vk_swiftshader.dll"
  Delete "$INSTDIR\vulkan-1.dll"
  Delete "$INSTDIR\locales\en-US.pak"
  Delete "$INSTDIR\locales\zh-CN.pak"
  Delete "$INSTDIR\locales\zh-TW.pak"
  Delete "$INSTDIR\resources\app-update.yml"
  Delete "$INSTDIR\resources\app.asar"
  Delete "$INSTDIR\resources\default_app.asar"
  Delete "$INSTDIR\resources\elevate.exe"
  RMDir "$INSTDIR\locales"
  RMDir "$INSTDIR\resources"
  RMDir "$INSTDIR"
!macroend
