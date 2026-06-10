; ─────────────────────────────────────────────────────────────────────────────
; OnyxAz — Windows installer (Inno Setup)
;
; This installer COPIES the prebuilt plugin into a user's Obsidian vault and
; writes onyxaz.config.json. It never builds anything.
;
; To produce OnyxAz-Setup.exe:
;   1. Build the plugin once:           npm run build
;   2. Edit the three #define lines below to pre-fill your org's details
;      (so employees don't type GUIDs — they can still override during install).
;   3. Compile with Inno Setup 6+:      ISCC installer\onyxaz.iss
;      (Inno Setup is free: https://jrsoftware.org/isinfo.php)
;
; The resulting OnyxAz-Setup.exe is what you hand to employees. It needs no
; admin rights and installs per-user into the vault they choose.
; ─────────────────────────────────────────────────────────────────────────────

#define MyAppName "OnyxAz"
#define MyAppVersion "0.4.0"

; ── Pre-fill these with your organization's details (or leave as-is) ──────────
#define DefaultOrgUrl "https://dev.azure.com/yourorg"
#define DefaultClientId ""
#define DefaultTenantId "organizations"

[Setup]
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppName}
DefaultDirName={autopf}\OnyxAz
CreateAppDir=no
DisableDirPage=yes
DisableProgramGroupPage=yes
Uninstallable=no
OutputBaseFilename=OnyxAz-Setup
WizardStyle=modern
PrivilegesRequired=lowest

[Files]
Source: "..\main.js";       DestDir: "{code:GetPluginDir}"; Flags: ignoreversion
Source: "..\manifest.json"; DestDir: "{code:GetPluginDir}"; Flags: ignoreversion
Source: "..\styles.css";    DestDir: "{code:GetPluginDir}"; Flags: ignoreversion

[Code]
var
  VaultPage: TInputDirWizardPage;
  ConfigPage: TInputQueryWizardPage;

procedure InitializeWizard;
begin
  VaultPage := CreateInputDirPage(wpWelcome,
    'Select your Obsidian vault',
    'Where is your Obsidian vault?',
    'OnyxAz will be installed into this vault''s .obsidian\plugins folder.' + #13#10 +
    'Choose the top-level folder of your vault.',
    False, '');
  VaultPage.Add('Vault folder:');

  ConfigPage := CreateInputQueryPage(VaultPage.ID,
    'Azure DevOps connection',
    'These are usually provided by your IT team.',
    'Pre-filled values can be left as-is. The client ID may be left blank if ' +
    'your users will sign in with a Personal Access Token instead.');
  ConfigPage.Add('Organization URL:', False);
  ConfigPage.Add('Application (client) ID:', False);
  ConfigPage.Add('Tenant ID:', False);
  ConfigPage.Values[0] := '{#DefaultOrgUrl}';
  ConfigPage.Values[1] := '{#DefaultClientId}';
  ConfigPage.Values[2] := '{#DefaultTenantId}';
end;

function GetPluginDir(Param: String): String;
begin
  Result := AddBackslash(VaultPage.Values[0]) + '.obsidian\plugins\onyxaz';
end;

function JsonEscape(S: String): String;
begin
  StringChangeEx(S, '\', '\\', True);
  StringChangeEx(S, '"', '\"', True);
  Result := S;
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  if CurPageID = VaultPage.ID then
  begin
    if Trim(VaultPage.Values[0]) = '' then
    begin
      MsgBox('Please choose your Obsidian vault folder.', mbError, MB_OK);
      Result := False;
    end
    else if not DirExists(AddBackslash(VaultPage.Values[0]) + '.obsidian') then
    begin
      if MsgBox('That folder has no .obsidian subfolder, so it may not be an Obsidian vault. ' +
                'Continue anyway?', mbConfirmation, MB_YESNO) = IDNO then
        Result := False;
    end;
  end;
end;

procedure CurStepChanged(CurStep: TSetupStep);
var
  Cfg, Dir: String;
begin
  if CurStep = ssPostInstall then
  begin
    Dir := GetPluginDir('');
    Cfg :=
      '{' + #13#10 +
      '  "organizationUrl": "' + JsonEscape(Trim(ConfigPage.Values[0])) + '",' + #13#10 +
      '  "clientId": "' + JsonEscape(Trim(ConfigPage.Values[1])) + '",' + #13#10 +
      '  "tenantId": "' + JsonEscape(Trim(ConfigPage.Values[2])) + '"' + #13#10 +
      '}' + #13#10;
    SaveStringToFile(AddBackslash(Dir) + 'onyxaz.config.json', Cfg, False);
  end;
end;
